import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useActiveProject } from "../../context/ActiveProjectContext";
import ProjectSelector from "./ProjectSelector";

const Icon = ({ name }) => {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "main-nav-icon",
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
        </svg>
      );
    case "logs":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h10M4 18h16" />
        </svg>
      );
    case "snapshots":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 3v18" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 3 3 5-6" />
        </svg>
      );
    case "customers":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "projects":
      return (
        <svg {...common}>
          <path d="M3 7h7l2 3h9v10H3z" />
        </svg>
      );
    default:
      return null;
  }
};

const initialsFor = (str) => {
  if (!str) return "?";
  const parts = str.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const ToolItem = ({ to, label, icon, hasActiveProject }) => {
  if (!hasActiveProject) {
    return (
      <span
        className="main-nav-item main-nav-item--disabled"
        title="Pick an active project first"
      >
        <Icon name={icon} />
        {label}
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        "main-nav-item" + (isActive ? " main-nav-item--active" : "")
      }
    >
      <Icon name={icon} />
      {label}
    </NavLink>
  );
};

const MainSidebar = () => {
  const { user, logout } = useAuth();
  const { activeProjectId } = useActiveProject();
  const navigate = useNavigate();
  const [popOpen, setPopOpen] = useState(false);
  const userRef = useRef(null);

  useEffect(() => {
    if (!popOpen) return;
    const onClick = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) setPopOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [popOpen]);

  const displayName =
    user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";

  const handleSignOut = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <aside className="main-sidebar">
      <div className="main-brand">Cognigy API Toolkit</div>

      <ProjectSelector />

      <nav className="main-nav">
        <div className="main-nav-section">
          <NavLink
            to="/home"
            className={({ isActive }) =>
              "main-nav-item" + (isActive ? " main-nav-item--active" : "")
            }
          >
            <Icon name="home" />
            Home
          </NavLink>
        </div>

        <div className="main-nav-section">
          <div className="main-nav-section-title">Tools</div>
          <ToolItem
            to="/tools/logs"
            label="Get Logs"
            icon="logs"
            hasActiveProject={!!activeProjectId}
          />
          <ToolItem
            to="/tools/snapshots"
            label="Snapshots"
            icon="snapshots"
            hasActiveProject={!!activeProjectId}
          />
          <ToolItem
            to="/tools/analytics"
            label="Analytics"
            icon="analytics"
            hasActiveProject={!!activeProjectId}
          />
        </div>

        <div className="main-nav-section">
          <div className="main-nav-section-title">Admin</div>
          <NavLink
            to="/admin/customers"
            className={({ isActive }) =>
              "main-nav-item" + (isActive ? " main-nav-item--active" : "")
            }
          >
            <Icon name="customers" />
            Customers
          </NavLink>
          <NavLink
            to="/admin/projects"
            className={({ isActive }) =>
              "main-nav-item" + (isActive ? " main-nav-item--active" : "")
            }
          >
            <Icon name="projects" />
            Projects
          </NavLink>
        </div>
      </nav>

      <div className="main-user" ref={userRef}>
        {popOpen && (
          <div className="main-user-popover">
            <Link to="/profile" onClick={() => setPopOpen(false)}>
              Profile
            </Link>
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          className="main-user-button"
          onClick={() => setPopOpen((o) => !o)}
        >
          <div className="main-avatar">{initialsFor(displayName)}</div>
          <div className="main-user-meta">
            <div className="main-user-name">{displayName}</div>
            <div className="main-user-email">{user?.email}</div>
          </div>
        </button>
      </div>
    </aside>
  );
};

export default MainSidebar;
