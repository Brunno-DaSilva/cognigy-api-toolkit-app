import ComingSoon from "../../components/ui/ComingSoon";
import { useActiveProject } from "../../context/ActiveProjectContext";
import NoActiveProject from "./NoActiveProject";

const Analytics = () => {
  const { activeProjectId } = useActiveProject();
  if (!activeProjectId) return <NoActiveProject toolName="Analytics" />;
  return <ComingSoon name="OData Analytics" />;
};

export default Analytics;
