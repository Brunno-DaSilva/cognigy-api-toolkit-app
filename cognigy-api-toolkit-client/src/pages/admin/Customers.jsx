import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import CustomerForm from "../../components/admin/CustomerForm";
import ConfirmDialog from "../../components/ui/ConfirmDialog";

const Customers = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("customers")
      .select("id, name, base_url, created_at")
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const { error: err } = await supabase
      .from("customers")
      .delete()
      .eq("id", confirmDelete.id);
    setDeleting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setConfirmDelete(null);
    load();
  };

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Customers</div>
          <div className="admin-page-sub">
            A customer represents a Cognigy organisation — region and API keys live here.
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + Add customer
        </button>
      </header>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="row-list">
          <div className="row-list-empty">Loading…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">
            No customers yet. Click <strong>+ Add customer</strong> to create one.
          </div>
        </div>
      ) : (
        <div className="card-grid">
          {rows.map((c) => (
            <div key={c.id} className="entity-card">
              <Link
                to={`/admin/customers/${c.id}`}
                className="entity-card-name entity-card-link"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {c.name}
              </Link>
              <div className="entity-card-meta">{c.base_url}</div>

              <div className="entity-card-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Edit"
                  aria-label="Edit"
                  onClick={() => {
                    setEditing(c);
                    setFormOpen(true);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  title="Delete"
                  aria-label="Delete"
                  onClick={() => setConfirmDelete(c)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CustomerForm
        open={formOpen}
        customer={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => load()}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete customer"
        message={
          confirmDelete
            ? `Delete "${confirmDelete.name}"? This also removes all of its projects and API keys. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete customer"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};

export default Customers;
