// cognigy-proxy
// Proxies Cognigy.AI API calls so the raw API key never touches the browser.
//
// Supports two transports:
//   - "rest"  (default): hits api-app-{region}.cognigy.ai with X-API-Key header
//   - "odata":           hits odata-app-{region}.cognigy.ai/v2.4 with ?apikey=... query param
//
// Request body (POST):
//   {
//     api_key_id: string,      // uuid of the api_keys row to use
//     path: string,            // e.g. "/v2.0/logs" or "/Analytics"
//     method?: string,         // default "GET"
//     query?: Record<string, string | number | boolean | (string | number | boolean)[]>,
//     body?: unknown,
//     transport?: "rest" | "odata"  // default "rest"
//   }
//
// Auth: caller must send Authorization: Bearer <Supabase user JWT>.
// Ownership of the api_key is enforced via RLS using the user's JWT before
// decrypting with service_role.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
      path,
      method = "GET",
      query,
      body,
      transport = "rest",
      accept,
    } = await req.json();
    if (!api_key_id || !path) {
      return json({ error: "api_key_id and path are required" }, 400);
    }
    if (transport !== "rest" && transport !== "odata") {
      return json({ error: "transport must be 'rest' or 'odata'" }, 400);
    }

    // Verify ownership via RLS (user's JWT).
    const { data: ownership, error: ownErr } = await userClient
      .from("api_keys")
      .select("id")
      .eq("id", api_key_id)
      .maybeSingle();
    if (ownErr || !ownership) {
      return json({ error: "api key not found" }, 404);
    }

    // Decrypt via service_role. The encryption key lives in Supabase Vault;
    // the RPC reads it via _get_encryption_key() — no key travels over the wire.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: keyRows, error: keyErr } = await admin.rpc(
      "get_api_key_plaintext",
      { p_api_key_id: api_key_id, p_project_id: project_id },
    );
    if (keyErr || !keyRows || keyRows.length === 0) {
      return json({ error: "decrypt failed" }, 500);
    }
    const { key_plaintext, base_url } = keyRows[0];

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let finalUrl: string;
    if (transport === "odata") {
      // OData has strict expectations about query encoding that URLSearchParams
      // breaks: it encodes `$filter` → `%24filter` and spaces → `+`. Cognigy's
      // OData server rejects both with a 400. Build the query string manually
      // so `$` stays literal and `encodeURIComponent` gives us %20 for spaces.
      headers["Accept"] = "application/json";
      const odataUrl = buildOdataUrl(base_url, path);
      const parts: string[] = [];
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (Array.isArray(v)) {
            for (const item of v) {
              parts.push(`${k}=${encodeURIComponent(String(item))}`);
            }
          } else if (v !== undefined && v !== null && v !== "") {
            parts.push(`${k}=${encodeURIComponent(String(v))}`);
          }
        }
      }
      parts.push(`apikey=${encodeURIComponent(key_plaintext)}`);
      finalUrl = `${odataUrl.origin}${odataUrl.pathname}?${parts.join("&")}`;
    } else {
      // Logs need HAL+JSON; other endpoints (e.g. knowledgestores) are plain
      // JSON and 500 on a HAL Accept. Callers can override via `accept`.
      headers["Accept"] = accept || "application/hal+json";
      headers["X-API-Key"] = key_plaintext;
      const url = new URL(path, base_url);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (Array.isArray(v)) {
            for (const item of v) url.searchParams.append(k, String(item));
          } else if (v !== undefined && v !== null && v !== "") {
            url.searchParams.set(k, String(v));
          }
        }
      }
      finalUrl = url.toString();
    }

    const cognigyRes = await fetch(finalUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await cognigyRes.text();
    const upstreamType = cognigyRes.headers.get("Content-Type") ?? "";

    // If Cognigy returned an error, wrap it as JSON so supabase-js exposes a
    // useful message to the caller (it otherwise reports a generic
    // "non-2xx status code" with no body).
    if (!cognigyRes.ok) {
      // Strip the apikey from the URL we report back.
      const safeUrl = finalUrl.replace(/([?&])apikey=[^&]+/, "$1apikey=***");
      return json(
        {
          error: `Cognigy ${cognigyRes.status}`,
          upstream_status: cognigyRes.status,
          upstream_url: safeUrl,
          upstream_body: responseText.slice(0, 1000),
          upstream_content_type: upstreamType,
        },
        cognigyRes.status,
      );
    }

    // Normalize HAL+JSON (and other +json variants) to application/json so
    // supabase-js functions.invoke() auto-parses the body. Without this it
    // returns the raw string and pagination silently sees 0 entries.
    const normalizedType = /\+json|application\/json/i.test(upstreamType)
      ? "application/json"
      : upstreamType || "application/json";
    return new Response(responseText, {
      status: cognigyRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": normalizedType,
      },
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Builds the full OData URL from the REST base + endpoint path.
// REST base e.g. https://api-app-us.cognigy.ai is rewritten to
// https://odata-app-us.cognigy.ai/v2.4, then the endpoint is appended.
// We construct manually because `new URL("/Analytics", base)` would drop the
// /v2.4 path segment.
function buildOdataUrl(restBaseUrl: string, endpoint: string): URL {
  const u = new URL(restBaseUrl);
  u.hostname = u.hostname.replace(/^api-app-/, "odata-app-");
  const ep = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return new URL(`https://${u.hostname}/v2.4${ep}`);
}
