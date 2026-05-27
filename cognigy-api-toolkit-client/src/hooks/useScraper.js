import { useCallback, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getTimestamp } from "../utils";

// Drives the stateless `scraper` Edge Function. The browser is the source of
// truth: we split the URL list into batches, call the function once per batch,
// accumulate the returned .ctxt files in memory. Nothing is persisted server-
// side; closing the tab loses progress (by design).
const BATCH_SIZE = 5;
const HARD_MAX_URLS_PER_REQUEST = 25; // mirrors the function's server-side cap

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
    async ({ urls, config }) => {
      const cleanUrls = (urls ?? [])
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter(Boolean);

      if (cleanUrls.length === 0) {
        addLine("No URLs to scrape.", "err");
        return;
      }

      reset();
      setRunning(true);

      const batchSize = Math.min(BATCH_SIZE, HARD_MAX_URLS_PER_REQUEST);
      const total = cleanUrls.length;
      const batches = [];
      for (let i = 0; i < cleanUrls.length; i += batchSize) {
        batches.push(cleanUrls.slice(i, i + batchSize));
      }

      addLine(
        `Starting scrape — ${total} URL${total === 1 ? "" : "s"} in ${batches.length} batch${batches.length === 1 ? "" : "es"} of up to ${batchSize}.`,
        "info",
      );

      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      const accFiles = [];
      const accErrors = [];

      try {
        for (let b = 0; b < batches.length; b++) {
          if (cancelRef.current) {
            addLine("Cancelled.", "warn");
            break;
          }

          const batch = batches[b];
          addLine(
            `Batch ${b + 1}/${batches.length} — scraping ${batch.length} URL${batch.length === 1 ? "" : "s"}...`,
          );

          const { data, error } = await supabase.functions.invoke("scraper", {
            body: { urls: batch, config },
          });

          if (error) {
            let detail = error.message;
            if (error.context && typeof error.context.json === "function") {
              try {
                const body = await error.context.json();
                detail = body.error || body.detail || body.title || detail;
              } catch {}
            }
            // Treat the whole batch as failed so the user knows which URLs
            // didn't make it. The loop continues with the next batch.
            failed += batch.length;
            processed += batch.length;
            for (const url of batch) accErrors.push({ url, message: detail });
            addLine(`Batch ${b + 1} failed: ${detail}`, "err");
          } else {
            const batchFiles = data?.files ?? [];
            const batchErrors = data?.errors ?? [];
            const batchSucceeded = data?.stats?.urlsSucceeded ?? 0;

            accFiles.push(...batchFiles);
            accErrors.push(...batchErrors);
            succeeded += batchSucceeded;
            failed += batchErrors.length;
            processed += batch.length;

            addLine(
              `Batch ${b + 1} — ${batchSucceeded}/${batch.length} ok, ${batchFiles.length} file${batchFiles.length === 1 ? "" : "s"} generated.`,
              batchErrors.length > 0 ? "warn" : "ok",
            );
            for (const e of batchErrors) {
              addLine(`  ✗ ${e.url}: ${e.message}`, "warn");
            }
          }

          setFiles([...accFiles]);
          setErrors([...accErrors]);
          setProgress({
            processed,
            total,
            succeeded,
            failed,
            pct: total > 0 ? (processed / total) * 100 : 0,
          });
        }

        if (!cancelRef.current) {
          addLine(
            `✓ Complete — ${succeeded}/${total} URLs ok, ${accFiles.length} .ctxt file${accFiles.length === 1 ? "" : "s"} ready.`,
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
