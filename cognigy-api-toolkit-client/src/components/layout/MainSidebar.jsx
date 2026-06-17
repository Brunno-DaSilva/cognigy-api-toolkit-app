import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useActiveProject } from "../../context/ActiveProjectContext";
import { useTheme } from "../../context/ThemeContext";
import { getAvatarUrl } from "../../utils";
import ProjectSelector from "./ProjectSelector";
import EnvList from "./EnvList";

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const ProfileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const SignOutIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

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
    case "scraper":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M17 8l-5-5-5 5" />
          <path d="M12 3v12" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 3 3 5-6" />
        </svg>
      );
    case "doctor":
      return (
        <svg {...common}>
          <path d="M4.8 2.3A.3.3 0 1 0 5 2.8a.3.3 0 0 0-.2-.5M8 15a6 6 0 0 0 6-6V3.5a1.5 1.5 0 0 0-1.5-1.5H11" />
          <path d="M8 15a6 6 0 0 1-6-6V3.5A1.5 1.5 0 0 1 3.5 2H5" />
          <path d="M8 15v3a4 4 0 0 0 8 0v-2" />
          <circle cx="20" cy="10" r="2" />
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
  const { theme, toggleTheme } = useTheme();
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

      <EnvList />
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
            to="/tools/scraper"
            label="Scraper"
            icon="scraper"
            hasActiveProject={!!activeProjectId}
          />
          <ToolItem
            to="/tools/uploader"
            label="Uploader"
            icon="upload"
            hasActiveProject={!!activeProjectId}
          />
          <ToolItem
            to="/tools/analytics"
            label="Analytics"
            icon="analytics"
            hasActiveProject={!!activeProjectId}
          />
          <ToolItem
            to="/tools/session-doctor"
            label="Session Doctor"
            icon="doctor"
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
              <span className="main-user-popover-icon">
                <ProfileIcon />
              </span>
              Profile
            </Link>
            <button
              type="button"
              className="main-user-popover-theme"
              onClick={toggleTheme}
              title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            >
              <span className="main-user-popover-icon">
                {theme === "light" ? <MoonIcon /> : <SunIcon />}
              </span>
              Theme: <strong>{theme === "light" ? "Light" : "Dark"}</strong>
            </button>
            <button type="button" onClick={handleSignOut}>
              <span className="main-user-popover-icon">
                <SignOutIcon />
              </span>
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          className="main-user-button"
          onClick={() => setPopOpen((o) => !o)}
        >
          <img
            className="main-avatar main-avatar--img"
            src={getAvatarUrl(user, 64)}
            alt={initialsFor(displayName)}
          />
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
