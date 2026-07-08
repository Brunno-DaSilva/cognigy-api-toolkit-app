import { useRef, useState } from "react";
import Card from "../../ui/Card";
import Terminal from "../../ui/Terminal";
import useKAISync from "../../../hooks/useKAISync";
import { parseFileToDocument } from "../../../utils/parseFile";

const ACCEPT = ".txt,.ctxt,.pdf,.docx,.odt";

const bytesToBase64 = (bytes) => {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
};
const textToBase64 = (text) => btoa(unescape(encodeURIComponent(text)));

// Produce the base64 of the EXACT bytes to upload to Cognigy:
//  - .ctxt / .txt → the raw file bytes, untouched (format-sensitive: CTXT must
//    reach Cognigy byte-identical, so no trimming or text round-trip).
//  - pdf / docx / odt → extracted plain text (we can't send the binary as text).
const fileToContentBase64 = async (file) => {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ctxt") || lower.endsWith(".txt")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) throw new Error("file is empty");
    return bytesToBase64(bytes);
  }
  const { text } = await parseFileToDocument(file);
  if (!text || !text.trim()) throw new Error("no text could be extracted");
  return textToBase64(text);
};

const ManualUploadPanel = ({ storeId, disabled, onEvaluated }) => {
  const { lines, busy, append, clear, evaluateDocument } = useKAISync();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    clear();
    append("default", `Evaluating ${files.length} file(s)…`);
    for (const file of files) {
      let contentBase64;
      try {
        contentBase64 = await fileToContentBase64(file);
      } catch (err) {
        append("error", `→ ${file.name}`);
        append("error", `  ✕ could not read file: ${err.message || err}`);
        continue;
      }
      try {
        await evaluateDocument({ storeId, filename: file.name, contentBase64 });
      } catch {
        // evaluateDocument already logged the error line
      }
    }
    append("success", "Done.");
    onEvaluated?.();
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  return (
    <Card title="Manual upload">
      <div
        className={"dropzone" + (dragOver ? " dropzone--over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        style={{
          border: "2px dashed var(--border, #d1d5db)",
          borderRadius: 8,
          padding: "28px 16px",
          textAlign: "center",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          background: dragOver ? "var(--surface-2, #f3f4f6)" : "transparent",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
          disabled={disabled || busy}
        />
        <div className="row-item-name">Drop files here or click to choose</div>
        <div className="row-item-meta">Accepts .txt, .ctxt, .pdf, .docx, .odt</div>
      </div>

      {disabled && (
        <div className="row-item-meta" style={{ marginTop: 8 }}>
          Save a store configuration first.
        </div>
      )}

      {lines.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Terminal lines={lines} />
        </div>
      )}
    </Card>
  );
};

export default ManualUploadPanel;
