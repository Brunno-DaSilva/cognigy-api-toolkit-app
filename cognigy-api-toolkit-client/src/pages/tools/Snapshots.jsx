import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useActiveProject } from "../../context/ActiveProjectContext";
import useSnapshots from "../../hooks/useSnapshots";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import JobProgress from "../../components/tools/Snapshots/JobProgress";
import PromoteModal from "../../components/tools/Snapshots/PromoteModal";
import NoActiveProject from "./NoActiveProject";

const formatBytes = (n) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const formatDate = (input) => {
  if (input == null) return "—";
  // Cognigy returns unix seconds/ms; DB returns ISO strings.
  const d = typeof input === "number"
    ? new Date(input < 1e12 ? input * 1000 : input)
    : new Date(input);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

const Snapshots = () => {
  const {
    activeProjectId,
    project,
    customer,
    apiKeys,
    loading: projectLoading,
  } = useActiveProject();

  const [apiKeyId, setApiKeyId] = useState("");
  const effectiveKeyId = useMemo(
    () => apiKeyId || apiKeys[0]?.id || "",
    [apiKeyId, apiKeys],
  );

  const {
    currents,
    archived,
    activeJobs,
    error,
    remoteListError,
    startJob,
    importExisting,
    reload,
  } = useSnapshots({
    projectId: activeProjectId,
    cognigyProjectId: project?.cognigy_project_id,
    apiKeyId: effectiveKeyId,
  });

  const [promoteFor, setPromoteFor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  if (!activeProjectId) return <NoActiveProject toolName="Snapshots" />;
  if (projectLoading) return <div className="admin-page">Loading project…</div>;
  if (!project) return <NoActiveProject toolName="Snapshots" />;

  const handleTakeSnapshot = async () => {
    if (!effectiveKeyId) {
      setActionError("Pick an API key first.");
      return;
    }
    setActionError(null);
    try {
      await startJob({
        kind: "create",
        targetProjectId: activeProjectId,
        targetApiKeyId: effectiveKeyId,
      });
    } catch (err) {
      setActionError(err.message || String(err));
    }
  };

  const handleImport = async (cognigySnapshotId) => {
    setActionError(null);
    try {
      await importExisting(cognigySnapshotId);
    } catch (err) {
      setActionError(err.message || String(err));
    }
  };

  const handleDownload = async (dbSnapshotId, fallbackName) => {
    setActionError(null);
    setDownloadingId(dbSnapshotId);
    try {
      const { data, error: invErr } = await supabase.functions.invoke(
        "cognigy-snapshots",
        { body: { action: "sign_download", snapshot_id: dbSnapshotId } },
      );
      if (invErr) throw invErr;
      if (!data?.url) throw new Error("no signed URL returned");
      const a = document.createElement("a");
      a.href = data.url;
      a.download = data.filename || `${fallbackName}.csnap`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setActionError(err.message || String(err));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      const { error: invErr } = await supabase.functions.invoke(
        "cognigy-snapshots",
        { body: { action: "delete_from_store", snapshot_id: confirmDelete.id } },
      );
      if (invErr) throw invErr;
      setConfirmDelete(null);
      await reload();
    } catch (err) {
      setActionError(err.message || String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handlePromote = async ({ kind, targetProjectId, targetApiKeyId }) => {
    await startJob({
      kind,
      targetProjectId,
      targetApiKeyId,
      sourceSnapshotId: promoteFor.id,
    });
  };

  const archiveFull = archived.length >= 10;
  const cognigyFull = currents.length >= 10;
  const hasActiveJob = activeJobs.length > 0;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Snapshots</div>
          <div className="admin-page-sub">
            {customer?.name} / {project.name}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {apiKeys.length > 1 && (
            <select
              className="select"
              value={effectiveKeyId}
              onChange={(e) => setApiKeyId(e.target.value)}
            >
              {apiKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ···· {k.key_last4}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={reload}
            disabled={hasActiveJob}
            title="Refresh from Cognigy"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={hasActiveJob || apiKeys.length === 0}
            onClick={handleTakeSnapshot}
            title={apiKeys.length === 0 ? "Add an API key first" : "Take snapshot in Cognigy"}
          >
            + Take snapshot
          </button>
        </div>
      </header>

      {apiKeys.length === 0 && (
        <div className="row-list-empty" style={{ marginBottom: 16 }}>
          No API keys for this customer.{" "}
          <Link className="btn-link" to={`/admin/customers/${customer?.id}`}>
            Add one →
          </Link>
        </div>
      )}

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
      {remoteListError && (
        <div
          className="form-error"
          style={{
            marginBottom: 12,
            background: "#fff7e6",
            color: "#92400e",
            border: "1px solid #fcd34d",
          }}
        >
          Couldn't fetch the live Cognigy snapshot list: {remoteListError}. The
          Current section may be out of date — your archived snapshots are still
          shown below.
        </div>
      )}
      {actionError && (
        <div className="form-error" style={{ marginBottom: 12 }}>{actionError}</div>
      )}

      {/* Active jobs ------------------------------------------------------- */}
      {activeJobs.map((job) => (
        <div key={job.id} style={{ marginBottom: 16 }}>
          <JobProgress job={job} />
        </div>
      ))}

      {/* Current ----------------------------------------------------------- */}
      <div className="section-header">
        <div className="section-title">
          Current in Cognigy{" "}
          <span className="row-item-meta">({currents.length}/10)</span>
        </div>
      </div>
      {cognigyFull && (
        <div
          className="form-error"
          style={{
            background: "#eef2ff",
            color: "#3730a3",
            border: "1px solid #c7d2fe",
            marginBottom: 12,
          }}
        >
          Cognigy is at the 10-snapshot cap. Creating a new snapshot will move
          the oldest into Archived (if its .csnap is already imported into the
          store).
        </div>
      )}
      {currents.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">No snapshots in Cognigy.</div>
        </div>
      ) : (
        <div className="row-list">
          {currents.map((c) => (
            <CurrentRow
              key={c.cognigy_snapshot_id}
              row={c}
              disableActions={hasActiveJob}
              downloadingId={downloadingId}
              onDownload={handleDownload}
              onPromote={(localRow) =>
                setPromoteFor({ id: localRow.id, name: localRow.name, project_id: localRow.project_id })
              }
              onImport={handleImport}
            />
          ))}
        </div>
      )}

      {/* Archived ---------------------------------------------------------- */}
      <div className="section-header" style={{ marginTop: 24 }}>
        <div className="section-title">
          Archived in toolkit{" "}
          <span className="row-item-meta">({archived.length}/10)</span>
        </div>
      </div>
      {archiveFull && (
        <div
          className="form-error"
          style={{
            background: "#fff7e6",
            color: "#92400e",
            border: "1px solid #fcd34d",
            marginBottom: 12,
          }}
        >
          You've reached the archive limit. Creating new snapshots from here on
          will permanently delete the oldest archived one to make room.
        </div>
      )}
      {archived.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">No archived snapshots.</div>
        </div>
      ) : (
        <div className="row-list">
          {archived.map((s) => (
            <ArchivedRow
              key={s.id}
              row={s}
              disableActions={hasActiveJob}
              downloadingId={downloadingId}
              onDownload={handleDownload}
              onPromote={(row) =>
                setPromoteFor({ id: row.id, name: row.name, project_id: row.project_id })
              }
              onDelete={(row) => setConfirmDelete(row)}
            />
          ))}
        </div>
      )}

      {/* Modals ------------------------------------------------------------ */}
      <PromoteModal
        open={!!promoteFor}
        sourceSnapshot={promoteFor}
        sourceProject={project}
        onClose={() => setPromoteFor(null)}
        onConfirm={handlePromote}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete archived snapshot"
        message={
          confirmDelete
            ? `Permanently delete "${confirmDelete.name}" from the toolkit store? The .csnap file will be deleted. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete from store"
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};

// --------------------------------------------------------------------------

const CurrentRow = ({
  row,
  disableActions,
  downloadingId,
  onDownload,
  onPromote,
  onImport,
}) => {
  const hasBinary = !!row.localRow?.storage_path;
  const name = row.cognigy_name ?? row.localRow?.name ?? row.cognigy_snapshot_id;
  const downloadingThis = hasBinary && downloadingId === row.localRow.id;

  return (
    <div className="row-item">
      <div className="row-item-main">
        <div className="row-item-name">
          {name}
          {!hasBinary && (
            <span
              className="badge"
              style={{ marginLeft: 8, background: "#fff7e6", color: "#92400e" }}
            >
              Cognigy only
            </span>
          )}
        </div>
        <div className="row-item-meta">
          {formatDate(row.cognigy_created_at)} ·{" "}
          {hasBinary ? formatBytes(row.localRow.size_bytes) : "not in store"} ·
          Cognigy id {row.cognigy_snapshot_id.slice(0, 8)}…
        </div>
      </div>
      <div className="row-item-actions" style={{ gap: 8 }}>
        {hasBinary ? (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onDownload(row.localRow.id, name)}
              disabled={disableActions || downloadingThis}
            >
              {downloadingThis ? "…" : "Download"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onPromote(row.localRow)}
              disabled={disableActions}
            >
              Promote
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => onImport(row.cognigy_snapshot_id)}
            disabled={disableActions}
            title="Download the .csnap into the toolkit store so it can be promoted or survive eviction"
          >
            Import to store
          </button>
        )}
      </div>
    </div>
  );
};

const ArchivedRow = ({
  row,
  disableActions,
  downloadingId,
  onDownload,
  onPromote,
  onDelete,
}) => {
  const downloadingThis = downloadingId === row.id;
  return (
    <div className="row-item">
      <div className="row-item-main">
        <div className="row-item-name">{row.name}</div>
        <div className="row-item-meta">
          archived {formatDate(row.archived_at)} · {formatBytes(row.size_bytes)}
        </div>
      </div>
      <div className="row-item-actions" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => onDownload(row.id, row.name)}
          disabled={disableActions || downloadingThis}
        >
          {downloadingThis ? "…" : "Download"}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onPromote(row)}
          disabled={disableActions}
        >
          Promote
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--danger"
          title="Delete from store"
          aria-label="Delete from store"
          onClick={() => onDelete(row)}
          disabled={disableActions}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default Snapshots;
