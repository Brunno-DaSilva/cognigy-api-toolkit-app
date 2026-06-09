import { useActiveProject } from "../../context/ActiveProjectContext";
import LoadingScreen from "../../components/ui/LoadingScreen";
import NoActiveProject from "./NoActiveProject";
import SessionDoctor from "../../components/tools/SessionDoctor";

const SessionDoctorPage = () => {
  const { activeProjectId, project, customer, apiKeys, loading } =
    useActiveProject();

  if (!activeProjectId) return <NoActiveProject toolName="Session Doctor" />;
  if (loading) return <LoadingScreen text="Loading project…" />;
  if (!project) return <NoActiveProject toolName="Session Doctor" />;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Session Doctor</div>
          <div className="admin-page-sub">
            {customer?.name} / {project.name}
          </div>
        </div>
      </header>

      <SessionDoctor project={project} customer={customer} apiKeys={apiKeys} />
    </div>
  );
};

export default SessionDoctorPage;
