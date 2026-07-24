import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import Card from "../../ui/Card";
import Select from "../../ui/Select";
import { useFlowIndex } from "../../../context/FlowIndexContext";
import { searchRecords } from "../../../utils/flowSearch";

const timeAgo = (ts) => {
  if (!ts) return null;
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
};

const Highlight = ({ snippet }) => (
  <span className="fs-snippet">
    {snippet.before}
    <mark className="fs-mark">{snippet.match}</mark>
    {snippet.after}
  </span>
);

// One matched node. Collapsed: node badge + name + breadcrumb + snippet(s).
// Expanded: the full text of each matched field (+ any cross-flow reference).
const ResultRow = ({ rec }) => {
  const [open, setOpen] = useState(false);
  const matchedFields = new Set(rec.fieldMatches.map((m) => m.field));
  const fullFields = rec.fields.filter((f) => matchedFields.has(f.field));

  return (
    <li className="fs-result">
      <button
        type="button"
        className="fs-result-head"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="badge badge--purple fs-type">{rec.nodeType}</span>
        <span className="fs-result-main">
          <span className="fs-result-top">
            <span className="fs-node-name">{rec.nodeName || "(unnamed)"}</span>
            {rec.path.length > 0 && (
              <span className="fs-path">{rec.path.join(" › ")}</span>
            )}
          </span>
          {rec.fieldMatches.map((m, i) => (
            <span key={i} className="fs-match">
              <span className="fs-field">{m.field}</span>
              <Highlight snippet={m.snippet} />
            </span>
          ))}
        </span>
      </button>

      {open && (
        <div className="fs-result-detail">
          {fullFields.map((f, i) => (
            <div key={i} className="fs-field-block">
              <div className="fs-field">{f.field}</div>
              <pre className="fs-field-full">{f.text}</pre>
            </div>
          ))}
          {rec.refs?.flow && (
            <div className="fs-field-block">
              <div className="fs-field">references</div>
              <pre className="fs-field-full">
                flow {rec.refs.flow}
                {rec.refs.node ? `  ·  node ${rec.refs.node}` : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

const FlowSearch = ({ customer, apiKeys }) => {
  // Indexing runs in the FlowIndexProvider (layout level) so it survives
  // navigation and starts on load — here we just read its state.
  const {
    records,
    facets,
    indexedAt,
    indexing,
    error,
    failures,
    progress,
    reindex,
    hasIndex,
  } = useFlowIndex();

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [typeFilter, setTypeFilter] = useState([]);
  const [flowFilter, setFlowFilter] = useState("");
  const [collapsed, setCollapsed] = useState({});

  // Debounce the typed query (~250ms) before it drives the search.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery), 250);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const { groups, total, error: searchError } = useMemo(
    () =>
      searchRecords(records, query, {
        regex,
        nodeTypes: typeFilter,
        flowIds: flowFilter ? [flowFilter] : null,
      }),
    [records, query, regex, typeFilter, flowFilter],
  );

  const toggleType = (t) =>
    setTypeFilter((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  const toggleGroup = (id) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  // ── No API key: can't reach Cognigy ──────────────────────────────────────
  if (apiKeys.length === 0) {
    return (
      <div className="tool-layout">
        <Card title="Flow Search">
          <div className="row-list-empty">
            This customer has no API key yet.{" "}
            <Link className="btn-link" to={`/admin/customers/${customer?.id}`}>
              Add one →
            </Link>{" "}
            to index this project's flows.
          </div>
        </Card>
      </div>
    );
  }

  // ── Indexing failed before any index was built ───────────────────────────
  if (!indexing && !hasIndex && error) {
    return (
      <div className="tool-layout">
        <Card title="Flow Search">
          <div className="form-error">{error}</div>
          <button type="button" className="btn btn--primary fs-notice" onClick={reindex}>
            Try again
          </button>
        </Card>
      </div>
    );
  }

  // ── Indexing in progress (auto-started) ──────────────────────────────────
  if (indexing || !hasIndex) {
    const pct = progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : null;
    return (
      <div className="tool-layout">
        <Card title="Indexing flows">
          <div className="fs-indexing">
            <div className="fs-indexing-headline">
              {pct === null
                ? "Preparing to index this project…"
                : `Reading flows — ${progress.done} of ${progress.total}`}
            </div>
            <div className="fs-progress-track">
              <div
                className={
                  "fs-progress-fill" +
                  (pct === null ? " fs-progress-fill--indeterminate" : "")
                }
                style={pct === null ? undefined : { width: `${pct}%` }}
              />
            </div>
            <div className="fs-indexing-sub">
              {progress.currentFlow
                ? progress.currentFlow
                : "Fetching flow list…"}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Ready: search ────────────────────────────────────────────────────────
  return (
    <div className="tool-layout">
      <Card title="Search">
        <div className="fs-ready-bar">
          <span className="fs-index-status">
            {records.length} nodes · {facets.flows.length} flows · indexed{" "}
            {timeAgo(indexedAt)}
          </span>
          <button
            type="button"
            className="btn-link"
            onClick={reindex}
            title="Re-index this project"
          >
            ↻ re-index
          </button>
        </div>

        <div className="fs-searchbar">
          <svg
            className="fs-searchbar-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="fs-searchbar-input"
            placeholder={
              regex
                ? "Regular expression…"
                : "Search variables, text, conditions, labels, comments…"
            }
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            autoFocus
          />
          {rawQuery && (
            <button
              type="button"
              className="fs-searchbar-clear"
              onClick={() => setRawQuery("")}
              title="Clear"
            >
              ×
            </button>
          )}
        </div>

        <div className="fs-search-controls mb-14">
          <label className="fs-regex-toggle">
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
            />
            regex
          </label>
          <Select
            className="select fs-flow-filter"
            value={flowFilter}
            onChange={(v) => setFlowFilter(v)}
            options={[
              { value: "", label: `All flows (${facets.flows.length})` },
              ...facets.flows.map((f) => ({
                value: f.flowId,
                label: `${f.flowName} (${f.count})`,
              })),
            ]}
          />
        </div>

        {facets.nodeTypes.length > 0 && (
          <div className="fs-chip-row mb-14">
            {facets.nodeTypes.map((t) => (
              <button
                type="button"
                key={t.type}
                className={
                  "fs-chip" +
                  (typeFilter.includes(t.type) ? " fs-chip--active" : "")
                }
                onClick={() => toggleType(t.type)}
              >
                {t.type} <span className="fs-count">{t.count}</span>
              </button>
            ))}
            {typeFilter.length > 0 && (
              <button
                type="button"
                className="btn-link"
                onClick={() => setTypeFilter([])}
              >
                clear
              </button>
            )}
          </div>
        )}

        {failures?.length > 0 && (
          <details className="fs-failures">
            <summary>{failures.length} flow(s) could not be indexed</summary>
            <ul>
              {failures.map((f, i) => (
                <li key={i}>
                  <strong>{f.flowName}</strong>: {f.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {!query && (
          <div className="fs-hint">
            Type above to search across {records.length} nodes in{" "}
            {facets.flows.length} flows — or narrow to a single flow first.
          </div>
        )}

        {searchError && (
          <div className="form-error">Invalid regex: {searchError}</div>
        )}

        {query && !searchError && (
          <div className="fs-results-summary">
            {total === 0
              ? "No matches"
              : `${total} match${total === 1 ? "" : "es"} in ${groups.length} flow${groups.length === 1 ? "" : "s"}`}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.flowId} className="fs-group">
            <button
              type="button"
              className="fs-group-head"
              onClick={() => toggleGroup(g.flowId)}
            >
              <span className="fs-caret">
                {collapsed[g.flowId] ? "▸" : "▾"}
              </span>
              <span className="fs-group-name">{g.flowName}</span>
              <span className="badge badge--green">{g.results.length}</span>
            </button>
            {!collapsed[g.flowId] && (
              <ul className="fs-result-list">
                {g.results.map((r) => (
                  <ResultRow key={r.nodeId} rec={r} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
};

export default FlowSearch;
