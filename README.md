# Cognigy API Toolkit

A web app that wraps the Cognigy.AI REST API with workflows that are missing or painful in the Cognigy GUI:

- **Get Logs** — bulk-export every log entry for a project with full auto-pagination, filtering, and a one-click JSON download.
- **Snapshots** — overcome Cognigy's 10-snapshot-per-project cap with a persistent toolkit-side store (10 archived slots beyond Cognigy's 10), semantic versioning (`v1.2.0`) with a changelog per version, and one-click promote a snapshot to the same env (restore) or a different env (cross-env upload with automatic safety backup).
- **Project discovery** — import a customer's projects straight from Cognigy instead of pasting 24-character project ids, per environment.

API keys never touch the browser. They live encrypted in Postgres (via `pgcrypto` and a Supabase Vault-stored master key) and are decrypted only inside Edge Functions for the duration of a single Cognigy call.

## Architecture

```
┌────────────────────┐         ┌──────────────────────────────┐         ┌──────────────────┐
│  React + Vite SPA  │  JWT    │  Supabase                    │   key   │  Cognigy.AI API  │
│  (cognigy-api-     │ ──────► │  • Postgres (RLS)            │ ─────►  │                  │
│   toolkit-client)  │         │  • Vault (master key)        │         │  /v2.0/...       │
│                    │         │  • Storage (private bucket)  │         │                  │
│                    │         │  • Edge Functions (Deno)     │         │                  │
└────────────────────┘         └──────────────────────────────┘         └──────────────────┘
```

- **Frontend** is a React 18 + Vite SPA. No UI component library — all styling is custom CSS.
- **Backend** is Supabase: Postgres with Row Level Security for data isolation, Vault for the API-key encryption master key, Storage for `.csnap` binaries, and Edge Functions (Deno) as the only path through which the raw Cognigy API key is ever decrypted.

## Repo layout

```
cognigy-api-toolkit-app/
├── cognigy-api-toolkit-client/        React + Vite SPA
│   ├── src/
│   │   ├── pages/                     Route components
│   │   │   ├── tools/Snapshots.jsx    Snapshots two-list view
│   │   │   ├── tools/Logs.jsx         Get Logs tool wrapper
│   │   │   └── admin/...              Customers, projects, API keys
│   │   ├── components/
│   │   │   ├── tools/Snapshots/       Snapshot row/modal/progress
│   │   │   ├── tools/GetLogs/         Log fetcher UI
│   │   │   └── ui/                    Card, Modal, ConfirmDialog, Terminal, ...
│   │   ├── hooks/
│   │   │   ├── useSnapshots.js        Merges Cognigy live list + DB rows + polls jobs
│   │   │   └── useFetchLogs.js        Auto-paginating log fetcher
│   │   ├── context/
│   │   │   ├── AuthContext.jsx        Supabase session
│   │   │   └── ActiveProjectContext.jsx
│   │   ├── lib/supabase.js
│   │   └── styles/index.css
│   └── package.json
│
└── cognigy-api-toolkit-backend/       Supabase backend
    └── supabase/
        ├── migrations/
        │   ├── 0001_initial_schema.sql
        │   ├── 0002_customer_centric_schema.sql
        │   ├── 0003_snapshots.sql
        │   ├── 0004_snapshots_import.sql
        │   ├── 0005_avatars_storage.sql
        │   ├── 0006_environments.sql
        │   ├── 0007_platform.sql
        │   ├── 0008_snapshot_versioning.sql
        │   └── 0009_project_discovery.sql
        ├── functions/
        │   ├── cognigy-proxy/         Generic REST proxy (decrypt key + forward)
        │   ├── cognigy-snapshots/     Snapshot UI primitives (list, sign-url, delete)
        │   └── snapshot-worker/       State machine for create / import / promote jobs
        └── config.toml
```

## Tech stack

| Layer    | Choice                                                      |
| -------- | ----------------------------------------------------------- |
| Frontend | React 18, Vite, react-router-dom v6, lucide-react, recharts |
| Backend  | Supabase (Postgres, Vault, Storage, Auth, Edge Functions)   |
| Crypto   | `pgcrypto` (`pgp_sym_encrypt`), Vault-stored master key     |
| Runtime  | Deno (Edge Functions), npm:`@supabase/supabase-js@2`        |

## Setup

### Prerequisites

- Node 18+
- `npx supabase` (the Supabase CLI runs via npx — no global install needed)
- A Supabase project (note its project ref, URL, anon key)

### Backend

From `cognigy-api-toolkit-backend/`:

```sh
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npx supabase functions deploy cognigy-proxy
npx supabase functions deploy cognigy-snapshots
npx supabase functions deploy snapshot-worker
```

Order matters after a schema change: `db push` first. The client calls
`start_snapshot_job` with the versioning arguments added in `0008`, so until that
migration lands, taking a snapshot fails with *"Could not find the function
public.start_snapshot_job(...) in the schema cache"*.

The migrations are idempotent against an existing prod DB *only if* migration tracking is already in sync. If `db push` complains about tables already existing, mark earlier migrations as applied:

```sh
npx supabase migration repair --status applied 0001
npx supabase migration repair --status applied 0002
```

then re-run `db push`.

### Frontend

From `cognigy-api-toolkit-client/`:

```sh
cp .env.example .env.local   # then edit
# VITE_SUPABASE_URL=https://<project-ref>.supabase.co
# VITE_SUPABASE_ANON_KEY=<anon-key>

npm install
npm run dev
```

App is at `http://localhost:5173`.

## Data model

```
profiles (= auth.users)
   │
   └─< customers       one row per Cognigy installation (DEV, QA, PROD, ...)
         ├─ base_url   e.g. https://api-app-us.cognigy.ai
         │
         ├─< api_keys  encrypted; only key_last4 returned to UI
         │
         └─< projects
               ├─ cognigy_project_id
               │
               ├─< snapshots                  current + archived lists, 10 each
               │     ├─ status                'current' | 'archived'
               │     ├─ cognigy_snapshot_id   null once archived
               │     └─ storage_path          path in Supabase Storage bucket 'snapshots'
               │
               └─< snapshot_promotions        job state machine for long-running ops
                     ├─ kind                  'create' | 'import' | 'promote_same' | 'promote_cross'
                     ├─ status                'pending' | 'running' | 'done' | 'failed'
                     ├─ step                  current step name
                     └─ log                   per-step JSON log entries
```

All tables are protected by RLS: a user only ever sees rows where `user_id = auth.uid()`.

## Project discovery

On a customer page, **Import from Cognigy** lists the projects that customer's API key
can actually see (`GET /new/v2.0/projects` through `cognigy-proxy`, paged 100 at a time)
and imports the selected ones. Everything not already imported is pre-selected, so the
common case is one click. Projects already present are shown greyed out with an
"Imported" badge rather than hidden, so the list matches what's in Cognigy.

Environment is part of the flow, not an afterthought: the picked environment decides which
host is listed *and* what the imported rows are pinned to. That required
`get_api_key_plaintext` to accept an explicit `p_environment_id` (migration `0009`) —
previously an env base_url was only reachable through a project already pinned to it,
which is a chicken-and-egg problem when the projects don't exist yet.

`+ Add manually` is still there for one-offs and for editing an existing project.

## Snapshot system

The headline feature. Cognigy caps snapshots at 10 per project; this toolkit gives you 20 effective slots (10 live in Cognigy + 10 archived in our Storage) and one-click promotion across environments.

### The two lists

| Section      | Source of truth          | What it shows                                                    |
| ------------ | ------------------------ | ---------------------------------------------------------------- |
| **Current**  | Cognigy `GET /snapshots` | What's actually in Cognigy right now (max 10).                   |
| **Archived** | Our DB                   | Snapshots evicted from Cognigy but kept in our Storage (max 10). |

For each row in **Current**, the UI checks our DB for a matching `cognigy_snapshot_id`. If found with a `storage_path`, Download and Promote are enabled. If not (snapshot was taken via the Cognigy GUI, never through this app), the row shows a "Cognigy only" badge with an **Import to store** button.

### Job kinds

The four workflows that mutate Cognigy state are run by the `snapshot-worker` Edge Function as state-machine jobs persisted in `snapshot_promotions`:

| Kind            | Use case                                | Steps                                                                                  |
| --------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `create`        | "Take snapshot" button                  | evict → create → poll → package → poll → download → insert                             |
| `import`        | "Import to store" on a Cognigy-only row | package → poll → download → insert                                                     |
| `promote_same`  | Promote modal, same target as source    | evict → safety snapshot (create → package → download → insert) → restore → poll        |
| `promote_cross` | Promote modal, different target         | evict → safety snapshot (...same as above) → evict again → upload (multipart) → poll   |

### Eviction policy

Before any new snapshot lands in Cognigy, the worker calls `evictCurrentIfNeeded`:

1. Fetch Cognigy's live list (Cognigy is authoritative).
2. If fewer than 10, return — there's room.
3. Otherwise pick the oldest by `createdAt` and look up its DB row.
   - If the row exists and has `storage_path` → delete from Cognigy, flip our row to `archived`.
   - If not → **fail the job** with an actionable error directing the user to **Import** that snapshot first. We never silently destroy a snapshot's binary.
4. If the archive is itself at 10, the oldest archived row + its `.csnap` are hard-deleted to make room.

A defensive Postgres trigger also rejects any insert/update that would push either list past 10, so eviction bugs surface as loud failures rather than silent overcounts.

### Polling model

The worker advances jobs one logical step per HTTP invocation. The UI polls `snapshot_promotions` (and re-invokes the worker) every 2.5s while a job is `pending`/`running`. Long-running Cognigy tasks (create, package, upload, restore) show up as `polling_*` steps; the worker checks `GET /v2.0/tasks/{id}` once per invocation and returns unchanged if it's still `queued`/`active`.

The page renders the job's `log` array as a terminal-style stream so users see progress in real time.

### Versioning and naming

Snapshots are semantic versions: `v<major>.<minor>.<patch>`. **Take snapshot** opens a
modal that reads the project's existing snapshots, shows the version it's on, and asks
for two things — the bump (major / minor / patch) and a description of what changed.
Both are required; the confirm button stays disabled until they're filled in, and
`start_snapshot_job` rejects a `create` without them. The description is stored as the
snapshot's description in Cognigy and doubles as the changelog shown on each row.

**A version travels with the artifact.** Each project computes its own next version for
snapshots it creates, but promoting keeps the source name — Dev's `v1.2.0` arrives in QA
as `v1.2.0`, so one version is traceable across environments. On cross-env promote the
version is sent as the upload filename and, once the upload lands, the worker checks the
new snapshot's name in the target and `PATCH`es it if Cognigy named it from inside the
`.csnap` instead. That rename is best-effort: it logs a warning rather than failing an
otherwise successful promote.

| Kind                        | Name pattern                          | Version column        |
| --------------------------- | ------------------------------------- | --------------------- |
| `create` (user-initiated)   | `v1.2.0`                              | the version           |
| `import`                    | whatever Cognigy already calls it     | set if the name parses |
| safety snapshot (promote_*) | `v1.1.0_pre-promote_MMM-DD-YYYY`      | null — a rollback point isn't a release |

The baseline version is the highest parseable `vX.Y.Z` across Cognigy's live list and our
archive; legacy date-based names simply don't parse. A project with no versioned history
starts at `v1.0.0` whichever bump is picked. A safety-snapshot name still parses, so it
can never push the baseline past a version that already exists.

### One click, one snapshot

`claim_snapshot_job` makes advancing a job exclusive at the DB level: a single
`UPDATE ... WHERE` re-checks its predicate after any concurrent writer commits, so of two
simultaneous workers exactly one proceeds, and a 150s lease means a worker that dies
mid-step doesn't wedge the job. The client also enqueues once and lets the poll loop make
the first worker call — previously it kicked the worker directly *and* the poll loop's
first tick fired for the same job, so both saw `step = null` and each POSTed its own
create-snapshot to Cognigy. The DB claim is what makes this hold across page refreshes
and a second browser tab.

### Edge Function summary

| Function            | Trigger                         | Responsibilities                                                                                       |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cognigy-proxy`     | Get Logs UI                     | Generic JSON proxy for Cognigy REST. Used by `useFetchLogs.js`.                                        |
| `cognigy-snapshots` | Snapshots UI (read/sign/delete) | Actions: `list_remote`, `sign_download`, `delete_from_store`.                                          |
| `snapshot-worker`   | Snapshots UI (write/mutate)     | Drives `snapshot_promotions` state machine. The only thing that mutates `snapshots` and Cognigy state. |

All three follow the same pattern: verify the JWT, check ownership via the user's RLS-scoped client, then call `get_api_key_plaintext` (service role) to decrypt the API key for outbound Cognigy calls.

### Cognigy endpoints used

Base URL is the `customer.base_url` (e.g. `https://api-app-us.cognigy.ai`). All paths below are appended to that base.

| Verb   | Path                                                                   | Purpose                                                                      |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/new/v2.0/snapshots?projectId=...`                                    | List snapshots                                                               |
| POST   | `/new/v2.0/snapshots`                                                  | Create snapshot (returns task `_id`)                                         |
| POST   | `/new/v2.0/snapshots/{id}/package`                                     | Package for download (returns task)                                          |
| GET    | `/new/v2.0/snapshots/{id}/download` *(unverified — see worker source)* | Stream `.csnap` binary                                                       |
| POST   | `/new/v2.0/snapshots/upload`                                           | Upload multipart (`file`, `projectId`)                                       |
| POST   | `/new/v2.0/snapshots/{id}/restore`                                     | Restore (returns task)                                                       |
| DELETE | `/new/v2.0/snapshots/{id}`                                             | Delete                                                                       |
| GET    | `/new/v2.0/tasks/{id}`                                                 | Poll task status (`queued`/`active`/`done`/`error`/`cancelling`/`cancelled`) |

The download endpoint is the one path that couldn't be confirmed against `docs.cognigy.com`. The best-guess `GET /snapshots/{id}/download` is encoded as a constant `C_DOWNLOAD` at the top of `snapshot-worker/index.ts` — if a real-world test shows it's different, that's a one-line fix.

## Known limitations

- **Binary buffering.** The worker holds each `.csnap` in memory (as a Blob) for the download→Storage hop and the Storage→upload hop. Comfortable for typical snapshots (tens of MB); a true >100MB snapshot may hit Edge Function memory caps. True streaming would require redesigning that hop.
- **No automatic rollback on partial failures.** If a multi-step job fails halfway, the job row goes to `status='failed'` with the error in `error_message`. Anything already pushed to Cognigy (e.g. a safety snapshot in `promote_cross`) is left for manual cleanup.
- **Concurrent worker invocations are not locked.** Two browser tabs polling the same job could each advance a step in parallel. Acceptable at current scale; a fix would be to add a `lock_token`/`lock_until` to `snapshot_promotions` and `select ... for update skip locked`.
- **Restoring an archived snapshot via `promote_same`** isn't supported yet — the worker would need to re-upload it to Cognigy first to obtain a `cognigy_snapshot_id`. Throws a clear error if attempted.

## What's next

- Surface the source snapshot's original Cognigy name/description on imports (currently overwritten with the `imported_*` convention).
- Re-upload-then-restore path for archived snapshots in `promote_same`.
- Streaming download/upload for very large snapshots.
- Cron-driven worker fallback for jobs whose UI tab was closed mid-run.
