import { useEffect, useRef, useState } from "react";
import { useActiveProject } from "../../context/ActiveProjectContext";

const CaretIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// Combined customer + project selector — the single source of truth for the
// active customer/project app-wide (replaces the old sidebar project card).
const Topbar = () => {
  const {
    customers,
    customer,
    activeCustomerId,
    setActiveCustomerId,
    project,
    activeProjectId,
    setActiveProjectId,
    visibleProjects,
    loading,
  } = useActiveProject();

  const [open, setOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setCustOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggleOpen = () => {
    setOpen((o) => !o);
    setCustOpen(false);
  };

  // Changing the customer cascades in context (resets env + project). The
  // panel stays open so the user can then pick a project below.
  const handlePickCustomer = (id) => {
    setActiveCustomerId(id);
    setCustOpen(false);
  };

  const handlePickProject = (id) => {
    setActiveProjectId(id);
    setOpen(false);
    setCustOpen(false);
  };

  // Collapsed breadcrumb: "Cvent / Reposite_VoiceBot"
  const crumb = !customer
    ? "Select a customer…"
    : project
      ? `${customer.name} / ${project.name}`
      : `${customer.name} / Select a project…`;

  return (
    <header className="topbar">
      <div className="topbar-spacer" />
      <div className="topbar-selector" ref={wrapRef}>
        <button
          type="button"
          className="topbar-selector-trigger"
          onClick={toggleOpen}
          title={crumb}
        >
          <span className="topbar-selector-label">Customer:</span>
          <span className="topbar-selector-crumb">{crumb}</span>
          <CaretIcon />
        </button>

        {open && (
          <div className="topbar-selector-dropdown" role="menu">
            {/* a. Switch customer */}
            <div className="topbar-selector-section">
              <div className="topbar-selector-section-title">
                Switch customer
              </div>
              <div className="topbar-cust">
                <button
                  type="button"
                  className="topbar-cust-trigger"
                  onClick={() => setCustOpen((o) => !o)}
                  aria-expanded={custOpen}
                >
                  <span className="topbar-cust-trigger-name">
                    {customer?.name || "Select a customer…"}
                  </span>
                  <CaretIcon />
                </button>
                {custOpen && (
                  <div className="topbar-cust-list">
                    {customers.length === 0 ? (
                      <div className="topbar-selector-empty">
                        No customers yet.
                      </div>
                    ) : (
                      customers.map((c) => {
                        const isActive = c.id === activeCustomerId;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={
                              "topbar-cust-option" +
                              (isActive ? " topbar-cust-option--active" : "")
                            }
                            onClick={() => handlePickCustomer(c.id)}
                          >
                            <span className="topbar-cust-option-name">
                              {c.name}
                            </span>
                            {isActive && (
                              <span className="topbar-cust-option-check">
                                <CheckIcon />
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* b. Projects for the selected customer */}
            <div className="topbar-selector-section">
              <div className="topbar-selector-section-title">
                {customer ? `Projects for ${customer.name}` : "Projects"}
              </div>
              <div className="topbar-selector-projects">
                {!customer ? (
                  <div className="topbar-selector-empty">
                    Select a customer to see its projects.
                  </div>
                ) : loading ? (
                  <div className="topbar-selector-empty">Loading projects…</div>
                ) : visibleProjects.length === 0 ? (
                  <div className="topbar-selector-empty">
                    No projects under this customer yet.
                  </div>
                ) : (
                  visibleProjects.map((p) => {
                    const isActive = p.id === activeProjectId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={
                          "topbar-selector-project" +
                          (isActive ? " topbar-selector-project--active" : "")
                        }
                        onClick={() => handlePickProject(p.id)}
                      >
                        <span className="topbar-selector-project-name">
                          {p.name}
                        </span>
                        <span className="topbar-selector-project-meta">
                          {p.cognigy_project_id}
                        </span>
                        {isActive && (
                          <span className="topbar-selector-project-check">
                            <CheckIcon />
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Topbar;
