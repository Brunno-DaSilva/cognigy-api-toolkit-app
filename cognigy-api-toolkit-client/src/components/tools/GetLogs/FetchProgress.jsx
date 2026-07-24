import { useEffect, useRef } from "react";
import Card from "../../ui/Card";
import StatCard from "../../ui/StatCard";

// Legend describing what each terminal color means. Kept in sync with the
// .gl-term-line--* classes in styles/index.css.
const LEGEND = [
  { cls: "info", label: "Config / info" },
  { cls: "default", label: "In progress" },
  { cls: "ok", label: "Page fetched" },
  { cls: "id", label: "Identifiers" },
];

// GetLogs-specific terminal. Intentionally NOT the shared ui/Terminal — this
// one carries the Get Logs color scheme (light + dark) without affecting the
// Snapshots / Scraper / Uploader terminals that use the shared component.
const LogTerminal = ({ lines }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <>
      <div className="gl-terminal" ref={ref}>
        {lines.map((l, i) => (
          <div
            key={i}
            className={`gl-term-line gl-term-line--${l.type || "default"}`}
          >
            {l.msg}
          </div>
        ))}
      </div>
      <div className="gl-term-legend">
        {LEGEND.map((item) => (
          <span key={item.cls} className="gl-term-legend-item">
            <span className={`gl-term-legend-dot gl-term-line--${item.cls}`} />
            {item.label}
          </span>
        ))}
      </div>
    </>
  );
};

const FetchProgress = ({ progress, terminal }) => (
  <Card>
    <div className="progress-header">
      <span className="card-title">Progress</span>
      <span className="progress-count">
        {progress.fetched.toLocaleString()} /{" "}
        {progress.total?.toLocaleString() ?? "—"}
      </span>
    </div>

    <div className="progress-bar-bg">
      <div
        className="progress-bar-fill"
        style={{ width: `${progress.pct}%` }}
      />
    </div>

    <div className="grid grid--3 mb-16">
      <StatCard label="Fetched" value={progress.fetched} accent="#6366f1" />
      <StatCard label="API Calls" value={progress.pages} accent="#0ea5e9" />
      <StatCard label="Total" value={progress.total} accent="#f59e0b" />
    </div>

    <LogTerminal lines={terminal} />
  </Card>
);

export default FetchProgress;
