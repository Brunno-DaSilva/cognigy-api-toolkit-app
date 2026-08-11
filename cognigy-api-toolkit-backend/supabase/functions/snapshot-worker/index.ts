// snapshot-worker
// State machine for snapshot_promotions rows. Each invocation reads the job,
// advances it through as many non-blocking steps as possible, then returns
// once it hits a polling step (waiting on a Cognigy task). The UI polls the
// snapshot_promotions row and re-invokes the worker until status is 'done'
// or 'failed'.
//
// Only one worker may advance a job at a time — see claim_snapshot_job in
// 0008_snapshot_versioning.sql. Snapshot names are semantic versions chosen by
// the user before the job starts (v1.0.1), and a version travels with the
// artifact when promoted.
//
// Job kinds:
//   create         (use case 1) — new snapshot on a project
//   promote_same   (use case 2) — safety snapshot of project, then Restore source
//   promote_cross  (use case 3) — safety snapshot of target, then Upload source
//   import         (sync)        — pull a Cognigy-only snapshot into our store
//
// Eviction rules (enforced before every "current snapshot lands in target Cognigy"):
//   - Cognigy is authoritative: we GET /v2.0/snapshots to see what's actually there.
//   - If Cognigy is at 10, the oldest (by createdAt) is deleted from Cognigy and
//     flipped to status='archived' in our DB.
//   - If we don't have the oldest's .csnap in our store yet, the worker fails the
//     job with an actionable error — the user must Import that snapshot first so
//     we don't lose its data forever in the eviction.
//   - If archived is already at 10, the oldest archived row + its Storage object
//     are hard-deleted first to make room.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cognigy API paths — verified against docs.cognigy.com/api-reference except
// where noted. Base URL is the customer's base_url (e.g. https://api-app-us.cognigy.ai).
const C_LIST = "/new/v2.0/snapshots";
const C_CREATE = "/new/v2.0/snapshots";
// Packaging kicks off the .csnap build; download happens via C_DOWNLOAD once done.
const C_PACKAGE = (id: string) => `/new/v2.0/snapshots/${id}/package`;
// TODO: confirm the actual download endpoint. The docs page 404s; the GUI's
// download icon hits this URL — check the network tab if the worker errors here.
const C_DOWNLOAD = (id: string) => `/new/v2.0/snapshots/${id}/download`;
const C_UPLOAD = "/new/v2.0/snapshots/upload";
const C_RESTORE = (id: string) => `/new/v2.0/snapshots/${id}/restore`;
const C_DELETE = (id: string) => `/new/v2.0/snapshots/${id}`;
const C_TASK = (id: string) => `/new/v2.0/tasks/${id}`;

// Cognigy task statuses (per docs)
const TASK_IN_PROGRESS = new Set(["queued", "active"]);
const TASK_DONE = "done";

// Rename an existing snapshot (used to stamp the promoted version onto the
// copy that lands in the target). Best-effort — see stepPollUpload.
const C_UPDATE = (id: string) => `/new/v2.0/snapshots/${id}`;

// ---------------------------------------------------------------------------
// Versioning
//
// Snapshots are named v<major>.<minor>.<patch>. The user picks the bump and
// writes the changelog in the UI, so 'create' jobs carry name/description/
// version on the job row. Safety snapshots taken before a promote are named
// after the version they roll back to: v1.1.0_pre-promote_Aug-11-2026.
// ---------------------------------------------------------------------------
type Version = { major: number; minor: number; patch: number };

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)(?:[._-].*)?$/i;

function parseVersion(name?: string | null): Version | null {
  const m = String(name ?? "").trim().match(VERSION_RE);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function formatVersion(v: Version): string {
  return `v${v.major}.${v.minor}.${v.patch}`;
}

function latestVersion(names: Array<string | null | undefined>): Version | null {
  let best: Version | null = null;
  for (const n of names) {
    const v = parseVersion(n);
    if (v && (!best || compare(v, best) > 0)) best = v;
  }
  return best;
}

function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

// Date suffix for snapshot names: e.g. "May-20-2026" (UTC).
function dateSuffix(d = new Date()): string {
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = String(d.getUTCDate()).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

function prePromoteName(current: Version | null): string {
  return `${current ? formatVersion(current) : "unversioned"}_pre-promote_${dateSuffix()}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Job = {
  id: string;
  user_id: string;
  kind: "create" | "promote_same" | "promote_cross" | "import";
  source_snapshot_id: string | null;
  source_cognigy_snapshot_id: string | null;
  target_project_id: string;
  target_api_key_id: string;
  source_api_key_id: string | null;
  status: "pending" | "running" | "done" | "failed";
  step: string | null;
  progress_pct: number;
  cognigy_task_id: string | null;
  resulting_snapshot_id: string | null;
  error_message: string | null;
  log: any[];
  // Chosen in the UI before the job starts (see 0008_snapshot_versioning.sql).
  snapshot_name: string | null;
  snapshot_description: string | null;
  snapshot_version: string | null;
  claimed_at: string | null;
};

type KeyInfo = { key: string; base_url: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

    const { job_id } = await req.json();
    if (!job_id) return json({ error: "job_id required" }, 400);

    // ownership via RLS
    const { data: ownership, error: ownErr } = await userClient
      .from("snapshot_promotions")
      .select("id")
      .eq("id", job_id)
      .maybeSingle();
    if (ownErr || !ownership) return json({ error: "job not found" }, 404);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const job = await loadJob(admin, job_id);
    if (!job) return json({ error: "job not found" }, 404);

    if (job.status === "done" || job.status === "failed") {
      return json(job);
    }

    // Exactly one worker may advance a job at a time. Without this, the UI's
    // initial kick and the poll loop's first tick both saw step=null and both
    // POSTed a create-snapshot to Cognigy — one click, two snapshots.
    const { data: claimed, error: claimErr } = await admin.rpc(
      "claim_snapshot_job",
      { p_job_id: job.id },
    );
    if (claimErr) return json({ error: `claim failed: ${claimErr.message}` }, 500);
    if (!claimed) {
      // Someone else is mid-step. Report the current state; the caller polls.
      return json({ ...job, claim_skipped: true });
    }

    try {
      const updated = await advance(admin, job);
      return json(updated);
    } catch (err) {
      const msg = (err as Error).message;
      await admin
        .from("snapshot_promotions")
        .update({ status: "failed", error_message: msg })
        .eq("id", job.id);
      await appendLog(admin, job.id, msg, "err");
      const failed = await loadJob(admin, job.id);
      return json(failed);
    } finally {
      // Release even on failure so a retry isn't blocked until the lease expires.
      await admin.rpc("release_snapshot_job", { p_job_id: job.id });
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// advance — runs steps until we hit a polling state, then returns the job row
// ---------------------------------------------------------------------------
async function advance(admin: SupabaseClient, job: Job): Promise<Job> {
  // Mark running on first transition out of pending
  if (job.status === "pending") {
    await admin
      .from("snapshot_promotions")
      .update({ status: "running" })
      .eq("id", job.id);
    job.status = "running";
    await appendLog(admin, job.id, `starting ${job.kind}`, "info");
  }

  // Loop until we transition into a polling state or terminate.
  // SAFETY: bound the loop in case of an unexpected step transition.
  for (let i = 0; i < 12; i++) {
    const before = job.step;
    job = await runOneStep(admin, job);
    if (job.status === "done" || job.status === "failed") break;
    // If the step didn't change, we're parked on a polling step — return.
    if (job.step === before) break;
  }
  return job;
}

// ---------------------------------------------------------------------------
// runOneStep — dispatch on (kind, step) and do exactly one transition
// ---------------------------------------------------------------------------
async function runOneStep(admin: SupabaseClient, job: Job): Promise<Job> {
  const step = job.step;

  // First transition out of pending. Import skips the Cognigy create — its
  // snapshot already exists; jump straight to packaging the source id.
  if (!step) {
    if (job.kind === "import") return await stepStartImport(admin, job);
    return await stepStartCreateOnTarget(admin, job);
  }

  switch (step) {
    case "polling_create":
      return await stepPollCreate(admin, job);
    case "polling_package":
      return await stepPollPackage(admin, job);
    case "downloading":
      return await stepDownloadToStorage(admin, job);
    case "evict_for_upload":
      return await stepEvictForUpload(admin, job);
    case "uploading":
      return await stepUploadToTarget(admin, job);
    case "polling_upload":
      return await stepPollUpload(admin, job);
    case "restoring":
      return await stepStartRestore(admin, job);
    case "polling_restore":
      return await stepPollRestore(admin, job);
    default:
      throw new Error(`unknown step: ${step}`);
  }
}

// ---------------------------------------------------------------------------
// Step 1: evict if needed, then POST to Cognigy to create a snapshot.
// Used for both 'create' (case 1) and as the safety-snapshot step of
// promote_same / promote_cross. The Cognigy project we create in is always
// the job's target_project (= source's project for same-env, true target
// for cross-env, the only project for 'create').
// ---------------------------------------------------------------------------
async function stepStartCreateOnTarget(admin: SupabaseClient, job: Job): Promise<Job> {
  await setProgress(admin, job, "evicting_for_create", 5);
  await evictCurrentIfNeeded(admin, job);

  await setProgress(admin, job, "creating", 10);
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const project = await loadProject(admin, job.target_project_id);

  const { name, description, version } = await resolveNames(admin, job);
  // Stash so the download step names the DB row identically without recomputing.
  await appendLog(admin, job.id, `snapshot_name=${name}`, "meta");
  if (version) await appendLog(admin, job.id, `snapshot_version=${version}`, "meta");

  const res = await cognigyFetch(key, "POST", C_CREATE, undefined, {
    projectId: project.cognigy_project_id,
    name,
    description,
  });
  const taskId = res?._id ?? res?.taskId ?? res?.id;
  if (!taskId) throw new Error(`Cognigy create did not return a task id: ${JSON.stringify(res).slice(0, 200)}`);

  await appendLog(admin, job.id, `Cognigy create-snapshot task ${taskId} started`, "info");
  return await setStep(admin, job, "polling_create", 15, { cognigy_task_id: taskId });
}

// ---------------------------------------------------------------------------
// Step 1 (import): the snapshot already exists in Cognigy. Skip the create
// task entirely and jump to packaging job.source_cognigy_snapshot_id.
// ---------------------------------------------------------------------------
async function stepStartImport(admin: SupabaseClient, job: Job): Promise<Job> {
  const snapId = job.source_cognigy_snapshot_id;
  if (!snapId) throw new Error("import job is missing source_cognigy_snapshot_id");

  // Stash the snapshot id in the log so stepDownloadToStorage can find it
  // through the same channel as the create flow.
  await appendLog(admin, job.id, `cognigy_snapshot_id=${snapId}`, "info");

  await setProgress(admin, job, "packaging", 15);
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);

  // Keep Cognigy's own name for the row we're about to create — if it was made
  // in the Cognigy GUI as v1.3.0, it stays v1.3.0 in the toolkit.
  const project = await loadProject(admin, job.target_project_id);
  const remote = await fetchCognigySnapshots(key, project.cognigy_project_id);
  const remoteName = remote.find((r) => r._id === snapId)?.name;
  if (remoteName) {
    await appendLog(admin, job.id, `cognigy_snapshot_name=${remoteName}`, "meta");
  }

  const res = await cognigyFetch(key, "POST", C_PACKAGE(snapId));
  const taskId = res?._id;
  if (!taskId) throw new Error(`package did not return a task _id`);
  await appendLog(admin, job.id, `Cognigy package task ${taskId} started`, "info");
  return await setStep(admin, job, "polling_package", 25, { cognigy_task_id: taskId });
}

// ---------------------------------------------------------------------------
// Step 2: poll the create task. When done, get the new snapshot id from the
// task params, stash it on the job, and kick off packaging.
//
// Cognigy task statuses: queued | active | done | cancelling | cancelled | error
// The new snapshot's id is exposed via task.data.snapshotId (per docs the
// task object has a `data` field with type-specific result fields).
// ---------------------------------------------------------------------------
async function stepPollCreate(admin: SupabaseClient, job: Job): Promise<Job> {
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const task = await cognigyFetch(key, "GET", C_TASK(job.cognigy_task_id!));
  const status = String(task?.status ?? "").toLowerCase();

  if (TASK_IN_PROGRESS.has(status)) return job;
  if (status !== TASK_DONE) {
    throw new Error(`create-snapshot task ${status}: ${task?.failReason ?? "unknown"}`);
  }

  // Snapshot id may surface under different shapes; check the most likely first.
  const snapId =
    task?.data?.snapshotId ??
    task?.data?._id ??
    task?.result?._id ??
    task?.resultId ??
    task?.snapshotId;
  if (!snapId) {
    throw new Error(
      `create-snapshot done but no snapshot id in task; keys: ${Object.keys(task ?? {}).join(",")}`,
    );
  }

  await appendLog(admin, job.id, `Cognigy snapshot ${snapId} created`, "ok");
  // Cache the cognigy snapshot id in the log so later steps can read it.
  await appendLog(admin, job.id, `cognigy_snapshot_id=${snapId}`, "info");

  const res = await cognigyFetch(key, "POST", C_PACKAGE(snapId));
  const taskId = res?._id;
  if (!taskId) throw new Error(`package did not return a task _id`);
  await appendLog(admin, job.id, `Cognigy package task ${taskId} started`, "info");

  return await setStep(admin, job, "polling_package", 30, { cognigy_task_id: taskId });
}

// ---------------------------------------------------------------------------
// Step 3: poll the package task. When done, transition to downloading.
// The actual binary is fetched in the next step via C_DOWNLOAD(snapshotId).
// ---------------------------------------------------------------------------
async function stepPollPackage(admin: SupabaseClient, job: Job): Promise<Job> {
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const task = await cognigyFetch(key, "GET", C_TASK(job.cognigy_task_id!));
  const status = String(task?.status ?? "").toLowerCase();

  if (TASK_IN_PROGRESS.has(status)) return job;
  if (status !== TASK_DONE) {
    throw new Error(`package task ${status}: ${task?.failReason ?? "unknown"}`);
  }

  await appendLog(admin, job.id, `package ready`, "ok");
  return await setStep(admin, job, "downloading", 45, { error_message: null });
}

// ---------------------------------------------------------------------------
// Step 4: stream .csnap from Cognigy into Storage, insert snapshots row.
// ---------------------------------------------------------------------------
async function stepDownloadToStorage(admin: SupabaseClient, job: Job): Promise<Job> {
  const cognigySnapshotId = findLogValue(job, /^cognigy_snapshot_id=(.+)$/);
  if (!cognigySnapshotId) throw new Error(`no cognigy_snapshot_id stashed on job`);

  const project = await loadProject(admin, job.target_project_id);
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);

  const dlUrl = new URL(C_DOWNLOAD(cognigySnapshotId), key.base_url);
  const dlRes = await fetch(dlUrl.toString(), {
    headers: { "X-API-Key": key.key, Accept: "application/octet-stream" },
  });
  if (!dlRes.ok) {
    const t = await dlRes.text();
    throw new Error(`download HTTP ${dlRes.status}: ${t.slice(0, 200)}`);
  }
  const blob = await dlRes.blob();
  const sizeBytes = blob.size;

  // Generate the snapshot row id up front so we can name the Storage path with it.
  const newSnapshotId = crypto.randomUUID();
  const storagePath = `${job.user_id}/${job.target_project_id}/${newSnapshotId}.csnap`;

  const { error: upErr } = await admin.storage
    .from("snapshots")
    .upload(storagePath, blob, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  const { name, description, version } = await resolveNames(admin, job);

  const { error: insErr } = await admin.from("snapshots").insert({
    id: newSnapshotId,
    project_id: job.target_project_id,
    user_id: job.user_id,
    cognigy_snapshot_id: cognigySnapshotId,
    name,
    description,
    version,
    size_bytes: sizeBytes,
    storage_path: storagePath,
    status: "current",
  });
  if (insErr) {
    // best-effort cleanup of the storage object so we don't leak
    await admin.storage.from("snapshots").remove([storagePath]);
    throw new Error(`db insert failed: ${insErr.message}`);
  }

  await appendLog(
    admin,
    job.id,
    `stored ${formatBytes(sizeBytes)} at ${storagePath}`,
    "ok",
  );

  // Decide the next step based on job kind:
  //   create         -> done
  //   import         -> done (we just pulled an existing Cognigy snapshot)
  //   promote_same   -> restoring (Restore the SOURCE snapshot on target)
  //   promote_cross  -> evict_for_upload (then upload SOURCE .csnap)
  if (job.kind === "create" || job.kind === "import") {
    await admin
      .from("snapshot_promotions")
      .update({
        status: "done",
        step: "done",
        progress_pct: 100,
        resulting_snapshot_id: newSnapshotId,
      })
      .eq("id", job.id);
    await appendLog(
      admin,
      job.id,
      job.kind === "import" ? `snapshot imported to store` : `snapshot created`,
      "ok",
    );
    return (await loadJob(admin, job.id))!;
  }
  if (job.kind === "promote_same") {
    return await setStep(admin, job, "restoring", 70, {
      resulting_snapshot_id: newSnapshotId,
    });
  }
  // promote_cross
  return await setStep(admin, job, "evict_for_upload", 60, {
    resulting_snapshot_id: newSnapshotId,
  });
}

// ---------------------------------------------------------------------------
// Step 5a (promote_cross): evict on target again before uploading.
// After the safety snapshot, target Cognigy may again be at 10 — make room.
// ---------------------------------------------------------------------------
async function stepEvictForUpload(admin: SupabaseClient, job: Job): Promise<Job> {
  await evictCurrentIfNeeded(admin, job);

  // Record what's in the target before the upload so stepPollUpload can tell
  // which snapshot is the new one and stamp the promoted version onto it.
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const project = await loadProject(admin, job.target_project_id);
  const before = await fetchCognigySnapshots(key, project.cognigy_project_id);
  await appendLog(
    admin,
    job.id,
    `pre_upload_ids=${before.map((s) => s._id).join(",")}`,
    "meta",
  );

  return await setStep(admin, job, "uploading", 70);
}

// ---------------------------------------------------------------------------
// Step 5b (promote_cross): multipart upload source .csnap to target Cognigy.
// ---------------------------------------------------------------------------
async function stepUploadToTarget(admin: SupabaseClient, job: Job): Promise<Job> {
  const source = await loadSnapshot(admin, job.source_snapshot_id!);
  const target = await loadProject(admin, job.target_project_id);
  const targetKey = await loadKey(admin, job.target_api_key_id, job.target_project_id);

  const { data: fileBlob, error: dlErr } = await admin.storage
    .from("snapshots")
    .download(source.storage_path);
  if (dlErr || !fileBlob) throw new Error(`storage download failed: ${dlErr?.message}`);

  const form = new FormData();
  form.append("file", fileBlob, `${source.name}.csnap`);
  form.append("projectId", target.cognigy_project_id);

  const url = new URL(C_UPLOAD, targetKey.base_url);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "X-API-Key": targetKey.key },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upload HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  let body: any = {};
  try { body = JSON.parse(text); } catch {}
  const taskId = body?._id;
  if (!taskId) throw new Error(`upload returned no task _id: ${text.slice(0, 200)}`);

  await appendLog(admin, job.id, `Cognigy upload task ${taskId} started`, "info");
  return await setStep(admin, job, "polling_upload", 85, { cognigy_task_id: taskId });
}

// ---------------------------------------------------------------------------
// Step 5c (promote_cross): poll the upload task.
// ---------------------------------------------------------------------------
async function stepPollUpload(admin: SupabaseClient, job: Job): Promise<Job> {
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const task = await cognigyFetch(key, "GET", C_TASK(job.cognigy_task_id!));
  const status = String(task?.status ?? "").toLowerCase();

  if (TASK_IN_PROGRESS.has(status)) return job;
  if (status !== TASK_DONE) {
    throw new Error(`upload task ${status}: ${task?.failReason ?? "unknown"}`);
  }

  await appendLog(admin, job.id, `snapshot uploaded to target`, "ok");
  await stampPromotedVersion(admin, job, key);

  await admin
    .from("snapshot_promotions")
    .update({ status: "done", step: "done", progress_pct: 100 })
    .eq("id", job.id);
  return (await loadJob(admin, job.id))!;
}

// ---------------------------------------------------------------------------
// A version travels with the artifact: Dev's v1.2.0 must read as v1.2.0 in the
// target too. We send the version as the multipart filename on upload, but
// Cognigy may take the name from inside the encrypted .csnap instead — so once
// the upload lands, check the new snapshot's name and rename it if it differs.
//
// Best-effort: a failure here leaves a correct snapshot with a stale name, which
// is not worth failing an otherwise successful promote over.
// ---------------------------------------------------------------------------
async function stampPromotedVersion(
  admin: SupabaseClient,
  job: Job,
  key: KeyInfo,
): Promise<void> {
  try {
    const source = await loadSnapshot(admin, job.source_snapshot_id!);
    const project = await loadProject(admin, job.target_project_id);

    const beforeCsv = findLogValue(job, /^pre_upload_ids=(.*)$/) ?? "";
    const before = new Set(beforeCsv.split(",").filter(Boolean));

    const after = await fetchCognigySnapshots(key, project.cognigy_project_id);
    const fresh = after.filter((s) => !before.has(s._id));
    if (fresh.length !== 1) {
      await appendLog(
        admin,
        job.id,
        `could not identify the uploaded snapshot (${fresh.length} new in target) — name left as Cognigy set it`,
        "warn",
      );
      return;
    }

    const uploaded = fresh[0];
    if (uploaded.name === source.name) {
      await appendLog(admin, job.id, `target shows ${source.name}`, "ok");
      return;
    }

    await cognigyFetch(key, "PATCH", C_UPDATE(uploaded._id), undefined, {
      name: source.name,
      description: source.description ?? undefined,
    });
    await appendLog(
      admin,
      job.id,
      `renamed uploaded snapshot "${uploaded.name}" -> "${source.name}"`,
      "ok",
    );
  } catch (err) {
    await appendLog(
      admin,
      job.id,
      `could not stamp the promoted version onto the target: ${(err as Error).message}`,
      "warn",
    );
  }
}

// ---------------------------------------------------------------------------
// Step 5a (promote_same): POST /restore on the SOURCE snapshot
// ---------------------------------------------------------------------------
async function stepStartRestore(admin: SupabaseClient, job: Job): Promise<Job> {
  const source = await loadSnapshot(admin, job.source_snapshot_id!);
  if (!source.cognigy_snapshot_id) {
    // The source is archived in our store but no longer in Cognigy. For
    // promote_same we'd need to re-upload it first; that's a future feature.
    throw new Error(
      "source snapshot is archived; promote_same requires it to still be in Cognigy",
    );
  }
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const target = await loadProject(admin, job.target_project_id);
  // Restore requires the target projectId in the body (per docs).
  const res = await cognigyFetch(key, "POST", C_RESTORE(source.cognigy_snapshot_id), undefined, {
    projectId: target.cognigy_project_id,
  });
  const taskId = res?._id;
  if (!taskId) throw new Error(`restore did not return a task _id`);
  await appendLog(admin, job.id, `Cognigy restore task ${taskId} started`, "info");
  return await setStep(admin, job, "polling_restore", 85, { cognigy_task_id: taskId });
}

// ---------------------------------------------------------------------------
// Step 5b (promote_same): poll the restore task.
// ---------------------------------------------------------------------------
async function stepPollRestore(admin: SupabaseClient, job: Job): Promise<Job> {
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const task = await cognigyFetch(key, "GET", C_TASK(job.cognigy_task_id!));
  const status = String(task?.status ?? "").toLowerCase();

  if (TASK_IN_PROGRESS.has(status)) return job;
  if (status !== TASK_DONE) {
    throw new Error(`restore task ${status}: ${task?.failReason ?? "unknown"}`);
  }

  await appendLog(admin, job.id, `restore complete`, "ok");
  await admin
    .from("snapshot_promotions")
    .update({ status: "done", step: "done", progress_pct: 100 })
    .eq("id", job.id);
  return (await loadJob(admin, job.id))!;
}

// ---------------------------------------------------------------------------
// Eviction: ensure target Cognigy project has room for one more snapshot.
//
// Cognigy is authoritative for "what's currently there." Our DB only tells us
// which of those we have binaries for in our Storage. We fetch the live list,
// and if Cognigy is at 10, we evict the oldest:
//
//   - If we already have its .csnap in our store (matching DB row with non-null
//     storage_path): delete from Cognigy, flip the DB row to archived.
//   - If we don't yet have its .csnap: refuse — archiving would lose the
//     snapshot forever. The user must Import it first via the UI's Import
//     action, then retry the create.
//
// If archived is already at 10, the oldest archived (row + Storage object) is
// hard-deleted first to make room.
// ---------------------------------------------------------------------------
async function evictCurrentIfNeeded(admin: SupabaseClient, job: Job): Promise<void> {
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const project = await loadProject(admin, job.target_project_id);

  const cognigySnaps = await fetchCognigySnapshots(key, project.cognigy_project_id);

  if (cognigySnaps.length < 10) return; // Cognigy has room — no eviction needed

  // Oldest first (by createdAt).
  cognigySnaps.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const oldest = cognigySnaps[0];

  // Look up our DB row for the oldest Cognigy snapshot.
  const { data: matchingRow, error: matchErr } = await admin
    .from("snapshots")
    .select("id, storage_path")
    .eq("project_id", job.target_project_id)
    .eq("cognigy_snapshot_id", oldest._id)
    .maybeSingle();
  if (matchErr) throw new Error(`load matching row failed: ${matchErr.message}`);

  if (!matchingRow || !matchingRow.storage_path) {
    throw new Error(
      `Cognigy is at the 10-snapshot cap and the oldest snapshot (${oldest.name ?? oldest._id}) ` +
      `is not in our store. Click "Import" on that row first so it survives the eviction, then retry.`,
    );
  }

  await appendLog(
    admin,
    job.id,
    `target Cognigy at cap — evicting oldest (${oldest.name ?? oldest._id}) to archived`,
    "info",
  );

  // Make room in archived if it's also full.
  const { data: archived, error: arcErr } = await admin
    .from("snapshots")
    .select("id, storage_path, created_at")
    .eq("project_id", job.target_project_id)
    .eq("status", "archived")
    .order("created_at", { ascending: true });
  if (arcErr) throw new Error(`load archived failed: ${arcErr.message}`);

  if (archived && archived.length >= 10) {
    const oldestArchived = archived[0];
    await appendLog(
      admin,
      job.id,
      `archive full — permanently deleting oldest archived (${oldestArchived.id})`,
      "warn",
    );
    if (oldestArchived.storage_path) {
      const { error: stRmErr } = await admin.storage
        .from("snapshots")
        .remove([oldestArchived.storage_path]);
      if (stRmErr) throw new Error(`archive storage delete failed: ${stRmErr.message}`);
    }
    const { error: dbRmErr } = await admin
      .from("snapshots")
      .delete()
      .eq("id", oldestArchived.id);
    if (dbRmErr) throw new Error(`archive db delete failed: ${dbRmErr.message}`);
  }

  // Delete from Cognigy.
  const delUrl = new URL(C_DELETE(oldest._id), key.base_url);
  const delRes = await fetch(delUrl.toString(), {
    method: "DELETE",
    headers: { "X-API-Key": key.key, Accept: "application/json" },
  });
  if (!delRes.ok && delRes.status !== 404) {
    const t = await delRes.text();
    throw new Error(`Cognigy delete failed: HTTP ${delRes.status} ${t.slice(0, 200)}`);
  }

  // Flip our row to archived.
  const { error: flipErr } = await admin
    .from("snapshots")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      cognigy_snapshot_id: null,
    })
    .eq("id", matchingRow.id);
  if (flipErr) throw new Error(`flip-to-archived failed: ${flipErr.message}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadJob(admin: SupabaseClient, id: string): Promise<Job | null> {
  const { data, error } = await admin
    .from("snapshot_promotions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Job;
}

// Always pass the project: a project pinned to an environment resolves to that
// environment's base_url, otherwise the customer's. Promoting across envs sends
// requests to the wrong installation without it.
async function loadKey(
  admin: SupabaseClient,
  apiKeyId: string,
  projectId: string,
): Promise<KeyInfo> {
  const { data, error } = await admin.rpc("get_api_key_plaintext", {
    p_api_key_id: apiKeyId,
    p_project_id: projectId,
  });
  if (error || !data?.length) throw new Error(`decrypt key failed: ${error?.message}`);
  return { key: data[0].key_plaintext, base_url: data[0].base_url };
}

// GET the live snapshot list for a Cognigy project. Cognigy is authoritative
// for both "what's currently there" (eviction) and "what version are we on".
async function fetchCognigySnapshots(
  key: KeyInfo,
  cognigyProjectId: string,
): Promise<Array<{ _id: string; name?: string; createdAt?: number }>> {
  const listUrl = new URL(C_LIST, key.base_url);
  listUrl.searchParams.set("projectId", cognigyProjectId);
  listUrl.searchParams.set("limit", "100");
  const res = await fetch(listUrl.toString(), {
    headers: { Accept: "application/json", "X-API-Key": key.key },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Cognigy list snapshots failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  const body = await res.json();
  return body?.items ?? [];
}

type SnapNames = { name: string; description: string; version: string | null };

// What the snapshot this job creates (or, for 'import', pulls) should be called.
//
//   create        — exactly what the user chose in the modal. The version and
//                   changelog are required at job-start time, so there is no
//                   fallback here by design.
//   import        — the name Cognigy already has; if that name is a version,
//                   we adopt it.
//   promote_*     — safety snapshot of the target, named after the version it
//                   rolls back to. version stays null: a rollback point isn't
//                   itself a released version.
async function resolveNames(admin: SupabaseClient, job: Job): Promise<SnapNames> {
  if (job.kind === "create") {
    if (!job.snapshot_name || !job.snapshot_version) {
      throw new Error(
        "this create job has no version — start it from the Snapshots page so a version and changelog are chosen",
      );
    }
    return {
      name: job.snapshot_name,
      description: job.snapshot_description ?? "",
      version: job.snapshot_version,
    };
  }

  if (job.kind === "import") {
    const name =
      findLogValue(job, /^cognigy_snapshot_name=(.+)$/) ?? `imported_${dateSuffix()}`;
    const parsed = parseVersion(name);
    return {
      name,
      description: job.snapshot_description ?? "Imported from Cognigy via Toolkit",
      version: parsed ? formatVersion(parsed) : null,
    };
  }

  // promote_same / promote_cross
  const name =
    findLogValue(job, /^snapshot_name=(.+)$/) ??
    job.snapshot_name ??
    (await derivePrePromoteName(admin, job));

  let description = job.snapshot_description;
  if (!description) {
    const incoming = job.source_snapshot_id
      ? await loadSnapshot(admin, job.source_snapshot_id)
      : null;
    const label = incoming?.version ?? incoming?.name ?? "a snapshot";
    description = `Safety snapshot taken before promoting ${label} into this project`;
  }

  return { name, description, version: null };
}

// The target's current version comes from Cognigy's live list plus anything we
// hold for that project (an evicted-but-archived row can be the highest one).
async function derivePrePromoteName(admin: SupabaseClient, job: Job): Promise<string> {
  const key = await loadKey(admin, job.target_api_key_id, job.target_project_id);
  const project = await loadProject(admin, job.target_project_id);
  const remote = await fetchCognigySnapshots(key, project.cognigy_project_id);

  const { data: localRows } = await admin
    .from("snapshots")
    .select("name")
    .eq("project_id", job.target_project_id);

  return prePromoteName(
    latestVersion([
      ...remote.map((r) => r.name),
      ...(localRows ?? []).map((r: { name: string }) => r.name),
    ]),
  );
}

async function loadProject(admin: SupabaseClient, projectId: string) {
  const { data, error } = await admin
    .from("projects")
    .select("id, cognigy_project_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) throw new Error(`project not found`);
  return data;
}

async function loadSnapshot(admin: SupabaseClient, snapshotId: string) {
  const { data, error } = await admin
    .from("snapshots")
    .select(
      "id, cognigy_snapshot_id, name, version, description, storage_path, status, project_id",
    )
    .eq("id", snapshotId)
    .maybeSingle();
  if (error || !data) throw new Error(`snapshot not found`);
  return data;
}

async function setStep(
  admin: SupabaseClient,
  job: Job,
  step: string,
  pct: number,
  extras: Record<string, any> = {},
): Promise<Job> {
  const { error } = await admin
    .from("snapshot_promotions")
    .update({ step, progress_pct: pct, ...extras })
    .eq("id", job.id);
  if (error) throw new Error(`setStep failed: ${error.message}`);
  return (await loadJob(admin, job.id))!;
}

async function setProgress(admin: SupabaseClient, job: Job, step: string, pct: number) {
  await admin
    .from("snapshot_promotions")
    .update({ step, progress_pct: pct })
    .eq("id", job.id);
  job.step = step;
  job.progress_pct = pct;
}

async function appendLog(
  admin: SupabaseClient,
  jobId: string,
  msg: string,
  type: "info" | "ok" | "warn" | "err" | "meta" = "info",
) {
  const { data } = await admin
    .from("snapshot_promotions")
    .select("log")
    .eq("id", jobId)
    .maybeSingle();
  const log = (data?.log as any[]) ?? [];
  log.push({ at: new Date().toISOString(), type, msg });
  await admin
    .from("snapshot_promotions")
    .update({ log })
    .eq("id", jobId);
}

async function cognigyFetch(
  key: KeyInfo,
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<any> {
  const url = new URL(path, key.base_url);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": key.key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Cognigy ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

function findLogValue(job: Job, pattern: RegExp): string | null {
  for (let i = (job.log ?? []).length - 1; i >= 0; i--) {
    const e = job.log[i];
    if (!e?.msg) continue;
    const m = String(e.msg).match(pattern);
    if (m) return m[1];
  }
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
