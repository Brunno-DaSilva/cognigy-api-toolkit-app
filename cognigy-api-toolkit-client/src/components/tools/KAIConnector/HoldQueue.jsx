const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

// Documents the evaluator flagged as too-similar-to-decide. A human confirms
// the replace, adds it as new, or discards the staged file.
const HoldQueue = ({ holds, documents, onResolve, busyId }) => {
  const docName = (id) => {
    const d = documents.find((x) => x.id === id);
    return d ? (d.original_filename ?? d.title ?? id) : "(unknown)";
  };

  if (holds.length === 0) {
    return (
      <div className="row-list">
        <div className="row-list-empty">Nothing waiting for review.</div>
      </div>
    );
  }

  return (
    <div className="row-list">
      {holds.map((h) => (
        <div key={h.id} className="row-item">
          <div className="row-item-main">
            <div className="row-item-name">
              <span className="badge" style={{ background: "#fff7e6", color: "#92400e", marginRight: 8 }}>
                HOLD
              </span>
              {h.incoming_filename ?? "—"}
            </div>
            <div className="row-item-meta">
              {fmt(h.created_at)} · matches <strong>{docName(h.matched_document_id)}</strong>
              {h.similarity_score != null ? ` · score ${Number(h.similarity_score).toFixed(3)}` : ""}
              {h.similarity_method ? ` (${h.similarity_method})` : ""}
            </div>
          </div>
          <div className="row-item-actions" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={busyId === h.id || !h.matched_document_id}
              onClick={() => onResolve(h, "replace")}
              title={h.matched_document_id ? "Replace the matched document" : "No matched document"}
            >
              Confirm Replace
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busyId === h.id}
              onClick={() => onResolve(h, "add")}
            >
              Add as New
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              title="Discard — no Cognigy action"
              aria-label="Discard"
              disabled={busyId === h.id}
              onClick={() => onResolve(h, "discard")}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default HoldQueue;
