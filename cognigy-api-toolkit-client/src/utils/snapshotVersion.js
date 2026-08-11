// Semantic versioning for snapshot names.
//
// Snapshots created through the toolkit are named `v<major>.<minor>.<patch>`
// (e.g. v1.0.1). A version travels with the artifact: promoting Dev's v1.2.0
// into QA keeps the name v1.2.0, so one version is traceable across
// environments.
//
// Safety snapshots taken before a promote carry a suffix:
//   v1.1.0_pre-promote_Aug-11-2026
// The leading version is still parseable, so a safety snapshot never pushes
// the baseline past a version that already exists.

// Matches a leading version, with or without a trailing suffix.
const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)(?:[._-].*)?$/i;

export const BUMPS = [
  {
    value: "major",
    label: "Major",
    hint: "Breaking or structural change to the agent",
  },
  {
    value: "minor",
    label: "Minor",
    hint: "New flows, intents or capabilities",
  },
  {
    value: "patch",
    label: "Patch",
    hint: "Fixes and small tweaks",
  },
];

// "v1.2.0" | "v1.2.0_pre-promote_Aug-11-2026" -> { major, minor, patch }
// Anything else (legacy date-based names) -> null.
export const parseVersion = (name) => {
  const m = String(name ?? "").trim().match(VERSION_RE);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
};

export const formatVersion = (v) =>
  v ? `v${v.major}.${v.minor}.${v.patch}` : null;

export const compareVersions = (a, b) =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;

// Highest parseable version across a list of snapshot names, or null if none
// of them are versioned yet.
export const latestVersion = (names) => {
  let best = null;
  for (const n of names ?? []) {
    const v = parseVersion(n);
    if (v && (!best || compareVersions(v, best) > 0)) best = v;
  }
  return best;
};

// The version a new snapshot gets. With no versioned history the first
// snapshot is v1.0.0 whatever the bump — there is nothing to bump from.
export const nextVersion = (current, bump) => {
  if (!current) return { major: 1, minor: 0, patch: 0 };
  if (bump === "major") return { major: current.major + 1, minor: 0, patch: 0 };
  if (bump === "minor") return { major: current.major, minor: current.minor + 1, patch: 0 };
  if (bump === "patch")
    return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  return null;
};

// "Aug-11-2026" (UTC) — matches the suffix the worker has always used.
export const dateSuffix = (d = new Date()) => {
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${month}-${day}-${d.getUTCFullYear()}`;
};

// Name for the safety snapshot taken on a promote target. `current` is the
// target's version right now — the point you roll back to.
export const prePromoteName = (current, d) =>
  `${formatVersion(current) ?? "unversioned"}_pre-promote_${dateSuffix(d)}`;

// Every name we know about for a project, newest-first lists included.
export const collectNames = (currents = [], archived = []) => [
  ...currents.map((c) => c.cognigy_name ?? c.localRow?.name),
  ...archived.map((a) => a.name),
];
