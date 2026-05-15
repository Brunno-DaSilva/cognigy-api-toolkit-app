import { Link } from "react-router-dom";

const NoActiveProject = ({ toolName }) => (
  <div className="admin-page">
    <header className="admin-page-header">
      <div>
        <div className="admin-page-title">{toolName}</div>
        <div className="admin-page-sub">
          Pick an active project from the sidebar to use this tool.
        </div>
      </div>
    </header>
    <div className="row-list">
      <div className="row-list-empty">
        No active project selected. Open the project selector in the sidebar, or browse{" "}
        <Link className="btn-link" to="/admin/projects">all projects →</Link>
      </div>
    </div>
  </div>
);

export default NoActiveProject;
