import Modal from "../../ui/Modal";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

const DECISION_COLORS = {
  skip: { bg: "#f3f4f6", fg: "#374151" },
  add: { bg: "#ecfdf5", fg: "#047857" },
  replace: { bg: "#eef2ff", fg: "#3730a3" },
  hold: { bg: "#fff7e6", fg: "#92400e" },
};

const Badge = ({ decision }) => {
  const c = DECISION_COLORS[decision] ?? DECISION_COLORS.skip;
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {String(decision ?? "—").toUpperCase()}
    </span>
  );
};

// Sync history for a single document.
const SyncEventModal = ({ open, doc, events, onClose }) => (
  <Modal open={open} onClose={onClose} title={doc ? `History — ${doc.original_filename ?? doc.title ?? "document"}` : "History"} size="large">
    {events.length === 0 ? (
      <div className="row-list-empty">No sync events for this document.</div>
    ) : (
      <div className="row-list">
        {events.map((e) => (
          <div key={e.id} className="row-item">
            <div className="row-item-main">
              <div className="row-item-name" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge decision={e.decision} />
                {e.incoming_filename ?? "—"}
              </div>
              <div className="row-item-meta">
                {fmt(e.created_at)} · {e.trigger}
                {e.similarity_method ? ` · ${e.similarity_method}` : ""}
                {e.similarity_score != null ? ` · score ${Number(e.similarity_score).toFixed(3)}` : ""}
                {e.status === "failed" ? ` · failed: ${e.error_message ?? ""}` : ""}
                {e.warning ? ` · ⚠ ${e.warning}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </Modal>
);

export default SyncEventModal;
