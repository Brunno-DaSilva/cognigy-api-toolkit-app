import { useState } from "react";
import JSZip from "jszip";
import StatCard from "../../ui/StatCard";
import Terminal from "../../ui/Terminal";

const slugForZip = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `cognigy-scrape-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const downloadZip = async (files) => {
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    // Defend against duplicate filenames across articles (rare, but the
    // server's title slug isn't globally unique).
    let name = f.name || "file.ctxt";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let i = 2;
      while (used.has(`${base}-${i}${ext}`)) i++;
      name = `${base}-${i}${ext}`;
    }
    used.add(name);
    zip.file(name, f.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugForZip()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
};

const Progress = ({ scraper, urlCount, onStart }) => {
  const [zipping, setZipping] = useState(false);
  const { files, errors, terminal, running, done, progress, cancel } = scraper;

  const canStart = !running && urlCount > 0;
  const hasResults = files.length > 0 || errors.length > 0;

  const handleDownload = async () => {
    if (files.length === 0) return;
    setZipping(true);
    try {
      await downloadZip(files);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="card scraper-progress">
      <div className="scraper-actions">
        <div className="scraper-actions-info">
          {urlCount > 0 ? (
            <span>
              Ready to scrape <strong>{urlCount}</strong> URL{urlCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="scraper-count-warn">Add at least one URL to start.</span>
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
              Start scrape
            </button>
          )}
          <button
            type="button"
            className="btn btn--success"
            onClick={handleDownload}
            disabled={files.length === 0 || zipping}
          >
            {zipping ? (
              <>
                <span className="spinner" /> Zipping…
              </>
            ) : (
              <>Download ZIP ({files.length})</>
            )}
          </button>
        </div>
      </div>

      {(running || hasResults) && (
        <>
          <div className="progress-header">
            <span className="progress-count">
              {progress.processed} / {progress.total} URLs
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
            <StatCard label=".ctxt files" value={files.length} accent="#6366f1" />
          </div>

          <Terminal lines={terminal} />

          {done && files.length > 0 && (
            <div className="scraper-done-hint">
              ✓ Done. Click <strong>Download ZIP</strong> to save the {files.length} file
              {files.length === 1 ? "" : "s"} to your computer.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Progress;
