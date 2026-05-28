import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: "",
    password: "",
    displayName: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { session } = await register({
        email: form.email,
        password: form.password,
        displayName: form.displayName,
      });

      // Email-confirmation flow: no session yet — bounce to login with a note.
      if (!session) {
        navigate("/", {
          replace: true,
          state: {
            info:
              "Account created. Check your email to confirm, then sign in. You can add your first customer from the Customers page.",
            email: form.email,
          },
        });
        return;
      }

      // Auto sign-in flow (email confirmation disabled): straight to home.
      navigate("/home", { replace: true });
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">
          Once signed in, head to <strong>Customers</strong> to add your first
          Cognigy customer and projects.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}

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
