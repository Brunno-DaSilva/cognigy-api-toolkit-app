import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { getAvatarUrl } from "../utils";

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — matches storage bucket limit
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Extracts the in-bucket path from a public avatar URL, or null if the URL
// isn't from our storage bucket (e.g. it's the robohash fallback).
const pathFromAvatarUrl = (url) => {
  if (!url) return null;
  const marker = "/storage/v1/object/public/avatars/";
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return url.slice(idx + marker.length).split("?")[0];
};

const Profile = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const displayName =
    user?.user_metadata?.display_name || user?.email?.split("@")[0] || "—";

  const hasCustomAvatar = !!user?.user_metadata?.avatar_url;

  const handleSignOut = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const handlePickFile = () => fileInputRef.current?.click();

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file
    if (!file) return;

    setError(null);
    setInfo(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPEG, WEBP, or GIF image.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("File is over 2 MB. Pick something smaller.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const newUrl = pub?.publicUrl;
      if (!newUrl) throw new Error("Couldn't resolve uploaded image URL.");

      // Remove the previous avatar file (if any) — keeps the bucket tidy.
      const oldPath = pathFromAvatarUrl(user?.user_metadata?.avatar_url);
      if (oldPath && oldPath !== path) {
        await supabase.storage.from("avatars").remove([oldPath]);
      }

      const { error: updateErr } = await supabase.auth.updateUser({
        data: { avatar_url: newUrl },
      });
      if (updateErr) throw updateErr;

      setInfo("Profile picture updated.");
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!hasCustomAvatar) return;
    setError(null);
    setInfo(null);
    setUploading(true);
    try {
      const oldPath = pathFromAvatarUrl(user?.user_metadata?.avatar_url);
      if (oldPath) {
        await supabase.storage.from("avatars").remove([oldPath]);
      }
      const { error: updateErr } = await supabase.auth.updateUser({
        data: { avatar_url: null },
      });
      if (updateErr) throw updateErr;
      setInfo("Profile picture removed.");
    } catch (err) {
      setError(err.message || "Couldn't remove picture.");
    } finally {
      setUploading(false);
    }
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

      <div className="profile-avatar-row">
        <img
          className="profile-avatar"
          src={getAvatarUrl(user, 240)}
          alt={displayName}
        />
        <div className="profile-avatar-actions">
          <div className="profile-avatar-help">
            {hasCustomAvatar
              ? "Click change to upload a new picture."
              : "We assigned you a robot — upload to replace it."}
          </div>
          <div className="profile-avatar-buttons">
            <button
              type="button"
              className="btn-primary"
              onClick={handlePickFile}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Change picture"}
            </button>
            {hasCustomAvatar && (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleRemove}
                disabled={uploading}
              >
                Reset to default
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            onChange={handleUpload}
            hidden
          />
          {info && <div className="auth-info">{info}</div>}
          {error && <div className="auth-error">{error}</div>}
        </div>
      </div>

      <dl className="kv-grid">
        <dt>Display name</dt>
        <dd>{displayName}</dd>
        <dt>Email</dt>
        <dd>{user?.email}</dd>
        <dt>User ID</dt>
        <dd>{user?.id}</dd>
        <dt>Joined</dt>
        <dd>
          {user?.created_at ? new Date(user.created_at).toLocaleString() : "—"}
        </dd>
      </dl>
    </div>
  );
};

export default Profile;
