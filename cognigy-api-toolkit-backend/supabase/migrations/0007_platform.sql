-- ---------------------------------------------------------------------------
-- Platform (Cognigy vs CXone)
--
-- Purely additive. Every existing customer defaults to 'cognigy' and keeps
-- working byte-for-byte. CXone customers hit a different set of hosts and put
-- the API key in an `apikey` header (instead of a `?apikey=` query param) for
-- OData/Analytics calls. The proxy branches on this value.
--
-- Platform is a customer-level attribute (one customer = one platform). It is
-- inherited by that customer's environments, so it lives only on `customers`.
-- ---------------------------------------------------------------------------

alter table public.customers
  add column platform text not null default 'cognigy'
    check (platform in ('cognigy', 'cxone'));

-- ---------------------------------------------------------------------------
-- get_api_key_plaintext — recreate to also return the customer's platform.
-- Return-column changes require DROP + CREATE (CREATE OR REPLACE can't alter
-- the output signature). Existing callers destructure by name and ignore the
-- new column, so this is backward-compatible.
-- ---------------------------------------------------------------------------
drop function if exists public.get_api_key_plaintext(uuid, uuid);

create or replace function public.get_api_key_plaintext(
  p_api_key_id uuid,
  p_project_id uuid default null
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
      -- Prefer env.base_url when the caller specifies a project that's pinned to an env.
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

revoke all    on function public.get_api_key_plaintext(uuid, uuid) from public;
grant execute on function public.get_api_key_plaintext(uuid, uuid) to service_role;
