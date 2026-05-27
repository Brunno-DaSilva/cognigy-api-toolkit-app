import { useCallback, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getTimestamp } from "../utils";

// Drives the stateless `scraper` Edge Function. The browser is the source of
// truth: we split the inputs into batches, call the function once per batch,
// accumulate the returned .ctxt files in memory. Nothing is persisted server-
// side; closing the tab loses progress (by design).
//
// URLs and documents share progress + accumulators but use different batch
// sizes: URLs are tiny on the wire (5 at a time) while documents carry up to
// ~2MB of pre-extracted text each, so we send them one at a time to stay
// well under the Edge Function payload limit.
const URL_BATCH_SIZE = 5;
const DOC_BATCH_SIZE = 1;
const HARD_MAX_PER_REQUEST = 25;

const useScraper = () => {
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState([]);
  const [terminal, setTerminal] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({
    processed: 0,
    total: 0,
    succeeded: 0,
    failed: 0,
    pct: 0,
  });

  const cancelRef = useRef(false);

  const addLine = useCallback((msg, type = "") => {
    setTerminal((p) => [...p, { msg: `[${getTimestamp()}] ${msg}`, type }]);
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setErrors([]);
    setTerminal([]);
    setDone(false);
    setProgress({ processed: 0, total: 0, succeeded: 0, failed: 0, pct: 0 });
    cancelRef.current = false;
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    addLine("Cancellation requested — will stop after current batch.", "warn");
  }, [addLine]);

  const start = useCallback(
    async ({ urls, documents, config }) => {
      const cleanUrls = (urls ?? [])
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter(Boolean);
      const cleanDocs = (documents ?? []).filter(
        (d) => d && typeof d.text === "string" && d.text.trim().length > 0,
      );

      if (cleanUrls.length === 0 && cleanDocs.length === 0) {
        addLine("Nothing to scrape — add URLs or upload files.", "err");
        return;
      }

      reset();
      setRunning(true);

      const total = cleanUrls.length + cleanDocs.length;
      addLine(
        `Starting scrape — ${cleanUrls.length} URL${cleanUrls.length === 1 ? "" : "s"} + ${cleanDocs.length} document${cleanDocs.length === 1 ? "" : "s"}.`,
        "info",
      );

      // Shared accumulators. Both loops mutate these and re-publish via
      // setFiles / setErrors / setProgress after each batch.
      const state = {
        processed: 0,
        succeeded: 0,
        failed: 0,
        files: [],
        errors: [],
      };

      const publish = () => {
        setFiles([...state.files]);
        setErrors([...state.errors]);
        setProgress({
          processed: state.processed,
          total,
          succeeded: state.succeeded,
          failed: state.failed,
          pct: total > 0 ? (state.processed / total) * 100 : 0,
        });
      };

      const runBatch = async ({ body, label, sourcesInBatch }) => {
        const { data, error } = await supabase.functions.invoke("scraper", { body });
        if (error) {
          let detail = error.message;
          if (error.context && typeof error.context.json === "function") {
            try {
              const errBody = await error.context.json();
              detail = errBody.error || errBody.detail || errBody.title || detail;
            } catch {}
          }
          state.failed += sourcesInBatch.length;
          state.processed += sourcesInBatch.length;
          for (const src of sourcesInBatch) state.errors.push({ source: src, message: detail });
          addLine(`${label} failed: ${detail}`, "err");
          return;
        }
        const batchFiles = data?.files ?? [];
        const batchErrors = data?.errors ?? [];
        const batchSucceeded = data?.stats?.succeeded ?? 0;

        state.files.push(...batchFiles);
        state.errors.push(...batchErrors);
        state.succeeded += batchSucceeded;
        state.failed += batchErrors.length;
        state.processed += sourcesInBatch.length;

        addLine(
          `${label} — ${batchSucceeded}/${sourcesInBatch.length} ok, ${batchFiles.length} file${batchFiles.length === 1 ? "" : "s"} generated.`,
          batchErrors.length > 0 ? "warn" : "ok",
        );
        for (const e of batchErrors) {
          addLine(`  ✗ ${e.source || e.url || "?"}: ${e.message}`, "warn");
        }
      };

      try {
        // ── URLs ──────────────────────────────────────────────────────
        const urlBatchSize = Math.min(URL_BATCH_SIZE, HARD_MAX_PER_REQUEST);
        const urlBatches = [];
        for (let i = 0; i < cleanUrls.length; i += urlBatchSize) {
          urlBatches.push(cleanUrls.slice(i, i + urlBatchSize));
        }
        for (let b = 0; b < urlBatches.length; b++) {
          if (cancelRef.current) {
            addLine("Cancelled.", "warn");
            break;
          }
          const batch = urlBatches[b];
          addLine(`URL batch ${b + 1}/${urlBatches.length} — scraping ${batch.length} URL${batch.length === 1 ? "" : "s"}...`);
          await runBatch({
            body: { urls: batch, config },
            label: `URL batch ${b + 1}`,
            sourcesInBatch: batch,
          });
          publish();
        }

        // ── Documents ─────────────────────────────────────────────────
        const docBatchSize = Math.min(DOC_BATCH_SIZE, HARD_MAX_PER_REQUEST);
        const docBatches = [];
        for (let i = 0; i < cleanDocs.length; i += docBatchSize) {
          docBatches.push(cleanDocs.slice(i, i + docBatchSize));
        }
        for (let b = 0; b < docBatches.length; b++) {
          if (cancelRef.current) {
            addLine("Cancelled.", "warn");
            break;
          }
          const batch = docBatches[b];
          const names = batch.map((d) => d.source || d.title || "document");
          addLine(`Doc ${b + 1}/${docBatches.length} — chunking ${names.join(", ")}...`);
          await runBatch({
            body: { documents: batch, config },
            label: `Doc ${b + 1}`,
            sourcesInBatch: names,
          });
          publish();
        }

        if (!cancelRef.current) {
          addLine(
            `✓ Complete — ${state.succeeded}/${total} sources ok, ${state.files.length} .ctxt file${state.files.length === 1 ? "" : "s"} ready.`,
            "ok",
          );
          setDone(true);
        }
      } catch (e) {
        addLine(`Fatal: ${e.message}`, "err");
      } finally {
        setRunning(false);
      }
    },
    [addLine, reset],
  );

  return {
    files,
    errors,
    terminal,
    running,
    done,
    progress,
    start,
    cancel,
    reset,
  };
};

export default useScraper;
