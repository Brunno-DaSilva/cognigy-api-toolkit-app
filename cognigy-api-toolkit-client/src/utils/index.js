export const toLocalDatetime = (date) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
};

export const getYesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const formatNumber = (n) =>
  typeof n === "number" ? n.toLocaleString() : n ?? "—";

export const downloadJSON = (logs) => {
  const blob = new Blob(
    [JSON.stringify({ total: logs.length, exportedAt: new Date().toISOString(), logs }, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cognigy-logs-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const getTimestamp = () =>
  new Date().toISOString().split("T")[1].split(".")[0];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "November-04-2025" — matches the upload_FEATURE logger's dated folder name.
export const formatLogDate = (date = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${MONTHS[date.getMonth()]}-${p(date.getDate())}-${date.getFullYear()}`;
};

// "211353" — the HHMMSS suffix on each per-run log file.
export const formatLogTime = (date = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
};

// Lowercase, hyphen-separated slug used to build the log "context" name
// (e.g. "Product Knowledge Base" → "product-knowledge-base").
export const slugify = (str) =>
  (str || "")
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

// Returns the user's uploaded avatar URL, or a stable robohash fallback.
// Using user.id as the seed gives each user a consistent random robot.
export const getAvatarUrl = (user, size = 180) => {
  const uploaded = user?.user_metadata?.avatar_url;
  if (uploaded) return uploaded;
  const seed = user?.id || "anonymous";
  return `https://robohash.org/${encodeURIComponent(seed)}?set=set2&size=${size}x${size}`;
};
