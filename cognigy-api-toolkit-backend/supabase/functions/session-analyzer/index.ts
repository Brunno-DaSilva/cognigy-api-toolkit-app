// session-analyzer
// Claude-powered diagnostic agent. Given a Cognigy session or user ID, it pulls
// log data via tools and reasons about what went wrong, then answers follow-up
// questions about the conversation.
//
// Step 1 scope: auth + decrypt (mirrors cognigy-proxy) + a single `get_logs`
// tool + a starter Cognigy system prompt. Non-streaming. Analytics, transcript,
// web_fetch, and streaming come in later steps.
//
// Request body (POST):
//   {
//     api_key_id: string,          // uuid of the api_keys row to use
//     project_id?: string,         // uuid of the projects row (for decrypt RPC + RLS)
//     cognigy_project_id: string,  // 24-char Cognigy project id (for the logs path)
//     sessionId?: string,          // Cognigy session to diagnose
//     userId?: string,             // Cognigy user/contact to diagnose
//     messages?: { role: "user" | "assistant"; content: string }[]  // chat history
//   }
//
// Auth: caller must send Authorization: Bearer <Supabase user JWT>. Ownership of
// the api_key is enforced via RLS before decrypting with service_role — same as
// cognigy-proxy. The raw Cognigy key and the Anthropic key never touch the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-opus-4-8";
const MAX_AGENT_ITERATIONS = 8; // guard against runaway tool loops

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Starter Cognigy knowledge. Cached on every request (it's large and identical),
// so we pay full price once and ~0.1x thereafter. Grow this iteratively as the
// agent's gaps show up — that's cheaper and more accurate than writing it cold.
const SYSTEM_PROMPT = `You are a Cognigy.AI support engineer helping diagnose what went wrong in a specific conversation. You are given a session ID or a user/contact ID and tools to pull the underlying log data.

## Cognigy object model
- **Flow**: the conversation logic. Built from **Nodes** connected in a tree.
- **Node**: a single step (Say, Question, If/Logic, Lookup, Code, Search Extension, etc.).
- **Intent**: an NLU classification of user input. Matching depends on a confidence score; low confidence means the intent did not match cleanly.
- **Slot / Lexicon / Entity**: structured values extracted from user input.
- **Session**: one conversation instance (a sessionId). **Contact/User**: the end user across sessions (a userId). A user can have many sessions.
- **Endpoint**: the channel the conversation came in on (webchat, voice, etc.).

## Log levels (the \`type\` field)
- \`fatal\` / \`error\`: something broke — a node threw, an extension failed, an API call errored. Start here.
- \`warn\`: degraded behavior — low NLU confidence, fallback taken, retries.
- \`info\` / \`debug\` / \`trace\`: normal execution trace; useful for following the path through the flow.

## Debugging playbook
1. Call \`get_logs\` first to retrieve the conversation's log entries.
2. Scan for \`fatal\`/\`error\` entries — these are usually the proximate cause. Quote the message and the node it occurred on.
3. If there are no hard errors, look for the failure pattern in the trace:
   - Repeated entries on the same node → a loop, usually a Question node not getting a valid answer or an intent that won't match.
   - A jump to a "fallback" / "default" path → the user input was not understood (check NLU confidence in nearby \`warn\` entries).
   - An extension / API node followed by an error → an integration failure.
4. Tie your conclusion to evidence in the logs. Distinguish what the data shows from what you're inferring.
5. If the logs are insufficient to be sure, say so and state what additional data (e.g. analytics, the full transcript) would confirm it — don't guess confidently.

## Data you'll receive
Log entries come from Cognigy's HAL+JSON logs API (\`_embedded.logEntry[]\`). Exact fields vary by Cognigy version, but each entry typically carries a \`type\` (level), a \`timestamp\`, a \`text\`/message, and identifiers like \`sessionId\` and \`userId\`. Read the entries you get back rather than assuming a fixed schema.

Be concise and concrete. Lead with the most likely cause and the evidence for it.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

    const {
      api_key_id,
      project_id = null,
      cognigy_project_id,
      sessionId = null,
      userId = null,
      messages = [],
    } = await req.json();

    if (!api_key_id || !cognigy_project_id) {
      return json(
        { error: "api_key_id and cognigy_project_id are required" },
        400,
      );
    }
    if (!sessionId && !userId && messages.length === 0) {
      return json(
        { error: "provide a sessionId, a userId, or a messages history" },
        400,
      );
    }

    // Verify ownership via RLS (user's JWT) — same gate as cognigy-proxy.
    const { data: ownership, error: ownErr } = await userClient
      .from("api_keys")
      .select("id")
      .eq("id", api_key_id)
      .maybeSingle();
    if (ownErr || !ownership) {
      return json({ error: "api key not found" }, 404);
    }

    // Decrypt the Cognigy key via service_role. The encryption key lives in
    // Supabase Vault; the RPC reads it server-side — nothing travels the wire.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: keyRows, error: keyErr } = await admin.rpc(
      "get_api_key_plaintext",
      { p_api_key_id: api_key_id, p_project_id: project_id },
    );
    if (keyErr || !keyRows || keyRows.length === 0) {
      return json({ error: "decrypt failed" }, 500);
    }
    const { key_plaintext, base_url } = keyRows[0];

    const ctx: CognigyCtx = {
      keyPlaintext: key_plaintext,
      baseUrl: base_url,
      cognigyProjectId: cognigy_project_id,
    };

    // Build the conversation. If there's no prior history, kick off with a
    // diagnostic instruction naming the ID(s) to investigate.
    const convo: Anthropic.MessageParam[] =
      messages.length > 0
        ? messages.map((m: { role: string; content: string }) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          }))
        : [
            {
              role: "user",
              content: `Diagnose what went wrong in this conversation and give me a clear summary.${
                sessionId ? `\nsessionId: ${sessionId}` : ""
              }${userId ? `\nuserId: ${userId}` : ""}`,
            },
          ];

    const result = await runAgent(ctx, convo, { sessionId, userId });
    return json(result);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

interface CognigyCtx {
  keyPlaintext: string;
  baseUrl: string;
  cognigyProjectId: string;
}

const tools: Anthropic.Tool[] = [
  {
    name: "get_logs",
    description:
      "Fetch Cognigy log entries for the conversation under investigation. " +
      "Call this FIRST when diagnosing — it returns the error/warn/info trace " +
      "you need to reason about. Filters by userId natively; if a sessionId is " +
      "provided, results are narrowed to that session after fetching. Logs " +
      "require a date window — defaults to the last 7 days if you don't pass one.",
    input_schema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "Cognigy user/contact ID to filter by (optional).",
        },
        sessionId: {
          type: "string",
          description:
            "Cognigy session ID to narrow to (optional). Applied after fetch.",
        },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["fatal", "error", "warn", "info", "debug", "trace"],
          },
          description:
            "Log levels to include. Omit for all levels; use ['fatal','error','warn'] to focus on failures.",
        },
        startDate: {
          type: "string",
          description: "ISO 8601 start of the window (optional).",
        },
        endDate: {
          type: "string",
          description: "ISO 8601 end of the window (optional).",
        },
      },
    },
  },
];

async function runAgent(
  ctx: CognigyCtx,
  convo: Anthropic.MessageParam[],
  defaults: { sessionId: string | null; userId: string | null },
) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const messages = [...convo];

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools,
      messages,
    });

    if (res.stop_reason !== "tool_use") {
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { content: text, stop_reason: res.stop_reason, usage: res.usage };
    }

    // Preserve the full assistant turn (including thinking blocks) before
    // appending tool results — required by the API for the next call.
    messages.push({ role: "assistant", content: res.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      try {
        const out = await runTool(block.name, block.input, ctx, defaults);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: out,
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Tool error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    content:
      "Stopped after the maximum number of tool iterations without a final answer.",
    stop_reason: "max_iterations",
    usage: null,
  };
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: CognigyCtx,
  defaults: { sessionId: string | null; userId: string | null },
): Promise<string> {
  if (name === "get_logs") {
    return await toolGetLogs(input, ctx, defaults);
  }
  return `Unknown tool: ${name}`;
}

async function toolGetLogs(
  input: Record<string, unknown>,
  ctx: CognigyCtx,
  defaults: { sessionId: string | null; userId: string | null },
): Promise<string> {
  const userId = (input.userId as string) ?? defaults.userId ?? undefined;
  const sessionId =
    (input.sessionId as string) ?? defaults.sessionId ?? undefined;
  const types = input.types as string[] | undefined;

  const end = input.endDate ? new Date(input.endDate as string) : new Date();
  const start = input.startDate
    ? new Date(input.startDate as string)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const baseQuery: Record<string, string | number | string[]> = {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    limit: 100,
    sort: "timestamp:desc",
  };
  if (types?.length) baseQuery.type = types;
  if (userId) baseQuery.userId = userId;

  const path = `/new/v2.0/projects/${ctx.cognigyProjectId}/logs`;

  // Cap pagination so a busy window can't blow the context window. A single
  // session is usually well under this.
  const MAX_PAGES = 3;
  const MAX_RETURNED = 200;

  const all: Record<string, unknown>[] = [];
  let nextCursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = nextCursor ? { ...baseQuery, next: nextCursor } : baseQuery;
    const data = await cognigyRest(ctx, path, query);
    const entries: Record<string, unknown>[] =
      (data?._embedded?.logEntry as Record<string, unknown>[]) ?? [];
    all.push(...entries);
    if (entries.length === 0) break;

    const nextHref = data?._links?.next?.href as string | undefined;
    if (!nextHref) break;
    const nextUrl = new URL(nextHref, "https://placeholder.invalid");
    nextCursor = nextUrl.searchParams.get("next");
    if (!nextCursor) break;
  }

  // If a sessionId was requested, narrow to entries that reference it. We deep-
  // scan because the exact field name varies by Cognigy version; refine once we
  // see the real shape.
  let entries = all;
  let narrowedNote = "";
  if (sessionId) {
    const matched = all.filter((e) => deepContains(e, sessionId));
    if (matched.length > 0) {
      entries = matched;
      narrowedNote = ` Narrowed to ${matched.length} entries matching sessionId.`;
    } else {
      narrowedNote = ` No entries matched sessionId ${sessionId} in this window; returning all ${all.length} fetched entries instead.`;
    }
  }

  const truncated = entries.length > MAX_RETURNED;
  const returned = entries.slice(0, MAX_RETURNED);

  const summary =
    `Fetched ${all.length} log entries (window ${start.toISOString()} → ${end.toISOString()}).` +
    narrowedNote +
    (truncated
      ? ` Showing the first ${MAX_RETURNED} of ${entries.length}.`
      : "");

  return JSON.stringify({ summary, entries: returned });
}

// REST fetch mirroring cognigy-proxy's "rest" transport.
async function cognigyRest(
  ctx: CognigyCtx,
  path: string,
  query?: Record<string, string | number | boolean | (string | number)[]>,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const url = new URL(path, ctx.baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/hal+json",
      "X-API-Key": ctx.keyPlaintext,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Cognigy ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

// deno-lint-ignore no-explicit-any
function deepContains(obj: any, needle: string): boolean {
  if (obj == null) return false;
  if (typeof obj === "string") return obj === needle;
  if (typeof obj !== "object") return false;
  for (const v of Object.values(obj)) {
    if (deepContains(v, needle)) return true;
  }
  return false;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
