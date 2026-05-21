-- Cognigy API Toolkit — Snapshots: 'import' kind + Cognigy-authoritative listing
--
-- Why this migration exists:
--   The UI now shows Cognigy's live snapshot list as the source of truth for
--   "current." Snapshots that exist in Cognigy but were never created through
--   our app (e.g. taken via the Cognigy GUI) need a way to be pulled into our
--   store so their .csnap binary survives later eviction. That action is a new
--   job kind: 'import' (no Cognigy create — just package + download + insert).
--
--   Also relaxes snapshots.storage_path to nullable to leave room for future
--   shadow-row patterns, and adds source_cognigy_snapshot_id to track which
--   Cognigy snapshot an import job is pulling.

-- ---------------------------------------------------------------------------
-- Allow 'import' as a job kind
-- ---------------------------------------------------------------------------
alter table public.snapshot_promotions
  drop constraint snapshot_promotions_kind_check;

alter table public.snapshot_promotions
  add constraint snapshot_promotions_kind_check
  check (kind in ('create', 'promote_same', 'promote_cross', 'import'));

-- ---------------------------------------------------------------------------
-- Track the Cognigy snapshot id that an 'import' job is pulling
-- ---------------------------------------------------------------------------
alter table public.snapshot_promotions
  add column source_cognigy_snapshot_id text;

-- ---------------------------------------------------------------------------
-- storage_path becomes nullable.
-- A null storage_path means the snapshot exists in Cognigy but not yet in
-- our store; we use this only transiently (not persisted today). Eviction
-- still requires storage_path to be non-null before flipping to archived.
-- ---------------------------------------------------------------------------
alter table public.snapshots
  alter column storage_path drop not null;

-- ---------------------------------------------------------------------------
-- start_snapshot_job — replace to accept the new kind and the new field.
-- ---------------------------------------------------------------------------
drop function if exists public.start_snapshot_job(text, uuid, uuid, uuid, uuid);

create or replace function public.start_snapshot_job(
  p_kind                       text,
  p_target_project_id          uuid,
  p_target_api_key_id          uuid,
  p_source_snapshot_id         uuid default null,
  p_source_api_key_id          uuid default null,
  p_source_cognigy_snapshot_id text default null
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
    source_cognigy_snapshot_id
  )
  values (
    v_user_id, p_kind,
    p_source_snapshot_id, p_target_project_id,
    p_target_api_key_id, p_source_api_key_id,
    p_source_cognigy_snapshot_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.start_snapshot_job(text, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.start_snapshot_job(text, uuid, uuid, uuid, uuid, text) to authenticated;
