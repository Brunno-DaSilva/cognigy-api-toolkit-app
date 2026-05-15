import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

const Home = () => {
  const [counts, setCounts] = useState({ customers: 0, projects: 0, apiKeys: 0 });
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [customersCount, projectsCount, apiKeysCount, recentCustomers] =
          await Promise.all([
            supabase.from("customers").select("id", { count: "exact", head: true }),
            supabase.from("projects").select("id", { count: "exact", head: true }),
            supabase.from("api_keys").select("id", { count: "exact", head: true }),
            supabase
              .from("customers")
              .select("id, name, base_url, created_at")
              .order("created_at", { ascending: false })
              .limit(5),
          ]);

        if (!active) return;
        const err =
          customersCount.error || projectsCount.error || apiKeysCount.error || recentCustomers.error;
        if (err) throw err;

        setCounts({
          customers: customersCount.count ?? 0,
          projects: projectsCount.count ?? 0,
          apiKeys: apiKeysCount.count ?? 0,
        });
        setRecent(recentCustomers.data ?? []);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Home</div>
          <div className="admin-page-sub">Overview of your customers and projects.</div>
        </div>
      </header>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="metric-row">
        <div className="metric-card">
          <div className="metric-label">Customers</div>
          <div className="metric-value">{loading ? "–" : counts.customers}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Projects</div>
          <div className="metric-value">{loading ? "–" : counts.projects}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">API keys</div>
          <div className="metric-value">{loading ? "–" : counts.apiKeys}</div>
        </div>
      </div>

      <div className="section-header">
        <div className="section-title">Recent customers</div>
        <Link className="btn-link" to="/admin/customers">View all →</Link>
      </div>

      {loading ? (
        <div className="row-list">
          <div className="row-list-empty">Loading…</div>
        </div>
      ) : recent.length === 0 ? (
        <div className="row-list">
          <div className="row-list-empty">
            No customers yet. <Link className="btn-link" to="/admin/customers">Add one →</Link>
          </div>
        </div>
      ) : (
        <div className="row-list">
          {recent.map((c) => (
            <Link key={c.id} className="row-item" to={`/admin/customers/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="row-item-main">
                <div className="row-item-name">{c.name}</div>
                <div className="row-item-meta">{c.base_url}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Home;
