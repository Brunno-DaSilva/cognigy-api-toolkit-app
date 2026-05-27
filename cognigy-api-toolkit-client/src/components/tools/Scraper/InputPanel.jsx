import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// Pulls URL-looking strings out of any cell in a 2D array. Avoids forcing the
// user to pick a specific column — works on a single-column list OR a wide
// sheet where URLs sit in column C.
const URL_RE = /https?:\/\/[^\s,;"'()<>]+/g;

const extractUrlsFromGrid = (rows) => {
  const found = new Set();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell == null) continue;
      const s = String(cell);
      const matches = s.match(URL_RE);
      if (matches) for (const m of matches) found.add(m.trim());
    }
  }
  return Array.from(found);
};

const isLikelyUrl = (s) =>
  typeof s === "string" && /^https?:\/\/\S+$/.test(s.trim());

const InputPanel = ({ urls, setUrls, disabled }) => {
  const [text, setText] = useState("");
  const [fileNote, setFileNote] = useState(null);
  const [fileError, setFileError] = useState(null);
  const fileRef = useRef(null);

  // Keep `urls` in sync with the parsed textarea content so the page always
  // has the latest list when Start is clicked.
  const parsedFromText = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter(isLikelyUrl),
    [text],
  );

  const validCount = parsedFromText.length;
  const totalLines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const invalidCount = totalLines - validCount;

  const syncUrls = (lines) => {
    setText(lines.join("\n"));
    setUrls(lines.filter(isLikelyUrl));
  };

  const handleTextChange = (next) => {
    setText(next);
    setUrls(
      next
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter(isLikelyUrl),
    );
  };

  const appendUrls = (incoming) => {
    const existing = new Set(parsedFromText);
    const toAdd = incoming.filter((u) => !existing.has(u));
    if (toAdd.length === 0) {
      setFileNote("No new URLs to add (all already in the list).");
      return 0;
    }
    const next = [...parsedFromText, ...toAdd];
    syncUrls(next);
    return toAdd.length;
  };

  const handleFile = async (file) => {
    setFileError(null);
    setFileNote(null);
    if (!file) return;

    try {
      const lower = file.name.toLowerCase();
      let extracted = [];
      if (lower.endsWith(".csv")) {
        const text = await file.text();
        const parsed = Papa.parse(text, { skipEmptyLines: true });
        extracted = extractUrlsFromGrid(parsed.data);
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            blankrows: false,
            defval: "",
          });
          extracted = extracted.concat(extractUrlsFromGrid(rows));
        }
        extracted = Array.from(new Set(extracted));
      } else {
        setFileError("Only .csv, .xlsx, .xls files are supported.");
        return;
      }

      if (extracted.length === 0) {
        setFileNote(`No URLs found in ${file.name}.`);
        return;
      }
      const added = appendUrls(extracted);
      if (added > 0) {
        setFileNote(`Added ${added} new URL${added === 1 ? "" : "s"} from ${file.name}.`);
      }
    } catch (err) {
      setFileError(`Failed to read ${file.name}: ${err.message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleClear = () => {
    syncUrls([]);
    setFileNote(null);
    setFileError(null);
  };

  return (
    <div className="card scraper-input">
      <div className="card-title">URLs to scrape</div>

      <div className="form-field">
        <label className="form-label">
          Paste URLs <span className="scraper-hint">— one per line</span>
        </label>
        <textarea
          className="input scraper-textarea"
          placeholder={
            "https://example.com/help/article-1\nhttps://example.com/help/article-2"
          }
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          disabled={disabled}
          rows={10}
        />
      </div>

      <div className="scraper-input-meta">
        <span className="scraper-count">
          {validCount} valid URL{validCount === 1 ? "" : "s"}
          {invalidCount > 0 && (
            <span className="scraper-count-warn">
              {" "}
              · {invalidCount} ignored (must start with http:// or https://)
            </span>
          )}
        </span>
        {validCount > 0 && (
          <button
            type="button"
            className="btn-link"
            onClick={handleClear}
            disabled={disabled}
          >
            Clear
          </button>
        )}
      </div>

      <div className="form-field">
        <label className="form-label">
          Or load from file <span className="scraper-hint">— .csv, .xlsx, .xls</span>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => handleFile(e.target.files?.[0])}
          disabled={disabled}
        />
        {fileNote && <div className="scraper-file-note">{fileNote}</div>}
        {fileError && <div className="form-error">{fileError}</div>}
      </div>

      {urls.length > 25 && (
        <div className="scraper-warning">
          Heads up — {urls.length} URLs will be scraped in {Math.ceil(urls.length / 5)} batches.
          Keep this tab open until the run finishes (nothing is saved server-side).
        </div>
      )}
    </div>
  );
};

export default InputPanel;
