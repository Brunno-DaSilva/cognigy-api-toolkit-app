// kai-sync-worker — nightly KAI sync job.
//
// For every kai_stores row with nightly_sync_enabled = true, fetch the
// customer's source-system document list (the baseline connector contract),
// pull each document's content, and run it through the SAME pipeline as
// kai-evaluator (processIncoming). Decisions are logged to kai_sync_events.
//
// Two invocation modes:
//   - User JWT (the "Run Now" button): processes the calling user's stores
//     (optionally a single store_id).
//   - Service-role bearer (Supabase cron / external trigger): processes all
//     nightly-enabled stores across users.
//
// Connector contract expected from the customer source system:
//   GET {source_api_url}/documents
//     -> { documents: [{ id, title, updated_at, content_url }] }
//   GET {content_url}  -> plain text

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  bytesToBase64,
  CognigyCtx,
  corsHeaders,
  evaluateOnly,
  json,
  makeAdmin,
  processIncoming,
  StoreRow,
} from "../_shared/kai-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_DOCS_PER_STORE = 500;

interface StoreSummary {
  store_id: string;
  dry_run: boolean;
  evaluated: number;
  add: number;
  replace: number;
  hold: number;
  skip: number;
  failed: number;
  errors: string[];
  decisions: Array<{ filename: string; decision: string }>;
  truncated: boolean;
}

async function decryptKey(
  admin: SupabaseClient,
  apiKeyId: string | null,
  projectId: string | null,
): Promise<{ key: string; baseUrl: string } | null> {
  if (!apiKeyId) return null;
  const { data, error } = await admin.rpc("get_api_key_plaintext", {
    p_api_key_id: apiKeyId,
    p_project_id: projectId,
  });
  if (error || !data || data.length === 0) return null;
  return { key: data[0].key_plaintext, baseUrl: data[0].base_url };
}

async function processStore(
  admin: SupabaseClient,
  store: Record<string, unknown>,
  dryRun: boolean,
): Promise<StoreSummary> {
  const summary: StoreSummary = {
    store_id: store.id as string,
    dry_run: dryRun,
    evaluated: 0,
    add: 0,
    replace: 0,
    hold: 0,
    skip: 0,
    failed: 0,
    errors: [],
    decisions: [],
    truncated: false,
  };

  const cognigy = await decryptKey(admin, store.api_key_id as string, store.project_id as string);
  if (!cognigy) {
    summary.errors.push("missing/undecryptable Cognigy API key");
    return summary;
  }
  const ctx: CognigyCtx = { key: cognigy.key, baseUrl: cognigy.baseUrl };

  let azureKey: string | null = null;
  if (store.embedding_mode === "azure_openai" && store.azure_api_key_id) {
    const az = await decryptKey(admin, store.azure_api_key_id as string, store.project_id as string);
    azureKey = az?.key ?? null;
  }

  const sourceUrl = store.source_api_url as string | null;
  if (!sourceUrl) {
    summary.errors.push("no source_api_url configured");
    return summary;
  }
  let sourceKey: string | null = null;
  if (store.source_api_key_id) {
    const sk = await decryptKey(admin, store.source_api_key_id as string, store.project_id as string);
    sourceKey = sk?.key ?? null;
  }
  const sourceHeaders: Record<string, string> = { Accept: "application/json" };
  if (sourceKey) sourceHeaders.Authorization = `Bearer ${sourceKey}`;

  // Fetch the customer's document list.
  let documents: Array<Record<string, unknown>> = [];
  try {
    const listUrl = new URL("documents", sourceUrl.replace(/\/?$/, "/")).toString();
    const res = await fetch(listUrl, { headers: sourceHeaders });
    if (!res.ok) throw new Error(`source list ${res.status}`);
    const data = await res.json();
    documents = Array.isArray(data?.documents) ? data.documents : [];
  } catch (err) {
    summary.errors.push(`source fetch failed: ${(err as Error).message}`);
    return summary;
  }

  if (documents.length > MAX_DOCS_PER_STORE) {
    summary.truncated = true;
    documents = documents.slice(0, MAX_DOCS_PER_STORE);
  }

  const storeRow: StoreRow = {
    id: store.id as string,
    user_id: store.user_id as string,
    cognigy_store_id: store.cognigy_store_id as string,
    embedding_mode: store.embedding_mode as "azure_openai" | "tfidf",
    azure_endpoint: store.azure_endpoint as string | null,
    azure_deployment: store.azure_deployment as string | null,
  };

  for (const doc of documents) {
    const title = String(doc.title ?? doc.id ?? "document");
    const contentUrl = doc.content_url as string | undefined;
    if (!contentUrl) {
      summary.failed++;
      summary.errors.push(`${title}: no content_url`);
      continue;
    }
    try {
      const cRes = await fetch(contentUrl, { headers: sourceHeaders });
      if (!cRes.ok) throw new Error(`content ${cRes.status}`);
      const bytes = new Uint8Array(await cRes.arrayBuffer());
      // Source docs are .ctxt (Cognigy Text); keep the extension so Cognigy
      // parses them correctly.
      const filename = `${title}.ctxt`;
      const incoming = {
        filename,
        contentBase64: bytesToBase64(bytes),
        trigger: "nightly_job" as const,
        externalId: doc.id ? String(doc.id) : null,
      };

      if (dryRun) {
        // Preview only — no Cognigy calls, no DB writes.
        const r = await evaluateOnly(admin, storeRow, azureKey, incoming);
        summary.evaluated++;
        summary[r.decision]++;
        summary.decisions.push({ filename, decision: r.decision });
        continue;
      }

      const outcome = await processIncoming(admin, ctx, storeRow, azureKey, incoming);
      summary.evaluated++;
      if (outcome.status === "failed") {
        summary.failed++;
        if (outcome.error) summary.errors.push(`${title}: ${outcome.error}`);
      } else {
        summary[outcome.decision]++;
        summary.decisions.push({ filename, decision: outcome.decision });
      }
    } catch (err) {
      summary.failed++;
      summary.errors.push(`${title}: ${(err as Error).message}`);
    }
  }

  // Record the run on the store (real runs only — dry-runs never mutate).
  if (!dryRun) {
    await admin
      .from("kai_stores")
      .update({ last_sync_at: new Date().toISOString(), last_sync_summary: summary })
      .eq("id", store.id);
  }

  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = makeAdmin();
    const body = await req.json().catch(() => ({}));
    const storeId: string | null = body.store_id ?? null;
    const dryRun: boolean = body.dry_run === true;

    // Determine scope. A valid user JWT scopes to that user; the service-role
    // key (cron) processes everyone.
    let userId: string | null = null;
    const isServiceRole = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    if (!isServiceRole) {
      if (!authHeader) return json({ error: "missing authorization" }, 401);
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
      userId = userData.user.id;
    }

    // Select stores to process.
    let q = admin.from("kai_stores").select("*").eq("nightly_sync_enabled", true);
    if (storeId) q = admin.from("kai_stores").select("*").eq("id", storeId); // explicit "run now"
    if (userId) q = q.eq("user_id", userId);
    const { data: stores, error: sErr } = await q;
    if (sErr) return json({ error: sErr.message }, 500);

    const summaries: StoreSummary[] = [];
    for (const store of stores ?? []) {
      // Guard: a user can only run their own stores.
      if (userId && store.user_id !== userId) continue;
      summaries.push(await processStore(admin, store, dryRun));
    }

    return json({ ok: true, stores_processed: summaries.length, summaries });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
