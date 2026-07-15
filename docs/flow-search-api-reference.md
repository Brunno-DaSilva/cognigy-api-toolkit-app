# Flow Search — Cognigy API Reference (Step 1)

Ground-truth notes for the Project-Wide Flow Search tool. Verified against a live
tenant on 2026-07-15 using a real flow chart response (a Mariner IT voice flow).

## Auth & base URL

- **Base URL**: per-customer, e.g. `https://api-app-us.cognigy.ai` (stored in
  `customers.base_url` / `environments.base_url`; injected server-side by the
  `cognigy-proxy` edge function).
- **Auth**: header `X-API-Key: <key>`. **NOT** `?apikey=` — that query-param form
  is only for the OData analytics endpoints and returns `401` on the REST API.
- **Prefix**: management resources (flows, snapshots) live under **`/new/v2.0/`**.
  (Confirmed: `/new/v2.0/flows/{id}/chart` returns `200`; a wrong path returns
  `404`, a bad auth returns `401`.)

## Endpoints

### List flows in a project
```
GET /new/v2.0/flows?projectId={cognigyProjectId}&limit=100
Header: X-API-Key: <key>
```
Paginated (skip/limit expected — reuse the `fetchAllRest` dedupe-and-stop pattern
from `useProjectAnalytics.js`). Grab `flowId`s here.

### Read a flow's chart (node content) — PRIMARY SOURCE
```
GET /v2.0/flows/{flowMongoId}/chart      ⚠ /v2.0, NOT /new/v2.0
Header: X-API-Key: <key>
Accept: application/json
```
**Verified 2026-07-15.** The chart lives on the **`/v2.0`** surface (not `/new/v2.0`)
and is keyed by the flow's **Mongo `_id`** (24-hex, e.g. `69e250f4cc5743c62598f29d`)
— NOT the UUID `reference`. Hitting `/new/v2.0/flows/{mongoId}/chart` returns `400`.
The `_id` is the last path segment of each list item's `_links.self.href`
(`https://…/v2.0/flows/69e250f4cc5743c62598f29d`). No locale param was needed for a
single-locale flow; multi-locale flows may need `?preferredLocaleId={id}` (text is
per-locale via `localeReference` — verify on a multi-locale flow).

### (To verify) Full node config incl. Code body
```
GET /new/v2.0/flows/{flowId}/chart/{nodeId}      # or .../nodes/{nodeId}
```
The chart response does **not** include Code Node source (see "Known gap"). Need
to confirm the per-node endpoint that returns the full `config` with the `code`
field, and its cost. **STATUS: unverified.**

## Chart response shape

```jsonc
{
  "_id": "…",              // chart id
  "relations": [ … ],       // the hierarchy/graph (see below)
  "nodes": [ … ]            // FLAT array of every node — no nesting
}
```

### `nodes[]` — flat, one entry per node
```jsonc
{
  "_id": "69f91c27e8802ec7b45ad321",         // Mongo id; used by relations[]
  "referenceId": "a40b075c-…",                // UUID; used by cross-flow refs
  "type": "code",                              // codeNode/say/question/if/addToContext/…
  "label": "🧑🏽‍💻Code: Phone Number to Text",   // Studio display name (searchable)
  "comment": "…",                              // developer comment (searchable)
  "commentColor": "#68FAFD",
  "isDisabled": false,
  "isEntryPoint": false,
  "extension": "@cognigy/basic-nodes",
  "mock": { "isEnabled": false, "code": "…" }, // mock code, not live logic
  "preview": …,                                // TYPE-DEPENDENT (see below)
  "localeReference": "69dfbf72…"
}
```

**`preview` is type-dependent** — this is where most searchable content lives:

| Node `type` | `preview` shape | Searchable content |
|---|---|---|
| `addToContext`, `removeFromContext` | string | context path, e.g. `"user.transferPayload.callBackPhoneNumber"` |
| `say` | object w/ `text[]` + `_cognigy._voiceGateway2.json.channelConfig.text` | message strings + SSML, inline `{{context…}}` |
| `question` | object w/ `text[]` | prompt text |
| `if` | object w/ `rule{left,operand,right}` and/or `condition` (raw JS) | `context.user.newIncidentPayload.Urgency === "High" …` |
| `goTo`, `executeFlow`, `aiAgentHandover` | `{ flow, node }` (UUIDs) | cross-flow reference targets |
| `sleep` | number (ms) | — |
| `completeGoal` | string | goal/task name |
| `aiAgentJobTool` | string | tool name (`troubleshooting`, `agent_transfer`) |
| `aiAgentToolAnswer`, `aiAgentJob` | string / object | agent instructions / config |
| `code` | `""` (EMPTY) | **code body NOT here — see gap** |

### `relations[]` — the hierarchy
```jsonc
{ "node": "<nodeId>", "children": ["<childId>", …], "next": "<nextId|null>", "_id": "…" }
```
- Keyed by node `_id`.
- `children[]` = nested nodes (e.g. `Then`/`Else` under an `If`; branches under `Once`).
- `next` = sequential successor at the same level (a sibling, NOT a parent).
- **Breadcrumb path** for a node = walk up: its parent is the relation whose
  `children[]` contains it; a node reached via `next` inherits its predecessor's
  parent. Traversal must follow both `children` (descend a level, push label) and
  `next` (same level, keep path). This is the core of `flattenFlow`.

### Two id spaces (important)
- `relations[]` reference nodes by **`_id`** (Mongo, e.g. `69f91c27…`).
- Cross-flow refs (`goTo`/`executeFlow` `preview.flow`/`preview.node`) use the
  **UUID `referenceId`** space (e.g. `a40b075c-…`). Resolving executeFlow targets
  across flows must map UUID↔flow, not `_id`.

## Known gap — Code Node source

Every `type: "code"` node returns `preview: ""`. The chart endpoint returns a
per-node **preview/summary**, not the full `config`, so the JavaScript body of
Code Nodes is **absent**. Implications:
- Rich search (context vars, if-conditions, Say/Question text, labels, comments,
  flow refs) works from **one chart call per flow**.
- Code-body search requires the (unverified) per-node config endpoint → up to
  N flows × M nodes calls. Recommend shipping rich-metadata search first and
  treating Code-body indexing as a follow-up once the per-node cost is known.

## Suggested indexing model (v1)

Per node → one searchable record:
```jsonc
{
  flowId, flowName,
  nodeId,            // _id
  referenceId,       // UUID
  nodeName,          // label
  nodeType,          // type
  path: [ …breadcrumb from relations… ],
  searchableText,    // label + comment + flattened preview strings + mock.code
  refs: { flow, node }   // for goTo/executeFlow only
}
```
Substring/regex over `searchableText` answers most "where is variable X used"
queries today, because variables surface in addToContext previews, if-conditions,
and Say text even without the code bodies.
