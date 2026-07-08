import { useMemo, useState } from "react";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const DECISIONS = ["all", "add", "replace", "hold", "skip"];

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Full audit log of every sync event for the store, with per-REPLACE backup
// management (download / restore) and CSV export.
const SyncLogPanel = ({ events, backups, storeName, onSignDownload, onRestore, busyId }) => {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [actionError, setActionError] = useState(null);

  const backupByEvent = useMemo(() => {
    const m = {};
    for (const b of backups) if (b.sync_event_id) m[b.sync_event_id] = b;
    return m;
  }, [backups]);

  const rows = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.decision === filter)),
    [events, filter],
  );

  const exportCsv = () => {
    const header = ["date", "trigger", "filename", "decision", "similarity_score", "method", "status"];
    const lines = [header.join(",")];
    for (const e of events) {
      lines.push([
        csvCell(e.created_at),
        csvCell(e.trigger),
        csvCell(e.incoming_filename),
        csvCell(e.decision),
        csvCell(e.similarity_score),
        csvCell(e.similarity_method),
        csvCell(e.status),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kai-sync-log-${(storeName || "store").replace(/\s+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  const handleDownload = async (backupId) => {
    setActionError(null);
    try {
      const { url, filename } = await onSignDownload(backupId);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "backup";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setActionError(err.message || String(err));
    }
  };

  const handleRestore = async (backupId) => {
    setActionError(null);
    try {
      await onRestore(backupId);
    } catch (err) {
      setActionError(err.message || String(err));
    }
  };

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Sync log</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            {DECISIONS.map((d) => (
              <option key={d} value={d}>{d === "all" ? "All decisions" : d}</option>
            ))}
          </select>
          <button type="button" className="btn-ghost" onClick={exportCsv} disabled={events.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      {actionError && <div className="form-error" style={{ marginBottom: 12 }}>{actionError}</div>}

      {rows.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">No events.</div>
        </div>
      ) : (
        <div className="row-list">
          {rows.map((e) => {
            const backup = backupByEvent[e.id];
            const isReplace = e.decision === "replace";
            const open = expanded === e.id;
            return (
              <div key={e.id} className="row-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <div className="row-item-main">
                    <div className="row-item-name">
                      <span className="badge" style={{ marginRight: 8 }}>{String(e.decision ?? "—").toUpperCase()}</span>
                      {e.incoming_filename ?? "—"}
                    </div>
                    <div className="row-item-meta">
                      {fmt(e.created_at)} · {e.trigger} · {e.status}
                      {e.similarity_method ? ` · ${e.similarity_method}` : ""}
                      {e.similarity_score != null ? ` · ${Number(e.similarity_score).toFixed(3)}` : ""}
                    </div>
                    {e.status === "failed" && e.error_message && (
                      <div className="row-item-meta" style={{ color: "var(--danger, #ef4444)" }}>
                        ✕ {e.error_message}
                      </div>
                    )}
                    {e.warning && (
                      <div className="row-item-meta" style={{ color: "#f59e0b" }}>
                        ⚠ {e.warning}
                      </div>
                    )}
                  </div>
                  {isReplace && (
                    <button type="button" className="btn-ghost" onClick={() => setExpanded(open ? null : e.id)}>
                      {open ? "Hide" : "Details"}
                    </button>
                  )}
                </div>

                {isReplace && open && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border, #e5e7eb)" }}>
                    {backup ? (
                      <>
                        <div className="row-item-meta">
                          Deleted: {backup.original_filename ?? "—"}
                          {backup.cognigy_source_id ? ` · source ${String(backup.cognigy_source_id).slice(0, 8)}…` : ""}
                          {" · "}backed up {fmt(backup.created_at)}
                          {!backup.original_binary_available && " · (metadata only — no original binary)"}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={!backup.original_binary_available}
                            onClick={() => handleDownload(backup.id)}
                          >
                            Download backup
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={!backup.original_binary_available || busyId === backup.id}
                            onClick={() => handleRestore(backup.id)}
                            title="Re-upload this backup to Cognigy KAI as a new source"
                          >
                            Restore
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="row-item-meta">No backup record linked to this event.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SyncLogPanel;
