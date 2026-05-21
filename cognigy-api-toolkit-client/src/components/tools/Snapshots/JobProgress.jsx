import Card from "../../ui/Card";
import Terminal from "../../ui/Terminal";

const KIND_LABEL = {
  create: "Taking snapshot",
  promote_same: "Promoting (same env)",
  promote_cross: "Promoting (cross env)",
};

const STEP_LABEL = {
  evicting_for_create: "Evicting oldest to make room",
  creating: "Asking Cognigy to create the snapshot",
  polling_create: "Waiting on Cognigy create task",
  polling_package: "Packaging snapshot for download",
  downloading: "Downloading .csnap into the store",
  evict_for_upload: "Evicting on target before upload",
  uploading: "Uploading to target Cognigy",
  polling_upload: "Waiting on target upload task",
  restoring: "Starting Cognigy restore",
  polling_restore: "Waiting on Cognigy restore task",
  done: "Done",
};

const JobProgress = ({ job }) => {
  const lines = (job.log ?? [])
    .filter((e) => e?.type !== "meta")
    .map((e) => ({
      msg: `[${new Date(e.at).toLocaleTimeString()}] ${e.msg}`,
      type: e.type === "ok" ? "ok" : e.type === "err" ? "err" : "info",
    }));

  return (
    <Card title={`${KIND_LABEL[job.kind] ?? job.kind} — ${job.status}`}>
      <div className="grid grid--2 mb-14">
        <div className="row-item-meta">
          Step: <strong>{STEP_LABEL[job.step] ?? job.step ?? "starting"}</strong>
        </div>
        <div className="row-item-meta" style={{ textAlign: "right" }}>
          {job.progress_pct}%
        </div>
      </div>
      <div
        style={{
          height: 6,
          background: "#e5e7eb",
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: `${job.progress_pct}%`,
            height: "100%",
            background: job.status === "failed" ? "#ef4444" : "#6366f1",
            transition: "width 300ms ease",
          }}
        />
      </div>
      {job.error_message && (
        <div className="form-error" style={{ marginBottom: 8 }}>
          {job.error_message}
        </div>
      )}
      {lines.length > 0 && <Terminal lines={lines} />}
    </Card>
  );
};

export default JobProgress;
