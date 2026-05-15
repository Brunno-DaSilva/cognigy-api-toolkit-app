import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import CustomerForm from "../../components/admin/CustomerForm";
import ProjectForm from "../../components/admin/ProjectForm";
import ApiKeyForm from "../../components/admin/ApiKeyForm";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useActiveProject } from "../../context/ActiveProjectContext";

const CustomerDetail = () => {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { setActiveProjectId } = useActiveProject();

  const openProject = (id) => {
    setActiveProjectId(id);
    navigate("/tools/logs");
  };

  const [customer, setCustomer] = useState(null);
  const [projects, setProjects] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [confirmCustomerDelete, setConfirmCustomerDelete] = useState(false);
  const [customerDeleting, setCustomerDeleting] = useState(false);

  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(null);

  const [apiKeyFormOpen, setApiKeyFormOpen] = useState(false);
  const [editingApiKey, setEditingApiKey] = useState(null);
  const [confirmApiKeyDelete, setConfirmApiKeyDelete] = useState(null);

  const [busyChild, setBusyChild] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p, k] = await Promise.all([
      supabase
        .from("customers")
        .select("id, name, base_url, created_at")
        .eq("id", customerId)
        .maybeSingle(),
      supabase
        .from("projects")
        .select("id, name, cognigy_project_id, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("api_keys")
        .select("id, name, key_last4, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
    ]);

    const err = c.error || p.error || k.error;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setCustomer(c.data);
    setProjects(p.data ?? []);
    setApiKeys(k.data ?? []);
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCustomerDelete = async () => {
    setCustomerDeleting(true);
    const { error: err } = await supabase
      .from("customers")
      .delete()
      .eq("id", customerId);
    setCustomerDeleting(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate("/admin/customers", { replace: true });
  };

  const handleProjectDelete = async () => {
    if (!confirmProjectDelete) return;
    setBusyChild(true);
    const { error: err } = await supabase
      .from("projects")
      .delete()
      .eq("id", confirmProjectDelete.id);
    setBusyChild(false);
    if (err) {
      setError(err.message);
      return;
    }
    setConfirmProjectDelete(null);
    load();
  };

  const handleApiKeyDelete = async () => {
    if (!confirmApiKeyDelete) return;
    setBusyChild(true);
    const { error: err } = await supabase
      .from("api_keys")
      .delete()
      .eq("id", confirmApiKeyDelete.id);
    setBusyChild(false);
    if (err) {
      setError(err.message);
      return;
    }
    setConfirmApiKeyDelete(null);
    load();
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="row-list">
          <div className="row-list-empty">Loading…</div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="admin-page">
        <div className="admin-breadcrumb">
          <Link to="/admin/customers">Customers</Link> / not found
        </div>
        <div className="form-error">Customer not found or you don't have access.</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-breadcrumb">
        <Link to="/admin/customers">Customers</Link> / {customer.name}
      </div>

      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">{customer.name}</div>
          <div className="admin-page-sub">{customer.base_url}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn-ghost" onClick={() => setCustomerEditOpen(true)}>
            Edit customer
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => setConfirmCustomerDelete(true)}
          >
            Delete
          </button>
        </div>
      </header>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Projects -------------------------------------------------------- */}
      <div className="section-header">
        <div className="section-title">Projects</div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditingProject(null);
            setProjectFormOpen(true);
          }}
        >
          + Add project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">No projects yet.</div>
        </div>
      ) : (
        <div className="card-grid">
          {projects.map((p) => (
            <div key={p.id} className="entity-card">
              <button
                type="button"
                className="entity-card-name"
                onClick={() => openProject(p.id)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  font: "inherit",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {p.name}
              </button>
              <div className="entity-card-meta">{p.cognigy_project_id}</div>

              <div className="entity-card-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Edit"
                  aria-label="Edit"
                  onClick={() => {
                    setEditingProject(p);
                    setProjectFormOpen(true);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  title="Delete"
                  aria-label="Delete"
                  onClick={() => setConfirmProjectDelete(p)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* API keys -------------------------------------------------------- */}
      <div className="section-header">
        <div className="section-title">API keys</div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditingApiKey(null);
            setApiKeyFormOpen(true);
          }}
        >
          + Add API key
        </button>
      </div>

      {apiKeys.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">
            No API keys yet. Add one to make Cognigy API calls under this customer.
          </div>
        </div>
      ) : (
        <div className="row-list">
          {apiKeys.map((k) => (
            <div key={k.id} className="row-item">
              <div className="row-item-main">
                <div className="row-item-name">{k.name}</div>
                <div className="row-item-meta">•••• {k.key_last4}</div>
              </div>
              <div className="row-item-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Edit"
                  aria-label="Edit"
                  onClick={() => {
                    setEditingApiKey(k);
                    setApiKeyFormOpen(true);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  title="Delete"
                  aria-label="Delete"
                  onClick={() => setConfirmApiKeyDelete(k)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals ---------------------------------------------------------- */}
      <CustomerForm
        open={customerEditOpen}
        customer={customer}
        onClose={() => setCustomerEditOpen(false)}
        onSaved={() => load()}
      />

      <ProjectForm
        open={projectFormOpen}
        project={editingProject}
        customerId={customerId}
        onClose={() => setProjectFormOpen(false)}
        onSaved={() => load()}
      />

      <ApiKeyForm
        open={apiKeyFormOpen}
        apiKey={editingApiKey}
        customerId={customerId}
        onClose={() => setApiKeyFormOpen(false)}
        onSaved={() => load()}
      />

      <ConfirmDialog
        open={confirmCustomerDelete}
        title="Delete customer"
        message={`Delete "${customer.name}"? This also removes all of its projects and API keys. This cannot be undone.`}
        confirmLabel="Delete customer"
        busy={customerDeleting}
        onConfirm={handleCustomerDelete}
        onCancel={() => setConfirmCustomerDelete(false)}
      />

      <ConfirmDialog
        open={!!confirmProjectDelete}
        title="Delete project"
        message={
          confirmProjectDelete
            ? `Delete project "${confirmProjectDelete.name}"? This cannot be undone.`
            : ""
        }
        busy={busyChild}
        onConfirm={handleProjectDelete}
        onCancel={() => setConfirmProjectDelete(null)}
      />

      <ConfirmDialog
        open={!!confirmApiKeyDelete}
        title="Delete API key"
        message={
          confirmApiKeyDelete
            ? `Delete API key "${confirmApiKeyDelete.name}"? Any project still using this key will need to switch to another one.`
            : ""
        }
        busy={busyChild}
        onConfirm={handleApiKeyDelete}
        onCancel={() => setConfirmApiKeyDelete(null)}
      />
    </div>
  );
};

export default CustomerDetail;
