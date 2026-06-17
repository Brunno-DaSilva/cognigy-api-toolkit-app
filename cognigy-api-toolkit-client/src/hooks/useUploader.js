import { useCallback, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getTimestamp } from "../utils";

// Drives the stateless `knowledge-upload` Edge Function. The browser is the
// source of truth: it owns the batch / throttle / retry loop (a port of
// upload_FEATURE/upload-files.mjs) and calls the function once per file per
// attempt. Keeping the orchestration client-side means each invocation stays
// short — server-side delays of 10s+ would blow the Edge Function timeout.
//
// Two parallel record streams, mirroring the original script's logger + console:
//   logEntries[] → the downloadable JSON ({timestamp, level, message})
//   terminal[]   → the live UI feed ({msg, type})
// Failures are additionally aggregated into failedFiles[] with full error
// detail so the user can fix and re-upload.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const useUploader = () => {
  const [terminal, setTerminal] = useState([]);
  const [failedFiles, setFailedFiles] = useState([]);
  const [report, setReport] = useState(null);
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

  const reset = useCallback(() => {
    setTerminal([]);
    setFailedFiles([]);
    setReport(null);
    setDone(false);
    setProgress({ processed: 0, total: 0, succeeded: 0, failed: 0, pct: 0 });
    cancelRef.current = false;
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const start = useCallback(
    async ({
      apiKeyId,
      projectId,
      knowledgeStoreId,
      context,
      files,
      config,
    }) => {
      const { delayBetweenUploads, batchSize, batchDelay, maxRetries, retryDelay } =
        config;

      reset();
      setRunning(true);

      const total = files.length;
      const logEntries = []; // {timestamp, level, message}
      const failed = []; // rich error records

      // Append to both the JSON log and the live terminal in one place. termType
      // overrides the terminal styling; level drives the JSON summary counts.
      const log = (message, { level = "info", termType } = {}) => {
        logEntries.push({
          timestamp: new Date().toISOString(),
          level,
          message,
        });
        const type = termType ?? (level === "error" ? "err" : "");
        setTerminal((p) => [...p, { msg: `[${getTimestamp()}] ${message}`, type }]);
      };

      const state = { processed: 0, succeeded: 0, failed: 0 };
      const publish = () => {
        setProgress({
          processed: state.processed,
          total,
          succeeded: state.succeeded,
          failed: state.failed,
          pct: total > 0 ? (state.processed / total) * 100 : 0,
        });
      };
      publish();

      log(`🟢 Found ${total} file(s) to upload`, { termType: "ok" });
      log(`⚙️  Throttling: ${delayBetweenUploads / 1000}s between uploads`);
      log(`📦 Batch size: ${batchSize} files, then ${batchDelay / 1000}s break`);
      log("📤 Starting throttled uploads...");

      // One upload attempt against the Edge Function. Returns a normalized
      // outcome — never throws — so the retry loop can branch on it.
      const attemptUpload = async ({ file, fileType }) => {
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("api_key_id", apiKeyId);
        if (projectId) fd.append("project_id", projectId);
        fd.append("knowledge_store_id", knowledgeStoreId);
        fd.append("file_type", fileType);

        const { data, error } = await supabase.functions.invoke(
          "knowledge-upload",
          { body: fd },
        );

        if (error) {
          let message = error.message;
          let status = null;
          let body = null;
          if (error.context && typeof error.context.json === "function") {
            try {
              const errBody = await error.context.json();
              message = errBody.error || errBody.detail || message;
              status = errBody.upstream_status ?? null;
              body = errBody.upstream_body ?? null;
            } catch {
              // non-JSON error body — keep the generic message
            }
          }
          return { success: false, status, message, body };
        }
        return {
          success: true,
          taskId: data?.taskId ?? null,
          status: data?.status ?? "queued",
        };
      };

      // Retry wrapper — mirrors uploadSingleFileWithRetry: 429 waits retryDelay,
      // other failures wait retryDelay * attempt (exponential backoff).
      const uploadWithRetry = async (item) => {
        let last = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          if (attempt > 1) {
            log(`🔄 Retry attempt ${attempt}/${maxRetries}`, { termType: "warn" });
          }
          const result = await attemptUpload(item);
          if (result.success) {
            log("🟢 Upload successful!", { termType: "ok" });
            log(`   Task ID: ${result.taskId ?? "—"}`, { termType: "ok" });
            log(`   Status: ${result.status}`, { termType: "ok" });
            return { success: true, attempts: attempt };
          }

          last = result;

          if (result.status === 429) {
            log(
              `⚠️  Rate limit hit (429). Waiting ${retryDelay / 1000}s before retry...`,
              { level: "error", termType: "warn" },
            );
            if (attempt < maxRetries) {
              await delay(retryDelay);
              continue;
            }
          } else {
            log(`🔴 Upload failed (attempt ${attempt}/${maxRetries})`, {
              level: "error",
            });
            log(`   Status: ${result.status || "Unknown"}`, { level: "error" });
            log(`   Error: ${result.message}`, { level: "error" });
            if (attempt < maxRetries) {
              const wait = retryDelay * attempt;
              log(`⏳ Waiting ${wait / 1000}s before next retry...`, {
                termType: "warn",
              });
              await delay(wait);
            }
          }
        }
        log(`🔴 Failed after ${maxRetries} attempts`, { level: "error" });
        return { success: false, attempts: maxRetries, last };
      };

      try {
        for (let i = 0; i < files.length; i++) {
          if (cancelRef.current) {
            log("⏹️  Cancelled by user — stopping.", {
              level: "error",
              termType: "warn",
            });
            break;
          }

          const item = files[i];
          const { file } = item;
          const batchNumber = Math.floor(i / batchSize) + 1;
          const positionInBatch = (i % batchSize) + 1;

          log(`\n[${i + 1}/${files.length}] [Batch ${batchNumber} - File ${positionInBatch}/${batchSize}]`);
          log(`📄 ${file.name}`);
          log(`📦 Size: ${file.size.toLocaleString()} bytes`);

          const outcome = await uploadWithRetry(item);

          if (outcome.success) {
            state.succeeded++;
          } else {
            state.failed++;
            const record = {
              fileName: file.name,
              errorMessage: outcome.last?.message ?? "Unknown error",
              statusCode: outcome.last?.status ?? null,
              responseBody: outcome.last?.body ?? null,
              failedAt: new Date().toISOString(),
              retryAttempts: outcome.attempts,
            };
            failed.push(record);
            setFailedFiles([...failed]);
          }
          state.processed++;
          publish();

          // Throttle between files (skip after the last one).
          if (i < files.length - 1 && !cancelRef.current) {
            if ((i + 1) % batchSize === 0) {
              log(`\n⏸️  Completed batch ${batchNumber}. Taking ${batchDelay / 1000}s break...`, {
                termType: "warn",
              });
              await delay(batchDelay);
            } else {
              log(`⏳ Waiting ${delayBetweenUploads / 1000}s before next upload...`);
              await delay(delayBetweenUploads);
            }
          }
        }

        // Summary block — mirrors the original script's tail.
        log("\n📊 UPLOAD SUMMARY");
        log(`🟢 Successful: ${state.succeeded}`, { termType: "ok" });
        log(`🔴 Failed: ${state.failed}`, {
          level: state.failed > 0 ? "error" : "info",
          termType: state.failed > 0 ? "err" : "ok",
        });
        if (failed.length > 0) {
          log("🔴 Failed files:", { level: "error" });
          for (const f of failed) log(`   - ${f.fileName}`, { level: "error" });
        }
        log("\n✨ All uploads completed!", { termType: "ok" });

        const infoCount = logEntries.filter((l) => l.level === "info").length;
        const errorCount = logEntries.filter((l) => l.level === "error").length;
        setReport({
          context,
          generatedAt: new Date().toISOString(),
          summary: {
            totalLogs: logEntries.length,
            infoCount,
            errorCount,
          },
          logs: logEntries,
          failedFiles: failed,
        });
        setDone(true);
      } catch (e) {
        log(`Fatal: ${e.message}`, { level: "error" });
      } finally {
        setRunning(false);
      }
    },
    [reset],
  );

  return {
    terminal,
    failedFiles,
    report,
    running,
    done,
    progress,
    start,
    cancel,
    reset,
  };
};

export default useUploader;
