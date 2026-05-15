import Card from "../../ui/Card";
import { TYPE_CONFIG } from "../../../constants";

const TypeBreakdown = ({ counts }) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return null;

  const rows = Object.entries(TYPE_CONFIG)
    .map(([key, { label, color }]) => ({ label, color, value: counts[key] || 0 }))
    .filter((r) => r.value > 0);

  return (
    <Card title="Log Breakdown by Type">
      <div className="breakdown-list">
        {rows.map(({ label, color, value }) => (
          <div key={label} className="breakdown-row">
            <div className="breakdown-meta">
              <span className="breakdown-label">{label}</span>
              <span className="breakdown-count" style={{ color }}>
                {value.toLocaleString()}
                <span className="breakdown-pct">
                  ({((value / total) * 100).toFixed(1)}%)
                </span>
              </span>
            </div>
            <div className="breakdown-bar-bg">
              <div
                className="breakdown-bar-fill"
                style={{ width: `${(value / total) * 100}%`, background: color }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default TypeBreakdown;
