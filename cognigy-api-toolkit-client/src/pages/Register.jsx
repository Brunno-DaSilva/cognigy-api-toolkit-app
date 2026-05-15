import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

const DEFAULT_BASE_URL = "https://api-app-us.cognigy.ai";

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: "",
    password: "",
    displayName: "",
    customerName: "",
    baseUrl: DEFAULT_BASE_URL,
    projectName: "Production",
    cognigyProjectId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const { session } = await register({
        email: form.email,
        password: form.password,
        displayName: form.displayName,
      });

      if (!session) {
        setInfo(
          "Account created. Check your email to confirm, then sign in. You can add your first customer and project from the dashboard."
        );
        return;
      }

      const { data: customer, error: customerErr } = await supabase
        .from("customers")
        .insert({
          user_id: session.user.id,
          name: form.customerName.trim(),
          base_url: form.baseUrl.trim(),
        })
        .select()
        .single();
      if (customerErr) throw customerErr;

      const { error: projectErr } = await supabase.from("projects").insert({
        customer_id: customer.id,
        user_id: session.user.id,
        name: form.projectName.trim() || "Production",
        cognigy_project_id: form.cognigyProjectId.trim(),
      });
      if (projectErr) throw projectErr;

      navigate("/home", { replace: true });
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide">
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">
          You'll add your first Cognigy customer and project at the same time.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          {info && <div className="auth-info">{info}</div>}

          <label className="auth-label">
            Display name
            <input
              className="auth-input"
              type="text"
              required
              value={form.displayName}
              onChange={update("displayName")}
            />
          </label>

          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={update("email")}
            />
          </label>

          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={form.password}
              onChange={update("password")}
            />
          </label>

          <div className="auth-divider">First customer</div>

          <label className="auth-label">
            Customer name
            <input
              className="auth-input"
              type="text"
              required
              placeholder="e.g. Acme Corp"
              value={form.customerName}
              onChange={update("customerName")}
            />
          </label>

          <label className="auth-label">
            Cognigy base URL
            <input
              className="auth-input"
              type="url"
              required
              value={form.baseUrl}
              onChange={update("baseUrl")}
            />
          </label>

          <div className="auth-divider">First project</div>

          <label className="auth-label">
            Project name
            <input
              className="auth-input"
              type="text"
              required
              value={form.projectName}
              onChange={update("projectName")}
            />
          </label>

          <label className="auth-label">
            Cognigy project ID
            <input
              className="auth-input"
              type="text"
              placeholder="24-character Cognigy project ID"
              required
              value={form.cognigyProjectId}
              onChange={update("cognigyProjectId")}
            />
          </label>

          <button className="auth-button" type="submit" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="auth-footer">
          Already registered? <Link className="auth-link" to="/">Sign in</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
