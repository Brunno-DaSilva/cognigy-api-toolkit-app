import { useState } from "react";
import Card from "../../ui/Card";
import FormField from "../../ui/FormField";
import FetchProgress from "./FetchProgress";
import LogBreakdown from "./LogBreakdown";
import DownloadIcon from "../../ui/DownloadIcon";
import useFetchLogs from "../../../hooks/useFetchLogs";
import { DEFAULT_CFG, TYPE_CONFIG, SORT_OPTIONS } from "../../../constants";
import { toLocalDatetime, getYesterday, downloadJSON } from "../../../utils";

// Quick-select presets — each returns { start, end } as Date objects. They are
// a shortcut that fills the two date widgets; the widgets stay editable after.
const PRESETS = [
  {
    id: "today",
    label: "Today",
    range: () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { start, end: new Date() };
    },
  },
  {
    id: "24h",
    label: "Last 24h",
    range: () => {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      return { start, end };
    },
  },
  {
    id: "7d",
    label: "Last 7 days",
    range: () => {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start, end };
    },
  },
];

const GetLogs = ({ project, customer, apiKeys }) => {
  const [cfg, setCfg] = useState({
    ...DEFAULT_CFG,
    startDate: toLocalDatetime(getYesterday()),
    endDate: toLocalDatetime(new Date()),
  });
  const [types, setTypes] = useState([]);
  const [activePreset, setActivePreset] = useState(null);

  // API key is resolved automatically from the active customer/project
  // selection (breadcrumb), not chosen in this form.
  const apiKeyId = apiKeys[0]?.id ?? "";

  const { logs, terminal, running, done, progress, fetchAll } = useFetchLogs();

  const handleChange = (key, value) =>
    setCfg((prev) => ({ ...prev, [key]: value }));

  // Manual edits to either date widget clear the active preset highlight —
  // the widgets remain the source of truth.
  const handleDateChange = (key, value) => {
    setActivePreset(null);
    handleChange(key, value);
  };

  const applyPreset = (preset) => {
    const { start, end } = preset.range();
    setActivePreset(preset.id);
    setCfg((prev) => ({
      ...prev,
      startDate: toLocalDatetime(start),
      endDate: toLocalDatetime(end),
    }));
  };

  const handleToggleType = (t) =>
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const handleFetch = () => {
    if (!apiKeyId) {
      alert("No API key is available for this project.");
      return;
    }
    if (!cfg.startDate || !cfg.endDate) {
      alert("Set a start and end date.");
      return;
    }
    fetchAll({
      apiKeyId,
      projectId: project.id,
      cognigyProjectId: project.cognigy_project_id,
      cfg,
      types,
    });
  };

  return (
    <div className="tool-layout">
      <Card title="Search">
        {/* a. DATE RANGE ROW — two widgets + quick-select presets */}
        <div className="gl-date-block">
          <div className="grid grid--2 gl-date-grid">
            <FormField label="Start date" required>
              <input
                className="input"
                type="datetime-local"
                value={cfg.startDate}
                onChange={(e) => handleDateChange("startDate", e.target.value)}
              />
            </FormField>
            <FormField label="End date" required>
              <input
                className="input"
                type="datetime-local"
                value={cfg.endDate}
                onChange={(e) => handleDateChange("endDate", e.target.value)}
              />
            </FormField>
          </div>
          <div className="gl-presets">
            <span className="gl-presets-label">Quick select</span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`gl-preset-btn${
                  activePreset === p.id ? " gl-preset-btn--active" : ""
                }`}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="gl-divider" />

        {/* b. LOG TYPES ROW — multi-select purple pills, empty = all */}
        <FormField label="Log Types — leave empty for all">
          <div className="gl-type-group">
            {Object.entries(TYPE_CONFIG).map(([key, { label }]) => {
              const active = types.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={`gl-type-pill${
                    active ? " gl-type-pill--active" : ""
                  }`}
                  aria-pressed={active}
                  onClick={() => handleToggleType(key)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </FormField>

        <div className="gl-divider" />

        {/* c. FIELDS ROW */}
        <div className="grid grid--4">
          <FormField label="Text Filter">
            <input
              className="input"
              placeholder="msg / type / traceId"
              value={cfg.filter}
              onChange={(e) => handleChange("filter", e.target.value)}
            />
          </FormField>
          <FormField label="Flow Name">
            <input
              className="input"
              placeholder="e.g. 2.0 - AI Agent"
              value={cfg.flowName}
              onChange={(e) => handleChange("flowName", e.target.value)}
            />
          </FormField>
          <FormField label="User ID">
            <input
              className="input"
              placeholder="e.g. +14434610694"
              value={cfg.userId}
              onChange={(e) => handleChange("userId", e.target.value)}
            />
          </FormField>
          <FormField label="Sort">
            <select
              className="select"
              value={cfg.sort}
              onChange={(e) => handleChange("sort", e.target.value)}
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* d. SUBMIT — Fetch (+ Download once complete), right-aligned */}
        <div className="action-bar gl-search-actions">
          {done && logs.length > 0 && (
            <button
              className="btn btn--success"
              onClick={() => downloadJSON(logs, customer?.name)}
            >
              <DownloadIcon />
              Download {logs.length.toLocaleString()} logs
            </button>
          )}
          <button
            className="btn btn--primary"
            onClick={handleFetch}
            disabled={running}
          >
            {running ? (
              <>
                <span className="spinner" />
                Fetching...
              </>
            ) : (
              <>
                <PlayIcon />
                Fetch All Logs
              </>
            )}
          </button>
        </div>
      </Card>

      {(running || done) && (
        <FetchProgress progress={progress} terminal={terminal} />
      )}
      {done && logs.length > 0 && <LogBreakdown logs={logs} />}
    </div>
  );
};

const PlayIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export default GetLogs;
