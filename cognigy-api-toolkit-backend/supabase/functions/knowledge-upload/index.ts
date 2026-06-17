// knowledge-upload
// Uploads a single document into a Cognigy Knowledge Store so the raw API key
// never touches the browser. Mirrors cognigy-proxy's auth + decrypt gate, but
// speaks multipart/form-data (cognigy-proxy is JSON-only) because the Cognigy
// `sources/upload` endpoint expects a file part.
//
// The browser drives the batch / throttle / retry loop and calls this function
// once per file per attempt — keeping each invocation short and well under the
// Edge Function execution limit. Listing + creating knowledge stores are JSON
// calls and go through cognigy-proxy instead.
//
// Request (POST, multipart/form-data):
//   file                — the document blob (.ctxt | .txt | .pdf)
//   api_key_id          — uuid of the api_keys row to use
//   project_id          — uuid of the projects row (for decrypt RPC + RLS)
//   knowledge_store_id  — 24-char Cognigy knowledge store id
//   file_type           — "ctxt" | "txt" | "pdf"
//
// Response:
//   200 { ok: true, taskId, status }
//   4xx/5xx { error, upstream_status?, upstream_body? }
//
// Auth: caller must send Authorization: Bearer <Supabase user JWT>. Ownership of
// the api_key is enforced via RLS before decrypting with service_role.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mirror of the client-side accept list. fileType is what Cognigy keys the
// parser off — it must match the actual file or the upload silently fails.
const ALLOWED_FILE_TYPES = new Set(["ctxt", "txt", "pdf"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

    const form = await req.formData();
    const file = form.get("file");
    const apiKeyId = form.get("api_key_id")?.toString();
    const projectId = form.get("project_id")?.toString() || null;
    const knowledgeStoreId = form.get("knowledge_store_id")?.toString();
    const fileType = form.get("file_type")?.toString();

    if (!(file instanceof File)) {
      return json({ error: "file is required" }, 400);
    }
    if (!apiKeyId || !knowledgeStoreId || !fileType) {
      return json(
        { error: "api_key_id, knowledge_store_id and file_type are required" },
        400,
      );
    }
    if (!ALLOWED_FILE_TYPES.has(fileType)) {
      return json(
        { error: `unsupported file_type '${fileType}' (allowed: ctxt, txt, pdf)` },
        400,
      );
    }

    // Verify ownership via RLS (user's JWT) — same gate as cognigy-proxy.
    const { data: ownership, error: ownErr } = await userClient
      .from("api_keys")
      .select("id")
      .eq("id", apiKeyId)
      .maybeSingle();
    if (ownErr || !ownership) {
      return json({ error: "api key not found" }, 404);
    }

    // Decrypt via service_role. The encryption key lives in Supabase Vault; the
    // RPC reads it server-side — no key travels over the wire.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: keyRows, error: keyErr } = await admin.rpc(
      "get_api_key_plaintext",
      { p_api_key_id: apiKeyId, p_project_id: projectId },
    );
    if (keyErr || !keyRows || keyRows.length === 0) {
      return json({ error: "decrypt failed" }, 500);
    }
    const { key_plaintext, base_url } = keyRows[0];

    // Rebuild the multipart body for Cognigy. We don't set Content-Type — fetch
    // derives the multipart boundary from the FormData instance.
    const uploadUrl = new URL(
      `/v2.0/knowledgestores/${knowledgeStoreId}/sources/upload`,
      base_url,
    ).toString();

    const outbound = new FormData();
    outbound.append("file", file, file.name);
    outbound.append("fileType", fileType);
    outbound.append("sourceType", "file");

    const cognigyRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-API-Key": key_plaintext,
      },
      body: outbound,
    });

    const responseText = await cognigyRes.text();

    if (!cognigyRes.ok) {
      return json(
        {
          error: `Cognigy ${cognigyRes.status}`,
          upstream_status: cognigyRes.status,
          upstream_body: responseText.slice(0, 1000),
        },
        cognigyRes.status,
      );
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Some deployments return an empty 2xx body — treat as success.
    }

    return json({
      ok: true,
      taskId: parsed._id ?? null,
      status: parsed.status ?? "queued",
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
