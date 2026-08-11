-- Cognigy API Toolkit — Snapshot semantic versioning + single-fire jobs
--
-- Two changes:
--
-- 1. Versioned names. Snapshots are named v<major>.<minor>.<patch> instead of
--    the old date-based `snapshot_Aug-11-2026_FromToolkit`. The name and the
--    "what changed" description are chosen by the user in a modal before the
--    job starts, so they ride on the job row instead of being invented by the
--    worker. A version travels with the artifact: promoting Dev's v1.2.0 into
--    QA keeps the name v1.2.0.
--
-- 2. Single-fire jobs. Two worker invocations used to be able to race on a
--    fresh job (the UI kicked the worker directly while the poll loop's first
--    tick fired for the same job), and each would POST its own create-snapshot
--    to Cognigy — one click, two snapshots. claim_snapshot_job() makes the
--    advance exclusive at the DB level, which also covers page refreshes and
--    a second browser tab.

-- ---------------------------------------------------------------------------
-- snapshots.version — parsed from the name, stored for querying/sorting.
-- Null for legacy and unversioned (imported) snapshots.
-- ---------------------------------------------------------------------------
alter table public.snapshots
  add column if not exists version text;

create index if not exists snapshots_project_version_idx
  on public.snapshots (project_id, version);

-- ---------------------------------------------------------------------------
-- snapshot_promotions — the user's intent for this job, plus the claim lease.
-- ---------------------------------------------------------------------------
alter table public.snapshot_promotions
  add column if not exists snapshot_name        text,
  add column if not exists snapshot_description text,
  add column if not exists snapshot_version     text,
  add column if not exists claimed_at           timestamptz;

-- ---------------------------------------------------------------------------
-- claim_snapshot_job — atomic "only one worker may advance this job".
--
-- A single UPDATE ... WHERE re-evaluates its predicate after any concurrent
-- writer commits, so of two simultaneous callers exactly one gets a row back.
-- The lease means a worker that dies mid-step doesn't wedge the job forever.
-- ---------------------------------------------------------------------------
create or replace function public.claim_snapshot_job(
  p_job_id         uuid,
  p_lease_seconds  int default 150
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_claimed boolean;
begin
  update public.snapshot_promotions
     set claimed_at = now()
   where id = p_job_id
     and status in ('pending', 'running')
     and (
       claimed_at is null
       or claimed_at < now() - make_interval(secs => p_lease_seconds)
     )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all    on function public.claim_snapshot_job(uuid, int) from public;
grant execute on function public.claim_snapshot_job(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- release_snapshot_job — drop the lease so the next poll tick can advance.
-- ---------------------------------------------------------------------------
create or replace function public.release_snapshot_job(p_job_id uuid)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.snapshot_promotions
     set claimed_at = null
   where id = p_job_id;
$$;

revoke all    on function public.release_snapshot_job(uuid) from public;
grant execute on function public.release_snapshot_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- start_snapshot_job — carries the chosen name/description/version.
--
-- 'create' requires all three: the UI cannot open a create job without the
-- user picking major/minor/patch and writing what changed.
-- 'promote_same' / 'promote_cross' may pass the pre-computed safety-snapshot
-- name; when omitted the worker derives it from the target's live list.
-- ---------------------------------------------------------------------------
drop function if exists public.start_snapshot_job(text, uuid, uuid, uuid, uuid, text);

create or replace function public.start_snapshot_job(
  p_kind                       text,
  p_target_project_id          uuid,
  p_target_api_key_id          uuid,
  p_source_snapshot_id         uuid default null,
  p_source_api_key_id          uuid default null,
  p_source_cognigy_snapshot_id text default null,
  p_snapshot_name              text default null,
  p_snapshot_description       text default null,
  p_snapshot_version           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_user_id   uuid := auth.uid();
  v_owner     uuid;
  v_id        uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_kind not in ('create', 'promote_same', 'promote_cross', 'import') then
    raise exception 'invalid kind: %', p_kind;
  end if;

  -- target project ownership
  select user_id into v_owner from public.projects where id = p_target_project_id;
  if v_owner is null or v_owner <> v_user_id then
    raise exception 'target project not found or access denied';
  end if;

  -- target api key ownership
  select user_id into v_owner from public.api_keys where id = p_target_api_key_id;
  if v_owner is null or v_owner <> v_user_id then
    raise exception 'target api key not found or access denied';
  end if;

  -- source snapshot ownership (required for promote_*)
  if p_kind in ('promote_same', 'promote_cross') then
    if p_source_snapshot_id is null then
      raise exception 'source_snapshot_id required for %', p_kind;
    end if;
    select user_id into v_owner from public.snapshots where id = p_source_snapshot_id;
    if v_owner is null or v_owner <> v_user_id then
      raise exception 'source snapshot not found or access denied';
    end if;
  end if;

  -- import requires the Cognigy snapshot id
  if p_kind = 'import' and (p_source_cognigy_snapshot_id is null or p_source_cognigy_snapshot_id = '') then
    raise exception 'source_cognigy_snapshot_id required for import';
  end if;

  -- create requires a version, a name and a changelog description
  if p_kind = 'create' then
    if p_snapshot_version is null or p_snapshot_version = '' then
      raise exception 'snapshot_version required for create';
    end if;
    if p_snapshot_name is null or p_snapshot_name = '' then
      raise exception 'snapshot_name required for create';
    end if;
    if p_snapshot_description is null or btrim(p_snapshot_description) = '' then
      raise exception 'snapshot_description required for create';
    end if;
  end if;

  -- source api key ownership: optional. Validate only if provided.
  if p_source_api_key_id is not null then
    select user_id into v_owner from public.api_keys where id = p_source_api_key_id;
    if v_owner is null or v_owner <> v_user_id then
      raise exception 'source api key not found or access denied';
    end if;
  end if;

  insert into public.snapshot_promotions (
    user_id, kind,
    source_snapshot_id, target_project_id,
    target_api_key_id, source_api_key_id,
    source_cognigy_snapshot_id,
    snapshot_name, snapshot_description, snapshot_version
  )
  values (
    v_user_id, p_kind,
    p_source_snapshot_id, p_target_project_id,
    p_target_api_key_id, p_source_api_key_id,
    p_source_cognigy_snapshot_id,
    p_snapshot_name, btrim(p_snapshot_description), p_snapshot_version
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all    on function public.start_snapshot_job(text, uuid, uuid, uuid, uuid, text, text, text, text) from public;
grant execute on function public.start_snapshot_job(text, uuid, uuid, uuid, uuid, text, text, text, text) to authenticated;
