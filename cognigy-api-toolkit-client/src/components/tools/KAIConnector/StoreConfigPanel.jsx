import { useEffect, useState } from "react";
import Card from "../../ui/Card";
import Modal from "../../ui/Modal";
import useKnowledgeStores from "../../../hooks/useKnowledgeStores";

const MONGO_ID = /^[a-f0-9]{24}$/i;

// Configures one tracked KAI Knowledge Store. Cognigy keys come from the active
// customer (project context); the Azure embedding key and customer source key
// are stored encrypted like any API key — named + pasted, never shown again.
const EMPTY = {
  id: null,
  cognigy_store_id: "",
  store_name: "",
  api_key_id: "",
  embedding_mode: "tfidf",
  azure_endpoint: "",
  azure_deployment: "",
  azure_api_key_id: "",
  source_api_url: "",
  source_api_key_id: "",
  nightly_sync_enabled: false,
  nightly_sync_cron: "0 2 * * *",
};

const fromStore = (s) =>
  !s ? { ...EMPTY } : {
    id: s.id,
    cognigy_store_id: s.cognigy_store_id ?? "",
    store_name: s.store_name ?? "",
    api_key_id: s.api_key_id ?? "",
    embedding_mode: s.embedding_mode ?? "tfidf",
    azure_endpoint: s.azure_endpoint ?? "",
    azure_deployment: s.azure_deployment ?? "",
    azure_api_key_id: s.azure_api_key_id ?? "",
    source_api_url: s.source_api_url ?? "",
    source_api_key_id: s.source_api_key_id ?? "",
    nightly_sync_enabled: !!s.nightly_sync_enabled,
    nightly_sync_cron: s.nightly_sync_cron ?? "0 2 * * *",
  };

const StoreConfigPanel = ({
  store,
  apiKeys,
  azureKeys,
  sourceKeys,
  projectId,
  cognigyProjectId,
  onSave,
  onCreateKey,
}) => {
  const [form, setForm] = useState(fromStore(store));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [keyModal, setKeyModal] = useState(null); // 'azure_openai' | 'source' | null
  const { stores: remoteStores, loading: storesLoading, error: storesError, loadStores } =
    useKnowledgeStores();

  useEffect(() => {
    setForm(fromStore(store));
  }, [store]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleBrowse = () => {
    if (!form.api_key_id) {
      setError("Pick a Cognigy API key first, then Browse.");
      return;
    }
    setError(null);
    loadStores({ apiKeyId: form.api_key_id, projectId, cognigyProjectId });
  };

  const handleSave = async () => {
    setError(null);
    if (!form.cognigy_store_id.trim()) {
      setError("Cognigy Knowledge Store ID is required.");
      return;
    }
    if (!form.api_key_id) {
      setError("Pick a Cognigy API key.");
      return;
    }
    if (form.embedding_mode === "azure_openai" && (!form.azure_endpoint || !form.azure_deployment || !form.azure_api_key_id)) {
      setError("Azure OpenAI mode needs an endpoint, a deployment name and an embedding key.");
      return;
    }
    if (form.nightly_sync_enabled && !form.source_api_url.trim()) {
      setError("Nightly sync needs a Source System API URL — that's the customer endpoint the job polls for new/updated articles. Add one, or turn nightly sync off.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...form,
        cognigy_store_id: form.cognigy_store_id.trim(),
        store_name: form.store_name.trim() || null,
        azure_endpoint: form.embedding_mode === "azure_openai" ? form.azure_endpoint.trim() || null : null,
        azure_deployment: form.embedding_mode === "azure_openai" ? form.azure_deployment.trim() || null : null,
        azure_api_key_id: form.embedding_mode === "azure_openai" ? form.azure_api_key_id || null : null,
        source_api_url: form.source_api_url.trim() || null,
        source_api_key_id: form.source_api_key_id || null,
        nightly_sync_cron: form.nightly_sync_enabled ? form.nightly_sync_cron.trim() || null : null,
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={store ? "Store configuration" : "New store"}>
      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="field-group">
        <label className="field">
          <span className="field-label">Cognigy Knowledge Store ID</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="field-input"
              value={form.cognigy_store_id}
              onChange={(e) => set("cognigy_store_id", e.target.value)}
              placeholder="24-char Cognigy store id (e.g. 6a24552c9079ecd0ab4baf99)"
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={handleBrowse}
              disabled={!form.api_key_id || storesLoading}
              title="List Knowledge Stores from Cognigy and pick one"
            >
              {storesLoading ? "…" : "Browse"}
            </button>
          </div>
          {storesError && (
            <span className="field-hint" style={{ color: "var(--danger, #ef4444)" }}>
              {storesError}
            </span>
          )}
          {remoteStores.length > 0 && (
            <select
              className="field-input"
              style={{ marginTop: 8 }}
              value=""
              onChange={(e) => {
                const s = remoteStores.find((x) => x._id === e.target.value);
                if (s) {
                  set("cognigy_store_id", s._id);
                  if (!form.store_name) set("store_name", s.name || "");
                }
              }}
            >
              <option value="">Select a store…</option>
              {remoteStores.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name || "(unnamed)"} — {s._id}
                </option>
              ))}
            </select>
          )}
          <span className="field-hint">
            Must be the Cognigy store ID (24-char hex / Mongo ID) — not a UUID.
            Click <strong>Browse</strong> to pick it from your store list.
            {form.cognigy_store_id && !MONGO_ID.test(form.cognigy_store_id.trim()) && (
              <span style={{ color: "var(--danger, #ef4444)" }}>
                {" "}This doesn't look like a Cognigy store ID — Cognigy will reject it.
              </span>
            )}
          </span>
        </label>

        <label className="field">
          <span className="field-label">Display name (optional)</span>
          <input
            className="field-input"
            value={form.store_name}
            onChange={(e) => set("store_name", e.target.value)}
            placeholder="e.g. Support KB — Production"
          />
        </label>

        <label className="field">
          <span className="field-label">Cognigy API key</span>
          <select
            className="field-input"
            value={form.api_key_id}
            onChange={(e) => set("api_key_id", e.target.value)}
          >
            <option value="">Select a key…</option>
            {apiKeys.map((k) => (
              <option key={k.id} value={k.id}>{k.name} ···· {k.key_last4}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Embedding mode</span>
          <select
            className="field-input"
            value={form.embedding_mode}
            onChange={(e) => set("embedding_mode", e.target.value)}
          >
            <option value="tfidf">TF-IDF (no AI)</option>
            <option value="azure_openai">Azure OpenAI</option>
          </select>
          <span className="field-hint">
            How KAI Connector decides whether an incoming file is new or an update.
            TF-IDF runs entirely in the function; Azure OpenAI uses embeddings.
          </span>
        </label>

        {form.embedding_mode === "azure_openai" && (
          <>
            <label className="field">
              <span className="field-label">Azure endpoint</span>
              <input
                className="field-input"
                value={form.azure_endpoint}
                onChange={(e) => set("azure_endpoint", e.target.value)}
                placeholder="https://my-resource.openai.azure.com"
              />
            </label>
            <label className="field">
              <span className="field-label">Embedding deployment name</span>
              <input
                className="field-input"
                value={form.azure_deployment}
                onChange={(e) => set("azure_deployment", e.target.value)}
                placeholder="e.g. text-embedding-3-small"
              />
            </label>
            <label className="field">
              <span className="field-label">Azure embedding key</span>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  className="field-input"
                  value={form.azure_api_key_id}
                  onChange={(e) => set("azure_api_key_id", e.target.value)}
                >
                  <option value="">Select a key…</option>
                  {azureKeys.map((k) => (
                    <option key={k.id} value={k.id}>{k.name} ···· {k.key_last4}</option>
                  ))}
                </select>
                <button type="button" className="btn-ghost" onClick={() => setKeyModal("azure_openai")}>
                  + Add key
                </button>
              </div>
              <span className="field-hint">Stored encrypted at rest — never displayed again.</span>
            </label>
          </>
        )}

        <label className="field">
          <span className="field-label">
            Source system API URL{form.nightly_sync_enabled
              ? <span className="form-required"> * (required for nightly sync)</span>
              : " (optional)"}
          </span>
          <input
            className="field-input"
            value={form.source_api_url}
            onChange={(e) => set("source_api_url", e.target.value)}
            placeholder="https://kb.customer.com/api"
          />
          <span className="field-hint">
            The customer's own knowledge endpoint that the nightly job polls for
            new/updated articles (GET {"{url}"}/documents). Not needed for manual
            uploads — those drop files in directly. This is separate from the
            Cognigy store, which KAI Connector always reads via the Cognigy key.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Source system key (optional)</span>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              className="field-input"
              value={form.source_api_key_id}
              onChange={(e) => set("source_api_key_id", e.target.value)}
            >
              <option value="">None</option>
              {sourceKeys.map((k) => (
                <option key={k.id} value={k.id}>{k.name} ···· {k.key_last4}</option>
              ))}
            </select>
            <button type="button" className="btn-ghost" onClick={() => setKeyModal("source")}>
              + Add key
            </button>
          </div>
        </label>

        <label className="field">
          <span className="field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.nightly_sync_enabled}
              onChange={(e) => set("nightly_sync_enabled", e.target.checked)}
            />
            Enable nightly sync
          </span>
        </label>

        {form.nightly_sync_enabled && (
          <label className="field">
            <span className="field-label">Cron schedule</span>
            <input
              className="field-input"
              value={form.nightly_sync_cron}
              onChange={(e) => set("nightly_sync_cron", e.target.value)}
              placeholder="0 2 * * *"
            />
            <span className="field-hint">Standard cron (e.g. 0 2 * * * = daily at 02:00).</span>
          </label>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : store ? "Save changes" : "Create store"}
          </button>
        </div>
      </div>

      <ProviderKeyModal
        provider={keyModal}
        onClose={() => setKeyModal(null)}
        onCreate={async ({ name, key }) => {
          const id = await onCreateKey({ name, key, provider: keyModal });
          if (keyModal === "azure_openai") set("azure_api_key_id", id);
          else set("source_api_key_id", id);
          setKeyModal(null);
        }}
      />
    </Card>
  );
};

// Inline encrypted-key add — mirrors ApiKeyForm: write-only, never read back.
const ProviderKeyModal = ({ provider, onClose, onCreate }) => {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (provider) {
      setName("");
      setKey("");
      setError(null);
    }
  }, [provider]);

  const label = provider === "azure_openai" ? "Azure embedding key" : "Source system key";

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!key) {
      setError("Key value is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({ name: name.trim() || label, key });
    } catch (err) {
      setError(err.message || "Failed to save key");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!provider}
      onClose={submitting ? undefined : onClose}
      title={`Add ${label}`}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" form="kai-key-form" className="btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : "Add key"}
          </button>
        </>
      }
    >
      <form id="kai-key-form" className="field-group" onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <label className="field">
          <span className="field-label">Key name</span>
          <input className="field-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={label} />
        </label>
        <label className="field">
          <span className="field-label">Key value</span>
          <input
            className="field-input"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste the key"
          />
          <span className="field-hint">
            Stored encrypted at rest. You will never be able to view it again.
          </span>
        </label>
      </form>
    </Modal>
  );
};

export default StoreConfigPanel;
