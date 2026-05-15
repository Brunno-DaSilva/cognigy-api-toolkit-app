// cognigy-proxy
// Proxies Cognigy.AI REST API calls so the raw API key never touches the browser.
//
// Request body (POST):
//   {
//     api_key_id: string,      // uuid of the api_keys row to use
//     path: string,            // e.g. "/v2.0/logs"
//     method?: string,         // default "GET"
//     query?: Record<string, string | number | boolean | (string | number | boolean)[]>,
//     body?: unknown
//   }
//
// Auth: caller must send Authorization: Bearer <Supabase user JWT>.
// Ownership of the api_key is enforced via RLS using the user's JWT before
// decrypting with service_role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { api_key_id, path, method = "GET", query, body } = await req.json();
    if (!api_key_id || !path) {
      return json({ error: "api_key_id and path are required" }, 400);
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
      { p_api_key_id: api_key_id },
    );
    if (keyErr || !keyRows || keyRows.length === 0) {
      return json({ error: "decrypt failed" }, 500);
    }
    const { key_plaintext, base_url } = keyRows[0];

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

    const cognigyRes = await fetch(url.toString(), {
      method,
      headers: {
        Accept: "application/hal+json",
        "Content-Type": "application/json",
        "X-API-Key": key_plaintext,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await cognigyRes.text();
    const upstreamType = cognigyRes.headers.get("Content-Type") ?? "";
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
