// kai-mock-source — a tiny stand-in for a customer's external knowledge base,
// used ONLY to test KAI Connector's nightly sync + comparison without a real
// customer endpoint. It implements the connector contract:
//
//   GET .../kai-mock-source/{scenario}/documents
//     -> { documents: [{ id, title, updated_at, content_url }] }
//   GET .../kai-mock-source/{scenario}/content/{id}
//     -> plain text (Cognigy Text / .ctxt body)
//
// Two scenarios let you exercise the decision engine by just switching the
// store's Source API URL between them and re-running the sync:
//   v1 -> 3 docs (faq-001, faq-002, faq-003)
//   v2 -> faq-001 unchanged, faq-002 CHANGED, faq-003 unchanged, faq-004 NEW
//
// Expected decisions:
//   v1 first run            -> 3x ADD
//   v1 again                -> 3x SKIP        (proves "same" detection)
//   switch to v2, run       -> faq-002 REPLACE, faq-004 ADD, others SKIP
//
// verify_jwt is false (see config.toml) so the sync worker can fetch it as a
// plain external URL. It serves only fixed test data — no secrets, no auth.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// A valid .ctxt body: backtick header + double-line-break-separated chunks.
const ctxt = (title: string, body: string) =>
  `\`version: 1\`\n\`title: ${title}\`\n\`tags: [mock, test]\`\n\n${body}\n`;

type Doc = { id: string; title: string; updated_at: string; content: string };

const SCENARIOS: Record<string, Doc[]> = {
  v1: [
    { id: "faq-001", title: "Reset password", updated_at: "2026-01-01T00:00:00Z",
      content: ctxt("Reset password", "To reset your password, open Settings and choose Security, then Reset Password.") },
    { id: "faq-002", title: "Billing cycle", updated_at: "2026-01-01T00:00:00Z",
      content: ctxt("Billing cycle", "Invoices are issued monthly on the first of the month.") },
    { id: "faq-003", title: "Contact support", updated_at: "2026-01-01T00:00:00Z",
      content: ctxt("Contact support", "Reach support via the in-app chat, 9am to 5pm CET.") },
  ],
  v2: [
    { id: "faq-001", title: "Reset password", updated_at: "2026-01-01T00:00:00Z",
      content: ctxt("Reset password", "To reset your password, open Settings and choose Security, then Reset Password.") },
    // CHANGED content -> should REPLACE
    { id: "faq-002", title: "Billing cycle", updated_at: "2026-06-01T00:00:00Z",
      content: ctxt("Billing cycle", "Invoices are now issued every quarter, on the first day of the quarter. Annual plans are billed yearly.") },
    { id: "faq-003", title: "Contact support", updated_at: "2026-01-01T00:00:00Z",
      content: ctxt("Contact support", "Reach support via the in-app chat, 9am to 5pm CET.") },
    // NEW doc -> should ADD
    { id: "faq-004", title: "Export your data", updated_at: "2026-06-01T00:00:00Z",
      content: ctxt("Export your data", "Export all your data from Settings > Data > Export. A download link is emailed to you.") },
  ],
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  // Path after the function name, e.g. /kai-mock-source/v1/documents
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("kai-mock-source");
  const tail = idx >= 0 ? parts.slice(idx + 1) : parts;
  const scenarioKey = tail[0] ?? "v1";
  const docs = SCENARIOS[scenarioKey] ?? SCENARIOS.v1;

  // .../{scenario}/documents
  if (tail[1] === "documents") {
    // Build absolute content URLs from the origin + the fixed public function
    // path. We can't trust url.pathname here — Supabase strips the
    // /functions/v1/kai-mock-source prefix inside the function, which would
    // produce an unroutable URL (404 when fetched).
    const base = `${url.origin}/functions/v1/kai-mock-source/${scenarioKey}`;
    const body = {
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        updated_at: d.updated_at,
        content_url: `${base}/content/${d.id}`,
      })),
    };
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // .../{scenario}/content/{id}
  if (tail[1] === "content" && tail[2]) {
    const doc = docs.find((d) => d.id === tail[2]);
    if (!doc) return new Response("not found", { status: 404, headers: corsHeaders });
    return new Response(doc.content, {
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Help text at the root.
  return new Response(
    JSON.stringify({
      ok: true,
      usage: "GET {this}/v1/documents  or  {this}/v2/documents",
      scenarios: Object.keys(SCENARIOS),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
