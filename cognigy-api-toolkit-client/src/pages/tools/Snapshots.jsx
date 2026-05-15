import ComingSoon from "../../components/ui/ComingSoon";
import { useActiveProject } from "../../context/ActiveProjectContext";
import NoActiveProject from "./NoActiveProject";

const Snapshots = () => {
  const { activeProjectId } = useActiveProject();
  if (!activeProjectId) return <NoActiveProject toolName="Snapshots" />;
  return <ComingSoon name="Snapshots Manager" />;
};

export default Snapshots;
