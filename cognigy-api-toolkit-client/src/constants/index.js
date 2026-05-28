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
  { id: "scraper", label: "Scraper", icon: "scraper" },
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

export const ANALYTICS_ENDPOINTS = [
  {
    value: "/Analytics",
    label: "Analytics",
    hint: "Turn-by-turn analytics records. Each row = one conversation turn.",
  },
  {
    value: "/Sessions",
    label: "Sessions",
    hint: "One record per session. Duration, turn count, completion status.",
  },
  {
    value: "/Conversations",
    label: "Conversations",
    hint: "Full conversation transcripts. Complete message history per session.",
  },
];

export const ANALYTICS_DEFAULT_COLUMNS = [
  "contactId",
  "sessionId",
  "inputText",
  "completedGoalsList",
  "timestamp",
  "custom1",
  "custom2",
  "custom3",
  "custom4",
  "custom5",
  "custom6",
  "custom7",
  "custom8",
  "custom9",
  "custom10",
];

// Columns whose value should be masked to "····{last4}" with a copy button.
export const ANALYTICS_ID_COLUMNS = ["contactId", "sessionId", "userId"];

export const ANALYTICS_VIEWS_STORAGE_KEY = "cognigy-toolkit:analytics-views";
export const ANALYTICS_ACTIVE_VIEW_STORAGE_KEY =
  "cognigy-toolkit:analytics-active-view";
