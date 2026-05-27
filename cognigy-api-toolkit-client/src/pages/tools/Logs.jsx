import { useActiveProject } from "../../context/ActiveProjectContext";
import LoadingScreen from "../../components/ui/LoadingScreen";
import NoActiveProject from "./NoActiveProject";
import GetLogs from "../../components/tools/GetLogs";

const Logs = () => {
  const { activeProjectId, project, customer, apiKeys, loading } =
    useActiveProject();

  if (!activeProjectId) return <NoActiveProject toolName="Get Logs" />;
  if (loading) return <LoadingScreen text="Loading project…" />;
  if (!project) return <NoActiveProject toolName="Get Logs" />;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Get Logs</div>
          <div className="admin-page-sub">
            {customer?.name} / {project.name}
          </div>
        </div>
      </header>

      <GetLogs project={project} customer={customer} apiKeys={apiKeys} />
    </div>
  );
};

export default Logs;
