import { Link } from "react-router-dom";
import { useState } from "react";
import Card from "../../ui/Card";
import FormField from "../../ui/FormField";
import LogFilters from "./LogFilters";
import FetchProgress from "./FetchProgress";
import LogBreakdown from "./LogBreakdown";
import ActionBar from "./ActionBar";
import useFetchLogs from "../../../hooks/useFetchLogs";
import { DEFAULT_CFG } from "../../../constants";
import { toLocalDatetime, getYesterday, downloadJSON } from "../../../utils";

const GetLogs = ({ project, customer, apiKeys }) => {
  const [cfg, setCfg] = useState({
    ...DEFAULT_CFG,
    startDate: toLocalDatetime(getYesterday()),
    endDate: toLocalDatetime(new Date()),
  });
  const [types, setTypes] = useState([]);
  const [apiKeyId, setApiKeyId] = useState(apiKeys[0]?.id ?? "");

  const { logs, terminal, running, done, progress, fetchAll } = useFetchLogs();

  const handleChange = (key, value) =>
    setCfg((prev) => ({ ...prev, [key]: value }));

  const handleToggleType = (t) =>
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const handleFetch = () => {
    if (!apiKeyId) {
      alert("Select an API key.");
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
      <Card title="Target">
        <div className="grid grid--3 mb-14">
          <FormField label="Customer">
            <input className="input" value={customer?.name ?? ""} disabled />
          </FormField>
          <FormField label="Project">
            <input className="input" value={project.name} disabled />
          </FormField>
          <FormField label="Cognigy project ID">
            <input
              className="input"
              value={project.cognigy_project_id}
              disabled
            />
          </FormField>
        </div>
        <div className="grid grid--3 mb-14">
          <FormField label="API key" required>
            {apiKeys.length === 0 ? (
              <div className="row-list-empty">
                No keys for this customer.{" "}
                <Link
                  className="btn-link"
                  to={`/admin/customers/${customer?.id}`}
                >
                  Add one →
                </Link>
              </div>
            ) : (
              <select
                className="select"
                value={apiKeyId}
                onChange={(e) => setApiKeyId(e.target.value)}
              >
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ···· {k.key_last4}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Start date" required>
            <input
              className="input"
              type="datetime-local"
              value={cfg.startDate}
              onChange={(e) => handleChange("startDate", e.target.value)}
            />
          </FormField>
          <FormField label="End date" required>
            <input
              className="input"
              type="datetime-local"
              value={cfg.endDate}
              onChange={(e) => handleChange("endDate", e.target.value)}
            />
          </FormField>
        </div>
      </Card>

      <LogFilters
        cfg={cfg}
        onChange={handleChange}
        types={types}
        onToggleType={handleToggleType}
      />
      <ActionBar
        running={running}
        done={done}
        logCount={logs.length}
        onFetch={handleFetch}
        onDownload={() => downloadJSON(logs, customer?.name)}
      />
      {(running || done) && (
        <FetchProgress progress={progress} terminal={terminal} />
      )}
      {done && logs.length > 0 && <LogBreakdown logs={logs} />}
    </div>
  );
};

export default GetLogs;
