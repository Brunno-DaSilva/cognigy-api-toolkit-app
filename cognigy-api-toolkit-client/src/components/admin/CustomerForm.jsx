import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

// Presets the customer picks from instead of typing a raw URL. Each carries the
// base URL and the platform behaviour the proxy branches on. "custom" lets a
// user paste a private-SaaS / other-region URL; its platform is inferred from
// the hostname (any *.nicecxone.com host is CXone, everything else Cognigy).
const PRESETS = [
  {
    id: "cognigy-us",
    label: "Cognigy — US (api-app-us.cognigy.ai)",
    baseUrl: "https://api-app-us.cognigy.ai",
    platform: "cognigy",
  },
  {
    id: "cxone-na1",
    label: "CXone — NA1 (cognigy-api-na1.nicecxone.com)",
    baseUrl: "https://cognigy-api-na1.nicecxone.com",
    platform: "cxone",
  },
  {
    id: "custom",
    label: "Custom / private SaaS URL",
    baseUrl: "",
    platform: null,
  },
];

const DEFAULT_PRESET = PRESETS[0];

const inferPlatform = (url) =>
  /(^|\.)nicecxone\.com/i.test(url) ? "cxone" : "cognigy";

// Match a saved base URL back to a preset so editing shows the right selection.
const presetForBaseUrl = (url) =>
  PRESETS.find((p) => p.baseUrl && p.baseUrl === url) ?? null;

const CustomerForm = ({ open, customer, onClose, onSaved }) => {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_PRESET.baseUrl);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(customer?.name ?? "");
      if (customer?.base_url) {
        const matched = presetForBaseUrl(customer.base_url);
        setPresetId(matched ? matched.id : "custom");
        setBaseUrl(customer.base_url);
      } else {
        setPresetId(DEFAULT_PRESET.id);
        setBaseUrl(DEFAULT_PRESET.baseUrl);
      }
      setError(null);
    }
  }, [open, customer]);

  const isCustom = presetId === "custom";

  const handlePresetChange = (id) => {
    setPresetId(id);
    const preset = PRESETS.find((p) => p.id === id);
    // Custom keeps whatever's already typed; presets overwrite the URL.
    if (preset && preset.id !== "custom") {
      setBaseUrl(preset.baseUrl);
    } else if (presetForBaseUrl(baseUrl)) {
      // Coming from a preset into custom — clear the preset URL so the user types.
      setBaseUrl("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedUrl = baseUrl.trim();
      const preset = PRESETS.find((p) => p.id === presetId);
      const platform =
        preset && preset.platform ? preset.platform : inferPlatform(trimmedUrl);

      if (customer) {
        const { error: err } = await supabase
          .from("customers")
          .update({ name: name.trim(), base_url: trimmedUrl, platform })
          .eq("id", customer.id);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase
          .from("customers")
          .insert({
            user_id: user.id,
            name: name.trim(),
            base_url: trimmedUrl,
            platform,
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
          <span className="field-label">Platform</span>
          <select
            className="field-input"
            value={presetId}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="field-hint">
            Pick the platform this customer was created on. Cognigy and CXone use
            different API hosts. Choose Custom for other regions or a private
            SaaS URL.
          </span>
        </label>

        {isCustom && (
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              className="field-input"
              type="url"
              required
              autoFocus
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://cognigy-api-eu1.nicecxone.com"
            />
            <span className="field-hint">
              Full API base URL. Any *.nicecxone.com host is treated as CXone;
              anything else as Cognigy.
            </span>
          </label>
        )}
      </form>
    </Modal>
  );
};

export default CustomerForm;
