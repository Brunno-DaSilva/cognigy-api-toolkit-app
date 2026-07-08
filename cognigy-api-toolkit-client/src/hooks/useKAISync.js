import { useCallback, useState } from "react";
import { supabase } from "../lib/supabase";

// Drives the evaluator and the nightly worker. The evaluator call is
// synchronous (it uploads + polls Cognigy within the request), so we stream
// progress as terminal lines around the call rather than polling a job row.
const DECISION_LABEL = {
  skip: "SKIP — identical file already in store",
  add: "ADD — new document, added to KAI",
  replace: "REPLACE — updated version, replaced in KAI",
  hold: "HOLD — too similar to an existing document, needs review",
};

const useKAISync = () => {
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  const append = useCallback((type, msg) => {
    setLines((prev) => [...prev, { type, msg }]);
  }, []);

  const clear = useCallback(() => setLines([]), []);

  // Evaluate a single document. `contentBase64` is the base64 of the exact bytes
  // to upload (raw .ctxt/.txt, or extracted text for pdf/docx). Returns outcome.
  const evaluateDocument = useCallback(
    async ({ storeId, filename, contentBase64 }) => {
      setBusy(true);
      append("default", `→ ${filename}`);
      append("default", "  extracting + hashing…");
      try {
        append("default", "  evaluating against store index…");
        const { data, error: err } = await supabase.functions.invoke("kai-evaluator", {
          body: {
            action: "evaluate",
            store_id: storeId,
            filename,
            file_content_base64: contentBase64,
            trigger: "manual_upload",
          },
        });
        if (err) throw err;
        if (data?.error) throw new Error(data.error);

        if (data.warning) append("warn", `  ⚠ ${data.warning}`);
        if (data.similarity_method) {
          const score =
            data.similarity_score != null
              ? ` (score ${data.similarity_score.toFixed(3)}, ${data.similarity_method})`
              : ` (${data.similarity_method})`;
          append("default", `  best match${score}`);
        }
        const decision = data.decision;
        const type = decision === "add" || decision === "replace"
          ? "success"
          : decision === "hold"
            ? "warn"
            : "default";
        append(type, `  ${DECISION_LABEL[decision] ?? decision}`);
        if (data.status === "failed") append("error", `  ✕ ${data.error ?? "failed"}`);
        return data;
      } catch (e) {
        append("error", `  ✕ ${e.message || String(e)}`);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  // Trigger the nightly worker immediately (optionally for one store).
  // dryRun = true previews decisions without uploading/deleting in Cognigy.
  const runNow = useCallback(
    async (storeId, { dryRun = false } = {}) => {
      setBusy(true);
      try {
        const { data, error: err } = await supabase.functions.invoke("kai-sync-worker", {
          body: { ...(storeId ? { store_id: storeId } : {}), dry_run: dryRun },
        });
        if (err) throw err;
        if (data?.error) throw new Error(data.error);
        return data;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { lines, busy, append, clear, evaluateDocument, runNow };
};

export default useKAISync;
