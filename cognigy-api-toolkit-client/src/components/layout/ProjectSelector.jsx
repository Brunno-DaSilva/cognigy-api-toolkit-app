import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useActiveProject } from "../../context/ActiveProjectContext";

const ProjectSelector = () => {
  const navigate = useNavigate();
  const { activeProjectId, setActiveProjectId, project, customer } =
    useActiveProject();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
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

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, cognigy_project_id, customer:customers(id, name, base_url)")
        .order("name", { ascending: true });
      setRows(data ?? []);
    })();
  }, [open]);

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(term) ||
            r.cognigy_project_id.toLowerCase().includes(term) ||
            r.customer?.name?.toLowerCase().includes(term)
        )
      : rows;

    const byCustomer = new Map();
    for (const r of filtered) {
      const cName = r.customer?.name ?? "—";
      if (!byCustomer.has(cName)) byCustomer.set(cName, []);
      byCustomer.get(cName).push(r);
    }
    return Array.from(byCustomer.entries());
  }, [rows, search]);

  const select = (id) => {
    setActiveProjectId(id);
    setOpen(false);
    setSearch("");
    navigate("/tools/logs");
  };

  return (
    <div className="main-project-selector" ref={ref}>
      <div className="main-project-selector-label">Active project</div>
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
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {project.name}
              </div>
              <div className="main-project-selector-meta">
                {customer?.name || ""}
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
          {grouped.length === 0 ? (
            <div className="main-project-selector-empty">No projects found.</div>
          ) : (
            grouped.map(([customerName, items]) => (
              <div key={customerName}>
                <div className="main-project-selector-group">{customerName}</div>
                {items.map((p) => (
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
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectSelector;
