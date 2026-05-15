import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { getTimestamp } from "../utils";

const useFetchLogs = () => {
  const [logs, setLogs] = useState([]);
  const [terminal, setTerminal] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({
    fetched: 0,
    pages: 0,
    total: null,
    pct: 0,
  });

  const addLine = useCallback((msg, type = "") => {
    setTerminal((p) => [...p, { msg: `[${getTimestamp()}] ${msg}`, type }]);
  }, []);

  const reset = useCallback(() => {
    setLogs([]);
    setTerminal([]);
    setDone(false);
    setProgress({ fetched: 0, pages: 0, total: null, pct: 0 });
  }, []);

  const fetchAll = useCallback(
    async ({ apiKeyId, cognigyProjectId, cfg, types }) => {
      reset();
      setRunning(true);

      const path = `/new/v2.0/projects/${cognigyProjectId}/logs`;
      const baseQuery = {
        startDate: new Date(cfg.startDate).toISOString(),
        endDate: new Date(cfg.endDate).toISOString(),
        limit: 100,
        sort: cfg.sort,
      };
      if (cfg.filter) baseQuery.filter = cfg.filter;
      if (cfg.flowName) baseQuery.flowName = cfg.flowName;
      if (cfg.userId) baseQuery.userId = cfg.userId;
      if (types.length) baseQuery.type = types;

      const allLogs = [];
      let nextCursor = null;
      let page = 0;
      let total = null;

      addLine(`Starting — project ${cognigyProjectId}`, "info");
      addLine(
        `Types: ${types.length ? types.join(", ") : "all"} | limit: 100/page (via cognigy-proxy)`,
        "info"
      );

      try {
        while (true) {
          page++;
          const query = nextCursor
            ? { ...baseQuery, next: nextCursor }
            : baseQuery;

          addLine(`Page ${page} — fetching...`);

          const { data, error } = await supabase.functions.invoke(
            "cognigy-proxy",
            { body: { api_key_id: apiKeyId, path, query } }
          );

          if (error) {
            let detail = error.message;
            if (error.context && typeof error.context.json === "function") {
              try {
                const body = await error.context.json();
                detail = body.error || body.detail || body.title || detail;
              } catch {}
            }
            addLine(`Error: ${detail}`, "err");
            break;
          }

          const entries = data?._embedded?.logEntry || data?.items || [];
          if (total === null) total = data?.total ?? null;

          allLogs.push(...entries);
          const fetched = allLogs.length;
          const pct = total ? Math.min(100, (fetched / total) * 100) : 0;

          setProgress({ fetched, pages: page, total, pct });
          setLogs([...allLogs]);
          addLine(
            `Page ${page} — ${entries.length} entries (${fetched} so far)`,
            "ok"
          );

          if (entries.length === 0) {
            addLine("No more entries.", "ok");
            break;
          }

          const nextHref = data?._links?.next?.href;
          if (!nextHref) {
            addLine("All pages fetched!", "ok");
            break;
          }

          const nextUrl = new URL(nextHref, "https://placeholder.invalid");
          nextCursor = nextUrl.searchParams.get("next");
          if (!nextCursor) {
            addLine("No more pages.", "ok");
            break;
          }

          await new Promise((r) => setTimeout(r, 150));
        }

        addLine(
          `✓ Complete — ${allLogs.length.toLocaleString()} entries`,
          "ok"
        );
        setDone(true);
      } catch (e) {
        addLine(`Fatal: ${e.message}`, "err");
      } finally {
        setRunning(false);
      }
    },
    [reset, addLine]
  );

  return { logs, terminal, running, done, progress, fetchAll };
};

export default useFetchLogs;
