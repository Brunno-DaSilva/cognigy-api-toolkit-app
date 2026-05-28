import { useMemo, useState } from "react";
import { ANALYTICS_ID_COLUMNS } from "../../../constants";

const MAX_ROWS = 500;

const niceLabel = (c) =>
  c
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^\w/, (x) => x.toUpperCase());

const isIsoDate = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);

const formatCellValue = (col, raw) => {
  if (raw === null || raw === undefined || raw === "") {
    return { display: "—", full: "", empty: true };
  }
  if (col === "timestamp" || isIsoDate(raw)) {
    const full = String(raw);
    return { display: new Date(raw).toLocaleString(), full };
  }
  if (typeof raw === "boolean") {
    return { display: String(raw), full: String(raw), kind: "bool", bool: raw };
  }
  if (col === "rating" && raw != null) {
    return { display: String(raw), full: String(raw), kind: "rating", rating: raw };
  }
  const full =
    typeof raw === "object" ? JSON.stringify(raw, null, 2) : String(raw);
  if (ANALYTICS_ID_COLUMNS.includes(col) && full.length > 4) {
    return { display: `····${full.slice(-4)}`, full, kind: "id" };
  }
  return { display: full, full };
};

const CopyButton = ({ value, copied, onCopy }) => (
  <button
    type="button"
    className="atbl-copy"
    aria-label="Copy value"
    title={copied ? "Copied!" : "Copy"}
    onClick={(e) => {
      e.stopPropagation();
      onCopy(value);
    }}
  >
    {copied ? <CheckIcon /> : <CopyIcon />}
  </button>
);

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const Cell = ({ col, raw, copiedKey, setCopiedKey, rowIdx }) => {
  const v = formatCellValue(col, raw);
  const cellKey = `${rowIdx}:${col}`;
  const copied = copiedKey === cellKey;

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(cellKey);
      setTimeout(() => {
        setCopiedKey((k) => (k === cellKey ? null : k));
      }, 1200);
    } catch {
      // clipboard blocked — leave the icon unchanged
    }
  };

  if (v.empty) return <td className="atbl-cell atbl-cell--empty">—</td>;

  if (v.kind === "bool") {
    return (
      <td className="atbl-cell">
        <span className={`badge ${v.bool ? "badge-ok" : "badge-err"}`}>
          {String(v.bool)}
        </span>
      </td>
    );
  }

  if (v.kind === "rating") {
    const cls =
      v.rating >= 4 ? "badge-ok" : v.rating >= 2 ? "badge-warn" : "badge-err";
    return (
      <td className="atbl-cell">
        <span className={`badge ${cls}`}>{v.rating}</span>
      </td>
    );
  }

  return (
    <td className="atbl-cell">
      <div className="atbl-cell-inner">
        <span className="atbl-cell-text" title={v.full}>
          {v.display}
        </span>
        <CopyButton value={v.full} copied={copied} onCopy={handleCopy} />
      </div>
    </td>
  );
};

const AnalyticsTable = ({ rows, columns, search }) => {
  const [copiedKey, setCopiedKey] = useState(null);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const visible = filtered.slice(0, MAX_ROWS);

  if (!filtered.length) {
    return <div className="atbl-empty">No records match.</div>;
  }

  return (
    <>
      <div className="atbl-wrap">
        <table className="atbl">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="atbl-th">
                  {niceLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => (
              <tr key={idx} className="atbl-tr">
                {columns.map((col) => (
                  <Cell
                    key={col}
                    col={col}
                    raw={row[col]}
                    rowIdx={idx}
                    copiedKey={copiedKey}
                    setCopiedKey={setCopiedKey}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="atbl-footer">
        Showing {visible.length.toLocaleString()} of{" "}
        {filtered.length.toLocaleString()} matching rows
        {filtered.length > MAX_ROWS &&
          ` — refine the search to see beyond ${MAX_ROWS}.`}
      </div>
    </>
  );
};

export default AnalyticsTable;
