import { useMemo, useState } from "react";
import Card from "../../ui/Card";
import RowDetailModal from "../../ui/RowDetailModal";
import { TYPE_CONFIG } from "../../../constants";
import {
  categorizeLog,
  getLogMessage,
  isKnownCategory,
} from "../../../utils/logCategories";

const SEVERITY_ORDER = ["fatal", "error", "warn", "info", "debug", "trace"];
const MAX_ENTRY_ROWS = 200;

const Chevron = ({ open }) => (
  <svg
    className={`lb-chevron${open ? " lb-chevron--open" : ""}`}
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// Small table of the individual log entries inside one sub-category.
const EntryTable = ({ entries, color, onView }) => {
  const visible = entries.slice(0, MAX_ENTRY_ROWS);
  return (
    <div className="lb-entries">
      <div className="atbl-wrap">
        <table className="atbl">
          <thead>
            <tr>
              <th className="atbl-th atbl-th--view">View</th>
              <th className="atbl-th">Timestamp</th>
              <th className="atbl-th">Message</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((log, idx) => (
              <tr key={idx} className="atbl-tr">
                <td className="atbl-cell atbl-cell--view">
                  <button
                    type="button"
                    className="atbl-view-btn"
                    onClick={() => onView(log)}
                    aria-label="View full log entry"
                  >
                    View
                  </button>
                </td>
                <td className="atbl-cell">
                  <span className="atbl-cell-text">
                    {log.timestamp
                      ? new Date(log.timestamp).toLocaleString()
                      : "—"}
                  </span>
                </td>
                <td className="atbl-cell">
                  <span
                    className="atbl-cell-text"
                    title={getLogMessage(log)}
                    style={{ color }}
                  >
                    {getLogMessage(log) || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > MAX_ENTRY_ROWS && (
        <div className="atbl-footer">
          Showing first {MAX_ENTRY_ROWS.toLocaleString()} of{" "}
          {entries.length.toLocaleString()} entries — download the JSON for the
          full set.
        </div>
      )}
    </div>
  );
};

const LogBreakdown = ({ logs }) => {
  const total = logs.length;

  const grouped = useMemo(() => {
    const types = {};
    for (const log of logs) {
      const t = log?.type || "unknown";
      if (!types[t]) types[t] = { entries: [], cats: new Map() };
      types[t].entries.push(log);
      const cat = categorizeLog(log);
      const bucket = types[t].cats.get(cat);
      if (bucket) bucket.push(log);
      else types[t].cats.set(cat, [log]);
    }

    const order = (t) => {
      const i = SEVERITY_ORDER.indexOf(t);
      return i === -1 ? SEVERITY_ORDER.length : i;
    };

    return Object.entries(types)
      .map(([type, { entries, cats }]) => ({
        type,
        label: TYPE_CONFIG[type]?.label ?? type,
        color: TYPE_CONFIG[type]?.color ?? "#6b7280",
        count: entries.length,
        cats: [...cats.entries()]
          .map(([label, catLogs]) => ({
            label,
            count: catLogs.length,
            entries: catLogs,
            known: isKnownCategory(label),
          }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => order(a.type) - order(b.type) || b.count - a.count);
  }, [logs]);

  // Default: expand the noisy/important levels (fatal, error) if present.
  const [openTypes, setOpenTypes] = useState(() => {
    const s = new Set();
    grouped.forEach((g) => {
      if (g.type === "fatal" || g.type === "error") s.add(g.type);
    });
    return s;
  });
  const [openCat, setOpenCat] = useState(null); // `${type}::${label}`
  const [detailRow, setDetailRow] = useState(null);

  const toggleType = (type) =>
    setOpenTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const toggleCat = (key) => setOpenCat((prev) => (prev === key ? null : key));

  if (!total) return null;

  return (
    <Card title="Log Breakdown">
      <div className="lb-summary">
        {total.toLocaleString()} entries across {grouped.length} type
        {grouped.length === 1 ? "" : "s"} — click a type, then a category, to
        drill into the entries.
      </div>

      <div className="lb-types">
        {grouped.map((g) => {
          const typeOpen = openTypes.has(g.type);
          const pct = total ? (g.count / total) * 100 : 0;
          return (
            <div key={g.type} className="lb-type">
              <button
                type="button"
                className="lb-type-header"
                onClick={() => toggleType(g.type)}
                aria-expanded={typeOpen}
              >
                <Chevron open={typeOpen} />
                <span className="lb-dot" style={{ background: g.color }} />
                <span className="lb-type-label">{g.label}</span>
                <span className="lb-type-count" style={{ color: g.color }}>
                  {g.count.toLocaleString()}
                  <span className="lb-pct">({pct.toFixed(1)}%)</span>
                </span>
                <span className="lb-type-bar">
                  <span
                    className="lb-type-bar-fill"
                    style={{ width: `${pct}%`, background: g.color }}
                  />
                </span>
              </button>

              {typeOpen && (
                <div className="lb-cats">
                  {g.cats.map((c) => {
                    const key = `${g.type}::${c.label}`;
                    const catOpen = openCat === key;
                    const catPct = g.count ? (c.count / g.count) * 100 : 0;
                    return (
                      <div key={key} className="lb-cat">
                        <button
                          type="button"
                          className={`lb-cat-row${catOpen ? " lb-cat-row--open" : ""}`}
                          onClick={() => toggleCat(key)}
                          aria-expanded={catOpen}
                        >
                          <Chevron open={catOpen} />
                          <span className="lb-cat-label" title={c.label}>
                            {c.label}
                            {!c.known && (
                              <span className="lb-cat-tag">auto</span>
                            )}
                          </span>
                          <span className="lb-cat-count">
                            {c.count.toLocaleString()}
                          </span>
                          <span className="lb-cat-bar">
                            <span
                              className="lb-cat-bar-fill"
                              style={{
                                width: `${catPct}%`,
                                background: g.color,
                              }}
                            />
                          </span>
                        </button>
                        {catOpen && (
                          <EntryTable
                            entries={c.entries}
                            color={g.color}
                            onView={setDetailRow}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        onClose={() => setDetailRow(null)}
      />
    </Card>
  );
};

export default LogBreakdown;
