import { useMemo } from "react";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

// The persistent local index of documents tracked in the selected KAI store.
const DocumentIndexTable = ({ documents, events, onViewHistory, onDelete, busyId }) => {
  // Latest similarity method per document, from its sync events.
  const methodByDoc = useMemo(() => {
    const m = {};
    for (const e of events) {
      if (e.document_id && !m[e.document_id] && e.similarity_method) {
        m[e.document_id] = e.similarity_method;
      }
    }
    return m;
  }, [events]);

  if (documents.length === 0) {
    return (
      <div className="row-list">
        <div className="row-list-empty">No documents tracked yet. Upload files to build the index.</div>
      </div>
    );
  }

  return (
    <div className="row-list">
      {documents.map((d) => (
        <div key={d.id} className="row-item">
          <div className="row-item-main">
            <div className="row-item-name">
              {d.original_filename ?? d.title ?? d.cognigy_source_id ?? d.id}
              {!d.original_binary_available && (
                <span className="badge" style={{ marginLeft: 8, background: "#fff7e6", color: "#92400e" }}>
                  no binary backup
                </span>
              )}
            </div>
            <div className="row-item-meta">
              {d.title ? `${d.title} · ` : ""}
              synced {fmt(d.last_synced_at)}
              {methodByDoc[d.id] ? ` · ${methodByDoc[d.id]}` : ""}
              {d.cognigy_source_id ? ` · source ${String(d.cognigy_source_id).slice(0, 8)}…` : ""}
            </div>
          </div>
          <div className="row-item-actions" style={{ gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={() => onViewHistory(d)}>
              History
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              title="Delete from Cognigy KAI and the local index"
              aria-label="Delete"
              onClick={() => onDelete(d)}
              disabled={busyId === d.id}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DocumentIndexTable;
