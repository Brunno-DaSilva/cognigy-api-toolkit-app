import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import CognigyLogo from "../components/ui/Logo";

// Cascading decorative logos in the top-right corner.
// Each row is { top, right, size, opacity, rotate? } expressed in CSS units.
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

const Landing = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/home";
  const info = location.state?.info;

  const [email, setEmail] = useState(location.state?.email ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
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

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to continue.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {info && <div className="auth-info">{info}</div>}
          {error && <div className="auth-error">{error}</div>}

          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button
            className="auth-button auth-button--brand"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="auth-footer">
          No account?{" "}
          <Link className="auth-link auth-link--brand" to="/register">
            Create one
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Landing;
