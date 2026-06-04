import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveProject } from "../../context/ActiveProjectContext";

const ProjectSelector = () => {
  const navigate = useNavigate();
  const {
    activeProjectId,
    setActiveProjectId,
    project,
    customer,
    environment,
    visibleProjects,
  } = useActiveProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return visibleProjects;
    return visibleProjects.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        r.cognigy_project_id.toLowerCase().includes(term),
    );
  }, [visibleProjects, search]);

  const select = (id) => {
    setActiveProjectId(id);
    setOpen(false);
    setSearch("");
    navigate("/tools/logs");
  };

  // Don't render if no customer is active — there's nothing to scope to.
  if (!customer) return null;

  const scopeLabel = environment
    ? `${environment.name} projects`
    : "All projects";

  return (
    <div className="main-project-selector" ref={ref}>
      <div className="main-project-selector-label">{scopeLabel}</div>
      <button
        type="button"
        className={
          "main-project-selector-button" +
          (!activeProjectId ? " main-project-selector-button--empty" : "")
        }
        onClick={() => setOpen((o) => !o)}
      >
        <div style={{ minWidth: 0 }}>
          {project ? (
            <>
              <div
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {project.name}
              </div>
              <div className="main-project-selector-meta">
                {project.cognigy_project_id}
              </div>
            </>
          ) : (
            "Pick a project…"
          )}
        </div>
        <span className="main-project-selector-caret">▾</span>
      </button>

      {open && (
        <div className="main-project-selector-dropdown">
          <input
            className="main-project-selector-search"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {filtered.length === 0 ? (
            <div className="main-project-selector-empty">
              {visibleProjects.length === 0
                ? environment
                  ? `No projects in ${environment.name} yet.`
                  : "No projects under this customer yet."
                : "No matches."}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className={
                  "main-project-selector-option" +
                  (p.id === activeProjectId
                    ? " main-project-selector-option--active"
                    : "")
                }
                onClick={() => select(p.id)}
              >
                <div>{p.name}</div>
                <div className="main-project-selector-option-meta">
                  {p.cognigy_project_id}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectSelector;
