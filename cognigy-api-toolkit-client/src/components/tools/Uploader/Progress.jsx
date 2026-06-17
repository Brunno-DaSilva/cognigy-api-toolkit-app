import { useState } from "react";
import JSZip from "jszip";
import StatCard from "../../ui/StatCard";
import Terminal from "../../ui/Terminal";
import { formatLogDate, formatLogTime } from "../../../utils";

// Builds a ZIP holding a dated folder with the per-run log JSON inside —
// mirrors the upload_FEATURE logger's "Month-DD-YYYY/<context>-<date>-<time>.json"
// layout. The log body keeps the original {summary, logs} shape and adds the
// failedFiles[] aggregate the spec calls for.
const downloadLogZip = async (report) => {
  const runDate = report.generatedAt ? new Date(report.generatedAt) : new Date();
  const dateFolder = formatLogDate(runDate);
  const time = formatLogTime(runDate);
  const base = `${report.context}-${dateFolder}-${time}`;

  const body = {
    summary: report.summary,
    logs: report.logs,
    failedFiles: report.failedFiles,
  };

  const zip = new JSZip();
  zip.folder(dateFolder).file(`${base}.json`, JSON.stringify(body, null, 2));
  const blob = await zip.generateAsync({ type: "blob" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.zip`;
  a.click();
  URL.revokeObjectURL(url);
};

const Progress = ({ uploader, fileCount, canStart, onStart }) => {
  const [zipping, setZipping] = useState(false);
  const { terminal, failedFiles, report, running, done, progress, cancel } =
    uploader;

  const hasActivity = running || progress.processed > 0 || terminal.length > 0;

  const handleDownload = async () => {
    if (!report) return;
    setZipping(true);
    try {
      await downloadLogZip(report);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="card scraper-progress">
      <div className="scraper-actions">
        <div className="scraper-actions-info">
          {fileCount > 0 ? (
            <span>
              Ready to upload <strong>{fileCount}</strong> file
              {fileCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="scraper-count-warn">
              Pick a knowledge store and add files to start.
            </span>
          )}
        </div>
        <div className="scraper-actions-buttons">
          {running ? (
            <button type="button" className="btn btn--primary" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onStart}
              disabled={!canStart}
            >
              Start upload
            </button>
          )}
          <button
            type="button"
            className="btn btn--success"
            onClick={handleDownload}
            disabled={!report || zipping}
          >
            {zipping ? (
              <>
                <span className="spinner" /> Zipping…
              </>
            ) : (
              "Download log"
            )}
          </button>
        </div>
      </div>

      {hasActivity && (
        <>
          <div className="progress-header">
            <span className="progress-count">
              {progress.processed} / {progress.total} files
            </span>
            <span className="progress-count">{Math.round(progress.pct)}%</span>
          </div>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.min(100, progress.pct)}%` }}
            />
          </div>

          <div className="scraper-stats">
            <StatCard label="Succeeded" value={progress.succeeded} accent="#10b981" />
            <StatCard label="Failed" value={progress.failed} accent="#ef4444" />
            <StatCard label="Total" value={progress.total} accent="#6366f1" />
          </div>

          <Terminal lines={terminal} />

          {failedFiles.length > 0 && (
            <div className="uploader-failed">
              <div className="uploader-failed-title">
                Failed files ({failedFiles.length})
              </div>
              {failedFiles.map((f, i) => (
                <div key={`${f.fileName}-${i}`} className="uploader-failed-row">
                  <span className="scraper-doc-name">{f.fileName}</span>
                  <span className="uploader-failed-detail">
                    {f.statusCode ? `HTTP ${f.statusCode} · ` : ""}
                    {f.errorMessage} · {f.retryAttempts} attempt
                    {f.retryAttempts === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {done && report && (
            <div className="scraper-done-hint">
              ✓ Done — {report.summary.errorCount === 0 ? "all files uploaded" : `${failedFiles.length} failed`}.
              Click <strong>Download log</strong> to save the dated log folder.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Progress;
