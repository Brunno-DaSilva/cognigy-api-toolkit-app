// kai-evaluator — the core of KAI Connector.
//
// Action-dispatched (like cognigy-snapshots). Auth + decrypt gate mirrors
// cognigy-proxy: JWT verify → RLS ownership check (user's JWT) → decrypt the
// Cognigy / Azure keys with service_role via get_api_key_plaintext → outbound
// calls. Raw keys never reach the browser.
//
// Actions:
//   evaluate             { store_id, filename, file_content_base64, trigger }
//   resolve_hold         { event_id, resolution: 'replace'|'add'|'discard' }
//   delete_document      { document_id }
//   sign_backup_download { backup_id }
//   restore_backup       { backup_id }

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  BACKUPS_BUCKET,
  backupDocument,
  base64ToBytes,
  CognigyCtx,
  computeVectors,
  corsHeaders,
  json,
  kaiDeleteSource,
  kaiPollTask,
  kaiUploadSource,
  makeAdmin,
  processIncoming,
  resolveSourceId,
  retainCopy,
  StoreConfig,
  StoreRow,
  tsLabel,
  uploadMeta,
} from "../_shared/kai-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface LoadedStore {
  store: Record<string, unknown>;
  storeRow: StoreRow;
  ctx: CognigyCtx;
  azureKey: string | null;
  storeConfig: StoreConfig;
}

// Verify ownership via the user's JWT, then decrypt the Cognigy + Azure keys
// with service_role. Returns everything needed to talk to Cognigy KAI.
async function loadStore(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  userId: string,
  storeId: string,
): Promise<LoadedStore> {
  const { data: store, error } = await userClient
    .from("kai_stores")
    .select("*")
    .eq("id", storeId)
    .maybeSingle();
  if (error || !store) throw new Error("store not found");
  if (store.user_id !== userId) throw new Error("access denied");
  if (!store.api_key_id) throw new Error("store has no Cognigy API key configured");

  const { data: keyRows, error: keyErr } = await admin.rpc("get_api_key_plaintext", {
    p_api_key_id: store.api_key_id,
    p_project_id: store.project_id,
  });
  if (keyErr || !keyRows || keyRows.length === 0) {
    throw new Error("decrypt failed (Cognigy key)");
  }
  const ctx: CognigyCtx = {
    key: keyRows[0].key_plaintext,
    baseUrl: keyRows[0].base_url,
  };

  let azureKey: string | null = null;
  if (store.embedding_mode === "azure_openai" && store.azure_api_key_id) {
    const { data: az, error: azErr } = await admin.rpc("get_api_key_plaintext", {
      p_api_key_id: store.azure_api_key_id,
      p_project_id: store.project_id,
    });
    if (!azErr && az && az.length > 0) azureKey = az[0].key_plaintext;
  }

  const storeRow: StoreRow = {
    id: store.id,
    user_id: store.user_id,
    cognigy_store_id: store.cognigy_store_id,
    embedding_mode: store.embedding_mode,
    azure_endpoint: store.azure_endpoint,
    azure_deployment: store.azure_deployment,
  };
  const storeConfig: StoreConfig = {
    embedding_mode: store.embedding_mode,
    azure_endpoint: store.azure_endpoint,
    azure_deployment: store.azure_deployment,
    azureKeyPlaintext: azureKey,
  };

  return { store, storeRow, ctx, azureKey, storeConfig };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = makeAdmin();
    const body = await req.json();
    const action = String(body.action ?? "evaluate");

    // ---- evaluate ------------------------------------------------------
    if (action === "evaluate") {
      const { store_id, filename, file_content_base64, trigger } = body;
      if (!store_id || !filename || !file_content_base64) {
        return json({ error: "store_id, filename, file_content_base64 required" }, 400);
      }
      const loaded = await loadStore(admin, userClient, userId, store_id);
      const outcome = await processIncoming(
        admin,
        loaded.ctx,
        loaded.storeRow,
        loaded.azureKey,
        {
          filename: String(filename),
          contentBase64: String(file_content_base64),
          trigger: trigger === "nightly_job" ? "nightly_job" : "manual_upload",
        },
      );
      return json(outcome);
    }

    // ---- resolve_hold --------------------------------------------------
    if (action === "resolve_hold") {
      const { event_id, resolution } = body;
      if (!event_id || !resolution) return json({ error: "event_id, resolution required" }, 400);

      const { data: ev, error: evErr } = await userClient
        .from("kai_sync_events")
        .select("*")
        .eq("id", event_id)
        .maybeSingle();
      if (evErr || !ev) return json({ error: "event not found" }, 404);
      if (ev.user_id !== userId) return json({ error: "access denied" }, 403);

      if (resolution === "discard") {
        await admin.from("kai_sync_events").delete().eq("id", event_id);
        return json({ ok: true, resolution: "discard" });
      }
      if (!ev.incoming_content_base64) {
        return json({ error: "no staged content for this hold" }, 400);
      }

      const loaded = await loadStore(admin, userClient, userId, ev.store_id);
      const contentBytes = base64ToBytes(ev.incoming_content_base64);
      const plainText = new TextDecoder().decode(contentBytes);
      const filename = ev.incoming_filename ?? "document.txt";
      const label = tsLabel();
      const uploadName = uploadMeta(filename).name;
      const v = await computeVectors(plainText, filename, loaded.storeConfig);

      if (resolution === "replace") {
        if (!ev.matched_document_id) return json({ error: "no matched document to replace" }, 400);
        const { data: matched, error: mErr } = await admin
          .from("kai_documents")
          .select("id, cognigy_source_id, original_filename, backup_storage_path, original_binary_available")
          .eq("id", ev.matched_document_id)
          .single();
        if (mErr || !matched) return json({ error: "matched document not found" }, 404);

        await backupDocument(admin, userId, ev.store_id, matched, event_id, label);
        if (matched.cognigy_source_id) {
          await kaiDeleteSource(loaded.ctx, loaded.storeRow.cognigy_store_id, matched.cognigy_source_id);
        }
        const upId = await kaiUploadSource(loaded.ctx, loaded.storeRow.cognigy_store_id, filename, contentBytes);
        await kaiPollTask(loaded.ctx, upId, 60000);
        const sourceId = await resolveSourceId(loaded.ctx, loaded.storeRow.cognigy_store_id, uploadName, upId);
        await admin.from("kai_documents").update({
          cognigy_source_id: sourceId,
          original_filename: filename,
          title: v.title,
          content_hash: v.hash,
          embedding: v.embedding,
          tfidf_vector: v.tfidf,
          original_binary_available: true,
          last_synced_at: new Date().toISOString(),
        }).eq("id", matched.id);

        await admin.from("kai_sync_events").update({
          decision: "replace",
          status: "done",
          document_id: matched.id,
          warning: v.warning,
          completed_at: new Date().toISOString(),
        }).eq("id", event_id);
        return json({ ok: true, resolution: "replace", document_id: matched.id });
      }

      // resolution === 'add'
      const upId = await kaiUploadSource(loaded.ctx, loaded.storeRow.cognigy_store_id, filename, contentBytes);
      await kaiPollTask(loaded.ctx, upId, 60000);
      const sourceId = await resolveSourceId(loaded.ctx, loaded.storeRow.cognigy_store_id, uploadName, upId);
      const { data: doc, error: insErr } = await admin.from("kai_documents").insert({
        user_id: userId,
        store_id: ev.store_id,
        cognigy_source_id: sourceId,
        original_filename: filename,
        title: v.title,
        content_hash: v.hash,
        embedding: v.embedding,
        tfidf_vector: v.tfidf,
        original_binary_available: true,
        last_synced_at: new Date().toISOString(),
      }).select("id").single();
      if (insErr || !doc) return json({ error: `doc insert failed: ${insErr?.message}` }, 500);

      await admin.from("kai_sync_events").update({
        decision: "add",
        matched_document_id: null,
        status: "done",
        document_id: doc.id,
        warning: v.warning,
        completed_at: new Date().toISOString(),
      }).eq("id", event_id);
      return json({ ok: true, resolution: "add", document_id: doc.id });
    }

    // ---- delete_document ----------------------------------------------
    if (action === "delete_document") {
      const { document_id } = body;
      if (!document_id) return json({ error: "document_id required" }, 400);

      const { data: doc, error: dErr } = await userClient
        .from("kai_documents")
        .select("*")
        .eq("id", document_id)
        .maybeSingle();
      if (dErr || !doc) return json({ error: "document not found" }, 404);
      if (doc.user_id !== userId) return json({ error: "access denied" }, 403);

      const loaded = await loadStore(admin, userClient, userId, doc.store_id);
      // Back up before delete (same invariant), then drop from Cognigy + index.
      await backupDocument(admin, userId, doc.store_id, doc, null, tsLabel());
      if (doc.cognigy_source_id) {
        await kaiDeleteSource(loaded.ctx, loaded.storeRow.cognigy_store_id, doc.cognigy_source_id);
      }
      await admin.from("kai_documents").delete().eq("id", document_id);
      return json({ ok: true, deleted: document_id });
    }

    // ---- sign_backup_download -----------------------------------------
    if (action === "sign_backup_download") {
      const { backup_id } = body;
      if (!backup_id) return json({ error: "backup_id required" }, 400);
      const { data: bk, error: bErr } = await userClient
        .from("kai_document_backups")
        .select("*")
        .eq("id", backup_id)
        .maybeSingle();
      if (bErr || !bk) return json({ error: "backup not found" }, 404);
      if (bk.user_id !== userId) return json({ error: "access denied" }, 403);

      const { data: signed, error: sErr } = await admin.storage
        .from(BACKUPS_BUCKET)
        .createSignedUrl(bk.storage_path, 300);
      if (sErr || !signed) return json({ error: sErr?.message ?? "sign failed" }, 500);
      return json({ url: signed.signedUrl, filename: bk.original_filename ?? "backup" });
    }

    // ---- restore_backup -----------------------------------------------
    if (action === "restore_backup") {
      const { backup_id } = body;
      if (!backup_id) return json({ error: "backup_id required" }, 400);
      const { data: bk, error: bErr } = await userClient
        .from("kai_document_backups")
        .select("*")
        .eq("id", backup_id)
        .maybeSingle();
      if (bErr || !bk) return json({ error: "backup not found" }, 404);
      if (bk.user_id !== userId) return json({ error: "access denied" }, 403);
      if (!bk.original_binary_available) {
        return json({ error: "this backup has no original file to restore" }, 400);
      }

      const loaded = await loadStore(admin, userClient, userId, bk.store_id);
      const { data: blob, error: dlErr } = await admin.storage
        .from(BACKUPS_BUCKET)
        .download(bk.storage_path);
      if (dlErr || !blob) return json({ error: `download failed: ${dlErr?.message}` }, 500);
      const contentBytes = new Uint8Array(await blob.arrayBuffer());
      const plainText = new TextDecoder().decode(contentBytes);
      const filename = bk.original_filename ?? "restored.txt";
      const label = tsLabel();
      const uploadName = uploadMeta(filename).name;
      const v = await computeVectors(plainText, filename, loaded.storeConfig);

      const upId = await kaiUploadSource(loaded.ctx, loaded.storeRow.cognigy_store_id, filename, contentBytes);
      await kaiPollTask(loaded.ctx, upId, 60000);
      const sourceId = await resolveSourceId(loaded.ctx, loaded.storeRow.cognigy_store_id, uploadName, upId);

      const { data: ev } = await admin.from("kai_sync_events").insert({
        user_id: userId,
        store_id: bk.store_id,
        trigger: "manual_restore",
        incoming_filename: filename,
        decision: "add",
        status: "running",
      }).select("id").single();

      const { data: doc, error: insErr } = await admin.from("kai_documents").insert({
        user_id: userId,
        store_id: bk.store_id,
        cognigy_source_id: sourceId,
        original_filename: filename,
        title: v.title,
        content_hash: v.hash,
        embedding: v.embedding,
        tfidf_vector: v.tfidf,
        original_binary_available: true,
        last_synced_at: new Date().toISOString(),
      }).select("id").single();
      if (insErr || !doc) return json({ error: `restore insert failed: ${insErr?.message}` }, 500);

      const retained = await retainCopy(admin, bk.store_id, doc.id, uploadName, contentBytes, label);
      if (retained) await admin.from("kai_documents").update({ backup_storage_path: retained }).eq("id", doc.id);

      if (ev?.id) {
        await admin.from("kai_sync_events").update({
          status: "done",
          document_id: doc.id,
          warning: v.warning,
          completed_at: new Date().toISOString(),
        }).eq("id", ev.id);
      }
      return json({ ok: true, restored_document_id: doc.id });
    }

    return json({ error: `unknown action '${action}'` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
