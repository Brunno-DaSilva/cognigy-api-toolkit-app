import { NAV_ITEMS } from "../../constants";

const Topbar = ({ active }) => {
  const pageTitle = NAV_ITEMS.find((n) => n.id === active)?.label ?? "";

  return (
    <header className="topbar">
      <h1 className="topbar-title">{pageTitle}</h1>
      <div className="topbar-badges">
        <span className="badge badge--purple">
          <span className="badge-dot" />
          Cognigy Toolkit
        </span>
        <span className="badge badge--green">v1.0</span>
      </div>
    </header>
  );
};

export default Topbar;
