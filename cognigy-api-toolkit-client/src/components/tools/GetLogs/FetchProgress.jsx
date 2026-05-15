import Card from "../../ui/Card";
import StatCard from "../../ui/StatCard";
import Terminal from "../../ui/Terminal";

const FetchProgress = ({ progress, terminal }) => (
  <Card>
    <div className="progress-header">
      <span className="card-title">Progress</span>
      <span className="progress-count">
        {progress.fetched.toLocaleString()} / {progress.total?.toLocaleString() ?? "—"}
      </span>
    </div>

    <div className="progress-bar-bg">
      <div
        className="progress-bar-fill"
        style={{ width: `${progress.pct}%` }}
      />
    </div>

    <div className="grid grid--3 mb-16">
      <StatCard label="Fetched"   value={progress.fetched} accent="#6366f1" />
      <StatCard label="API Calls" value={progress.pages}   accent="#0ea5e9" />
      <StatCard label="Total"     value={progress.total}   accent="#f59e0b" />
    </div>

    <Terminal lines={terminal} />
  </Card>
);

export default FetchProgress;
