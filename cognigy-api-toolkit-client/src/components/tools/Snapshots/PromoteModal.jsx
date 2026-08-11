import { useEffect, useMemo, useState } from "react";
import Modal from "../../ui/Modal";
import Select from "../../ui/Select";
import { supabase } from "../../../lib/supabase";
import {
  formatVersion,
  latestVersion,
  prePromoteName,
} from "../../../utils/snapshotVersion";

// Lets the user pick a target project + API key for a Promote job.
// The job kind is derived from the picked target:
//   target == source's project  -> promote_same  (safety + Restore here)
//   target != source's project  -> promote_cross (safety on target + Upload)
//
// The version travels with the artifact: the snapshot keeps its own name in the
// target. Before it lands, the target is snapshotted at its current version so
// there's a rollback point — that name is computed here so the user can see it
// before confirming.
const PromoteModal = ({ open, sourceSnapshot, sourceProject, onClose, onConfirm }) => {
  const [allProjects, setAllProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [keys, setKeys] = useState([]);

  const [targetProjectId, setTargetProjectId] = useState("");
  const [targetApiKeyId, setTargetApiKeyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Target's current version — the rollback point the safety snapshot records.
  // Tagged with the target it was read for, so switching target reads as
  // "loading" until the new fetch lands instead of briefly showing a stale one.
  const [versionInfo, setVersionInfo] = useState({
    key: "",
    state: "idle",
    version: null,
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTargetProjectId("");
    setTargetApiKeyId("");
    (async () => {
      const [pr, cu] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, customer_id, cognigy_project_id")
          .order("name", { ascending: true }),
        supabase.from("customers").select("id, name").order("name", { ascending: true }),
      ]);
      if (pr.error) {
        setError(pr.error.message);
        return;
      }
      if (cu.error) {
        setError(cu.error.message);
        return;
      }
      setAllProjects(pr.data ?? []);
      setCustomers(cu.data ?? []);
    })();
  }, [open]);

  useEffect(() => {
    if (!targetProjectId) {
      setKeys([]);
      setTargetApiKeyId("");
      return;
    }
    const proj = allProjects.find((p) => p.id === targetProjectId);
    if (!proj) return;
    (async () => {
      const { data, error: err } = await supabase
        .from("api_keys")
        .select("id, name, key_last4")
        .eq("customer_id", proj.customer_id)
        .order("created_at", { ascending: false });
      if (err) {
        setError(err.message);
        return;
      }
      const keysList = data ?? [];
      setKeys(keysList);
      setTargetApiKeyId(keysList.length === 1 ? keysList[0].id : "");
    })();
  }, [targetProjectId, allProjects]);

  const versionKey =
    targetProjectId && targetApiKeyId ? `${targetProjectId}:${targetApiKeyId}` : "";
  const versionState = !versionKey
    ? "idle"
    : versionInfo.key === versionKey
      ? versionInfo.state
      : "loading";
  const targetVersion = versionInfo.key === versionKey ? versionInfo.version : null;

  // Read the target's version straight from Cognigy (plus anything we hold for
  // it — an evicted-but-archived snapshot can be the highest version).
  useEffect(() => {
    if (!versionKey) return;
    const proj = allProjects.find((p) => p.id === targetProjectId);
    if (!proj) return;

    let cancelled = false;
    (async () => {
      try {
        const [remote, local] = await Promise.all([
          supabase.functions.invoke("cognigy-snapshots", {
            body: {
              action: "list_remote",
              api_key_id: targetApiKeyId,
              cognigy_project_id: proj.cognigy_project_id,
              project_id: targetProjectId,
            },
          }),
          supabase.from("snapshots").select("name").eq("project_id", targetProjectId),
        ]);
        if (cancelled) return;
        if (remote.error) throw remote.error;
        if (local.error) throw local.error;

        const names = [
          ...(remote.data?.items ?? []).map((i) => i.name),
          ...(local.data ?? []).map((r) => r.name),
        ];
        setVersionInfo({
          key: versionKey,
          state: "ready",
          version: latestVersion(names),
        });
      } catch {
        if (cancelled) return;
        // Non-fatal: the worker derives the safety name itself when we don't
        // send one. We just can't preview it here.
        setVersionInfo({ key: versionKey, state: "error", version: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [versionKey, targetProjectId, targetApiKeyId, allProjects]);

  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.name]));
    return (projId) => {
      const p = allProjects.find((pp) => pp.id === projId);
      return p ? map.get(p.customer_id) : "";
    };
  }, [customers, allProjects]);

  const kind = useMemo(() => {
    if (!targetProjectId || !sourceSnapshot) return null;
    return targetProjectId === sourceSnapshot.project_id ? "promote_same" : "promote_cross";
  }, [targetProjectId, sourceSnapshot]);

  const targetLabel = useMemo(() => {
    const p = allProjects.find((pp) => pp.id === targetProjectId);
    return p ? p.name : "the target";
  }, [allProjects, targetProjectId]);

  const promotedLabel = sourceSnapshot?.version ?? sourceSnapshot?.name ?? "snapshot";

  // Only previewable once we know the target's version; otherwise the worker
  // derives the name when it runs.
  const safetyName = versionState === "ready" ? prePromoteName(targetVersion) : null;

  const handleConfirm = async () => {
    if (!targetProjectId || !targetApiKeyId || !kind) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({
        kind,
        targetProjectId,
        targetApiKeyId,
        safetyName: safetyName ?? undefined,
        safetyDescription: safetyName
          ? `Safety snapshot of ${targetLabel} taken before promoting ${promotedLabel} from ${sourceProject?.name ?? "a lower environment"}`
          : undefined,
      });
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const canConfirm = !busy && targetProjectId && targetApiKeyId && kind;

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Promote snapshot"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={kind === "promote_same" ? "btn-danger" : "btn-primary"}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {busy
              ? "Working…"
              : kind === "promote_same"
                ? "Take safety + Restore"
                : "Take safety + Upload"}
          </button>
        </>
      }
    >
      <div className="field-group">
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <span className="field-label">Source</span>
          <div>
            <strong>{sourceSnapshot?.name}</strong>
            <span className="row-item-meta" style={{ marginLeft: 8 }}>
              from {sourceProject?.name}
            </span>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Target project</span>
          <Select
            className="select"
            value={targetProjectId}
            onChange={(v) => setTargetProjectId(v)}
            disabled={busy}
            placeholder="— pick a project —"
            options={[
              { value: "", label: "— pick a project —" },
              ...allProjects.map((p) => ({
                value: p.id,
                label: `${customerName(p.id)} / ${p.name}${
                  p.id === sourceSnapshot?.project_id
                    ? "  (same env — will Restore)"
                    : ""
                }`,
              })),
            ]}
          />
        </label>

        {targetProjectId && (
          <label className="field">
            <span className="field-label">Target API key</span>
            {keys.length === 0 ? (
              <div className="row-list-empty">
                No API keys for this customer. Add one in the customer page first.
              </div>
            ) : (
              <Select
                className="select"
                value={targetApiKeyId}
                onChange={(v) => setTargetApiKeyId(v)}
                disabled={busy}
                placeholder="— pick a key —"
                options={[
                  { value: "", label: "— pick a key —" },
                  ...keys.map((k) => ({
                    value: k.id,
                    label: `${k.name} ···· ${k.key_last4}`,
                  })),
                ]}
              />
            )}
          </label>
        )}

        {targetProjectId && targetApiKeyId && (
          <div className="field">
            <span className="field-label">Safety snapshot of the target</span>
            {versionState === "loading" && (
              <span className="field-hint">Reading {targetLabel}'s version…</span>
            )}
            {versionState === "ready" && (
              <>
                <div className="snap-promote-flow">
                  <strong className="snap-version-current">
                    {formatVersion(targetVersion) ?? "unversioned"}
                  </strong>
                  <span className="snap-version-arrow">→</span>
                  <strong className="snap-version-next">{promotedLabel}</strong>
                </div>
                <span className="field-hint">
                  {targetLabel} is snapshotted as <strong>{safetyName}</strong>{" "}
                  before {promotedLabel} lands, so you can roll back to it.
                </span>
              </>
            )}
            {versionState === "error" && (
              <span className="field-hint">
                Couldn't read {targetLabel}'s current version from Cognigy. The
                safety snapshot is still taken first — the worker names it when
                it runs.
              </span>
            )}
          </div>
        )}

        {kind === "promote_same" && (
          <div className="form-error" style={{ background: "#fff7e6", color: "#92400e", border: "1px solid #fcd34d" }}>
            <strong>Destructive:</strong> Restore overwrites all Flows, Lexicons, NLU
            models and other resources in the target project. A safety snapshot is
            taken first so you can roll back, but live Endpoints will briefly break.
          </div>
        )}

        {kind === "promote_cross" && (
          <div className="form-error" style={{ background: "#eef2ff", color: "#3730a3", border: "1px solid #c7d2fe" }}>
            Uploads the snapshot to the target. A safety snapshot of the target is
            taken first. The target's runtime state is not changed — go into the
            target's Cognigy and Restore the new snapshot to make it live.
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PromoteModal;
