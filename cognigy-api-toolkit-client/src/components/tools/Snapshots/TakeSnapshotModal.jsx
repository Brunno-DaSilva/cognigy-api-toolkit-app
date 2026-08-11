import { useMemo, useState } from "react";
import Modal from "../../ui/Modal";
import {
  BUMPS,
  formatVersion,
  nextVersion,
} from "../../../utils/snapshotVersion";

// Asks for the two things a version needs before any snapshot is taken:
// the bump (major / minor / patch) and what changed. Both are required —
// the confirm button stays disabled until they're filled in.
//
// `current` is the project's highest existing version (null if nothing is
// versioned yet, in which case the first snapshot is v1.0.0).
//
// Mounted only while open (see Snapshots.jsx), so every open starts blank —
// no bump preselected and no leftover changelog from a previous snapshot.
const TakeSnapshotModal = ({
  open,
  current,
  recent = [],
  onClose,
  onConfirm,
}) => {
  const [bump, setBump] = useState(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const preview = useMemo(
    () => (bump ? formatVersion(nextVersion(current, bump)) : null),
    [bump, current],
  );

  const canConfirm = !busy && !!bump && description.trim().length > 0;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({
        bump,
        version: preview,
        name: preview,
        description: description.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Take a snapshot"
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
            title={
              canConfirm
                ? `Create ${preview} in Cognigy`
                : "Pick a version bump and describe what changed"
            }
          >
            {busy ? "Working…" : preview ? `Create ${preview}` : "Create snapshot"}
          </button>
        </>
      }
    >
      <div className="field-group">
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <span className="field-label">Current version</span>
          <div className="snap-version-line">
            <strong className="snap-version-current">
              {formatVersion(current) ?? "none yet"}
            </strong>
            {preview && (
              <>
                <span className="snap-version-arrow">→</span>
                <strong className="snap-version-next">{preview}</strong>
              </>
            )}
          </div>
          {!current && (
            <span className="field-hint">
              No versioned snapshots in this project yet — the first one is
              v1.0.0 whichever bump you pick.
            </span>
          )}
        </div>

        <div className="field">
          <span className="field-label">What kind of change is this?</span>
          <div className="bump-grid">
            {BUMPS.map((b) => {
              const result = formatVersion(nextVersion(current, b.value));
              const selected = bump === b.value;
              return (
                <button
                  key={b.value}
                  type="button"
                  className={`bump-option${selected ? " bump-option--on" : ""}`}
                  onClick={() => setBump(b.value)}
                  disabled={busy}
                  aria-pressed={selected}
                >
                  <span className="bump-option-label">{b.label}</span>
                  <span className="bump-option-version">{result}</span>
                  <span className="bump-option-hint">{b.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="field">
          <span className="field-label">What changed?</span>
          <textarea
            className="field-input snap-changelog"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            placeholder="e.g. Added the refund flow, retrained billing intents, fixed the handover fallback"
          />
          <span className="field-hint">
            Stored as the snapshot's description in Cognigy and travels with it
            when you promote.
          </span>
        </label>

        {recent.length > 0 && (
          <div className="field">
            <span className="field-label">Recent snapshots</span>
            <div className="snap-history">
              {recent.map((r) => (
                <div key={r.key} className="snap-history-row">
                  <span className="snap-history-name">{r.name}</span>
                  <span className="snap-history-desc">
                    {r.description || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default TakeSnapshotModal;
