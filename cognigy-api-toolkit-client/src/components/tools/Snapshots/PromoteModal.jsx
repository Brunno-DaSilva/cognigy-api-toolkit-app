import { useEffect, useMemo, useState } from "react";
import Modal from "../../ui/Modal";
import Select from "../../ui/Select";
import { supabase } from "../../../lib/supabase";

// Lets the user pick a target project + API key for a Promote job.
// The job kind is derived from the picked target:
//   target == source's project  -> promote_same  (safety + Restore here)
//   target != source's project  -> promote_cross (safety on target + Upload)
const PromoteModal = ({ open, sourceSnapshot, sourceProject, onClose, onConfirm }) => {
  const [allProjects, setAllProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [keys, setKeys] = useState([]);

  const [targetProjectId, setTargetProjectId] = useState("");
  const [targetApiKeyId, setTargetApiKeyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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

  const handleConfirm = async () => {
    if (!targetProjectId || !targetApiKeyId || !kind) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ kind, targetProjectId, targetApiKeyId });
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
