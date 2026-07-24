import { useEffect, useMemo, useState } from "react";
import Modal from "../../ui/Modal";
import Select from "../../ui/Select";
import {
  ANALYTICS_DEFAULT_COLUMNS,
  ANALYTICS_VIEWS_STORAGE_KEY,
  ANALYTICS_ACTIVE_VIEW_STORAGE_KEY,
} from "../../../constants";

const DEFAULT_VIEW_ID = "__default__";
const DEFAULT_VIEW = {
  id: DEFAULT_VIEW_ID,
  name: "Default",
  columns: ANALYTICS_DEFAULT_COLUMNS,
  builtin: true,
};

const loadViews = () => {
  try {
    const raw = localStorage.getItem(ANALYTICS_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveViews = (views) => {
  try {
    localStorage.setItem(ANALYTICS_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // localStorage unavailable — views won't persist this session
  }
};

const loadActiveId = () => {
  try {
    return localStorage.getItem(ANALYTICS_ACTIVE_VIEW_STORAGE_KEY) || DEFAULT_VIEW_ID;
  } catch {
    return DEFAULT_VIEW_ID;
  }
};

const saveActiveId = (id) => {
  try {
    localStorage.setItem(ANALYTICS_ACTIVE_VIEW_STORAGE_KEY, id);
  } catch {
    // localStorage unavailable — selection won't persist this session
  }
};

const ViewManager = ({ availableColumns, onColumnsChange }) => {
  const [userViews, setUserViews] = useState(() => loadViews());
  const [activeId, setActiveId] = useState(() => loadActiveId());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const allViews = useMemo(() => [DEFAULT_VIEW, ...userViews], [userViews]);
  const activeView =
    allViews.find((v) => v.id === activeId) ?? DEFAULT_VIEW;

  // The columns we actually show: keep view order, but only ones that exist
  // in the current dataset. If no data yet (availableColumns empty), still
  // show the view's columns so the UI doesn't go blank between fetches.
  useEffect(() => {
    const cols = availableColumns.length
      ? activeView.columns.filter((c) => availableColumns.includes(c))
      : activeView.columns;
    onColumnsChange(cols.length ? cols : activeView.columns);
  }, [activeView, availableColumns, onColumnsChange]);

  const handleSelectView = (id) => {
    setActiveId(id);
    saveActiveId(id);
  };

  const openNew = () => {
    setEditing({
      id: `view-${Date.now()}`,
      name: "",
      columns: activeView.columns.slice(),
    });
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (activeView.builtin) return;
    setEditing({ ...activeView, columns: activeView.columns.slice() });
    setEditorOpen(true);
  };

  const handleDelete = () => {
    if (activeView.builtin) return;
    if (!confirm(`Delete view "${activeView.name}"?`)) return;
    const next = userViews.filter((v) => v.id !== activeView.id);
    setUserViews(next);
    saveViews(next);
    handleSelectView(DEFAULT_VIEW_ID);
  };

  const handleSave = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    if (!editing.columns.length) return;

    const exists = userViews.some((v) => v.id === editing.id);
    const next = exists
      ? userViews.map((v) => (v.id === editing.id ? { ...editing, name } : v))
      : [...userViews, { ...editing, name }];
    setUserViews(next);
    saveViews(next);
    setActiveId(editing.id);
    saveActiveId(editing.id);
    setEditorOpen(false);
    setEditing(null);
  };

  return (
    <>
      <div className="view-manager">
        <label className="view-manager-label">View</label>
        <Select
          className="select select--sm"
          value={activeId}
          onChange={(v) => handleSelectView(v)}
          options={allViews.map((v) => ({
            value: v.id,
            label: `${v.name}${v.builtin ? " (built-in)" : ""}`,
          }))}
        />
        <button type="button" className="btn-ghost" onClick={openNew}>
          + New
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={openEdit}
          disabled={activeView.builtin}
          title={activeView.builtin ? "Built-in view cannot be edited" : "Edit view"}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn-ghost btn-ghost--danger"
          onClick={handleDelete}
          disabled={activeView.builtin}
          title={
            activeView.builtin ? "Built-in view cannot be deleted" : "Delete view"
          }
        >
          Delete
        </button>
      </div>

      <Modal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        title={
          editing && userViews.some((v) => v.id === editing.id)
            ? "Edit view"
            : "New view"
        }
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditorOpen(false);
                setEditing(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSave}
              disabled={
                !editing?.name.trim() || !editing?.columns.length
              }
            >
              Save view
            </button>
          </>
        }
      >
        {editing && (
          <ViewEditor
            editing={editing}
            setEditing={setEditing}
            availableColumns={availableColumns}
          />
        )}
      </Modal>
    </>
  );
};

const ViewEditor = ({ editing, setEditing, availableColumns }) => {
  const columnPool = useMemo(() => {
    const merged = new Set([...ANALYTICS_DEFAULT_COLUMNS, ...availableColumns]);
    editing.columns.forEach((c) => merged.add(c));
    return Array.from(merged);
  }, [availableColumns, editing.columns]);

  const toggle = (col) => {
    setEditing((prev) => {
      const has = prev.columns.includes(col);
      return {
        ...prev,
        columns: has
          ? prev.columns.filter((c) => c !== col)
          : [...prev.columns, col],
      };
    });
  };

  return (
    <div className="view-editor">
      <div className="form-field">
        <label className="form-label">View name</label>
        <input
          className="input"
          autoFocus
          placeholder="e.g. Token usage"
          value={editing.name}
          onChange={(e) =>
            setEditing((prev) => ({ ...prev, name: e.target.value }))
          }
        />
      </div>

      <div className="form-field">
        <label className="form-label">
          Columns ({editing.columns.length} selected)
        </label>
        <div className="view-editor-columns">
          {columnPool.map((col) => {
            const checked = editing.columns.includes(col);
            return (
              <label key={col} className="view-editor-col">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(col)}
                />
                <span>{col}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ViewManager;
