-- Cognigy API Toolkit — Snapshots & Promotions
--
-- Two-list model per project:
--   - "current"  (max 10): mirrors what's in Cognigy right now
--   - "archived" (max 10): was evicted from Cognigy but the .csnap binary lives in our Storage
-- One snapshots row covers both; the `status` column flips when Cognigy evicts.
--
-- Lifecycle (driven by snapshot-worker edge function):
--   Create:        worker creates in Cognigy -> downloads .csnap to Storage -> inserts current row.
--                  If project already has 10 current, the oldest current is first deleted in Cognigy
--                  and flipped to status='archived' here. If archived is then at 10, the oldest
--                  archived row + its Storage object are hard-deleted to make room.
--   Promote-same:  safety-snapshot the project -> Restore the chosen snapshot -> done.
--   Promote-cross: safety-snapshot the target project -> Upload .csnap to target -> done.
--
-- snapshot_promotions stores the job state so the UI can poll without holding a connection.
-- The worker is the only writer to snapshots (via service_role); the UI starts jobs through
-- start_snapshot_job() and reads its own rows via RLS.

-- ---------------------------------------------------------------------------
-- snapshots
-- ---------------------------------------------------------------------------
create table public.snapshots (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  user_id               uuid not null references public.profiles(id) on delete cascade,

  cognigy_snapshot_id   text,                    -- null once archived (deleted from Cognigy)
  name                  text not null,
  description           text,
  size_bytes            bigint,
  storage_path          text not null,           -- path inside the 'snapshots' bucket
  status                text not null default 'current'
                          check (status in ('current', 'archived')),

  created_at            timestamptz not null default now(),    -- when we recorded it
  cognigy_created_at    timestamptz,                            -- per Cognigy
  archived_at           timestamptz                             -- when we flipped to archived
);

create index snapshots_project_status_idx
  on public.snapshots (project_id, status, created_at desc);
create index snapshots_user_idx on public.snapshots (user_id);

alter table public.snapshots enable row level security;

-- Read + delete via RLS. Inserts/updates only via service_role (worker).
create policy snapshots_select_own on public.snapshots
  for select using (auth.uid() = user_id);
create policy snapshots_delete_own on public.snapshots
  for delete using (auth.uid() = user_id);

-- Defensive guard: never let either list exceed 10 for a project. The worker
-- is responsible for evicting first; this trigger turns silent-overflow bugs
-- into loud failures.
create or replace function public._snapshots_enforce_cap()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.snapshots
  where project_id = new.project_id and status = new.status;

  if v_count >= 10 then
    raise exception 'snapshots cap reached for project % (status=%): worker must evict first',
      new.project_id, new.status;
  end if;
  return new;
end;
$$;

create trigger snapshots_enforce_cap_insert
  before insert on public.snapshots
  for each row execute function public._snapshots_enforce_cap();

create trigger snapshots_enforce_cap_update
  before update of status on public.snapshots
  for each row when (old.status is distinct from new.status)
  execute function public._snapshots_enforce_cap();

-- ---------------------------------------------------------------------------
-- snapshot_promotions  (the job state machine)
-- ---------------------------------------------------------------------------
create table public.snapshot_promotions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,

  -- 'create'         : new snapshot on a project (use case 1)
  -- 'promote_same'   : restore an existing snapshot in its own project (use case 2)
  -- 'promote_cross'  : safety-snapshot target + upload to target (use case 3)
  kind                     text not null
                              check (kind in ('create', 'promote_same', 'promote_cross')),

  source_snapshot_id       uuid references public.snapshots(id) on delete set null,
  target_project_id        uuid not null references public.projects(id) on delete cascade,
  target_api_key_id        uuid not null references public.api_keys(id) on delete cascade,
  source_api_key_id        uuid references public.api_keys(id) on delete set null,

  status                   text not null default 'pending'
                              check (status in ('pending', 'running', 'done', 'failed')),
  step                     text,
  progress_pct             int not null default 0,
  cognigy_task_id          text,
  resulting_snapshot_id    uuid references public.snapshots(id) on delete set null,
  error_message            text,
  log                      jsonb not null default '[]'::jsonb,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index snapshot_promotions_user_idx
  on public.snapshot_promotions (user_id, created_at desc);
create index snapshot_promotions_active_idx
  on public.snapshot_promotions (status)
  where status in ('pending', 'running');

alter table public.snapshot_promotions enable row level security;

-- Read via RLS, write via RPC + worker.
create policy snapshot_promotions_select_own on public.snapshot_promotions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage bucket for .csnap binaries
-- Private; all reads issued as signed URLs from edge functions after
-- ownership checks. All writes happen via service_role from the worker.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('snapshots', 'snapshots', false)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- start_snapshot_job  — frontend RPC.
-- Validates ownership of all referenced rows, then enqueues a 'pending' job.
-- The worker (invoked by the same RPC once and then poll-driven) advances it.
-- ---------------------------------------------------------------------------
create or replace function public.start_snapshot_job(
  p_kind                 text,
  p_target_project_id    uuid,
  p_target_api_key_id    uuid,
  p_source_snapshot_id   uuid default null,
  p_source_api_key_id    uuid default null
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

  if p_kind not in ('create', 'promote_same', 'promote_cross') then
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

  -- source api key ownership: optional. The worker reads source .csnap from
  -- our Storage, so we don't strictly need source creds. Only validate if
  -- the caller provided one (useful for future "re-pull from source" flows).
  if p_source_api_key_id is not null then
    select user_id into v_owner from public.api_keys where id = p_source_api_key_id;
    if v_owner is null or v_owner <> v_user_id then
      raise exception 'source api key not found or access denied';
    end if;
  end if;

  insert into public.snapshot_promotions (
    user_id, kind,
    source_snapshot_id, target_project_id,
    target_api_key_id, source_api_key_id
  )
  values (
    v_user_id, p_kind,
    p_source_snapshot_id, p_target_project_id,
    p_target_api_key_id, p_source_api_key_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.start_snapshot_job(text, uuid, uuid, uuid, uuid) from public;
grant execute on function public.start_snapshot_job(text, uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- touch_snapshot_promotion  — internal: bump updated_at on every write.
-- ---------------------------------------------------------------------------
create or replace function public._touch_snapshot_promotion()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger snapshot_promotions_touch
  before update on public.snapshot_promotions
  for each row execute function public._touch_snapshot_promotion();
