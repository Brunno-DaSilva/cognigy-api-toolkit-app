# cognigy-api-toolkit-backend

Supabase backend for the [cognigy-api-toolkit](../cognigy-api-toolkit) React frontend.

Contains:
- Database schema (migrations)
- Row Level Security policies
- Edge functions that proxy Cognigy API calls so raw API keys never touch the browser

## Layout

```
supabase/
├── migrations/
│   └── 0001_initial_schema.sql   profiles, projects, api_keys, RLS, pgcrypto, RPCs
├── functions/
│   └── cognigy-proxy/
│       └── index.ts              Deno edge function — decrypts key + proxies to Cognigy
└── config.toml
```

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

## Deploy the edge function

```sh
supabase functions deploy cognigy-proxy
```

Set the encryption key (used by `pgp_sym_encrypt` to encrypt API keys at rest):

```sh
supabase secrets set COGNIGY_KEY_ENCRYPTION_KEY="<a long random string, treat as a master key>"
```

> Treat this value like a root credential. If it leaks, every stored API key must be rotated.

## Wire up the frontend

In `../cognigy-api-toolkit/.env.local`:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

## How a Cognigy API call flows

1. Frontend calls `supabase.functions.invoke("cognigy-proxy", { body: { api_key_id, path, ... } })`
2. Edge function verifies the user JWT, checks the user owns the `api_key_id` via RLS
3. Edge function calls `get_api_key_plaintext` RPC (service_role) with `COGNIGY_KEY_ENCRYPTION_KEY` to decrypt
4. Edge function calls the Cognigy API with `X-API-Key: <decrypted>` and returns the response

The raw key only exists in memory inside the edge function for the duration of a single request.
