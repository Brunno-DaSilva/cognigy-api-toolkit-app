-- Cognigy API Toolkit — initial schema
-- Tables: profiles, projects, api_keys
-- Security: RLS on every table, pgcrypto for API key encryption,
-- SECURITY DEFINER RPCs for encrypt/decrypt so plaintext never leaves the server.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id);

-- Auto-create profile row on signup. display_name comes from raw_user_meta_data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  name                text not null,
  cognigy_project_id  text not null,
  base_url            text not null,
  created_at          timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);

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
-- api_keys
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  name              text not null,
  key_encrypted     text not null,       -- pgp_sym_encrypt output, base64
  key_last4         text not null,       -- only field shown in UI
  secret_encrypted  text,                -- optional, same encoding
  created_at        timestamptz not null default now()
);

create index api_keys_project_id_idx on public.api_keys (project_id);
create index api_keys_user_id_idx    on public.api_keys (user_id);

alter table public.api_keys enable row level security;

-- Users can read their own rows (encrypted blobs are useless without the key)
-- and delete them. Inserts go through create_api_key() so encryption happens
-- server-side; no INSERT/UPDATE policy is exposed to clients.
create policy api_keys_select_own on public.api_keys
  for select using (auth.uid() = user_id);
create policy api_keys_delete_own on public.api_keys
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RPC: create_api_key
-- Encrypts plaintext server-side and inserts the row. Called by the frontend
-- (authenticated role). Verifies project ownership before inserting.
-- ---------------------------------------------------------------------------
create or replace function public.create_api_key(
  p_project_id        uuid,
  p_name              text,
  p_key_plaintext     text,
  p_secret_plaintext  text,
  p_encryption_key    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id       uuid := auth.uid();
  v_project_owner uuid;
  v_id            uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select user_id into v_project_owner from public.projects where id = p_project_id;
  if v_project_owner is null or v_project_owner <> v_user_id then
    raise exception 'project not found or access denied';
  end if;

  insert into public.api_keys (project_id, user_id, name, key_encrypted, key_last4, secret_encrypted)
  values (
    p_project_id,
    v_user_id,
    p_name,
    encode(pgp_sym_encrypt(p_key_plaintext, p_encryption_key), 'base64'),
    right(p_key_plaintext, 4),
    case when p_secret_plaintext is null then null
         else encode(pgp_sym_encrypt(p_secret_plaintext, p_encryption_key), 'base64')
    end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_api_key(uuid, text, text, text, text) from public;
grant execute on function public.create_api_key(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_api_key_plaintext
-- Decrypts and returns plaintext + the project's base_url and cognigy_project_id.
-- ONLY callable by service_role (i.e. from edge functions). The frontend can
-- never call this because the encryption key never leaves the server.
-- ---------------------------------------------------------------------------
create or replace function public.get_api_key_plaintext(
  p_api_key_id     uuid,
  p_encryption_key text
)
returns table (
  key_plaintext       text,
  secret_plaintext    text,
  project_id          uuid,
  base_url            text,
  cognigy_project_id  text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    pgp_sym_decrypt(decode(ak.key_encrypted, 'base64')::bytea, p_encryption_key)::text,
    case when ak.secret_encrypted is null then null
         else pgp_sym_decrypt(decode(ak.secret_encrypted, 'base64')::bytea, p_encryption_key)::text
    end,
    ak.project_id,
    p.base_url,
    p.cognigy_project_id
  from public.api_keys ak
  join public.projects p on p.id = ak.project_id
  where ak.id = p_api_key_id;
end;
$$;

revoke all on function public.get_api_key_plaintext(uuid, text) from public;
grant execute on function public.get_api_key_plaintext(uuid, text) to service_role;
