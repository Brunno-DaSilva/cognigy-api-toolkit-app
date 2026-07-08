// kai-core — shared evaluation + action logic for KAI Connector.
//
// Imported by both kai-evaluator (manual upload) and kai-sync-worker (nightly
// job) so the two run the IDENTICAL pipeline. Everything here is self-contained
// — no npm packages, no Postgres extensions. MD5, Levenshtein and TF-IDF are
// implemented inline per the tool's constraints.
//
// Cognigy's Knowledge Sources API returns metadata only, so KAI Connector keeps
// its own copy of every file it uploads in the private 'kai-backups' bucket.
// A REPLACE is gated on a confirmed backup row before the Cognigy DELETE fires.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Decision thresholds (cosine similarity) — shared by embedding + tfidf modes.
export const SIM_REPLACE = 0.92;
export const SIM_HOLD = 0.75;
export const TITLE_FUZZY_REPLACE = 85;
export const BACKUPS_BUCKET = "kai-backups";

// ---------------------------------------------------------------------------
// MD5 — compact, dependency-free. Hashes a UTF-8 string to a 32-char hex digest.
// ---------------------------------------------------------------------------
export function md5(input: string): string {
  function toBytes(str: string): number[] {
    const utf8 = unescape(encodeURIComponent(str));
    const bytes: number[] = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) & 0xff);
    return bytes;
  }
  function add32(a: number, b: number) {
    return (a + b) & 0xffffffff;
  }
  function rol(n: number, c: number) {
    return (n << c) | (n >>> (32 - c));
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    return add32(rol(add32(add32(a, q), add32(x, t)), s), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  const bytes = toBytes(input);
  const origLenBits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) {
    bytes.push((origLenBits >>> (8 * i)) & 0xff);
  }

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const T = [
    -680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426,
    -1473231341, -45705983, 1770035416, -1958414417, -42063, -1990404162,
    1804603682, -40341101, -1502002290, 1236535329, -165796510, -1069501632,
    643717713, -373897302, -701558691, 38016083, -660478335, -405537848,
    568446438, -1019803690, -187363961, 1163531501, -1444681467, -51403784,
    1735328473, -1926607734, -378558, -2022574463, 1839030562, -35309556,
    -1530992060, 1272893353, -155497632, -1094730640, 681279174, -358537222,
    -722521979, 76029189, -640364487, -421815835, 530742520, -995338651,
    -198630844, 1126891415, -1416354905, -57434055, 1700485571, -1894986606,
    -1051523, -2054922799, 1873313359, -30611744, -1560198380, 1309151649,
    -145523070, -1120210379, 718787259, -343485551,
  ];

  for (let i = 0; i < bytes.length; i += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) {
      M[j] = bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) |
        (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24);
    }
    const oa = a, ob = b, oc = c, od = d;
    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) {
        f = ff(a, b, c, d, M[j], S[j], T[j]);
        g = j;
      } else if (j < 32) {
        f = gg(a, b, c, d, M[(5 * j + 1) % 16], S[j], T[j]);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = hh(a, b, c, d, M[(3 * j + 5) % 16], S[j], T[j]);
        g = (3 * j + 5) % 16;
      } else {
        f = ii(a, b, c, d, M[(7 * j) % 16], S[j], T[j]);
        g = (7 * j) % 16;
      }
      a = d;
      d = c;
      c = b;
      b = f;
      // g intentionally unused beyond index selection above
      void g;
    }
    a = add32(a, oa);
    b = add32(b, ob);
    c = add32(c, oc);
    d = add32(d, od);
  }

  const hex = (n: number) => {
    let s = "";
    for (let i = 0; i < 4; i++) {
      s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    }
    return s;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

// ---------------------------------------------------------------------------
// Levenshtein distance + token-sort ratio (0–100). Inline, no library.
// ---------------------------------------------------------------------------
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function normalizeTokens(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

// token_sort_ratio: order-independent similarity, 0–100.
export function tokenSortRatio(a: string, b: string): number {
  const na = normalizeTokens(a);
  const nb = normalizeTokens(b);
  if (!na && !nb) return 100;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length) || 1;
  return Math.round((1 - dist / maxLen) * 100);
}

// ---------------------------------------------------------------------------
// TF-IDF (inline). Stored vectors are raw term-frequency maps; IDF is computed
// across the corpus at compare time so cosine is consistent without persisting
// global state.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is",
  "are", "was", "were", "be", "as", "at", "by", "it", "this", "that", "with",
  "from", "we", "you", "your", "our", "their", "they", "he", "she", "i",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function termFreq(text: string): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokenize(text)) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

// Cosine over two sparse vectors weighted by IDF derived from the corpus.
function tfidfCosine(
  a: Record<string, number>,
  b: Record<string, number>,
  idf: Record<string, number>,
): number {
  let dot = 0, magA = 0, magB = 0;
  const wa: Record<string, number> = {};
  for (const [t, f] of Object.entries(a)) wa[t] = f * (idf[t] ?? 0);
  const wb: Record<string, number> = {};
  for (const [t, f] of Object.entries(b)) wb[t] = f * (idf[t] ?? 0);
  for (const v of Object.values(wa)) magA += v * v;
  for (const v of Object.values(wb)) magB += v * v;
  for (const [t, v] of Object.entries(wa)) {
    if (wb[t] !== undefined) dot += v * wb[t];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Build IDF over the corpus of stored TF maps plus the incoming one.
function buildIdf(corpus: Record<string, number>[]): Record<string, number> {
  const N = corpus.length || 1;
  const df: Record<string, number> = {};
  for (const tf of corpus) {
    for (const t of Object.keys(tf)) df[t] = (df[t] ?? 0) + 1;
  }
  const idf: Record<string, number> = {};
  for (const [t, d] of Object.entries(df)) {
    idf[t] = Math.log((N + 1) / (d + 1)) + 1;
  }
  return idf;
}

// Cosine for dense float vectors (Azure embeddings).
export function vectorCosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ---------------------------------------------------------------------------
// Title extraction: first markdown-ish heading, else first non-empty line,
// else the filename without extension.
// ---------------------------------------------------------------------------
export function extractTitle(text: string, filename: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  // Cognigy Text (.ctxt) header carries an explicit `title: ...` — prefer it.
  for (const l of lines) {
    const t = l.match(/^`?\s*title\s*:\s*(.+?)\s*`?$/i);
    if (t) return t[1].trim().slice(0, 200);
  }
  for (const l of lines) {
    if (!l) continue;
    // Skip .ctxt backtick header lines (`version: 1`, `tags: [...]`, `url: …`).
    if (/^`[^`]*`$/.test(l) || /^`?\s*(version|tags|url|image)\s*:/i.test(l)) continue;
    const m = l.match(/^#{1,6}\s+(.*)$/);
    if (m) return m[1].trim().slice(0, 200);
    return l.slice(0, 200);
  }
  return filename.replace(/\.[^.]+$/, "");
}

// ---------------------------------------------------------------------------
// Azure OpenAI embeddings.
// ---------------------------------------------------------------------------
export async function azureEmbed(
  endpoint: string,
  deployment: string,
  apiKey: string,
  text: string,
): Promise<number[]> {
  const base = endpoint.replace(/\/+$/, "");
  const url =
    `${base}/openai/deployments/${deployment}/embeddings?api-version=2023-05-15`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ input: text.slice(0, 32000) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`azure embeddings ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("azure embeddings: no vector");
  return vec;
}

// ---------------------------------------------------------------------------
// Decision types.
// ---------------------------------------------------------------------------
export type Decision = "add" | "replace" | "hold" | "skip";
export type SimMethod = "hash" | "title_fuzzy" | "embedding" | "tfidf";

export interface TrackedDoc {
  id: string;
  title: string | null;
  content_hash: string | null;
  embedding: number[] | null;
  tfidf_vector: Record<string, number> | null;
}

export interface EvalResult {
  decision: Decision;
  similarity_score: number | null;
  similarity_method: SimMethod | null;
  matched_document_id: string | null;
  // Vectors computed for the incoming doc, persisted on add/replace.
  incoming_hash: string;
  incoming_title: string;
  incoming_embedding: number[] | null;
  incoming_tfidf: Record<string, number> | null;
  warning: string | null;
}

export interface StoreConfig {
  embedding_mode: "azure_openai" | "tfidf";
  azure_endpoint: string | null;
  azure_deployment: string | null;
  azureKeyPlaintext: string | null; // decrypted by caller
}

// Core pipeline — run in order, stop at first conclusive result.
export async function evaluate(
  plainText: string,
  filename: string,
  docs: TrackedDoc[],
  store: StoreConfig,
): Promise<EvalResult> {
  const incoming_hash = md5(plainText);
  const incoming_title = extractTitle(plainText, filename);

  const base: EvalResult = {
    decision: "add",
    similarity_score: null,
    similarity_method: null,
    matched_document_id: null,
    incoming_hash,
    incoming_title,
    incoming_embedding: null,
    incoming_tfidf: null,
    warning: null,
  };

  // Step 0 — content hash → skip (identical re-upload).
  const hashMatch = docs.find((d) => d.content_hash === incoming_hash);
  if (hashMatch) {
    return {
      ...base,
      decision: "skip",
      similarity_method: "hash",
      matched_document_id: hashMatch.id,
    };
  }

  // Step 1 — title fuzzy match (token-sort ratio ≥ 85).
  let bestTitle = -1;
  let bestTitleDoc: TrackedDoc | null = null;
  for (const d of docs) {
    if (!d.title) continue;
    const r = tokenSortRatio(incoming_title, d.title);
    if (r > bestTitle) {
      bestTitle = r;
      bestTitleDoc = d;
    }
  }
  if (bestTitleDoc && bestTitle >= TITLE_FUZZY_REPLACE) {
    return {
      ...base,
      decision: "replace",
      similarity_score: bestTitle / 100,
      similarity_method: "title_fuzzy",
      matched_document_id: bestTitleDoc.id,
    };
  }

  // Step 2 — semantic similarity (azure embeddings or inline tfidf).
  let useTfidf = store.embedding_mode === "tfidf";
  let warning: string | null = null;
  let incoming_embedding: number[] | null = null;

  if (store.embedding_mode === "azure_openai") {
    try {
      if (!store.azure_endpoint || !store.azure_deployment || !store.azureKeyPlaintext) {
        throw new Error("azure embedding config incomplete");
      }
      incoming_embedding = await azureEmbed(
        store.azure_endpoint,
        store.azure_deployment,
        store.azureKeyPlaintext,
        plainText,
      );
    } catch (err) {
      // Constraint #10 — fall back to tfidf, never fail the job.
      useTfidf = true;
      warning = `azure embedding failed, fell back to tfidf: ${(err as Error).message}`;
    }
  }

  let bestScore = -1;
  let bestDoc: TrackedDoc | null = null;
  let method: SimMethod;
  let incoming_tfidf: Record<string, number> | null = null;

  if (!useTfidf && incoming_embedding) {
    method = "embedding";
    for (const d of docs) {
      if (!d.embedding) continue;
      const s = vectorCosine(incoming_embedding, d.embedding);
      if (s > bestScore) {
        bestScore = s;
        bestDoc = d;
      }
    }
  } else {
    method = "tfidf";
    incoming_tfidf = termFreq(plainText);
    const corpus = docs
      .map((d) => d.tfidf_vector)
      .filter((v): v is Record<string, number> => !!v);
    const idf = buildIdf([incoming_tfidf, ...corpus]);
    for (const d of docs) {
      if (!d.tfidf_vector) continue;
      const s = tfidfCosine(incoming_tfidf, d.tfidf_vector, idf);
      if (s > bestScore) {
        bestScore = s;
        bestDoc = d;
      }
    }
  }

  // No comparable docs → add (and persist the incoming vectors).
  if (!bestDoc || bestScore < 0) {
    return { ...base, incoming_embedding, incoming_tfidf, warning };
  }

  let decision: Decision;
  if (bestScore >= SIM_REPLACE) decision = "replace";
  else if (bestScore >= SIM_HOLD) decision = "hold";
  else decision = "add";

  return {
    ...base,
    decision,
    similarity_score: bestScore,
    similarity_method: method,
    matched_document_id: decision === "add" ? null : bestDoc.id,
    incoming_embedding,
    incoming_tfidf,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Cognigy KAI REST helpers. All calls use X-API-Key and the proven
// /v2.0/knowledgestores base (matches the knowledge-upload function).
// ---------------------------------------------------------------------------
export interface CognigyCtx {
  key: string;
  baseUrl: string;
}

// Cognigy ingestion task statuses. Anything not explicitly "done" or "failed"
// is treated as still-in-progress so we keep polling rather than erroring.
const TASK_DONE = new Set(["done", "ready", "completed", "complete", "success", "finished"]);
const TASK_FAILED = new Set(["error", "failed", "failure", "cancelled", "canceled"]);

// Decide how to present the upload to Cognigy. We only ever have plain text:
// .ctxt is kept as Cognigy Text (fileType 'ctxt'), .txt as text, and everything
// else (pdf/docx/odt — we already extracted the text) is sent as a .txt file.
// fileType MUST match the filename extension or Cognigy fails to ingest.
export function uploadMeta(filename: string): { fileType: string; name: string } {
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (ext === "ctxt") return { fileType: "ctxt", name: filename };
  if (ext === "txt") return { fileType: "txt", name: filename };
  const base = filename.replace(/\.[^.]+$/, "") || "document";
  return { fileType: "txt", name: `${base}.txt` };
}

export async function kaiUploadSource(
  ctx: CognigyCtx,
  storeId: string,
  filename: string,
  content: Uint8Array,
): Promise<string | null> {
  const url = new URL(
    `/v2.0/knowledgestores/${storeId}/sources/upload`,
    ctx.baseUrl,
  ).toString();
  const { fileType, name } = uploadMeta(filename);
  const form = new FormData();
  // Upload the exact bytes — never reconstructed text — so .ctxt structure is
  // preserved and Cognigy accepts it.
  form.append(
    "file",
    new Blob([content], { type: "application/octet-stream" }),
    name,
  );
  form.append("fileType", fileType);
  form.append("sourceType", "file");
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "X-API-Key": ctx.key },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`cognigy upload ${res.status}: ${text.slice(0, 500)}`);
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch { /* empty 2xx body */ }
  // Some deployments return the new source id, some a task id.
  return (parsed._id ?? parsed.taskId ?? parsed.sourceId ?? null) as string | null;
}

export async function kaiDeleteSource(
  ctx: CognigyCtx,
  storeId: string,
  sourceId: string,
): Promise<void> {
  const url = new URL(
    `/v2.0/knowledgestores/${storeId}/sources/${sourceId}`,
    ctx.baseUrl,
  ).toString();
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Accept: "application/json", "X-API-Key": ctx.key },
  });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`cognigy delete ${res.status}: ${t.slice(0, 500)}`);
  }
}

export async function kaiListSources(
  ctx: CognigyCtx,
  storeId: string,
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(
    `/v2.0/knowledgestores/${storeId}/sources`,
    ctx.baseUrl,
  );
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-API-Key": ctx.key },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`cognigy list sources ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  const list = data?.items ?? data?._embedded?.sources ?? data ?? [];
  return Array.isArray(list) ? list : [];
}

// Poll a Cognigy ingestion task until done/error, mirroring snapshot-worker's
// 2.5s cadence. Best-effort: a missing/unknown task id resolves quietly.
export async function kaiPollTask(
  ctx: CognigyCtx,
  taskId: string | null,
  maxMs = 60000,
): Promise<void> {
  if (!taskId) return;
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    let task: Record<string, unknown> | null = null;
    try {
      const url = new URL(`/new/v2.0/tasks/${taskId}`, ctx.baseUrl).toString();
      const res = await fetch(url, {
        headers: { Accept: "application/json", "X-API-Key": ctx.key },
      });
      // Not a task id (the upload returned a source id), or no task endpoint —
      // nothing to poll; the upload already succeeded.
      if (res.status === 404) return;
      if (res.ok) task = await res.json();
    } catch { /* transient — retry */ }

    const status = String(task?.status ?? "").toLowerCase();
    if (!status) return;                      // unrecognised shape — don't block the add
    if (TASK_DONE.has(status)) return;        // ingestion finished
    if (TASK_FAILED.has(status)) {            // genuine failure
      throw new Error(`cognigy ingestion ${status}: ${task?.failReason ?? "unknown"}`);
    }
    // Any other status (active / running / queued / processing / …) → keep waiting.
    await new Promise((r) => setTimeout(r, 2500));
  }
  // Timed out while still ingesting — the source is uploaded and Cognigy keeps
  // processing server-side, so we don't treat this as a failure.
}

// ---------------------------------------------------------------------------
// Backup-before-delete invariant.
// Writes a confirmed kai_document_backups row (and Storage object) for the doc
// being replaced. Throws if the backup cannot be confirmed — caller MUST abort
// the DELETE on throw.
// ---------------------------------------------------------------------------
export async function backupDocument(
  admin: SupabaseClient,
  userId: string,
  storeId: string,
  doc: {
    id: string;
    cognigy_source_id: string | null;
    original_filename: string | null;
    backup_storage_path: string | null;
    original_binary_available: boolean;
  },
  syncEventId: string | null,
  tsLabel: string,
): Promise<string> {
  const filename = doc.original_filename ?? "document.txt";
  let storagePath: string;
  let sizeBytes = 0;
  let binaryAvailable = doc.original_binary_available && !!doc.backup_storage_path;

  if (doc.backup_storage_path) {
    // We retained a copy when this doc was added/replaced. Re-store it under a
    // timestamped backup path so the live copy and the backup are independent.
    const { data: blob, error: dlErr } = await admin.storage
      .from(BACKUPS_BUCKET)
      .download(doc.backup_storage_path);
    if (dlErr || !blob) {
      throw new Error(
        `backup aborted: cannot read retained copy (${dlErr?.message ?? "missing"})`,
      );
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    sizeBytes = bytes.byteLength;
    storagePath = `${storeId}/${doc.id}/${tsLabel}_${filename}`;
    const { error: upErr } = await admin.storage
      .from(BACKUPS_BUCKET)
      .upload(storagePath, bytes, {
        contentType: "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw new Error(`backup aborted: storage upload failed (${upErr.message})`);
    binaryAvailable = true;
  } else {
    // Pre-existing Cognigy source we never uploaded — no original bytes exist.
    // Record an honest metadata-only backup so the invariant ("confirmed backup
    // row before delete") still holds, flagged as binary-unavailable.
    const note = JSON.stringify({
      note: "Original file binary not available — source pre-existed in Cognigy and was never uploaded through KAI Connector.",
      cognigy_source_id: doc.cognigy_source_id,
      original_filename: doc.original_filename,
      backed_up_at: tsLabel,
    });
    storagePath = `${storeId}/${doc.id}/${tsLabel}_metadata.json`;
    const bytes = new TextEncoder().encode(note);
    sizeBytes = bytes.byteLength;
    const { error: upErr } = await admin.storage
      .from(BACKUPS_BUCKET)
      .upload(storagePath, bytes, { contentType: "application/json", upsert: false });
    if (upErr) throw new Error(`backup aborted: storage upload failed (${upErr.message})`);
    binaryAvailable = false;
  }

  const { error: insErr } = await admin.from("kai_document_backups").insert({
    user_id: userId,
    store_id: storeId,
    document_id: doc.id,
    sync_event_id: syncEventId,
    original_filename: filename,
    file_size_bytes: sizeBytes,
    storage_path: storagePath,
    cognigy_source_id: doc.cognigy_source_id,
    original_binary_available: binaryAvailable,
  });
  if (insErr) {
    // Roll back the orphaned object so we don't leave a half-backup.
    await admin.storage.from(BACKUPS_BUCKET).remove([storagePath]);
    throw new Error(`backup aborted: backup row insert failed (${insErr.message})`);
  }
  return storagePath;
}

// Store the freshly-uploaded file as our retained copy (so future replaces of
// this doc always have bytes to back up). Returns the storage path or null.
export async function retainCopy(
  admin: SupabaseClient,
  storeId: string,
  documentId: string,
  filename: string,
  content: Uint8Array,
  tsLabel: string,
): Promise<string | null> {
  const path = `${storeId}/${documentId}/current_${tsLabel}_${filename}`;
  const { error } = await admin.storage
    .from(BACKUPS_BUCKET)
    .upload(path, content, { contentType: "application/octet-stream", upsert: true });
  if (error) return null;
  return path;
}

// Build a service-role admin client. Shared so both functions construct it
// identically.
export function makeAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// A timestamp label safe for storage paths (no colons).
export function tsLabel(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Decode the base64 plain-text payload the frontend sends.
export function decodeBase64Text(b64: string): string {
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return atob(b64);
  }
}

// Base64 <-> raw bytes. Uploads send the EXACT original file bytes (not
// reconstructed text), so format-sensitive files like .ctxt reach Cognigy
// byte-identical to the source.
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Compute hash/title/vectors for a doc, honouring the store's embedding mode
// with the same azure→tfidf fallback as the main pipeline.
export async function computeVectors(
  plainText: string,
  filename: string,
  store: StoreConfig,
): Promise<{
  hash: string;
  title: string;
  embedding: number[] | null;
  tfidf: Record<string, number> | null;
  warning: string | null;
}> {
  const hash = md5(plainText);
  const title = extractTitle(plainText, filename);
  let embedding: number[] | null = null;
  let tfidf: Record<string, number> | null = null;
  let warning: string | null = null;

  if (store.embedding_mode === "azure_openai") {
    try {
      if (!store.azure_endpoint || !store.azure_deployment || !store.azureKeyPlaintext) {
        throw new Error("azure embedding config incomplete");
      }
      embedding = await azureEmbed(
        store.azure_endpoint,
        store.azure_deployment,
        store.azureKeyPlaintext,
        plainText,
      );
    } catch (err) {
      warning = `azure embedding failed, fell back to tfidf: ${(err as Error).message}`;
      tfidf = termFreq(plainText);
    }
  } else {
    tfidf = termFreq(plainText);
  }
  return { hash, title, embedding, tfidf, warning };
}

// Resolve the real Cognigy source id for a just-uploaded file by matching the
// newest source whose name equals the uploaded filename. Falls back to the id
// returned by the upload call.
export async function resolveSourceId(
  ctx: CognigyCtx,
  storeId: string,
  uploadedName: string,
  fallback: string | null,
): Promise<string | null> {
  try {
    const sources = await kaiListSources(ctx, storeId);
    const matches = sources.filter(
      (s) => String((s as Record<string, unknown>).name ?? "") === uploadedName,
    );
    if (matches.length > 0) {
      const last = matches[matches.length - 1] as Record<string, unknown>;
      return String(last._id ?? last.id ?? fallback ?? "") || fallback;
    }
  } catch { /* listing best-effort; fall back below */ }
  return fallback;
}

export interface StoreRow {
  id: string;
  user_id: string;
  cognigy_store_id: string;
  embedding_mode: "azure_openai" | "tfidf";
  azure_endpoint: string | null;
  azure_deployment: string | null;
}

export interface IncomingDoc {
  filename: string;
  // base64 of the EXACT bytes to upload to Cognigy (raw .ctxt/.txt, or extracted
  // text for pdf/docx). Text for evaluation is decoded from these bytes.
  contentBase64: string;
  trigger: "manual_upload" | "nightly_job" | "manual_restore";
  externalId?: string | null;
}

export interface ProcessOutcome {
  event_id: string;
  decision: Decision;
  similarity_score: number | null;
  similarity_method: SimMethod | null;
  matched_document_id: string | null;
  document_id: string | null;
  status: "done" | "failed";
  warning: string | null;
  error: string | null;
}

// Dry-run: compute the decision for an incoming doc WITHOUT writing anything or
// touching Cognigy. Used by the worker's dry_run mode so you can preview the
// add/replace/skip/hold decisions safely before any mutation.
export async function evaluateOnly(
  admin: SupabaseClient,
  store: StoreRow,
  azureKeyPlaintext: string | null,
  incoming: IncomingDoc,
): Promise<{
  filename: string;
  decision: Decision;
  similarity_score: number | null;
  similarity_method: SimMethod | null;
  matched_document_id: string | null;
  warning: string | null;
}> {
  const plainText = new TextDecoder().decode(base64ToBytes(incoming.contentBase64));
  const { data: docRows } = await admin
    .from("kai_documents")
    .select("id, title, content_hash, embedding, tfidf_vector")
    .eq("store_id", store.id);
  const docs: TrackedDoc[] = (docRows ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    content_hash: d.content_hash,
    embedding: d.embedding ?? null,
    tfidf_vector: d.tfidf_vector ?? null,
  }));
  const result = await evaluate(plainText, incoming.filename, docs, {
    embedding_mode: store.embedding_mode,
    azure_endpoint: store.azure_endpoint,
    azure_deployment: store.azure_deployment,
    azureKeyPlaintext,
  });
  return {
    filename: incoming.filename,
    decision: result.decision,
    similarity_score: result.similarity_score,
    similarity_method: result.similarity_method,
    matched_document_id: result.matched_document_id,
    warning: result.warning,
  };
}

// The single pipeline both kai-evaluator and kai-sync-worker run per document:
// evaluate → log → act (with the backup-before-delete invariant on REPLACE).
export async function processIncoming(
  admin: SupabaseClient,
  ctx: CognigyCtx,
  store: StoreRow,
  azureKeyPlaintext: string | null,
  incoming: IncomingDoc,
): Promise<ProcessOutcome> {
  const { filename, contentBase64, trigger } = incoming;
  const contentBytes = base64ToBytes(contentBase64);
  const plainText = new TextDecoder().decode(contentBytes);
  const label = tsLabel();

  // Open an audit event (running).
  const { data: evRow, error: evErr } = await admin
    .from("kai_sync_events")
    .insert({
      user_id: store.user_id,
      store_id: store.id,
      trigger,
      incoming_filename: filename,
      status: "running",
    })
    .select("id")
    .single();
  if (evErr || !evRow) {
    throw new Error(`failed to open sync event: ${evErr?.message}`);
  }
  const eventId = evRow.id as string;

  const fail = async (msg: string): Promise<ProcessOutcome> => {
    await admin
      .from("kai_sync_events")
      .update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() })
      .eq("id", eventId);
    return {
      event_id: eventId,
      decision: "skip",
      similarity_score: null,
      similarity_method: null,
      matched_document_id: null,
      document_id: null,
      status: "failed",
      warning: null,
      error: msg,
    };
  };

  try {
    // Load the tracked corpus for this store.
    const { data: docRows, error: docErr } = await admin
      .from("kai_documents")
      .select("id, title, content_hash, embedding, tfidf_vector")
      .eq("store_id", store.id);
    if (docErr) return await fail(`load docs: ${docErr.message}`);

    const docs: TrackedDoc[] = (docRows ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      content_hash: d.content_hash,
      embedding: d.embedding ?? null,
      tfidf_vector: d.tfidf_vector ?? null,
    }));

    const result = await evaluate(plainText, filename, docs, {
      embedding_mode: store.embedding_mode,
      azure_endpoint: store.azure_endpoint,
      azure_deployment: store.azure_deployment,
      azureKeyPlaintext,
    });

    const baseEvent = {
      decision: result.decision,
      similarity_score: result.similarity_score,
      similarity_method: result.similarity_method,
      matched_document_id: result.matched_document_id,
      warning: result.warning,
    };

    // ---- SKIP ----------------------------------------------------------
    if (result.decision === "skip") {
      await admin
        .from("kai_sync_events")
        .update({ ...baseEvent, status: "done", document_id: result.matched_document_id, completed_at: new Date().toISOString() })
        .eq("id", eventId);
      return {
        event_id: eventId,
        ...baseEvent,
        document_id: result.matched_document_id,
        status: "done",
        error: null,
      };
    }

    // ---- HOLD ----------------------------------------------------------
    if (result.decision === "hold") {
      await admin
        .from("kai_sync_events")
        .update({
          ...baseEvent,
          status: "done",
          incoming_content_base64: contentBase64,
          completed_at: new Date().toISOString(),
        })
        .eq("id", eventId);
      return {
        event_id: eventId,
        ...baseEvent,
        document_id: null,
        status: "done",
        error: null,
      };
    }

    const uploadName = uploadMeta(filename).name;

    // ---- REPLACE -------------------------------------------------------
    if (result.decision === "replace" && result.matched_document_id) {
      const { data: matched, error: mErr } = await admin
        .from("kai_documents")
        .select("id, cognigy_source_id, original_filename, backup_storage_path, original_binary_available")
        .eq("id", result.matched_document_id)
        .single();
      if (mErr || !matched) return await fail(`replace: matched doc not found`);

      // HARD INVARIANT: confirmed backup BEFORE any Cognigy DELETE.
      await backupDocument(admin, store.user_id, store.id, matched, eventId, label);

      if (matched.cognigy_source_id) {
        await kaiDeleteSource(ctx, store.cognigy_store_id, matched.cognigy_source_id);
      }
      const newId = await kaiUploadSource(ctx, store.cognigy_store_id, filename, contentBytes);
      await kaiPollTask(ctx, newId, 60000);
      const sourceId = await resolveSourceId(ctx, store.cognigy_store_id, uploadName, newId);
      const retained = await retainCopy(admin, store.id, matched.id, uploadName, contentBytes, label);

      await admin
        .from("kai_documents")
        .update({
          cognigy_source_id: sourceId,
          original_filename: filename,
          title: result.incoming_title,
          content_hash: result.incoming_hash,
          embedding: result.incoming_embedding,
          tfidf_vector: result.incoming_tfidf,
          backup_storage_path: retained,
          original_binary_available: true,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", matched.id);

      await admin
        .from("kai_sync_events")
        .update({ ...baseEvent, status: "done", document_id: matched.id, completed_at: new Date().toISOString() })
        .eq("id", eventId);

      return {
        event_id: eventId,
        ...baseEvent,
        document_id: matched.id,
        status: "done",
        error: null,
      };
    }

    // ---- ADD -----------------------------------------------------------
    const newId = await kaiUploadSource(ctx, store.cognigy_store_id, filename, contentBytes);
    await kaiPollTask(ctx, newId, 60000);
    const sourceId = await resolveSourceId(ctx, store.cognigy_store_id, uploadName, newId);

    const { data: insertedDoc, error: insErr } = await admin
      .from("kai_documents")
      .insert({
        user_id: store.user_id,
        store_id: store.id,
        cognigy_source_id: sourceId,
        external_id: incoming.externalId ?? null,
        original_filename: filename,
        title: result.incoming_title,
        content_hash: result.incoming_hash,
        embedding: result.incoming_embedding,
        tfidf_vector: result.incoming_tfidf,
        original_binary_available: true,
        last_synced_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr || !insertedDoc) return await fail(`add: doc insert failed (${insErr?.message})`);

    const retained = await retainCopy(admin, store.id, insertedDoc.id, uploadName, contentBytes, label);
    if (retained) {
      await admin.from("kai_documents").update({ backup_storage_path: retained }).eq("id", insertedDoc.id);
    }

    await admin
      .from("kai_sync_events")
      .update({ ...baseEvent, decision: "add", matched_document_id: null, status: "done", document_id: insertedDoc.id, completed_at: new Date().toISOString() })
      .eq("id", eventId);

    return {
      event_id: eventId,
      ...baseEvent,
      decision: "add",
      matched_document_id: null,
      document_id: insertedDoc.id,
      status: "done",
      error: null,
    };
  } catch (err) {
    return await fail((err as Error).message);
  }
}
