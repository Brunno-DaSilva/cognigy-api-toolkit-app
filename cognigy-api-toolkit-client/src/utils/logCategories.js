// Turns a free-text Cognigy log entry into a coarse sub-category so we can say
// "12 × HTTP 400, 8 × Parser error, ..." instead of a flat "30 errors".
//
// Strategy is hybrid (see the Get Logs tool): first try to recognise well-known
// failure shapes (HTTP status, parser, timeout, ...), then fall back to an
// auto-clustered signature of the raw message so nothing is ever dropped.

// Pull a readable message string out of a log entry. The Cognigy logs API is
// loosely typed and the message can live under a few different keys, or be an
// object — handle all of it defensively.
export const getLogMessage = (log) => {
  if (!log || typeof log !== "object") return String(log ?? "");
  const raw = log.text ?? log.message ?? log.msg ?? log.error ?? log.description;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    return (
      raw.message ||
      raw.text ||
      raw.error ||
      raw.description ||
      JSON.stringify(raw)
    );
  }
  return String(raw);
};

// "status code 400", "HTTP 500", "responded with 429", "returned 404" → the code.
const HTTP_STATUS_RE =
  /\b(?:http|status|code|returned|respond(?:ed)?)\b[^0-9]{0,10}([1-5]\d{2})\b/i;

// Collapse the variable parts of a message so structurally-identical entries
// group together: "Node abc123 failed after 45ms" → "Node {id} failed after {n}".
const normalizeSignature = (msg) => {
  let s = String(msg)
    .replace(/["'`][^"'`]*["'`]/g, "…") // quoted values
    .replace(/\b[0-9a-f]{8,}\b/gi, "{id}") // long hex / uuids / object ids
    .replace(/\b\d[\d.,:]*\b/g, "{n}") // numbers, durations, timestamps-ish
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "(empty message)";
  if (s.length > 80) s = `${s.slice(0, 80)}…`;
  return s;
};

// Returns a human-readable category label for a single log entry.
export const categorizeLog = (log) => {
  const msg = getLogMessage(log);
  if (!msg) return "(empty message)";
  const text = msg.toLowerCase();

  const http = msg.match(HTTP_STATUS_RE);
  if (http) return `HTTP ${http[1]}`;

  if (/\bpars(?:e|ing|er)\b|json\.parse|unexpected token|malformed/.test(text))
    return "Parser error";
  if (/timed?\s?out|etimedout|\btimeout\b|deadline exceeded/.test(text))
    return "Timeout";
  if (/\bextension\b|search extension/.test(text)) return "Extension error";
  if (
    /econnrefused|enotfound|econnreset|network|fetch failed|socket hang|request failed|dns/.test(
      text
    )
  )
    return "API / network error";
  if (
    /cannot read propert|is not a function|referenceerror|typeerror|undefined is|null is|unhandled/.test(
      text
    )
  )
    return "Runtime / code error";
  if (/\bintent\b|confidence|\bnlu\b|not understood|no match/.test(text))
    return "NLU / intent";
  if (/\bnode\b/.test(text)) return "Node execution";

  // Nothing matched a known shape — auto-cluster by message signature.
  return normalizeSignature(msg);
};

// Whether a category label came from a recognised pattern (vs. auto-clustered).
// Used only for a subtle UI hint.
const KNOWN_PREFIXES = [
  "HTTP ",
  "Parser error",
  "Timeout",
  "Extension error",
  "API / network error",
  "Runtime / code error",
  "NLU / intent",
  "Node execution",
];
export const isKnownCategory = (label) =>
  KNOWN_PREFIXES.some((p) => label === p || label.startsWith(p));
