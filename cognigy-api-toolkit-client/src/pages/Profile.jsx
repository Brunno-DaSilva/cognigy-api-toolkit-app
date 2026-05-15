import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const Profile = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const displayName =
    user?.user_metadata?.display_name || user?.email?.split("@")[0] || "—";

  const handleSignOut = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Profile</div>
          <div className="admin-page-sub">Your account.</div>
        </div>
        <button type="button" className="btn-ghost" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      <div className="project-banner">
        Changing display name, email, and password is coming next.
      </div>

      <dl className="kv-grid">
        <dt>Display name</dt>
        <dd>{displayName}</dd>
        <dt>Email</dt>
        <dd>{user?.email}</dd>
        <dt>User ID</dt>
        <dd>{user?.id}</dd>
        <dt>Joined</dt>
        <dd>{user?.created_at ? new Date(user.created_at).toLocaleString() : "—"}</dd>
      </dl>
    </div>
  );
};

export default Profile;
