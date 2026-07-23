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
import { flattenFlow, indexFacets } from "../utils/flowSearch";

// Project-wide flow index, hoisted to the layout so it survives route changes.
//
// Indexing is bound to the PROJECT SELECTION (per customer): it runs in the
// background whenever a project is selected for a customer — including the
// selection restored from the last session on login — and KEEPS RUNNING
// regardless of which page is focused, because this provider is mounted above
// the router's <Outlet> and never unmounts while navigating between tools.
// Results are cached per customer+project, so returning to an already-indexed
// selection is instant.
//
// All Cognigy calls go through the shared `cognigy-proxy` edge function; the
// raw API key never reaches the browser. See docs/flow-search-api-reference.md.

const PAGE = 100;
const MAX_PAGES = 50; // up to 5,000 flows
const CHART_DELAY_MS = 120; // throttle between per-flow chart fetches

const FlowIndexContext = createContext(null);

const EMPTY = {
  records: [],
  facets: { nodeTypes: [], flows: [] },
  indexedAt: null,
  indexing: false,
  error: null,
  failures: [],
  progress: { done: 0, total: 0, currentFlow: null },
};

// Extract a useful message from a failed functions.invoke() (unwrap the
// FunctionsHttpError body the proxy returns on an upstream Cognigy error).
async function invokeError(error) {
  let detail = error.message;
  if (error.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.json();
      detail = body.upstream_body || body.error || body.detail || body.title || detail;
    } catch {
      // keep generic message
    }
  }
  return new Error(detail);
}

// The id sometimes only appears inside the HAL self link, e.g.
// "https://…/v2.0/flows/69e250f4cc5743c62598f29d" — grab the last path segment.
const idFromSelfLink = (f) => {
  const href = f?._links?.self?.href;
  if (typeof href !== "string") return null;
  const m = href.match(/\/flows\/([^/?#]+)/);
  return m ? m[1] : null;
};

// The chart endpoint (GET /v2.0/flows/{id}/chart) is keyed by the flow's Mongo
// `_id` (the last segment of _links.self.href) — NOT the UUID `reference`.
const flowRefOf = (f) =>
  f?._id || idFromSelfLink(f) || f?.id || f?.reference || f?.referenceId || null;
const flowNameOf = (f) => f?.name || f?.flowName || flowRefOf(f) || "Unnamed flow";

// The Cognigy project (agent) a flow belongs to — used to scope the list to the
// selected project, since the list surface can return flows across projects.
const flowProjectId = (f) => f?.projectId ?? f?.project ?? f?.projectReference ?? null;
const belongsToProject = (f, cognigyProjectId) => {
  const pid = flowProjectId(f);
  // If the flow doesn't carry a project id, don't exclude it (avoid dropping
  // everything if the shape is unexpected — better to over-include than blank).
  return !pid || String(pid) === String(cognigyProjectId);
};

async function fetchFlowList({ apiKeyId, projectId, cognigyProjectId }) {
  const all = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase.functions.invoke("cognigy-proxy", {
      body: {
        api_key_id: apiKeyId,
        project_id: projectId,
        path: "/new/v2.0/flows",
        accept: "application/json",
        query: { projectId: cognigyProjectId, limit: PAGE, skip: page * PAGE },
      },
    });
    if (error) throw await invokeError(error);

    const items = data?.items ?? (Array.isArray(data) ? data : []);
    if (!items.length) break;

    let added = 0;
    for (const it of items) {
      const id = flowRefOf(it);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      all.push(it);
      added++;
    }
    if (items.length < PAGE || added === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Scope to the selected Cognigy project — the list surface can return flows
  // belonging to other projects on the same instance.
  const scoped = all.filter((f) => belongsToProject(f, cognigyProjectId));
  return scoped;
}

async function fetchChart({ apiKeyId, projectId, flowRef }) {
  const { data, error } = await supabase.functions.invoke("cognigy-proxy", {
    body: {
      api_key_id: apiKeyId,
      project_id: projectId,
      // Chart lives on the /v2.0 (not /new/v2.0) surface, keyed by Mongo _id.
      path: `/v2.0/flows/${flowRef}/chart`,
      accept: "application/json",
    },
  });
  if (error) throw await invokeError(error);
  return data;
}

export const FlowIndexProvider = ({ children }) => {
  const { activeCustomerId, activeProjectId, project, apiKeys } =
    useActiveProject();

  const apiKeyId = apiKeys?.[0]?.id ?? "";
  const projectId = project?.id ?? "";
  const cognigyProjectId = project?.cognigy_project_id ?? "";

  const [state, setState] = useState(EMPTY);
  const reqId = useRef(0);
  const keyRef = useRef(null); // key currently loaded/loading
  const cacheRef = useRef(new Map()); // key -> { records, facets, indexedAt, failures }

  const runIndex = useCallback(
    // All fetch inputs are passed explicitly (not read from closure) so a run
    // can never use a project id that's out of sync with the selection.
    async (key, { apiKeyId, projectId, cognigyProjectId }) => {
      const myReq = ++reqId.current;
      // Clear stale results and switch to the indexing state immediately.
      setState({ ...EMPTY, indexing: true });

      try {
        const flows = await fetchFlowList({ apiKeyId, projectId, cognigyProjectId });
        if (myReq !== reqId.current) return;
        setState((s) => ({
          ...s,
          progress: { done: 0, total: flows.length, currentFlow: null },
        }));

        const records = [];
        const failures = [];
        for (let i = 0; i < flows.length; i++) {
          if (myReq !== reqId.current) return; // project switched mid-run
          const f = flows[i];
          const flowRef = flowRefOf(f);
          const flowName = flowNameOf(f);
          setState((s) => ({
            ...s,
            progress: { done: i, total: flows.length, currentFlow: flowName },
          }));
          try {
            const chart = await fetchChart({ apiKeyId, projectId, flowRef });
            records.push(...flattenFlow(chart, { flowId: flowRef, flowName }));
          } catch (e) {
            failures.push({ flowName, message: e.message });
          }
          if (i < flows.length - 1) {
            await new Promise((r) => setTimeout(r, CHART_DELAY_MS));
          }
        }
        if (myReq !== reqId.current) return;

        const facets = indexFacets(records);
        const indexedAt = Date.now();
        cacheRef.current.set(key, { records, facets, indexedAt, failures });
        setState({
          records,
          facets,
          indexedAt,
          indexing: false,
          error: failures.length
            ? `${failures.length} of ${flows.length} flow(s) could not be indexed`
            : null,
          failures,
          progress: { done: flows.length, total: flows.length, currentFlow: null },
        });
      } catch (e) {
        if (myReq !== reqId.current) return;
        setState((s) => ({ ...s, indexing: false, error: e.message }));
      }
    },
    [],
  );

  // Index is bound to the PROJECT SELECTION (per customer): the cache key is
  // `customerId|projectId`. It runs whenever a project is selected for a
  // customer — including the selection restored from the last session on login
  // — so Flow Search is ready when opened. Because this provider never unmounts
  // during navigation, an in-flight run is NOT interrupted by moving between
  // pages; only selecting a different project starts a new run, and a project
  // already in the cache loads instantly. Nothing indexes without a selected
  // project. (A usable API key + Cognigy project id are also required to fetch.)
  useEffect(() => {
    // Nothing selected → clear.
    if (!activeProjectId) {
      reqId.current++;
      keyRef.current = null;
      setState(EMPTY);
      return;
    }
    // Wait until the RESOLVED project record matches the current selection.
    // During a switch, `project` (and its cognigyProjectId) lags activeProjectId
    // by a render; indexing before they agree would fetch the previous
    // project's flows under the new key — the exact bug we're fixing. Also wait
    // for a usable API key + Cognigy id.
    if (
      !project ||
      project.id !== activeProjectId ||
      !apiKeyId ||
      !cognigyProjectId
    ) {
      return;
    }

    const key = `${activeCustomerId}|${project.id}`;
    if (keyRef.current === key) return; // this selection already handled
    keyRef.current = key;

    const cached = cacheRef.current.get(key);
    if (cached) {
      reqId.current++; // abandon any in-flight run for a previous selection
      setState({ ...EMPTY, ...cached, indexing: false });
      return;
    }
    runIndex(key, { apiKeyId, projectId: project.id, cognigyProjectId });
  }, [activeCustomerId, activeProjectId, project, apiKeyId, cognigyProjectId, runIndex]);

  // Force a fresh re-index of the current selection (ignores the cache).
  const reindex = useCallback(() => {
    if (!project || project.id !== activeProjectId) return;
    if (!apiKeyId || !cognigyProjectId) return;
    const key = `${activeCustomerId}|${project.id}`;
    cacheRef.current.delete(key);
    keyRef.current = key;
    runIndex(key, { apiKeyId, projectId: project.id, cognigyProjectId });
  }, [activeCustomerId, activeProjectId, project, apiKeyId, cognigyProjectId, runIndex]);

  const value = useMemo(
    () => ({
      ...state,
      reindex,
      hasIndex: state.records.length > 0,
      hasApiKey: !!apiKeyId,
      hasActiveProject: !!activeProjectId,
    }),
    [state, reindex, apiKeyId, activeProjectId],
  );

  return (
    <FlowIndexContext.Provider value={value}>
      {children}
    </FlowIndexContext.Provider>
  );
};

export const useFlowIndex = () => {
  const ctx = useContext(FlowIndexContext);
  if (!ctx)
    throw new Error("useFlowIndex must be used inside <FlowIndexProvider>");
  return ctx;
};
