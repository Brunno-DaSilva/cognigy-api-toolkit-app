import { useActiveProject } from "../../context/ActiveProjectContext";
import LoadingScreen from "../../components/ui/LoadingScreen";
import NoActiveProject from "./NoActiveProject";
import Analytics from "../../components/tools/Analytics";

const AnalyticsPage = () => {
  const { activeProjectId, project, customer, apiKeys, loading } =
    useActiveProject();

  if (!activeProjectId) return <NoActiveProject toolName="Analytics" />;
  if (loading) return <LoadingScreen text="Loading project…" />;
  if (!project) return <NoActiveProject toolName="Analytics" />;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">OData Analytics</div>
          <div className="admin-page-sub">
            {customer?.name} / {project.name}
          </div>
        </div>
      </header>

      <Analytics project={project} customer={customer} apiKeys={apiKeys} />
    </div>
  );
};

export default AnalyticsPage;
