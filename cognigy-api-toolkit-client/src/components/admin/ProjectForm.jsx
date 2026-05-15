import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

const ProjectForm = ({ open, project, customerId, onClose, onSaved }) => {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [cognigyProjectId, setCognigyProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setCognigyProjectId(project?.cognigy_project_id ?? "");
      setError(null);
    }
  }, [open, project]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (project) {
        const { error: err } = await supabase
          .from("projects")
          .update({
            name: name.trim(),
            cognigy_project_id: cognigyProjectId.trim(),
          })
          .eq("id", project.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("projects").insert({
          customer_id: customerId,
          user_id: user.id,
          name: name.trim(),
          cognigy_project_id: cognigyProjectId.trim(),
        });
        if (err) throw err;
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onClose}
      title={project ? "Edit project" : "Add project"}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="project-form" className="btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : project ? "Save changes" : "Add project"}
          </button>
        </>
      }
    >
      <form id="project-form" className="field-group" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <label className="field">
          <span className="field-label">Project name</span>
          <input
            className="field-input"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production agent"
          />
        </label>

        <label className="field">
          <span className="field-label">Cognigy project ID</span>
          <input
            className="field-input"
            type="text"
            required
            value={cognigyProjectId}
            onChange={(e) => setCognigyProjectId(e.target.value)}
            placeholder="24-character ID from the Cognigy URL"
          />
          <span className="field-hint">
            Found in the Cognigy URL after /project/ — e.g. 69dfbf7216e36e78370289b3
          </span>
        </label>
      </form>
    </Modal>
  );
};

export default ProjectForm;
