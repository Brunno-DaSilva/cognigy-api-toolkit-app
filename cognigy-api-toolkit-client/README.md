# Cognigy API Toolkit

A full-stack web app for operating Cognigy.AI and CXone projects: pull logs, run
OData analytics, manage snapshots, search every flow in a project, scrape &
chunk content into knowledge files, bulk upload to Knowledge Stores, and
diagnose broken sessions with an AI agent.

Cognigy API keys are **never** exposed to the browser. The frontend only ever
sees the last 4 digits of a key; every call that needs the real key is proxied
through a Supabase Edge Function that decrypts it server-side.

## Architecture

```
cognigy-api-toolkit-app/
├── docs/                            # API ground-truth notes (flow-search-api-reference.md)
├── cognigy-api-toolkit-client/      # React 19 + Vite 8 SPA
│   └── src/
│       ├── pages/                   # Routed pages (admin/, tools/, Landing, Register, Profile)
│       ├── components/              # layout/, ui/, admin/, home/, tools/<Tool>/
│       ├── context/                 # Auth, ActiveProject, Theme, AnalyticsCache, FlowIndex
│       ├── hooks/                   # useFetchLogs, useFetchAnalytics, useSnapshots,
│       │                            #   useScraper, useUploader, useKnowledgeStores,
│       │                            #   useSessionAnalyzer, useProjectAnalytics
│       ├── lib/supabase.js          # Supabase client init
│       ├── constants/               # nav items, type configs, analytics endpoints/columns
│       ├── utils/                   # flowSearch (index + search), parseFile, logCategories
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
| **Analytics** | `/tools/analytics` | Queries the OData API (Cognigy or CXone) — `Analytics` (turns), `Sessions`, and `Conversations` (transcripts). Saved column views, ID masking, row detail drill-down. |
| **Flow Search** | `/tools/flow-search` | Project-wide search across every node in every flow — variables, text, conditions, labels, comments. Plain-text or regex, faceted by node type and flow, results grouped per flow with highlighted snippets and expandable full field text. |
| **Snapshots** | `/tools/snapshots` | Lists, creates, promotes, downloads, and deletes project snapshots. Long-running create/promote runs as a background job; `.csnap` archives live in Supabase Storage. |
| **Scraper** | `/tools/scraper` | Scrapes web URLs or parses local files (PDF/DOCX/ODT/TXT) and chunks them into `.ctxt` knowledge files, downloaded as a ZIP. Download-only. |
| **Uploader** | `/tools/uploader` | Bulk-uploads `.ctxt`/`.txt`/`.pdf` documents into a Cognigy Knowledge Store. Browser-driven batching/throttle/retry; can create new stores. |
| **Session Doctor** | `/tools/session-doctor` | Claude-powered diagnostic agent. Given a session or user ID, it pulls logs via tools, reasons about what went wrong, and answers follow-up questions. |

Admin pages manage **customers**, their **projects**, **environments**, and
**API keys** (`/home`, `/admin/customers`, `/admin/projects`, `/profile`).

`/home` also shows **project analytics** for the active customer + project:
total sessions, a sessions-per-day chart for the last 5 days (from
`/v2.0/conversations`), and the most-used tasks grouped by name (from the
cursor-paginated `/v2.0/tasks`). The two sections load independently, so a
failure in one doesn't blank the other.

### Flow Search indexing

Flow Search reads flow content from the **live chart** endpoint rather than from
snapshots — snapshot `.csnap` archives are encrypted, so their node content
isn't readable. Indexing therefore walks the project: list flows via
`/new/v2.0/flows`, then fetch `/v2.0/flows/{mongoId}/chart` per flow (throttled,
~120 ms apart) and flatten every node into searchable records.

Indexing is owned by `FlowIndexContext`, mounted **above** the router outlet, so:

- it starts automatically when a project is selected (including the selection
  restored on login) and keeps running while you navigate between other tools;
- results are cached per `customer + project`, so returning to an already-indexed
  project is instant;
- switching projects abandons the in-flight run instead of mixing results.

Search itself is pure and in-memory (`utils/flowSearch.js`) — no request per
keystroke. Node **code bodies are absent from the chart payload**, so Code node
JavaScript is not searchable. See `docs/flow-search-api-reference.md` for the
verified endpoint/auth details.

## Edge Functions

All functions require `Authorization: Bearer <Supabase user JWT>`. Ownership of
an `api_key` is enforced via RLS using the caller's JWT *before* the key is
decrypted with `service_role` — the raw key never reaches the browser.

| Function | Purpose |
|----------|---------|
| `cognigy-proxy` | Generic Cognigy proxy. `rest` transport (`X-API-Key`) and `odata` transport, which branches on the customer's platform (see below). Backs Get Logs, Analytics, Flow Search, Home analytics, and knowledge-store list/create. |
| `cognigy-snapshots` | Synchronous snapshot primitives: `list_remote`, `sign_download` (5-min signed URL), `delete_from_store`. |
| `snapshot-worker` | Long-running snapshot create/promote jobs. |
| `scraper` | Stateless URL fetch + HTML/document chunking into `.ctxt`. No server-side persistence. |
| `knowledge-upload` | Multipart upload of one document into a Knowledge Store (cognigy-proxy is JSON-only, so uploads have their own function). |
| `session-analyzer` | Claude diagnostic agent. Decrypts the Cognigy key, calls a `get_logs` tool, and reasons over the session. Both the Cognigy key and the Anthropic key stay server-side. |

## Platform: Cognigy vs CXone

Platform is a **customer-level** attribute (`customers.platform`, one of
`cognigy` / `cxone`) and is inherited by that customer's environments. It's set
when the customer is created — either from a region preset or inferred from a
pasted custom base URL. Existing customers default to `cognigy`.

`cognigy-proxy` branches on it for OData/Analytics calls:

| | Cognigy | CXone |
|---|---|---|
| API host | `api-app-{region}.cognigy.ai` | `cognigy-api-{region}.nicecxone.com` |
| OData host | `api-{region}.cognigy.ai` | `cognigy-odata-{region}.nicecxone.com` |
| OData auth | `?apikey=` query param | `apikey` request header |

REST calls use the `X-API-Key` header on both platforms. The platform is
returned alongside the decrypted key by `get_api_key_plaintext`, so the browser
never needs to know which host or auth form applies.

## Data model

Customer-centric schema (`migrations/`). RLS isolates every row to its owning
user — no user can read another user's data.

- `0001_initial_schema` — profiles, projects, api_keys
- `0002_customer_centric_schema` — customers as the top-level entity; Vault-based key encryption
- `0003_snapshots`, `0004_snapshots_import` — snapshot tracking + import
- `0005_avatars_storage` — profile avatar storage bucket
- `0006_environments` — optional per-customer environments (base_url override; legacy `customer.base_url` fallback)
- `0007_platform` — `customers.platform` (`cognigy` | `cxone`); `get_api_key_plaintext` recreated to also return it

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
