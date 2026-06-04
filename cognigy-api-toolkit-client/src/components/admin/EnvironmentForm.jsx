import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { supabase } from "../../lib/supabase";

const EnvironmentForm = ({ open, environment, customerId, onClose, onSaved }) => {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(environment?.name ?? "");
      setBaseUrl(environment?.base_url ?? "");
      setError(null);
    }
  }, [open, environment]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (environment) {
        const { error: err } = await supabase
          .from("environments")
          .update({ name: name.trim(), base_url: baseUrl.trim() })
          .eq("id", environment.id);
        if (err) throw err;
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) throw new Error("Not signed in.");
        const { error: err } = await supabase.from("environments").insert({
          customer_id: customerId,
          user_id: userId,
          name: name.trim(),
          base_url: baseUrl.trim(),
        });
        if (err) throw err;
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save environment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onClose}
      title={environment ? "Edit environment" : "Add environment"}
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="env-form"
            className="btn-primary"
            disabled={submitting}
          >
            {submitting ? "Saving…" : environment ? "Save changes" : "Add environment"}
          </button>
        </>
      }
    >
      <form id="env-form" className="field-group" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <label className="field">
          <span className="field-label">Environment name</span>
          <input
            className="field-input"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. PROD, QA, DEV, Sandbox"
          />
          <span className="field-hint">
            Free-form label. Use whatever scheme makes sense for this customer.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Base URL</span>
          <input
            className="field-input"
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api-app-us.cognigy.ai"
          />
          <span className="field-hint">
            The Cognigy API URL for this environment. Projects assigned to this env
            route their API calls here.
          </span>
        </label>
      </form>
    </Modal>
  );
};

export default EnvironmentForm;
