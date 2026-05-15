export const TYPE_CONFIG = {
  fatal: { color: "#7c3aed", label: "Fatal" },
  error: { color: "#ef4444", label: "Error" },
  warn: { color: "#f59e0b", label: "Warning" },
  info: { color: "#3b82f6", label: "Info" },
  debug: { color: "#8b5cf6", label: "Debug" },
  trace: { color: "#10b981", label: "Trace" },
};

export const NAV_ITEMS = [
  { id: "logs", label: "Get Logs", icon: "logs" },
  { id: "snapshots", label: "Snapshots", icon: "snapshots" },
  { id: "analytics", label: "Analytics", icon: "analytics" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export const SORT_OPTIONS = [
  { value: "timestamp:desc", label: "Newest first" },
  { value: "timestamp:asc", label: "Oldest first" },
];

export const DEFAULT_CFG = {
  startDate: "",
  endDate: "",
  filter: "",
  flowName: "",
  userId: "",
  sort: "timestamp:desc",
};
