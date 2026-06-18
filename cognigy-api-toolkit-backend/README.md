# cognigy-api-toolkit-backend

Supabase backend for the [cognigy-api-toolkit](../cognigy-api-toolkit-client)
React frontend.

Contains:
- Database schema and Row Level Security policies (migrations)
- Storage buckets (avatars, snapshot `.csnap` archives)
- Edge Functions that proxy Cognigy.AI calls so raw API keys never touch the browser

The client points at **cloud Supabase** (project `ewhgmukcjbzrunhduryw`). Any
function edit must be redeployed and any schema change pushed before it takes
effect in the app.

## Layout

```
supabase/
├── config.toml          # local dev config (vector analytics disabled)
├── migrations/          # Postgres schema + RLS, applied in filename order
└── functions/           # Deno Edge Functions (one folder each)
```

## Edge Functions

Every function requires `Authorization: Bearer <Supabase user JWT>`. Ownership
of an `api_key` is enforced via RLS using the caller's JWT **before** the key is
decrypted with `service_role`, so the raw Cognigy key is never returned to the
browser.

| Function | Purpose |
|----------|---------|
| `cognigy-proxy` | Generic Cognigy proxy. `rest` transport (`api-app-{region}.cognigy.ai`, `X-API-Key`) and `odata` transport (`odata-app-{region}.cognigy.ai/v2.4`, `?apikey=`). JSON only. Backs Get Logs, Analytics, and knowledge-store list/create. |
| `cognigy-snapshots` | Synchronous snapshot primitives: `list_remote`, `sign_download` (5-min signed Storage URL), `delete_from_store`. |
| `snapshot-worker` | State machine over `snapshot_promotions` rows. Job kinds: `create`, `promote_same`, `promote_cross`, `import`. Advances a job until it hits a polling step; the UI re-invokes until `done`/`failed`. Enforces Cognigy's 10-snapshot eviction rules. |
| `scraper` | Stateless. `urls[]` (server-side fetch + HTML extraction) or `documents[]` (text already extracted client-side); both chunk into `.ctxt`. Nothing persisted server-side. |
| `knowledge-upload` | Multipart upload of one document (`.ctxt`/`.txt`/`.pdf`) into a Knowledge Store — separate from `cognigy-proxy` because that one is JSON only. Browser drives batching/throttle/retry. |
| `session-analyzer` | Claude (`claude-opus-4-8`) diagnostic agent. Decrypts the Cognigy key, calls a `get_logs` tool, reasons over the session, and answers follow-ups. Both the Cognigy key and the Anthropic key stay server-side. |

## Migrations

Applied in filename order. RLS isolates every row to its owning user — no user
can read another user's data.

| Migration | Adds |
|-----------|------|
| `0001_initial_schema` | profiles, projects, api_keys (original pgcrypto-based schema) |
| `0002_customer_centric_schema` | customers as the top-level entity; **Vault-based** API key encryption + RPCs (`create_api_key`, `update_api_key`, `get_api_key_plaintext`) |
| `0003_snapshots` | snapshot tracking tables |
| `0004_snapshots_import` | import of Cognigy-only snapshots into the store |
| `0005_avatars_storage` | profile avatar Storage bucket |
| `0006_environments` | optional per-customer environments (base_url override; legacy `customer.base_url` fallback) |

API keys are stored encrypted with `pgp_sym_encrypt`. The master key lives in
**Supabase Vault** (secret `cognigy_encryption_key`, auto-created on first run by
the `0002` migration). The frontend never sees, sends, or stores it — the UI
only receives `key_last4`. Decryption happens inside `get_api_key_plaintext`
(SECURITY DEFINER), called by the Edge Functions with `service_role`.

## One-time setup

1. Install the Supabase CLI: https://supabase.com/docs/guides/cli/getting-started
2. Create a project at https://supabase.com (note the **project ref**, **URL**, and **anon key**)
3. From this folder:
   ```sh
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

## Apply the schema

```sh
supabase db push
```

The Vault master key is created automatically by `0002`. To rotate it (or seed
it manually), run in the SQL editor:

```sql
select vault.create_secret('<a long random string>', 'cognigy_encryption_key');
```

> Treat this value like a root credential. If it leaks, every stored API key
> must be rotated.

## Deploy the Edge Functions

```sh
supabase functions deploy cognigy-proxy
supabase functions deploy cognigy-snapshots
supabase functions deploy snapshot-worker
supabase functions deploy scraper
supabase functions deploy knowledge-upload
supabase functions deploy session-analyzer
```

Set the function secrets:

```sh
# All functions
supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
# session-analyzer only
supabase secrets set ANTHROPIC_API_KEY=...
```

## Wire up the frontend

In `../cognigy-api-toolkit-client/.env`:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

## How a Cognigy API call flows

1. Frontend calls `supabase.functions.invoke("cognigy-proxy", { body: { api_key_id, path, ... } })`
2. The function verifies the user JWT and checks the user owns the `api_key_id` via RLS
3. It calls the `get_api_key_plaintext` RPC (service_role), which reads the master key from Vault and decrypts
4. It calls the Cognigy API with `X-API-Key: <decrypted>` (or `?apikey=` for OData) and returns the response

The raw key only exists in memory inside the function for the duration of a
single request.
