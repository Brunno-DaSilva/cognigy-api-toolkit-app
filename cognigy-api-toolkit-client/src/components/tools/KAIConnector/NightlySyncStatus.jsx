import Card from "../../ui/Card";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "never");

// Last nightly run summary + ad-hoc "Run now" / "Dry run" triggers.
const NightlySyncStatus = ({ store, onRunNow, running, lastRun }) => {
  const summaries = Array.isArray(store?.last_sync_summary)
    ? store.last_sync_summary
    : store?.last_sync_summary
      ? [store.last_sync_summary]
      : [];

  const totals = summaries.reduce(
    (acc, s) => ({
      evaluated: acc.evaluated + (s.evaluated ?? 0),
      add: acc.add + (s.add ?? 0),
      replace: acc.replace + (s.replace ?? 0),
      hold: acc.hold + (s.hold ?? 0),
      skip: acc.skip + (s.skip ?? 0),
      failed: acc.failed + (s.failed ?? 0),
    }),
    { evaluated: 0, add: 0, replace: 0, hold: 0, skip: 0, failed: 0 },
  );

  const errors = summaries.flatMap((s) => s.errors ?? []);

  return (
    <Card title="Nightly sync">
      <div className="row-item-meta" style={{ marginBottom: 12 }}>
        {store?.nightly_sync_enabled
          ? `Scheduled: ${store.nightly_sync_cron ?? "—"}`
          : "Nightly sync is disabled for this store."}
        {" · "}Last run: {fmt(store?.last_sync_at)}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        {[
          ["Evaluated", totals.evaluated],
          ["Added", totals.add],
          ["Replaced", totals.replace],
          ["Held", totals.hold],
          ["Skipped", totals.skip],
          ["Failed", totals.failed],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="row-item-name">{value}</div>
            <div className="row-item-meta">{label}</div>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <div className="form-error" style={{ marginBottom: 12 }}>
          {errors.length} issue(s) on last run: {errors.slice(0, 3).join("; ")}
          {errors.length > 3 ? "…" : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => onRunNow({ dryRun: true })}
          disabled={running || !store?.source_api_url}
          title="Preview decisions without uploading or deleting anything in Cognigy"
        >
          {running ? "Running…" : "Dry run (preview)"}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onRunNow({ dryRun: false })}
          disabled={running || !store?.source_api_url}
        >
          {running ? "Running…" : "Run now"}
        </button>
        {!store?.source_api_url && (
          <span className="row-item-meta">
            Set a Source system API URL in the store config to enable sync.
          </span>
        )}
      </div>

      {lastRun && (
        <div style={{ marginTop: 16 }}>
          <div className="row-item-meta" style={{ marginBottom: 6 }}>
            {lastRun.dry_run ? "Dry run preview" : "Last run"} — {lastRun.decisions?.length ?? 0} document(s)
          </div>
          {(lastRun.decisions ?? []).length === 0 ? (
            <div className="row-list-empty">No documents returned from the source.</div>
          ) : (
            <div className="row-list">
              {lastRun.decisions.map((d, i) => (
                <div key={i} className="row-item">
                  <div className="row-item-main">
                    <div className="row-item-name" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <DecisionBadge decision={d.decision} />
                      {d.filename}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(lastRun.errors ?? []).length > 0 && (
            <div className="form-error" style={{ marginTop: 8 }}>
              {lastRun.errors.join("; ")}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

const DECISION_COLORS = {
  skip: { bg: "#f3f4f6", fg: "#374151" },
  add: { bg: "#ecfdf5", fg: "#047857" },
  replace: { bg: "#eef2ff", fg: "#3730a3" },
  hold: { bg: "#fff7e6", fg: "#92400e" },
};

const DecisionBadge = ({ decision }) => {
  const c = DECISION_COLORS[decision] ?? DECISION_COLORS.skip;
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {String(decision ?? "—").toUpperCase()}
    </span>
  );
};

export default NightlySyncStatus;
