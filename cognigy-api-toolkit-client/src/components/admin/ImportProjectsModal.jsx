import { useEffect, useMemo, useState } from "react";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

// Lists the projects a customer's API key can actually see in Cognigy and
// imports the chosen ones, so nobody has to copy 24-character project ids out
// of the Cognigy URL by hand.
//
// Environment matters: a customer's QA projects live on the QA host, so the
// picked environment decides both which host we list from and what the imported
// rows get pinned to. Mounted only while open, so each open starts fresh.

const PAGE = 100;
const MAX_PAGES = 10; // 1,000 projects — far beyond any real customer
const EMPTY = new Set();
const NO_ITEMS = [];

// Unwrap the FunctionsHttpError body cognigy-proxy returns on an upstream error.
async function invokeError(error) {
  let detail = error.message;
  if (error.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.json();
      detail = body.upstream_body || body.error || body.detail || body.title || detail;
    } catch {
      // keep generic message
    }
  }
  return new Error(detail);
}

const ImportProjectsModal = ({
  open,
  customerId,
  apiKeys = [],
  environments = [],
  existingProjects = [],
  onClose,
  onSaved,
}) => {
  const { user } = useAuth();

  const [apiKeyId, setApiKeyId] = useState(apiKeys[0]?.id ?? "");
  const [environmentId, setEnvironmentId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  // Tracked as opt-*outs* so everything new is selected by default without an
  // effect that rewrites state every time the fetch lands. Tagged with the
  // fetch it belongs to so switching environment starts clean.
  const [optedOut, setOptedOut] = useState({ key: "", ids: EMPTY });

  // Tagged with what it was fetched for, so switching key/env reads as loading
  // rather than briefly showing the previous environment's projects.
  const [result, setResult] = useState({
    key: "",
    state: "idle",
    items: [],
    error: null,
  });

  const fetchKey = apiKeyId ? `${apiKeyId}:${environmentId}` : "";
  const fresh = result.key === fetchKey;
  const state = !fetchKey ? "idle" : fresh ? result.state : "loading";
  const items = fresh ? result.items : NO_ITEMS;

  useEffect(() => {
    if (!fetchKey) return;
    let cancelled = false;

    (async () => {
      try {
        const all = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data, error } = await supabase.functions.invoke("cognigy-proxy", {
            body: {
              api_key_id: apiKeyId,
              environment_id: environmentId || null,
              path: "/new/v2.0/projects",
              accept: "application/json",
              query: { limit: PAGE, skip: page * PAGE },
            },
          });
          if (error) throw await invokeError(error);
          const batch = data?.items ?? (Array.isArray(data) ? data : []);
          all.push(...batch);
          if (batch.length < PAGE) break;
        }
        if (cancelled) return;
        setResult({
          key: fetchKey,
          state: "ready",
          items: all.filter((p) => p?._id),
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setResult({
          key: fetchKey,
          state: "error",
          items: [],
          error: err.message || String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchKey, apiKeyId, environmentId]);

  // Already imported into this customer *at this environment* — same rule as the
  // projects_customer_cognigy_env_uniq index.
  const importedIds = useMemo(() => {
    const envKey = environmentId || null;
    return new Set(
      existingProjects
        .filter((p) => (p.environment_id ?? null) === envKey)
        .map((p) => p.cognigy_project_id),
    );
  }, [existingProjects, environmentId]);

  const importable = useMemo(
    () => items.filter((p) => !importedIds.has(p._id)),
    [items, importedIds],
  );

  const off = optedOut.key === fetchKey ? optedOut.ids : EMPTY;
  const selected = useMemo(
    () => importable.filter((p) => !off.has(p._id)).map((p) => p._id),
    [importable, off],
  );

  const toggle = (id) => {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOptedOut({ key: fetchKey, ids: next });
  };

  const allSelected = importable.length > 0 && off.size === 0;
  const toggleAll = () =>
    setOptedOut({
      key: fetchKey,
      ids: allSelected ? new Set(importable.map((p) => p._id)) : EMPTY,
    });

  const handleImport = async () => {
    if (selected.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const rows = importable
        .filter((p) => !off.has(p._id))
        .map((p) => ({
          customer_id: customerId,
          user_id: user.id,
          name: p.name || p._id,
          cognigy_project_id: p._id,
          environment_id: environmentId || null,
        }));
      const { error } = await supabase.from("projects").insert(rows);
      if (error) {
        throw new Error(
          error.code === "23505"
            ? "Some of those projects are already imported for this environment. Close and reopen this dialog to refresh the list."
            : error.message,
        );
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setImportError(err.message || String(err));
      setImporting(false);
    }
  };

  const envName = (id) => environments.find((e) => e.id === id)?.name ?? null;
  const scopeLabel = environmentId
    ? envName(environmentId)
    : "the customer's base URL";

  return (
    <Modal
      open={open}
      onClose={importing ? undefined : onClose}
      title="Import projects from Cognigy"
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleImport}
            disabled={importing || selected.length === 0}
          >
            {importing
              ? "Importing…"
              : selected.length > 0
                ? `Import ${selected.length} project${selected.length === 1 ? "" : "s"}`
                : "Import projects"}
          </button>
        </>
      }
    >
      <div className="field-group">
        {importError && <div className="form-error">{importError}</div>}

        {apiKeys.length === 0 ? (
          <div className="row-list-empty">
            This customer has no API keys yet. Add one first — discovery lists the
            projects that key can see.
          </div>
        ) : (
          <>
            {apiKeys.length > 1 && (
              <label className="field">
                <span className="field-label">API key</span>
                <Select
                  className="field-input"
                  value={apiKeyId}
                  onChange={(v) => setApiKeyId(v)}
                  disabled={importing}
                  options={apiKeys.map((k) => ({
                    value: k.id,
                    label: `${k.name} ···· ${k.key_last4}`,
                  }))}
                />
              </label>
            )}

            {environments.length > 0 && (
              <label className="field">
                <span className="field-label">Environment</span>
                <Select
                  className="field-input"
                  value={environmentId}
                  onChange={(v) => setEnvironmentId(v)}
                  disabled={importing}
                  placeholder="— None (use customer's base URL) —"
                  options={[
                    { value: "", label: "— None (use customer's base URL) —" },
                    ...environments.map((env) => ({
                      value: env.id,
                      label: `${env.name} — ${env.base_url}`,
                    })),
                  ]}
                />
                <span className="field-hint">
                  Lists the projects that exist in this environment and pins the
                  imported ones to it.
                </span>
              </label>
            )}

            <div className="field">
              <div className="import-list-head">
                <span className="field-label">
                  Projects in {scopeLabel}
                  {state === "ready" && ` (${items.length})`}
                </span>
                {importable.length > 0 && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={toggleAll}
                    disabled={importing}
                  >
                    {allSelected ? "Select none" : "Select all"}
                  </button>
                )}
              </div>

              {state === "loading" && (
                <div className="row-list-empty">Reading projects from Cognigy…</div>
              )}
              {state === "error" && (
                <div className="form-error">{result.error}</div>
              )}
              {state === "ready" && items.length === 0 && (
                <div className="row-list-empty">
                  Cognigy returned no projects for this key.
                </div>
              )}
              {state === "ready" && items.length > 0 && (
                <div className="import-list">
                  {items.map((p) => {
                    const already = importedIds.has(p._id);
                    const checked = !off.has(p._id);
                    return (
                      <label
                        key={p._id}
                        className={`import-row${already ? " import-row--done" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={already || checked}
                          disabled={already || importing}
                          onChange={() => toggle(p._id)}
                        />
                        <span className="import-row-main">
                          <span className="import-row-name">{p.name || p._id}</span>
                          <span className="import-row-id">{p._id}</span>
                        </span>
                        {already && <span className="badge">Imported</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ImportProjectsModal;
