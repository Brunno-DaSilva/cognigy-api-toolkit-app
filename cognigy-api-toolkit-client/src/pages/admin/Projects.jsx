import { useCallback, useEffect, useMemo, useState } from "react";
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

  // Group projects by customer, preserving the order in which each customer
  // first appears in the (created_at desc) list.
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of filtered) {
      const key = p.customer?.id ?? "__none__";
      if (!map.has(key)) map.set(key, { customer: p.customer, projects: [] });
      map.get(key).projects.push(p);
    }
    return [...map.values()];
  }, [filtered]);

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
        style={{ marginBottom: 16, width: "100%", maxWidth: 460 }}
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
        <div className="proj-groups">
          {groups.map((g) => (
            <div key={g.customer?.id ?? "__none__"} className="proj-group">
              <div className="proj-group-header">
                <h4 className="proj-group-title">
                  {g.customer?.name || "No customer"}
                </h4>
                <span className="proj-group-rule" />
              </div>
              <div className="proj-rows">
                {g.projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="proj-row"
                    onClick={() => open(p.id)}
                  >
                    <div className="proj-row-main">
                      <div className="proj-row-name">{p.name}</div>
                      <div className="proj-row-id">{p.cognigy_project_id}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;
