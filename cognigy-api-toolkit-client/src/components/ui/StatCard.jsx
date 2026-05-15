import { formatNumber } from "../../utils";

const StatCard = ({ label, value, accent }) => (
  <div className="stat-card" style={{ borderLeftColor: accent }}>
    <div className="stat-value">{formatNumber(value)}</div>
    <div className="stat-label">{label}</div>
  </div>
);

export default StatCard;
