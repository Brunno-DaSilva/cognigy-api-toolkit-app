-- Cognigy API Toolkit — customer-centric reshape
--
-- Model:
--   profiles ──< customers ──< projects     (a customer is a Cognigy org)
--                       └────< api_keys     (keys are org-scoped, not per-project)
--
-- Cognigy base URL moves up to customers (one region per org).
-- API keys belong to a customer and can be used across that customer's projects;
-- the project a key is used with is selected at API call time, not stored as a join.
--
-- Encryption: API key plaintext is encrypted via pgcrypto with a master key stored
-- in Supabase Vault. The frontend never sees, sends, or stores the master key.
-- This migration auto-generates the master key on first run if it doesn't exist.
--
-- Safe to apply because no rows exist in the v1 projects / api_keys tables yet.

-- ---------------------------------------------------------------------------
-- Drop v1 RPCs and tables that are being reshaped
-- ---------------------------------------------------------------------------
drop function if exists public.create_api_key(uuid, text, text, text, text);
drop function if exists public.get_api_key_plaintext(uuid, text);

drop table if exists public.api_keys cascade;
drop table if exists public.projects cascade;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  base_url    text not null,
  created_at  timestamptz not null default now()
);

create index customers_user_id_idx on public.customers (user_id);

alter table public.customers enable row level security;

create policy customers_select_own on public.customers
  for select using (auth.uid() = user_id);
create policy customers_insert_own on public.customers
  for insert with check (auth.uid() = user_id);
create policy customers_update_own on public.customers
  for update using (auth.uid() = user_id);
create policy customers_delete_own on public.customers
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- projects (now belongs to a customer)
-- ---------------------------------------------------------------------------
create table public.projects (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references public.customers(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  name                text not null,
  cognigy_project_id  text not null,
  created_at          timestamptz not null default now()
);

create index projects_customer_id_idx on public.projects (customer_id);
create index projects_user_id_idx     on public.projects (user_id);

alter table public.projects enable row level security;

create policy projects_select_own on public.projects
  for select using (auth.uid() = user_id);
create policy projects_insert_own on public.projects
  for insert with check (auth.uid() = user_id);
create policy projects_update_own on public.projects
  for update using (auth.uid() = user_id);
create policy projects_delete_own on public.projects
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- api_keys (now belongs to a customer)
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  name              text not null,
  key_encrypted     text not null,       -- pgp_sym_encrypt output, base64
  key_last4         text not null,       -- only field shown in UI
  secret_encrypted  text,                -- optional, same encoding
  created_at        timestamptz not null default now()
);

create index api_keys_customer_id_idx on public.api_keys (customer_id);
create index api_keys_user_id_idx     on public.api_keys (user_id);

alter table public.api_keys enable row level security;

-- Reads + deletes via RLS. Writes that touch the encrypted key value go through
-- create_api_key / update_api_key RPCs so plaintext never lives in a client query.
create policy api_keys_select_own on public.api_keys
  for select using (auth.uid() = user_id);
create policy api_keys_delete_own on public.api_keys
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Vault: auto-create the master encryption key on first run.
-- gen_random_bytes(32) gives 256 bits of entropy; encoded as base64 for storage.
-- Idempotent: only creates if not already present, so re-running the migration
-- never rotates the key (which would orphan existing encrypted rows).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cognigy_encryption_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'cognigy_encryption_key',
      'Master key for encrypting Cognigy API keys at rest (auto-generated)'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- _get_encryption_key — internal helper, reads master key from Vault.
-- SECURITY DEFINER so it can read vault.decrypted_secrets even when called
-- from an authenticated user's session via another SECURITY DEFINER RPC.
-- Not granted to any role; only called from other SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
create or replace function public._get_encryption_key()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, vault
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'cognigy_encryption_key'
  limit 1;
  if v_key is null then
    raise exception 'cognigy_encryption_key not found in vault — run: select vault.create_secret(''<key>'', ''cognigy_encryption_key'');';
  end if;
  return v_key;
end;
$$;

revoke all on function public._get_encryption_key() from public;

-- ---------------------------------------------------------------------------
-- create_api_key — frontend RPC. Encrypts plaintext server-side using Vault.
-- ---------------------------------------------------------------------------
create or replace function public.create_api_key(
  p_customer_id       uuid,
  p_name              text,
  p_key_plaintext     text,
  p_secret_plaintext  text
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

  select user_id into v_customer_owner from public.customers where id = p_customer_id;
  if v_customer_owner is null or v_customer_owner <> v_user_id then
    raise exception 'customer not found or access denied';
  end if;

  insert into public.api_keys (customer_id, user_id, name, key_encrypted, key_last4, secret_encrypted)
  values (
    p_customer_id,
    v_user_id,
    p_name,
    encode(pgp_sym_encrypt(p_key_plaintext, v_enc_key), 'base64'),
    right(p_key_plaintext, 4),
    case when p_secret_plaintext is null or p_secret_plaintext = '' then null
         else encode(pgp_sym_encrypt(p_secret_plaintext, v_enc_key), 'base64')
    end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_api_key(uuid, text, text, text) from public;
grant execute on function public.create_api_key(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_api_key — rename and/or replace the key value.
--   p_new_name null/empty       -> keep existing name
--   p_new_key_plaintext null/'' -> keep existing encrypted value
--   p_new_secret null           -> keep existing secret
--   p_new_secret ''             -> clear the secret
-- Never returns the existing plaintext.
-- ---------------------------------------------------------------------------
create or replace function public.update_api_key(
  p_api_key_id          uuid,
  p_new_name            text,
  p_new_key_plaintext   text,
  p_new_secret_plaintext text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_user_id   uuid := auth.uid();
  v_key_owner uuid;
  v_enc_key   text := public._get_encryption_key();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select user_id into v_key_owner from public.api_keys where id = p_api_key_id;
  if v_key_owner is null or v_key_owner <> v_user_id then
    raise exception 'api key not found or access denied';
  end if;

  update public.api_keys
  set
    name = coalesce(nullif(p_new_name, ''), name),
    key_encrypted = case
      when p_new_key_plaintext is null or p_new_key_plaintext = '' then key_encrypted
      else encode(pgp_sym_encrypt(p_new_key_plaintext, v_enc_key), 'base64')
    end,
    key_last4 = case
      when p_new_key_plaintext is null or p_new_key_plaintext = '' then key_last4
      else right(p_new_key_plaintext, 4)
    end,
    secret_encrypted = case
      when p_new_secret_plaintext is null then secret_encrypted
      when p_new_secret_plaintext = '' then null
      else encode(pgp_sym_encrypt(p_new_secret_plaintext, v_enc_key), 'base64')
    end
  where id = p_api_key_id;
end;
$$;

revoke all on function public.update_api_key(uuid, text, text, text) from public;
grant execute on function public.update_api_key(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_api_key_plaintext — service_role only, called from edge functions.
-- Returns the decrypted key and the customer's base_url.
-- ---------------------------------------------------------------------------
create or replace function public.get_api_key_plaintext(
  p_api_key_id uuid
)
returns table (
  key_plaintext     text,
  secret_plaintext  text,
  customer_id       uuid,
  base_url          text
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_enc_key text := public._get_encryption_key();
begin
  return query
  select
    pgp_sym_decrypt(decode(ak.key_encrypted, 'base64')::bytea, v_enc_key)::text,
    case when ak.secret_encrypted is null then null
         else pgp_sym_decrypt(decode(ak.secret_encrypted, 'base64')::bytea, v_enc_key)::text
    end,
    ak.customer_id,
    c.base_url
  from public.api_keys ak
  join public.customers c on c.id = ak.customer_id
  where ak.id = p_api_key_id;
end;
$$;

revoke all on function public.get_api_key_plaintext(uuid) from public;
grant execute on function public.get_api_key_plaintext(uuid) to service_role;
