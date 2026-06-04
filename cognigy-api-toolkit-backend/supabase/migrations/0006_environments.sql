-- ---------------------------------------------------------------------------
-- Environments
--
-- Purely additive: every existing customer keeps its current `base_url` and
-- continues to work unchanged. Environments are optional. When a project is
-- assigned to an env, calls go to env.base_url; otherwise calls keep using
-- customer.base_url (legacy fallback).
-- ---------------------------------------------------------------------------

create table public.environments (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  base_url     text not null,
  created_at   timestamptz not null default now()
);

create index environments_customer_id_idx on public.environments (customer_id);
create index environments_user_id_idx     on public.environments (user_id);

alter table public.environments enable row level security;

create policy environments_select_own on public.environments
  for select using (auth.uid() = user_id);
create policy environments_insert_own on public.environments
  for insert with check (auth.uid() = user_id);
create policy environments_update_own on public.environments
  for update using (auth.uid() = user_id);
create policy environments_delete_own on public.environments
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- projects.environment_id (nullable — projects can stay unassigned)
-- ---------------------------------------------------------------------------
alter table public.projects
  add column environment_id uuid
    references public.environments(id) on delete set null;

create index projects_environment_id_idx on public.projects (environment_id);

-- ---------------------------------------------------------------------------
-- get_api_key_plaintext — drop the old signature and recreate with optional
-- project_id. When project_id is given AND the project has an environment_id,
-- we return env.base_url; otherwise we return the customer.base_url (legacy).
-- ---------------------------------------------------------------------------
drop function if exists public.get_api_key_plaintext(uuid);

create or replace function public.get_api_key_plaintext(
  p_api_key_id uuid,
  p_project_id uuid default null
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
    coalesce(
      -- Prefer env.base_url when the caller specifies a project that's pinned to an env.
      (select e.base_url
         from public.projects p
         join public.environments e on e.id = p.environment_id
         where p.id = p_project_id),
      c.base_url
    ) as base_url
  from public.api_keys ak
  join public.customers c on c.id = ak.customer_id
  where ak.id = p_api_key_id;
end;
$$;

revoke all    on function public.get_api_key_plaintext(uuid, uuid) from public;
grant execute on function public.get_api_key_plaintext(uuid, uuid) to service_role;
