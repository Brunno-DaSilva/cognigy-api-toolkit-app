import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { useActiveProject } from "./ActiveProjectContext";
import { toLocalDatetime, getYesterday } from "../utils";
import { ANALYTICS_ENDPOINTS } from "../constants";

const AnalyticsCacheContext = createContext(null);

const initialFormState = () => ({
  apiKeyId: "",
  endpoint: ANALYTICS_ENDPOINTS[0].value,
  dateField: "timestamp",
  startDate: toLocalDatetime(getYesterday()),
  endDate: toLocalDatetime(new Date()),
});

const buildFilter = ({ cognigyProjectId, dateField, startDate, endDate }) => {
  const parts = [`projectId eq '${cognigyProjectId}'`];
  if (startDate) {
    parts.push(`${dateField} ge '${new Date(startDate).toISOString()}'`);
  }
  if (endDate) {
    parts.push(`${dateField} le '${new Date(endDate).toISOString()}'`);
  }
  return parts.join(" and ");
};

export const AnalyticsCacheProvider = ({ children }) => {
  const { activeProjectId } = useActiveProject();

  // Form inputs
  const [form, setForm] = useState(initialFormState);
  const updateForm = useCallback((patch) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  // Search + view selection
  const [search, setSearch] = useState("");
  const [viewColumns, setViewColumns] = useState([]);

  // Fetched data
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  // When the active project changes, clear cached data — it belongs to a
  // different project. Form inputs keep their last values; only the fetched
  // results get reset.
  const prevProjectIdRef = useRef(activeProjectId);
  useEffect(() => {
    if (prevProjectIdRef.current !== activeProjectId) {
      prevProjectIdRef.current = activeProjectId;
      setRows([]);
      setColumns([]);
      setDone(false);
      setError(null);
      setSearch("");
      setViewColumns([]);
    }
  }, [activeProjectId]);

  const reset = useCallback(() => {
    setRows([]);
    setColumns([]);
    setDone(false);
    setError(null);
  }, []);

  const fetchAnalytics = useCallback(
    async ({
      apiKeyId,
      projectId,
      cognigyProjectId,
      endpoint,
      dateField,
      startDate,
      endDate,
    }) => {
      reset();
      setRunning(true);
      try {
        const filter = buildFilter({
          cognigyProjectId,
          dateField,
          startDate,
          endDate,
        });

        const { data, error: invokeError } = await supabase.functions.invoke(
          "cognigy-proxy",
          {
            body: {
              api_key_id: apiKeyId,
              project_id: projectId,
              transport: "odata",
              path: endpoint,
              query: { $filter: filter },
            },
          }
        );

        if (invokeError) {
          let detail = invokeError.message;
          if (invokeError.context?.text) {
            try {
              const raw = await invokeError.context.text();
              try {
                const body = JSON.parse(raw);
                const upstreamMsg =
                  body.upstream_body || body.detail || body.title;
                const base = upstreamMsg || body.error || detail;
                detail = body.upstream_status
                  ? `${base} (Cognigy ${body.upstream_status})`
                  : base;
              } catch {
                detail = raw.slice(0, 500) || detail;
              }
            } catch {
              // body unreadable — keep generic message
            }
          }
          throw new Error(detail);
        }

        const value = data?.value ?? (Array.isArray(data) ? data : []);
        setRows(value);
        setColumns(value[0] ? Object.keys(value[0]) : []);
        setDone(true);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setRunning(false);
      }
    },
    [reset]
  );

  const value = useMemo(
    () => ({
      form,
      updateForm,
      search,
      setSearch,
      viewColumns,
      setViewColumns,
      rows,
      columns,
      running,
      done,
      error,
      fetchAnalytics,
      reset,
    }),
    [
      form,
      updateForm,
      search,
      viewColumns,
      rows,
      columns,
      running,
      done,
      error,
      fetchAnalytics,
      reset,
    ]
  );

  return (
    <AnalyticsCacheContext.Provider value={value}>
      {children}
    </AnalyticsCacheContext.Provider>
  );
};

export const useAnalyticsCache = () => {
  const ctx = useContext(AnalyticsCacheContext);
  if (!ctx)
    throw new Error(
      "useAnalyticsCache must be used inside <AnalyticsCacheProvider>"
    );
  return ctx;
};
