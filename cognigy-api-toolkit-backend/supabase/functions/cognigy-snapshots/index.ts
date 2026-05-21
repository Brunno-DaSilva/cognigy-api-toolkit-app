// cognigy-snapshots
// UI-facing actions for snapshot management. Long-running jobs (create / promote)
// go through snapshot-worker; this function handles the synchronous primitives.
//
// Actions (POST body { action, ... }):
//
//   list_remote          { api_key_id, cognigy_project_id }
//     -> Lists snapshots that currently exist in Cognigy for a project.
//        Used to verify our DB state matches Cognigy.
//
//   sign_download        { snapshot_id }
//     -> Returns a 5-minute signed URL the browser can use to download the
//        .csnap from Supabase Storage. Ownership enforced via RLS on snapshots.
//
//   delete_from_store    { snapshot_id }
//     -> Deletes an archived snapshot row + its .csnap from Storage.
//        Refuses to delete 'current' snapshots (they must be evicted to archived
//        by the create flow first).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cognigy API paths — adjust if your installation uses a different prefix.
// The existing useFetchLogs hook uses /new/v2.0/... so we match that convention.
const COGNIGY_SNAPSHOTS_PATH = "/new/v2.0/snapshots";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

    const payload = await req.json();
    const action = payload?.action;
    if (!action) return json({ error: "action is required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (action) {
      case "list_remote":
        return await listRemote(userClient, admin, payload);
      case "sign_download":
        return await signDownload(userClient, admin, payload);
      case "delete_from_store":
        return await deleteFromStore(userClient, admin, payload);
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// list_remote — proxy GET /v2.0/snapshots?projectId=X
// ---------------------------------------------------------------------------
async function listRemote(userClient: any, admin: any, p: any) {
  const { api_key_id, cognigy_project_id } = p;
  if (!api_key_id || !cognigy_project_id) {
    return json({ error: "api_key_id and cognigy_project_id required" }, 400);
  }

  // ownership via RLS
  const { data: ownership, error: ownErr } = await userClient
    .from("api_keys")
    .select("id")
    .eq("id", api_key_id)
    .maybeSingle();
  if (ownErr || !ownership) return json({ error: "api key not found" }, 404);

  const { data: keyRows, error: keyErr } = await admin.rpc(
    "get_api_key_plaintext",
    { p_api_key_id: api_key_id },
  );
  if (keyErr || !keyRows?.length) return json({ error: "decrypt failed" }, 500);
  const { key_plaintext, base_url } = keyRows[0];

  const url = new URL(COGNIGY_SNAPSHOTS_PATH, base_url);
  url.searchParams.set("projectId", cognigy_project_id);
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-API-Key": key_plaintext,
    },
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// sign_download — signed URL for .csnap in Storage
// ---------------------------------------------------------------------------
async function signDownload(userClient: any, admin: any, p: any) {
  const { snapshot_id } = p;
  if (!snapshot_id) return json({ error: "snapshot_id required" }, 400);

  const { data: snap, error: snapErr } = await userClient
    .from("snapshots")
    .select("id, storage_path, name")
    .eq("id", snapshot_id)
    .maybeSingle();
  if (snapErr || !snap) return json({ error: "snapshot not found" }, 404);

  const { data, error } = await admin.storage
    .from("snapshots")
    .createSignedUrl(snap.storage_path, 60 * 5);
  if (error) return json({ error: error.message }, 500);

  // Sanitize filename — keep alnum/dash/underscore/dot only.
  const safeName = String(snap.name).replace(/[^\w.-]+/g, "_");
  return json({ url: data.signedUrl, filename: `${safeName}.csnap` });
}

// ---------------------------------------------------------------------------
// delete_from_store — archived snapshots only
// Removes Storage object first; only then removes the DB row. This way a
// failure leaves the row pointing at a real file rather than an orphaned row.
// ---------------------------------------------------------------------------
async function deleteFromStore(userClient: any, admin: any, p: any) {
  const { snapshot_id } = p;
  if (!snapshot_id) return json({ error: "snapshot_id required" }, 400);

  const { data: snap, error: snapErr } = await userClient
    .from("snapshots")
    .select("id, status, storage_path")
    .eq("id", snapshot_id)
    .maybeSingle();
  if (snapErr || !snap) return json({ error: "snapshot not found" }, 404);

  if (snap.status !== "archived") {
    return json(
      { error: "only archived snapshots can be deleted from the store" },
      400,
    );
  }

  const { error: stErr } = await admin.storage
    .from("snapshots")
    .remove([snap.storage_path]);
  if (stErr) return json({ error: `storage delete failed: ${stErr.message}` }, 500);

  const { error: delErr } = await userClient
    .from("snapshots")
    .delete()
    .eq("id", snapshot_id);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ ok: true });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
