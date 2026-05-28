import { useState } from "react";
import Modal from "../../ui/Modal";

const isIsoDate = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);

const formatValue = (raw) => {
  if (raw === null || raw === undefined || raw === "") {
    return { display: "—", copy: "", empty: true };
  }
  if (typeof raw === "boolean") {
    return { display: String(raw), copy: String(raw), kind: "bool", bool: raw };
  }
  if (typeof raw === "number") {
    return { display: String(raw), copy: String(raw) };
  }
  if (isIsoDate(raw)) {
    return {
      display: `${new Date(raw).toLocaleString()}  (${raw})`,
      copy: String(raw),
    };
  }
  if (typeof raw === "object") {
    const str = JSON.stringify(raw, null, 2);
    return { display: str, copy: str, kind: "json" };
  }
  const str = String(raw);
  return { display: str, copy: str, kind: str.length > 80 ? "long" : "short" };
};

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

const FieldRow = ({ name, raw, copiedKey, onCopy }) => {
  const v = formatValue(raw);
  const copied = copiedKey === name;

  let valueEl;
  if (v.empty) {
    valueEl = <span className="row-detail-empty">—</span>;
  } else if (v.kind === "bool") {
    valueEl = (
      <span className={`badge ${v.bool ? "badge-ok" : "badge-err"}`}>
        {String(v.bool)}
      </span>
    );
  } else if (v.kind === "json" || v.kind === "long") {
    valueEl = <pre className="row-detail-pre">{v.display}</pre>;
  } else {
    valueEl = <span className="row-detail-text">{v.display}</span>;
  }

  return (
    <div className="row-detail-row">
      <div className="row-detail-key">{name}</div>
      <div className="row-detail-value">{valueEl}</div>
      <button
        type="button"
        className="row-detail-copy"
        title={copied ? "Copied!" : "Copy"}
        aria-label="Copy value"
        disabled={v.empty}
        onClick={() => onCopy(name, v.copy)}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
};

const RowDetailModal = ({ open, onClose, row }) => {
  const [copiedKey, setCopiedKey] = useState(null);

  const handleCopy = async (key, text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((k) => (k === key ? null : k));
      }, 1200);
    } catch {
      // clipboard blocked — silently ignore
    }
  };

  if (!row) return null;
  const fields = Object.keys(row);

  return (
    <Modal open={open} onClose={onClose} title="Record details" size="xl">
      <div className="row-detail-list">
        {fields.length === 0 ? (
          <div className="row-detail-empty">No fields on this record.</div>
        ) : (
          fields.map((name) => (
            <FieldRow
              key={name}
              name={name}
              raw={row[name]}
              copiedKey={copiedKey}
              onCopy={handleCopy}
            />
          ))
        )}
      </div>
    </Modal>
  );
};

export default RowDetailModal;
