-- Cognigy API Toolkit — Project discovery
--
-- Projects are no longer typed in by hand: the Customer page lists what the
-- customer's API key can actually see in Cognigy and imports the chosen ones.
--
-- Discovery has to be able to target an environment *before* any project is
-- pinned to it — a customer's QA projects live on the QA host, and until now
-- get_api_key_plaintext could only reach an env base_url through an existing
-- project. This adds an explicit p_environment_id.
--
-- Resolution order for base_url:
--   1. p_environment_id           (explicit — used by discovery)
--   2. the project's environment   (existing behaviour)
--   3. the customer's base_url     (legacy fallback)

-- The 2-arg signature is dropped rather than kept: leaving both would make
-- get_api_key_plaintext(p_api_key_id, p_project_id) ambiguous to resolve.
drop function if exists public.get_api_key_plaintext(uuid, uuid);

create or replace function public.get_api_key_plaintext(
  p_api_key_id     uuid,
  p_project_id     uuid default null,
  p_environment_id uuid default null
)
returns table (
  key_plaintext     text,
  secret_plaintext  text,
  customer_id       uuid,
  base_url          text,
  platform          text
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
      -- An explicitly named environment wins: project discovery has no project
      -- to infer it from yet.
      (select e.base_url
         from public.environments e
        where e.id = p_environment_id
          and e.customer_id = ak.customer_id),
      -- Otherwise prefer env.base_url when the project is pinned to an env.
      (select e.base_url
         from public.projects p
         join public.environments e on e.id = p.environment_id
         where p.id = p_project_id),
      c.base_url
    ) as base_url,
    c.platform
  from public.api_keys ak
  join public.customers c on c.id = ak.customer_id
  where ak.id = p_api_key_id;
end;
$$;

revoke all    on function public.get_api_key_plaintext(uuid, uuid, uuid) from public;
grant execute on function public.get_api_key_plaintext(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- One row per (customer, cognigy project, environment).
--
-- Discovery imports in bulk, so the same project must not be able to land
-- twice. Environment is part of the key on purpose: the same Cognigy project id
-- can legitimately exist in two environments, and unpinned (null env) rows are
-- treated as distinct from pinned ones.
--
-- Pre-existing duplicates would make this fail loudly rather than silently
-- dropping rows; if the push errors here, delete the duplicate project first.
-- ---------------------------------------------------------------------------
create unique index if not exists projects_customer_cognigy_env_uniq
  on public.projects (customer_id, cognigy_project_id, coalesce(environment_id, '00000000-0000-0000-0000-000000000000'::uuid));
