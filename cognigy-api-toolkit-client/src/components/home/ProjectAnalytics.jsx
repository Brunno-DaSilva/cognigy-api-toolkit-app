import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber } from "../../utils";

// Matches --brand in the design system (rgb 134 59 255).
const BRAND = "#863bff";

// Turn a raw upstream error into something readable for the tasks section.
const friendlyTasksError = (msg) => {
  if (!msg) return "Couldn’t load tasks.";
  if (/not enabled|feature.*disabled|disabled.*feature/i.test(msg)) {
    return "This feature isn't enabled for this project in Cognigy, so there's no task data to show.";
  }
  return `Couldn’t load tasks: ${msg}`;
};

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-value">
        {formatNumber(payload[0].value)} session
        {payload[0].value === 1 ? "" : "s"}
      </div>
    </div>
  );
};

const ProjectAnalytics = ({ customer, project, loading, error, data, onRetry, days }) => {
  const sessionsByDay = data?.sessionsByDay ?? [];
  const topTasks = data?.topTasks ?? [];
  const sessionsError = data?.sessionsError;
  const tasksError = data?.tasksError;

  const RetryLink = () =>
    onRetry ? (
      <button type="button" className="btn-link" onClick={onRetry}>
        Retry
      </button>
    ) : null;

  const statValue = (err, value) =>
    loading ? "…" : err ? "—" : formatNumber(value ?? 0);

  return (
    <section className="home-analytics">
      <h3 className="home-analytics-title">
        {customer?.name}
        {project?.name ? (
          <span className="home-analytics-project"> · {project.name}</span>
        ) : null}
      </h3>

      {error ? (
        <div className="form-error" style={{ marginBottom: 16 }}>
          {error} <RetryLink />
        </div>
      ) : null}

      <div className="home-analytics-grid">
        <div className="metric-card">
          <div className="metric-label">Sessions (last {days} days)</div>
          <div className="metric-value">
            {statValue(sessionsError, data?.totalSessions)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Tasks used (distinct)</div>
          <div className="metric-value">
            {statValue(tasksError, data?.distinctTasks)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total tasks</div>
          <div className="metric-value">
            {statValue(tasksError, data?.totalTasks)}
          </div>
        </div>
      </div>

      <div className="chart-card">
        <div className="section-title" style={{ marginBottom: 4 }}>
          Sessions per day
        </div>
        <div className="chart-card-sub">Last {days} days to today</div>
        {loading ? (
          <div className="chart-empty">Loading session volume…</div>
        ) : sessionsError ? (
          <div className="chart-empty">
            Couldn’t load sessions: {sessionsError} <RetryLink />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart
              data={sessionsByDay}
              margin={{ top: 10, right: 12, left: -14, bottom: 0 }}
            >
              <defs>
                <linearGradient id="homeSessionsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: BRAND, strokeOpacity: 0.25 }} />
              <Area
                type="monotone"
                dataKey="count"
                stroke={BRAND}
                strokeWidth={2}
                fill="url(#homeSessionsFill)"
                dot={{ r: 3, fill: BRAND }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="chart-card">
        <div className="section-title" style={{ marginBottom: 4 }}>
          Most used tasks
        </div>
        <div className="chart-card-sub">Top 5 tasks by number of runs</div>
        <div className="row-list">
          {loading ? (
            <div className="row-list-empty">Loading tasks…</div>
          ) : tasksError ? (
            <div className="row-list-empty">
              {friendlyTasksError(tasksError)} <RetryLink />
            </div>
          ) : topTasks.length === 0 ? (
            <div className="row-list-empty">No task data for this project.</div>
          ) : (
            topTasks.slice(0, 5).map((t) => (
              <div className="row-item" key={t.name}>
                <div className="row-item-main">
                  <div className="row-item-name">{t.name}</div>
                </div>
                <span className="task-count-badge">{formatNumber(t.count)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};

export default ProjectAnalytics;
