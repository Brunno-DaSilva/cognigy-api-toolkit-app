# Cognigy API Toolkit

A full-stack web app for operating Cognigy.AI projects: pull logs, run OData
analytics, manage snapshots, scrape & chunk content into knowledge files, bulk
upload to Knowledge Stores, and diagnose broken sessions with an AI agent.

Cognigy API keys are **never** exposed to the browser. The frontend only ever
sees the last 4 digits of a key; every call that needs the real key is proxied
through a Supabase Edge Function that decrypts it server-side.

## Architecture

```
cognigy-api-toolkit-app/
├── cognigy-api-toolkit-client/      # React 19 + Vite 8 SPA
│   └── src/
│       ├── pages/                   # Routed pages (admin/, tools/, Landing, Register, Profile)
│       ├── components/              # layout/, ui/, admin/, tools/<Tool>/
│       ├── context/                 # Auth, ActiveProject, Theme, AnalyticsCache
│       ├── hooks/                   # useFetchLogs, useFetchAnalytics, useSnapshots,
│       │                            #   useScraper, useUploader, useKnowledgeStores,
│       │                            #   useSessionAnalyzer
│       ├── lib/supabase.js          # Supabase client init
│       ├── constants/ utils/        # nav items, type configs, file parsing helpers
│       └── styles/index.css         # Custom design system (no UI library)
└── cognigy-api-toolkit-backend/
    └── supabase/
        ├── functions/               # Deno Edge Functions (see below)
        └── migrations/              # Postgres schema + RLS
```

### Stack

- **Frontend:** React 19, Vite 8, React Router 7, Recharts, lucide-react
- **File handling:** jszip, mammoth (DOCX), papaparse (CSV), pdfjs-dist (PDF), xlsx
- **Backend:** Supabase (Postgres + Auth + RLS + Storage + Edge Functions on Deno)
- **AI:** Anthropic Claude (`claude-opus-4-8`) for the Session Doctor agent

## Tools

The app is a customer-centric console. Pick an active customer/project (and
optionally an environment), then use the tools:

| Tool | Route | What it does |
|------|-------|--------------|
| **Get Logs** | `/tools/logs` | Fetches all project log entries with full auto-pagination (HAL+JSON, 100/page), filterable by type/flow/user/date, exports to a single JSON file. |
| **Analytics** | `/tools/analytics` | Queries the Cognigy OData API — `Analytics` (turns), `Sessions`, and `Conversations` (transcripts). Saved column views, ID masking, row detail drill-down. |
| **Snapshots** | `/tools/snapshots` | Lists, creates, promotes, downloads, and deletes project snapshots. Long-running create/promote runs as a background job; `.csnap` archives live in Supabase Storage. |
| **Scraper** | `/tools/scraper` | Scrapes web URLs or parses local files (PDF/DOCX/ODT/TXT) and chunks them into `.ctxt` knowledge files, downloaded as a ZIP. Download-only. |
| **Uploader** | `/tools/uploader` | Bulk-uploads `.ctxt`/`.txt`/`.pdf` documents into a Cognigy Knowledge Store. Browser-driven batching/throttle/retry; can create new stores. |
| **Session Doctor** | `/tools/session-doctor` | Claude-powered diagnostic agent. Given a session or user ID, it pulls logs via tools, reasons about what went wrong, and answers follow-up questions. |

Admin pages manage **customers**, their **projects**, **environments**, and
**API keys** (`/home`, `/admin/customers`, `/admin/projects`, `/profile`).

## Edge Functions

All functions require `Authorization: Bearer <Supabase user JWT>`. Ownership of
an `api_key` is enforced via RLS using the caller's JWT *before* the key is
decrypted with `service_role` — the raw key never reaches the browser.

| Function | Purpose |
|----------|---------|
| `cognigy-proxy` | Generic Cognigy proxy. `rest` transport (`X-API-Key`) and `odata` transport (`?apikey=`). Backs Get Logs, Analytics, and knowledge-store list/create. |
| `cognigy-snapshots` | Synchronous snapshot primitives: `list_remote`, `sign_download` (5-min signed URL), `delete_from_store`. |
| `snapshot-worker` | Long-running snapshot create/promote jobs. |
| `scraper` | Stateless URL fetch + HTML/document chunking into `.ctxt`. No server-side persistence. |
| `knowledge-upload` | Multipart upload of one document into a Knowledge Store (cognigy-proxy is JSON-only, so uploads have their own function). |
| `session-analyzer` | Claude diagnostic agent. Decrypts the Cognigy key, calls a `get_logs` tool, and reasons over the session. Both the Cognigy key and the Anthropic key stay server-side. |

## Data model

Customer-centric schema (`migrations/`). RLS isolates every row to its owning
user — no user can read another user's data.

- `0001_initial_schema` — profiles, projects, api_keys
- `0002_customer_centric_schema` — customers as the top-level entity; Vault-based key encryption
- `0003_snapshots`, `0004_snapshots_import` — snapshot tracking + import
- `0005_avatars_storage` — profile avatar storage bucket
- `0006_environments` — optional per-customer environments (base_url override; legacy `customer.base_url` fallback)

API keys are stored encrypted (Supabase Vault). The UI receives only
`key_last4`; the full key is decrypted server-side inside the Edge Functions.

## Getting started

### Client

```bash
cd cognigy-api-toolkit-client
npm install
npm run dev        # Vite dev server
npm run build      # production build
npm run lint       # ESLint
```

Create `.env` in `cognigy-api-toolkit-client/`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### Backend

The client points at **cloud Supabase** (project `ewhgmukcjbzrunhduryw`).
Editing a function requires deploying it:

```bash
cd cognigy-api-toolkit-backend
supabase functions deploy <name>     # e.g. cognigy-proxy, session-analyzer
supabase db push                     # apply migrations
```

Edge Function secrets (set in the Supabase dashboard / `supabase secrets set`):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`ANTHROPIC_API_KEY` (for `session-analyzer`).

## Security principles

- Cognigy API keys are encrypted at rest and never returned raw to the frontend.
- All Cognigy calls are proxied server-side through Edge Functions.
- RLS enforces per-user data isolation at the database level.
- Auth, email confirmation, and RLS are kept on — not weakened for convenience.
