import { useState } from "react";
import Modal from "../../ui/Modal";
import FormField from "../../ui/FormField";

// Create-a-knowledge-store dialog. On success the parent re-lists stores and
// selects the new one (Cognigy's create response isn't relied on for the id).
const CreateStoreModal = ({ open, onClose, onCreate, busy, error }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const canSubmit = !!name.trim() && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const created = await onCreate({
      name: name.trim(),
      description: description.trim(),
    });
    if (created) {
      setName("");
      setDescription("");
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Create knowledge store"
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
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {busy ? (
              <>
                <span className="spinner" /> Creating…
              </>
            ) : (
              "Create store"
            )}
          </button>
        </>
      }
    >
      <FormField label="Name" required>
        <input
          className="input"
          placeholder="e.g. Product Knowledge Base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </FormField>
      <FormField label="Description">
        <input
          className="input"
          placeholder="optional"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </FormField>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
};

export default CreateStoreModal;
