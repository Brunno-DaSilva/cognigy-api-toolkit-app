import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

const DEFAULT_BASE_URL = "https://api-app-us.cognigy.ai";

const CustomerForm = ({ open, customer, onClose, onSaved }) => {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(customer?.name ?? "");
      setBaseUrl(customer?.base_url ?? DEFAULT_BASE_URL);
      setError(null);
    }
  }, [open, customer]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (customer) {
        const { error: err } = await supabase
          .from("customers")
          .update({ name: name.trim(), base_url: baseUrl.trim() })
          .eq("id", customer.id);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase
          .from("customers")
          .insert({
            user_id: user.id,
            name: name.trim(),
            base_url: baseUrl.trim(),
          })
          .select()
          .single();
        if (err) throw err;
        onSaved?.(data);
        onClose();
        return;
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save customer");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onClose}
      title={customer ? "Edit customer" : "Add customer"}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="customer-form" className="btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : customer ? "Save changes" : "Add customer"}
          </button>
        </>
      }
    >
      <form id="customer-form" className="field-group" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <label className="field">
          <span className="field-label">Customer name</span>
          <input
            className="field-input"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corp"
          />
        </label>

        <label className="field">
          <span className="field-label">Cognigy base URL</span>
          <input
            className="field-input"
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <span className="field-hint">
            Regional API URL — e.g. https://api-app-us.cognigy.ai (US),
            https://api-trial.cognigy.ai (EU)
          </span>
        </label>
      </form>
    </Modal>
  );
};

export default CustomerForm;
