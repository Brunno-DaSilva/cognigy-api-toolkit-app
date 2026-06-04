import { useActiveProject } from "../../context/ActiveProjectContext";

const EnvList = () => {
  const {
    environments,
    environment,
    activeEnvironmentId,
    setActiveEnvironmentId,
    customer,
  } = useActiveProject();

  // Only render if the active customer has at least one env.
  if (!customer || environments.length === 0) return null;

  const handlePick = (id) => {
    setActiveEnvironmentId(id === activeEnvironmentId ? null : id);
  };

  return (
    <div className="sidebar-envs">
      <div className="sidebar-envs-label">Environments</div>
      <div className="sidebar-envs-list">
        {environments.map((e) => {
          const isActive = e.id === environment?.id;
          return (
            <button
              key={e.id}
              type="button"
              className={
                "sidebar-env-item" +
                (isActive ? " sidebar-env-item--active" : "")
              }
              onClick={() => handlePick(e.id)}
              title={e.base_url}
            >
              <span className="sidebar-env-dot" />
              <span className="sidebar-env-name">{e.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default EnvList;
