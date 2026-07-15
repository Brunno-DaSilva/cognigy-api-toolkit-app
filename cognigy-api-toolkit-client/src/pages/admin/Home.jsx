import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useActiveProject } from "../../context/ActiveProjectContext";
import useProjectAnalytics from "../../hooks/useProjectAnalytics";
import ProjectAnalytics from "../../components/home/ProjectAnalytics";

const ANALYTICS_DAYS = 5;

const Placeholder = ({ title, body }) => (
  <div className="home-placeholder">
    <div className="home-placeholder-title">{title}</div>
    <div className="home-placeholder-body">{body}</div>
  </div>
);

const Home = () => {
  const { customer, project, apiKeys, activeProjectId } = useActiveProject();

  const [counts, setCounts] = useState({ customers: 0, projects: 0, apiKeys: 0 });
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [customersCount, projectsCount, apiKeysCount] = await Promise.all([
          supabase.from("customers").select("id", { count: "exact", head: true }),
          supabase.from("projects").select("id", { count: "exact", head: true }),
          supabase.from("api_keys").select("id", { count: "exact", head: true }),
        ]);

        if (!active) return;
        const err =
          customersCount.error || projectsCount.error || apiKeysCount.error;
        if (err) throw err;

        setCounts({
          customers: customersCount.count ?? 0,
          projects: projectsCount.count ?? 0,
          apiKeys: apiKeysCount.count ?? 0,
        });
      } catch (err) {
        if (active) setCountsError(err.message);
      } finally {
        if (active) setCountsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // API keys are org-scoped and returned newest-first; use the newest one.
  const apiKeyId = apiKeys?.[0]?.id ?? null;

  const analytics = useProjectAnalytics({
    apiKeyId,
    projectId: activeProjectId,
    cognigyProjectId: project?.cognigy_project_id,
    days: ANALYTICS_DAYS,
  });

  const fmt = (v) => (countsLoading ? "…" : v);

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Home</div>
          <div className="admin-page-sub">
            Overview and analytics for the selected project.
          </div>
        </div>
      </header>

      <div className="home-counts-band">
        {countsError ? (
          <span className="home-count-error">{countsError}</span>
        ) : (
          <>
            <span className="home-count">
              <span className="home-count-label">Customers:</span>{" "}
              <span className="home-count-value">{fmt(counts.customers)}</span>
            </span>
            <span className="home-count">
              <span className="home-count-label">Projects:</span>{" "}
              <span className="home-count-value">{fmt(counts.projects)}</span>
            </span>
            <span className="home-count">
              <span className="home-count-label">API Keys:</span>{" "}
              <span className="home-count-value">{fmt(counts.apiKeys)}</span>
            </span>
          </>
        )}
      </div>

      {!customer ? (
        <Placeholder
          title="Select a customer"
          body="Choose a customer from the dropdown at the top of the page, then pick a project to see its analytics."
        />
      ) : !project ? (
        <Placeholder
          title="Select a project"
          body={`Pick a project for ${customer.name} using the “All projects” selector at the top-left.`}
        />
      ) : !apiKeyId ? (
        <Placeholder
          title="No API key configured"
          body={
            <>
              Add an API key for {customer.name} in{" "}
              <Link className="btn-link" to="/admin/customers">
                Customers
              </Link>{" "}
              to load analytics.
            </>
          }
        />
      ) : (
        <ProjectAnalytics
          customer={customer}
          project={project}
          loading={analytics.loading}
          error={analytics.error}
          data={analytics.data}
          onRetry={analytics.refetch}
          days={ANALYTICS_DAYS}
        />
      )}
    </div>
  );
};

export default Home;
