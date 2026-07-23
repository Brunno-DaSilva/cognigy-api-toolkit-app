import { useCallback, useState } from "react";
import { supabase } from "../lib/supabase";

// OData datetime literals differ by platform. Cognigy expects a quoted literal
// (`timestamp ge '2026-07-22T00:00:00.000Z'`); CXone expects an unquoted
// DateTimeOffset at second precision (`timestamp ge 2026-07-22T00:00:00Z`).
const formatDateLiteral = (value, platform) => {
  const iso = new Date(value).toISOString();
  if (platform === "cxone") {
    return iso.replace(/\.\d{3}Z$/, "Z");
  }
  return `'${iso}'`;
};

const buildFilter = ({
  cognigyProjectId,
  dateField,
  startDate,
  endDate,
  platform = "cognigy",
}) => {
  const parts = [`projectId eq '${cognigyProjectId}'`];
  if (startDate) {
    parts.push(`${dateField} ge ${formatDateLiteral(startDate, platform)}`);
  }
  if (endDate) {
    parts.push(`${dateField} le ${formatDateLiteral(endDate, platform)}`);
  }
  return parts.join(" and ");
};

const useFetchAnalytics = () => {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

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
      platform = "cognigy",
    }) => {
      reset();
      setRunning(true);
      try {
        const filter = buildFilter({
          cognigyProjectId,
          dateField,
          startDate,
          endDate,
          platform,
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
                // Prefer the upstream Cognigy message — it tells us what's
                // actually wrong. Fall back to our wrapper's error field.
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

  return { rows, columns, running, done, error, fetchAnalytics, reset };
};

export default useFetchAnalytics;
