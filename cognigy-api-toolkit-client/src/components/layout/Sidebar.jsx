import { NAV_ITEMS } from "../../constants";
import NavIcon from "../ui/NavIcon";
import Logo from "../ui/Logo";

const Sidebar = ({ active, onNavigate }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Logo width={25} height={20} />
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, icon }) => (
          <button
            key={id}
            className={`nav-item ${active === id ? "nav-item--active" : ""}`}
            onClick={() => onNavigate(id)}
            title={label}
            aria-label={label}
          >
            <NavIcon name={icon} />
            {id !== active && id === "logs" && (
              <span className="nav-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
