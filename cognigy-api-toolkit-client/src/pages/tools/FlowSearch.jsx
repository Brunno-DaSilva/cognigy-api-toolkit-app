import { useActiveProject } from "../../context/ActiveProjectContext";
import LoadingScreen from "../../components/ui/LoadingScreen";
import NoActiveProject from "./NoActiveProject";
import FlowSearch from "../../components/tools/FlowSearch";

const FlowSearchPage = () => {
  const { activeProjectId, project, customer, apiKeys, loading } =
    useActiveProject();

  if (!activeProjectId) return <NoActiveProject toolName="Flow Search" />;
  if (loading) return <LoadingScreen text="Loading project…" />;
  if (!project) return <NoActiveProject toolName="Flow Search" />;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Flow Search</div>
          <div className="admin-page-sub">
            {customer?.name} / {project.name}
          </div>
        </div>
      </header>

      <FlowSearch project={project} customer={customer} apiKeys={apiKeys} />
    </div>
  );
};

export default FlowSearchPage;
