import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { supabase } from "../../lib/supabase";

// API keys are write-only from the UI: the plaintext is never read back.
// Edit mode pre-fills the name only; the key field is empty and acts as a
// "replace key" input — if left blank, the existing encrypted key stays as-is.
const ApiKeyForm = ({ open, apiKey, customerId, onClose, onSaved }) => {
  const [name, setName] = useState("");
  const [keyPlaintext, setKeyPlaintext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(apiKey?.name ?? "");
      setKeyPlaintext("");
      setError(null);
    }
  }, [open, apiKey]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (apiKey) {
        const { error: err } = await supabase.rpc("update_api_key", {
          p_api_key_id: apiKey.id,
          p_new_name: name.trim(),
          p_new_key_plaintext: keyPlaintext, // empty means "leave key unchanged"
          p_new_secret_plaintext: null,
        });
        if (err) throw err;
      } else {
        if (!keyPlaintext) throw new Error("API key value is required");
        const { error: err } = await supabase.rpc("create_api_key", {
          p_customer_id: customerId,
          p_name: name.trim(),
          p_key_plaintext: keyPlaintext,
          p_secret_plaintext: null,
        });
        if (err) throw err;
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save API key");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onClose}
      title={apiKey ? "Edit API key" : "Add API key"}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="apikey-form" className="btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : apiKey ? "Save changes" : "Add key"}
          </button>
        </>
      }
    >
      <form id="apikey-form" className="field-group" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <label className="field">
          <span className="field-label">Key name</span>
          <input
            className="field-input"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Prod read-only"
          />
          <span className="field-hint">
            How this key is identified throughout the app. The actual key value is
            never displayed.
          </span>
        </label>

        <label className="field">
          <span className="field-label">
            {apiKey ? "Replace key (optional)" : "API key value"}
          </span>
          <input
            className="field-input"
            type="password"
            autoComplete="off"
            required={!apiKey}
            value={keyPlaintext}
            onChange={(e) => setKeyPlaintext(e.target.value)}
            placeholder={apiKey ? "Leave blank to keep the current key" : "Paste the API key from Cognigy"}
          />
          <span className="field-hint">
            {apiKey
              ? "If you leave this empty, only the name changes. The existing key stays in place."
              : "Stored encrypted at rest. You will never be able to view it again — copy it from Cognigy now if you need it elsewhere."}
          </span>
        </label>
      </form>
    </Modal>
  );
};

export default ApiKeyForm;
