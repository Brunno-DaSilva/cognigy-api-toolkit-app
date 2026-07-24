import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import Card from "../../ui/Card";
import FormField from "../../ui/FormField";
import Select from "../../ui/Select";
import useSessionAnalyzer from "../../../hooks/useSessionAnalyzer";

const DIAGNOSE_PROMPT =
  "Diagnose what went wrong in this conversation and give me a clear summary.";

const SessionDoctor = ({ project, customer, apiKeys }) => {
  const { messages, running, error, send, reset } = useSessionAnalyzer();
  const [apiKeyId, setApiKeyId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [userId, setUserId] = useState("");
  const [question, setQuestion] = useState("");

  // Default the API key once keys load.
  useEffect(() => {
    if (!apiKeyId && apiKeys.length > 0) setApiKeyId(apiKeys[0].id);
  }, [apiKeyId, apiKeys]);

  const target = {
    apiKeyId,
    projectId: project.id,
    cognigyProjectId: project.cognigy_project_id,
    sessionId: sessionId.trim() || null,
    userId: userId.trim() || null,
  };

  const hasTarget = !!(sessionId.trim() || userId.trim());
  const canDiagnose = !!apiKeyId && hasTarget && !running;
  const canAsk = !!apiKeyId && !!question.trim() && !running;

  const handleDiagnose = () => {
    if (!canDiagnose) return;
    send({ ...target, question: DIAGNOSE_PROMPT });
  };

  const handleAsk = () => {
    if (!canAsk) return;
    send({ ...target, question: question.trim() });
    setQuestion("");
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
              <Select
                className="select"
                value={apiKeyId}
                onChange={(v) => setApiKeyId(v)}
                options={apiKeys.map((k) => ({
                  value: k.id,
                  label: `${k.name} ···· ${k.key_last4}`,
                }))}
              />
            )}
          </FormField>
          <FormField label="Session ID">
            <input
              className="input"
              placeholder="Cognigy session ID"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </FormField>
          <FormField label="User / contact ID">
            <input
              className="input"
              placeholder="optional"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </FormField>
        </div>

        <p className="analytics-hint">
          Provide a session ID and/or a user ID, then run a diagnosis. After the
          first answer you can ask follow-up questions about the same
          conversation.
        </p>

        <div className="action-bar">
          <button
            className="btn btn--primary"
            onClick={handleDiagnose}
            disabled={!canDiagnose}
          >
            {running ? (
              <>
                <span className="spinner" />
                Analyzing…
              </>
            ) : (
              "Diagnose"
            )}
          </button>
          {messages.length > 0 && (
            <button className="btn-ghost" onClick={reset} disabled={running}>
              Clear
            </button>
          )}
        </div>
      </Card>

      {error && <div className="analytics-error">Error: {error}</div>}

      {messages.length > 0 && (
        <Card title="Conversation">
          <div className="session-doctor-chat">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`session-doctor-msg session-doctor-msg--${m.role}`}
              >
                <div className="session-doctor-msg-role">
                  {m.role === "assistant" ? "Session Doctor" : "You"}
                </div>
                <div className="session-doctor-msg-body">{m.content}</div>
              </div>
            ))}
            {running && (
              <div className="session-doctor-msg session-doctor-msg--assistant">
                <div className="session-doctor-msg-role">Session Doctor</div>
                <div className="session-doctor-msg-body">
                  <span className="spinner" /> thinking…
                </div>
              </div>
            )}
          </div>

          <div className="session-doctor-ask">
            <input
              className="input"
              placeholder="Ask a follow-up about this session…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAsk();
              }}
            />
            <button
              className="btn btn--primary"
              onClick={handleAsk}
              disabled={!canAsk}
            >
              Ask
            </button>
          </div>
        </Card>
      )}
    </div>
  );
};

export default SessionDoctor;
