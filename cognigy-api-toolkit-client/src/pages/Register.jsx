import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import CognigyLogo from "../components/ui/Logo";

// Same cascade config as Landing — keeps the two auth pages visually aligned.
const DECOR_LOGOS = [
  { top: "-30px",  right: "-30px",  size: 220, opacity: 0.55, rotate: -8 },
  { top: "90px",   right: "120px",  size: 96,  opacity: 0.32, rotate: 12 },
  { top: "170px",  right: "240px",  size: 64,  opacity: 0.22, rotate: -4 },
  { top: "240px",  right: "60px",   size: 130, opacity: 0.40, rotate: 6 },
  { top: "390px",  right: "200px",  size: 80,  opacity: 0.22, rotate: -10 },
  { top: "470px",  right: "30px",   size: 100, opacity: 0.28, rotate: 14 },
  { top: "600px",  right: "180px",  size: 56,  opacity: 0.18, rotate: 0 },
  { top: "680px",  right: "60px",   size: 76,  opacity: 0.20, rotate: -16 },
];

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
    <div className="auth-page auth-page--branded">
      <div className="auth-decor" aria-hidden="true">
        {DECOR_LOGOS.map((l, i) => (
          <div
            key={i}
            className="auth-decor-logo"
            style={{
              top: l.top,
              right: l.right,
              opacity: l.opacity,
              transform: `rotate(${l.rotate ?? 0}deg)`,
            }}
          >
            <CognigyLogo width={l.size} height={l.size * (46 / 48)} />
          </div>
        ))}
      </div>

      <div className="auth-card auth-card--branded">
        <div className="auth-brand">
          <CognigyLogo width={36} height={34} />
          <span className="auth-brand-name">Cognigy API Toolkit</span>
        </div>

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

          <button
            className="auth-button auth-button--brand"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="auth-footer">
          Already registered?{" "}
          <Link className="auth-link auth-link--brand" to="/">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
