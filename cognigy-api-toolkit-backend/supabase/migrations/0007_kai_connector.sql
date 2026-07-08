-- Cognigy API Toolkit — KAI Connector
--
-- KAI Connector keeps a persistent local index of every document ingested in a
-- Cognigy Knowledge AI (KAI) Knowledge Store and decides, for each incoming
-- document, whether it's a NEW document (add) or an UPDATED version of an
-- existing one (replace) — then drives the Cognigy KAI REST API accordingly.
--
-- Model:
--   kai_stores ──< kai_documents ──< kai_document_backups
--           └────< kai_sync_events
--
-- Keys: the Cognigy KAI key, the Azure OpenAI embedding key, and the customer's
-- source-system key all live in the existing `api_keys` table (encrypted via
-- Vault, same as the main Cognigy key — user names it, only key_last4 is ever
-- shown, deletable but never viewable). A new `provider` column distinguishes
-- them so they never leak into the Cognigy key dropdowns.
--
-- Backup-before-delete: Cognigy's Knowledge Sources API returns metadata only
-- (no original file content / no download URL), so KAI Connector keeps its own
-- copy of every file it uploads in the private `kai-backups` Storage bucket. A
-- REPLACE always backs that copy into kai_document_backups (confirmed written)
-- before issuing the Cognigy DELETE. This is a hard invariant in kai-evaluator.
--
-- Idempotent: re-running this migration is safe.

-- ---------------------------------------------------------------------------
-- api_keys.provider — distinguishes Cognigy keys from KAI helper keys.
-- Existing rows default to 'cognigy' so legacy behaviour is unchanged.
-- ---------------------------------------------------------------------------
alter table public.api_keys
  add column if not exists provider text not null default 'cognigy';

-- ---------------------------------------------------------------------------
-- kai_stores — one tracked KAI Knowledge Store per project.
-- ---------------------------------------------------------------------------
create table if not exists public.kai_stores (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles(id) on delete cascade,
  customer_id            uuid not null references public.customers(id) on delete cascade,
  project_id             uuid not null references public.projects(id) on delete cascade,

  cognigy_store_id       text not null,                 -- KAI Knowledge Store id in Cognigy
  store_name             text,
  api_key_id             uuid references public.api_keys(id) on delete set null, -- Cognigy key for KAI calls

  embedding_mode         text not null default 'tfidf'
                           check (embedding_mode in ('azure_openai', 'tfidf')),
  azure_endpoint         text,                          -- only used when embedding_mode = 'azure_openai'
  azure_deployment       text,                          -- embedding deployment name
  azure_api_key_id       uuid references public.api_keys(id) on delete set null, -- provider='azure_openai'

  -- Customer source system (nightly connector contract). The key is stored in
  -- api_keys with provider='source'.
  source_api_url         text,
  source_api_key_id      uuid references public.api_keys(id) on delete set null,

  nightly_sync_enabled   boolean not null default false,
  nightly_sync_cron      text,                          -- e.g. '0 2 * * *'
  last_sync_at           timestamptz,
  last_sync_summary      jsonb,                         -- {evaluated, add, replace, hold, skip, ...}

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists kai_stores_user_idx    on public.kai_stores (user_id);
create index if not exists kai_stores_project_idx  on public.kai_stores (project_id);
create unique index if not exists kai_stores_project_cognigy_uidx
  on public.kai_stores (project_id, cognigy_store_id);

alter table public.kai_stores enable row level security;

drop policy if exists kai_stores_select_own on public.kai_stores;
create policy kai_stores_select_own on public.kai_stores
  for select using (auth.uid() = user_id);
drop policy if exists kai_stores_insert_own on public.kai_stores;
create policy kai_stores_insert_own on public.kai_stores
  for insert with check (auth.uid() = user_id);
drop policy if exists kai_stores_update_own on public.kai_stores;
create policy kai_stores_update_own on public.kai_stores
  for update using (auth.uid() = user_id);
drop policy if exists kai_stores_delete_own on public.kai_stores;
create policy kai_stores_delete_own on public.kai_stores
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- kai_documents — one row per document currently tracked in a KAI store.
-- ---------------------------------------------------------------------------
create table if not exists public.kai_documents (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles(id) on delete cascade,
  store_id                  uuid not null references public.kai_stores(id) on delete cascade,

  cognigy_source_id         text,                       -- Knowledge Source id in Cognigy KAI
  external_id               text,                       -- stable id from the customer source system (nightly)
  original_filename         text,
  title                     text,
  content_hash              text,                       -- MD5 of extracted plain text
  embedding                 jsonb,                      -- serialized float array; null in tfidf mode
  tfidf_vector              jsonb,                      -- serialized term-frequency map; null in azure mode

  -- Our retained copy of the uploaded file, used to satisfy the pre-delete
  -- backup invariant (Cognigy cannot return the original bytes).
  backup_storage_path       text,
  original_binary_available boolean not null default true,

  last_synced_at            timestamptz,
  created_at                timestamptz not null default now()
);

create index if not exists kai_documents_store_idx on public.kai_documents (store_id);
create index if not exists kai_documents_user_idx  on public.kai_documents (user_id);
create index if not exists kai_documents_hash_idx  on public.kai_documents (store_id, content_hash);

alter table public.kai_documents enable row level security;

drop policy if exists kai_documents_select_own on public.kai_documents;
create policy kai_documents_select_own on public.kai_documents
  for select using (auth.uid() = user_id);
drop policy if exists kai_documents_insert_own on public.kai_documents;
create policy kai_documents_insert_own on public.kai_documents
  for insert with check (auth.uid() = user_id);
drop policy if exists kai_documents_update_own on public.kai_documents;
create policy kai_documents_update_own on public.kai_documents
  for update using (auth.uid() = user_id);
drop policy if exists kai_documents_delete_own on public.kai_documents;
create policy kai_documents_delete_own on public.kai_documents
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- kai_sync_events — audit log of every evaluation and its outcome.
-- incoming_content_base64 stages the content so a 'hold' can be resolved later
-- from the Hold Queue without re-uploading.
-- ---------------------------------------------------------------------------
create table if not exists public.kai_sync_events (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  store_id                 uuid not null references public.kai_stores(id) on delete cascade,
  document_id              uuid references public.kai_documents(id) on delete set null,

  trigger                  text not null
                             check (trigger in ('manual_upload', 'nightly_job', 'manual_restore')),
  incoming_filename        text,
  incoming_content_base64  text,                        -- staged plain text (base64) for hold resolution

  decision                 text
                             check (decision in ('add', 'replace', 'hold', 'skip')),
  similarity_score         numeric,
  similarity_method        text
                             check (similarity_method in ('hash', 'title_fuzzy', 'embedding', 'tfidf')),
  matched_document_id      uuid references public.kai_documents(id) on delete set null,

  status                   text not null default 'pending'
                             check (status in ('pending', 'running', 'done', 'failed')),
  error_message            text,
  warning                  text,                        -- e.g. azure fell back to tfidf

  created_at               timestamptz not null default now(),
  completed_at             timestamptz
);

create index if not exists kai_sync_events_store_idx
  on public.kai_sync_events (store_id, created_at desc);
create index if not exists kai_sync_events_user_idx
  on public.kai_sync_events (user_id);
create index if not exists kai_sync_events_hold_idx
  on public.kai_sync_events (store_id)
  where decision = 'hold' and status = 'done';

alter table public.kai_sync_events enable row level security;

drop policy if exists kai_sync_events_select_own on public.kai_sync_events;
create policy kai_sync_events_select_own on public.kai_sync_events
  for select using (auth.uid() = user_id);
drop policy if exists kai_sync_events_insert_own on public.kai_sync_events;
create policy kai_sync_events_insert_own on public.kai_sync_events
  for insert with check (auth.uid() = user_id);
drop policy if exists kai_sync_events_update_own on public.kai_sync_events;
create policy kai_sync_events_update_own on public.kai_sync_events
  for update using (auth.uid() = user_id);
drop policy if exists kai_sync_events_delete_own on public.kai_sync_events;
create policy kai_sync_events_delete_own on public.kai_sync_events
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- kai_document_backups — binary backup of every file deleted from Cognigy KAI
-- before replacement. storage_path points into the private 'kai-backups' bucket.
-- ---------------------------------------------------------------------------
create table if not exists public.kai_document_backups (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles(id) on delete cascade,
  store_id                  uuid not null references public.kai_stores(id) on delete cascade,
  document_id               uuid references public.kai_documents(id) on delete set null,
  sync_event_id             uuid references public.kai_sync_events(id) on delete set null,

  original_filename         text,
  file_content_base64       text,                       -- inline fallback for tiny text payloads; usually null
  file_size_bytes           integer,
  storage_path              text not null,              -- path in Storage bucket 'kai-backups'
  cognigy_source_id         text,                       -- the source id that was deleted, for reference
  original_binary_available boolean not null default true,

  created_at                timestamptz not null default now()
);

create index if not exists kai_document_backups_store_idx    on public.kai_document_backups (store_id, created_at desc);
create index if not exists kai_document_backups_document_idx on public.kai_document_backups (document_id);
create index if not exists kai_document_backups_user_idx     on public.kai_document_backups (user_id);

alter table public.kai_document_backups enable row level security;

drop policy if exists kai_document_backups_select_own on public.kai_document_backups;
create policy kai_document_backups_select_own on public.kai_document_backups
  for select using (auth.uid() = user_id);
drop policy if exists kai_document_backups_insert_own on public.kai_document_backups;
create policy kai_document_backups_insert_own on public.kai_document_backups
  for insert with check (auth.uid() = user_id);
drop policy if exists kai_document_backups_delete_own on public.kai_document_backups;
create policy kai_document_backups_delete_own on public.kai_document_backups
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- updated_at bump on kai_stores.
-- ---------------------------------------------------------------------------
create or replace function public._touch_kai_store()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kai_stores_touch on public.kai_stores;
create trigger kai_stores_touch
  before update on public.kai_stores
  for each row execute function public._touch_kai_store();

-- ---------------------------------------------------------------------------
-- Storage bucket for KAI file backups.
-- Private; all reads issued as signed URLs from edge functions after ownership
-- checks, all writes via service_role. No public storage.objects policies —
-- the bucket is reachable only through kai-evaluator / kai-sync-worker.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('kai-backups', 'kai-backups', false)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- create_provider_api_key — frontend RPC to store a KAI helper key (Azure
-- embedding key or customer source key) the same way as a Cognigy key:
-- encrypted server-side via Vault, only key_last4 retained for display.
-- Mirrors create_api_key but stamps a non-'cognigy' provider.
-- ---------------------------------------------------------------------------
create or replace function public.create_provider_api_key(
  p_customer_id    uuid,
  p_name           text,
  p_key_plaintext  text,
  p_provider       text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_user_id        uuid := auth.uid();
  v_customer_owner uuid;
  v_id             uuid;
  v_enc_key        text := public._get_encryption_key();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_provider not in ('azure_openai', 'source') then
    raise exception 'invalid provider: %', p_provider;
  end if;

  select user_id into v_customer_owner from public.customers where id = p_customer_id;
  if v_customer_owner is null or v_customer_owner <> v_user_id then
    raise exception 'customer not found or access denied';
  end if;

  insert into public.api_keys (customer_id, user_id, name, key_encrypted, key_last4, provider)
  values (
    p_customer_id,
    v_user_id,
    p_name,
    encode(pgp_sym_encrypt(p_key_plaintext, v_enc_key), 'base64'),
    right(p_key_plaintext, 4),
    p_provider
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all    on function public.create_provider_api_key(uuid, text, text, text) from public;
grant execute on function public.create_provider_api_key(uuid, text, text, text) to authenticated;
