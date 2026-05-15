import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useActiveProject } from "../../context/ActiveProjectContext";

const Projects = () => {
  const navigate = useNavigate();
  const { setActiveProjectId } = useActiveProject();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("projects")
      .select(
        "id, name, cognigy_project_id, created_at, customer:customers(id, name, base_url)"
      )
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const term = q.trim().toLowerCase();
  const filtered = term
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.cognigy_project_id.toLowerCase().includes(term) ||
          r.customer?.name?.toLowerCase().includes(term)
      )
    : rows;

  const open = (id) => {
    setActiveProjectId(id);
    navigate("/tools/logs");
  };

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">All projects</div>
          <div className="admin-page-sub">
            Every project across every customer. Click one to make it active and jump to Get Logs.
          </div>
        </div>
      </header>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      <input
        className="auth-input"
        placeholder="Search by project, customer, or Cognigy ID…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 380 }}
      />

      {loading ? (
        <div className="row-list">
          <div className="row-list-empty">Loading…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">
            {rows.length === 0 ? (
              <>
                No projects yet. Add a customer and project from{" "}
                <Link className="btn-link" to="/admin/customers">Customers →</Link>
              </>
            ) : (
              "No projects match your search."
            )}
          </div>
        </div>
      ) : (
        <div className="row-list">
          {filtered.map((p) => (
            <div key={p.id} className="row-item">
              <button
                type="button"
                onClick={() => open(p.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 0,
                  flex: 1,
                  fontFamily: "inherit",
                  color: "inherit",
                }}
              >
                <div className="row-item-name">{p.name}</div>
                <div className="row-item-meta">
                  {p.customer?.name || "—"} • {p.cognigy_project_id}
                </div>
              </button>
              <div className="row-item-actions">
                <Link
                  className="btn-ghost"
                  to={`/admin/customers/${p.customer?.id}`}
                  style={{ textDecoration: "none" }}
                >
                  Customer
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;
