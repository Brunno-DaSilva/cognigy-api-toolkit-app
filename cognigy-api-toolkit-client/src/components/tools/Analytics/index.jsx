import { useEffect, useMemo, useCallback, useState } from "react";
import Card from "../../ui/Card";
import FormField from "../../ui/FormField";
import Select from "../../ui/Select";
import StatCard from "../../ui/StatCard";
import ViewManager from "./ViewManager";
import AnalyticsTable from "./AnalyticsTable";
import { useAnalyticsCache } from "../../../context/AnalyticsCacheContext";
import { ANALYTICS_ENDPOINTS } from "../../../constants";
import { slugify, toLocalDatetime } from "../../../utils";
import DownloadIcon from "../../ui/DownloadIcon";

// Quick-select presets — each returns { start, end } Dates. They fill the two
// date widgets (which stay visible + editable); they are a shortcut, not a
// replacement.
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
      return { start: new Date(end.getTime() - 24 * 60 * 60 * 1000), end };
    },
  },
  {
    id: "next7",
    label: "Next 7 days",
    range: () => {
      const start = new Date();
      return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) };
    },
  },
];

// Left-border accent per stat card — purple first (brand), then blue / orange /
// pink, matching the Get Logs stat-card pattern.
const STAT_ACCENTS = ["#863bff", "#3b82f6", "#f59e0b", "#ec4899"];

const exportCSV = (rows, columns, endpoint, customerName) => {
  if (!rows.length) return;
  const esc = (s) => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    columns.join(","),
    ...rows.map((r) =>
      columns
        .map((c) => {
          const v = r[c] ?? "";
          const s = typeof v === "object" ? JSON.stringify(v) : String(v);
          return esc(s);
        })
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const customerSlug = slugify(customerName);
  const endpointSlug = endpoint.replace("/", "").toLowerCase();
  const date = new Date().toISOString().split("T")[0];
  a.download = customerSlug
    ? `cognigy-${customerSlug}-${endpointSlug}-${date}.csv`
    : `cognigy-${endpointSlug}-${date}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

const Analytics = ({ project, customer, apiKeys }) => {
  const {
    form,
    updateForm,
    search,
    setSearch,
    viewColumns,
    setViewColumns,
    rows,
    columns,
    running,
    done,
    error,
    fetchAnalytics,
  } = useAnalyticsCache();

  const { apiKeyId, endpoint, dateField, startDate, endDate } = form;
  const [activePreset, setActivePreset] = useState(null);

  // API key is resolved automatically from the active customer/project
  // selection (top-right selector), not chosen in this form.
  useEffect(() => {
    if (!apiKeyId && apiKeys.length > 0) {
      updateForm({ apiKeyId: apiKeys[0].id });
    }
  }, [apiKeyId, apiKeys, updateForm]);

  // Manual edits to either widget clear the active preset highlight — the
  // widgets remain the source of truth.
  const handleDateChange = (key, value) => {
    setActivePreset(null);
    updateForm({ [key]: value });
  };

  const applyPreset = (preset) => {
    const { start, end } = preset.range();
    setActivePreset(preset.id);
    updateForm({
      startDate: toLocalDatetime(start),
      endDate: toLocalDatetime(end),
    });
  };

  const handleColumnsChange = useCallback(
    (cols) => {
      setViewColumns(cols);
    },
    [setViewColumns]
  );

  const handleFetch = () => {
    if (!apiKeyId) {
      alert("Select an API key.");
      return;
    }
    if (!startDate || !endDate) {
      alert("Set a start and end date.");
      return;
    }
    fetchAnalytics({
      apiKeyId,
      projectId: project.id,
      cognigyProjectId: project.cognigy_project_id,
      endpoint,
      dateField,
      startDate,
      endDate,
      platform: customer?.platform ?? "cognigy",
    });
  };

  const endpointHint = useMemo(
    () => ANALYTICS_ENDPOINTS.find((e) => e.value === endpoint)?.hint ?? "",
    [endpoint]
  );

  const metrics = useMemo(() => {
    if (!rows.length) return null;
    const setOf = (keys) => {
      const s = new Set();
      for (const r of rows) {
        for (const k of keys) {
          if (r[k] != null && r[k] !== "") {
            s.add(r[k]);
            break;
          }
        }
      }
      return s.size;
    };
    return {
      total: rows.length,
      sessions: setOf(["sessionId", "session_id", "SessionId"]),
      users: setOf(["userId", "user_id", "UserId", "contactId"]),
      flows: setOf(["flowId", "flow_id", "FlowId", "flowName"]),
    };
  }, [rows]);

  return (
    <div className="tool-layout">
      <Card title="Search">
        <div className="grid grid--2 mb-14">
          <FormField label="Endpoint" required>
            <Select
              className="select"
              value={endpoint}
              onChange={(nextEndpoint) => {
                // Sessions use `startedAt`; Analytics/Conversations use `timestamp`.
                updateForm({
                  endpoint: nextEndpoint,
                  dateField:
                    nextEndpoint === "/Sessions" ? "startedAt" : "timestamp",
                });
              }}
              options={ANALYTICS_ENDPOINTS.map((ep) => ({
                value: ep.value,
                label: `${ep.label} — ${ep.value}`,
              }))}
            />
          </FormField>
          <FormField label="Date field">
            <Select
              className="select"
              value={dateField}
              onChange={(v) => updateForm({ dateField: v })}
              options={[
                { value: "timestamp", label: "timestamp" },
                { value: "startedAt", label: "startedAt" },
              ]}
            />
          </FormField>
        </div>

        <p className="analytics-hint">{endpointHint}</p>

        <div className="gl-date-block mb-14">
          <div className="grid grid--2">
            <FormField label="From (UTC)" required>
              <input
                className="input"
                type="datetime-local"
                value={startDate}
                onChange={(e) => handleDateChange("startDate", e.target.value)}
              />
            </FormField>
            <FormField label="To (UTC)" required>
              <input
                className="input"
                type="datetime-local"
                value={endDate}
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

        <div className="action-bar">
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
              "Fetch analytics"
            )}
          </button>
        </div>
      </Card>

      {error && <div className="analytics-error">Error: {error}</div>}

      {done && metrics && (
        <div className="card-grid">
          <StatCard
            label="Total records"
            value={metrics.total}
            accent={STAT_ACCENTS[0]}
          />
          <StatCard
            label="Unique sessions"
            value={metrics.sessions > 1 ? metrics.sessions : "—"}
            accent={STAT_ACCENTS[1]}
          />
          <StatCard
            label="Unique users"
            value={metrics.users > 1 ? metrics.users : "—"}
            accent={STAT_ACCENTS[2]}
          />
          <StatCard
            label="Unique flows"
            value={metrics.flows > 1 ? metrics.flows : "—"}
            accent={STAT_ACCENTS[3]}
          />
        </div>
      )}

      {done && rows.length > 0 && (
        <Card>
          <div className="analytics-toolbar">
            <ViewManager
              availableColumns={columns}
              onColumnsChange={handleColumnsChange}
            />
            <input
              className="input input--sm analytics-search"
              type="text"
              placeholder="Search any field…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="btn btn--success"
              onClick={() => exportCSV(rows, columns, endpoint, customer?.name)}
              disabled={!rows.length}
            >
              <DownloadIcon />
              Export {rows.length.toLocaleString()} rows
            </button>
          </div>
          <AnalyticsTable
            rows={rows}
            columns={viewColumns}
            search={search}
          />
        </Card>
      )}

      {done && rows.length === 0 && !error && (
        <Card>
          <div className="analytics-empty">
            No records found for the selected filters. Try widening your date
            range.
          </div>
        </Card>
      )}
    </div>
  );
};

export default Analytics;
