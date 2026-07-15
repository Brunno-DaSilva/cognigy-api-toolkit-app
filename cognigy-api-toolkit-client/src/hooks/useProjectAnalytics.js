import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Sessions come from the REST /v2.0/conversations endpoint (one item per
// conversation). Tasks come from the REST /v2.0/tasks endpoint — a cursor-
// paginated list of { name, status, ... } records. "Most used tasks" groups
// those records by name and counts them.
const PAGE = 100;
const MAX_PAGES = 50; // up to 5,000 records per resource

// Local YYYY-MM-DD key used to bucket a timestamp into a calendar day.
const dayKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Builds `days` day-buckets ending today (inclusive), oldest first.
const buildDayBuckets = (days) => {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({
      key: dayKey(d),
      date: new Date(d),
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: 0,
    });
  }
  return out;
};

// Extract a useful error message from a failed functions.invoke().
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

// Pages a proxied REST list endpoint via skip/limit until it's exhausted,
// stops advancing (some endpoints ignore skip), or hits MAX_PAGES.
async function fetchAllRest({ apiKeyId, projectId, path, query, extractItems }) {
  const all = [];
  const seen = new Set();

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase.functions.invoke("cognigy-proxy", {
      body: {
        api_key_id: apiKeyId,
        project_id: projectId,
        path,
        // These endpoints return plain JSON and 500 on a HAL Accept header.
        accept: "application/json",
        query: { ...query, limit: PAGE, skip: page * PAGE },
      },
    });
    if (error) throw await invokeError(error);

    const items = extractItems(data);
    if (!items.length) break;

    let added = 0;
    for (const it of items) {
      const id = it?._id || it?.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      all.push(it);
      added++;
    }
    if (items.length < PAGE || added === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return all;
}

// Pages the cursor-based /v2.0/tasks endpoint. The response carries `total` and
// a `nextCursor`; the next page is requested by passing that cursor as `next`.
async function fetchAllTasks({ apiKeyId, projectId, cognigyProjectId }) {
  const all = [];
  const seen = new Set();
  let cursor = null;
  let total = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = { projectId: cognigyProjectId, limit: PAGE };
    if (cursor) query.next = cursor;

    const { data, error } = await supabase.functions.invoke("cognigy-proxy", {
      body: {
        api_key_id: apiKeyId,
        project_id: projectId,
        path: "/v2.0/tasks",
        accept: "application/json",
        query,
      },
    });
    if (error) throw await invokeError(error);

    const items = data?.items ?? (Array.isArray(data) ? data : []);
    if (total === null) total = data?.total ?? null;
    if (!items.length) break;

    let added = 0;
    for (const it of items) {
      const id = it?._id || it?.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      all.push(it);
      added++;
    }

    const nextCursor = data?.nextCursor;
    if (!nextCursor || nextCursor === cursor || items.length < PAGE || added === 0) {
      break;
    }
    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, 100));
  }

  return { tasks: all, total: total ?? all.length };
}

// Pull a conversation's start timestamp across the field names Cognigy has used.
const conversationStart = (c) =>
  c?.startTime || c?.startedAt || c?.start || c?.createdAt || null;

const extractItems = (d) => d?.items ?? (Array.isArray(d) ? d : []);

// Fetches and aggregates session + task analytics for a single project.
// Re-runs whenever the active project / key changes; stale responses (from a
// project the user has since switched away from) are discarded.
const useProjectAnalytics = ({ apiKeyId, projectId, cognigyProjectId, days = 5 }) => {
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const reqId = useRef(0);

  const run = useCallback(async () => {
    if (!apiKeyId || !projectId || !cognigyProjectId) {
      setState({ loading: false, error: null, data: null });
      return;
    }

    const myReq = ++reqId.current;
    setState({ loading: true, error: null, data: null });

    // Fetch independently — a failure in one section must not blank the other.
    const [convRes, tasksRes] = await Promise.allSettled([
      fetchAllRest({
        apiKeyId,
        projectId,
        path: "/v2.0/conversations",
        query: { projectId: cognigyProjectId },
        extractItems,
      }),
      fetchAllTasks({ apiKeyId, projectId, cognigyProjectId }),
    ]);

    // A newer request started while we were awaiting — drop this result.
    if (myReq !== reqId.current) return;

    // ── Sessions bucketed into the last `days` days ────────────────────────
    const buckets = buildDayBuckets(days);
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    const windowStart = buckets[0].date.getTime();
    let totalSessions = 0;
    let sessionsError = null;

    if (convRes.status === "fulfilled") {
      for (const c of convRes.value) {
        const ts = conversationStart(c);
        if (!ts) continue;
        const d = new Date(ts);
        if (Number.isNaN(d.getTime()) || d.getTime() < windowStart) continue;
        const bucket = byKey.get(dayKey(d));
        if (bucket) {
          bucket.count += 1;
          totalSessions += 1;
        }
      }
    } else {
      sessionsError = convRes.reason?.message || String(convRes.reason);
    }

    // ── Most used tasks: group /v2.0/tasks records by name ─────────────────
    let topTasks = [];
    let distinctTasks = 0;
    let totalTasks = 0;
    let tasksError = null;

    if (tasksRes.status === "fulfilled") {
      const { tasks, total } = tasksRes.value;
      totalTasks = total;

      const counts = new Map();
      for (const t of tasks) {
        const name = t?.name || "Unnamed task";
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      distinctTasks = counts.size;
      topTasks = [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    } else {
      tasksError = tasksRes.reason?.message || String(tasksRes.reason);
    }

    setState({
      loading: false,
      error: null,
      data: {
        totalSessions,
        conversationsScanned:
          convRes.status === "fulfilled" ? convRes.value.length : 0,
        sessionsError,
        sessionsByDay: buckets.map(({ key, label, count }) => ({ key, label, count })),
        distinctTasks,
        totalTasks,
        topTasks,
        tasksError,
      },
    });
  }, [apiKeyId, projectId, cognigyProjectId, days]);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, refetch: run };
};

export default useProjectAnalytics;
