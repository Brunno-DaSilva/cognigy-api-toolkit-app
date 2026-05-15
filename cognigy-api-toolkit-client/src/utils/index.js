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
