import { useEffect, useRef } from "react";
import FormField from "../../ui/FormField";
import Select from "../../ui/Select";
import { UPLOAD_ACCEPT, fileTypeFor } from "./fileTypes";

const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const InputPanel = ({
  apiKeyId,
  stores,
  storesLoading,
  storesError,
  selectedStoreId,
  setSelectedStoreId,
  onRefreshStores,
  onOpenCreate,
  files,
  setFiles,
  onUnsupported,
  disabled,
}) => {
  const folderRef = useRef(null);

  // `webkitdirectory` has no clean JSX prop, so set it on the DOM node directly.
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
    }
  }, []);

  const addFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);

    const existing = new Set(files.map((f) => `${f.file.name}:${f.file.size}`));
    const supported = [];
    const unsupported = [];

    for (const file of incoming) {
      const fileType = fileTypeFor(file.name);
      if (!fileType) {
        unsupported.push(file.name);
        continue;
      }
      const key = `${file.name}:${file.size}`;
      if (existing.has(key)) continue;
      existing.add(key);
      supported.push({ file, fileType });
    }

    if (supported.length > 0) setFiles([...files, ...supported]);
    if (unsupported.length > 0) onUnsupported(unsupported);
  };

  const removeFile = (idx) => setFiles(files.filter((_, i) => i !== idx));
  const clearFiles = () => setFiles([]);

  return (
    <div className="card scraper-input">
      <div className="card-title">Target</div>

      <FormField label="Knowledge store" required>
        {storesLoading ? (
          <div className="scraper-file-note">
            <span className="spinner" /> Loading knowledge stores…
          </div>
        ) : stores.length === 0 ? (
          <div className="row-list-empty">
            No knowledge stores in this project.{" "}
            <button
              type="button"
              className="btn-link"
              onClick={onOpenCreate}
              disabled={disabled || !apiKeyId}
            >
              Create one →
            </button>
          </div>
        ) : (
          <div className="uploader-store-row">
            <Select
              className="select"
              value={selectedStoreId}
              onChange={(v) => setSelectedStoreId(v)}
              disabled={disabled}
              placeholder="Select a store…"
              options={[
                { value: "", label: "Select a store…" },
                ...stores.map((s) => ({
                  value: s._id,
                  label: (
                    <span className="uploader-store-option">
                      <span className="uploader-store-option-name">
                        {s.name}
                      </span>
                      <span className="uploader-store-option-id">{s._id}</span>
                    </span>
                  ),
                })),
              ]}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={onRefreshStores}
              disabled={disabled}
              title="Refresh list"
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onOpenCreate}
              disabled={disabled || !apiKeyId}
            >
              + New
            </button>
          </div>
        )}
        {storesError && <div className="form-error">{storesError}</div>}
      </FormField>

      <div className="scraper-divider" />

      <FormField label="Select a folder">
        <span className="scraper-hint">
          — reads every <code>.ctxt</code>, <code>.txt</code>, and{" "}
          <code>.pdf</code> in the folder
        </span>
        <input
          ref={folderRef}
          type="file"
          multiple
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
          disabled={disabled}
        />
      </FormField>

      <FormField label="Or add individual files">
        <input
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
          disabled={disabled}
        />
      </FormField>

      {files.length > 0 && (
        <>
          <div className="scraper-input-meta">
            <span className="scraper-count">
              {files.length} file{files.length === 1 ? "" : "s"} ready
            </span>
            <button
              type="button"
              className="btn-link"
              onClick={clearFiles}
              disabled={disabled}
            >
              Clear
            </button>
          </div>
          <div className="scraper-doc-list">
            {files.map((f, i) => (
              <div key={`${f.file.name}-${i}`} className="scraper-doc-row">
                <div className="scraper-doc-name">{f.file.name}</div>
                <div className="scraper-doc-meta">
                  {f.fileType} · {formatBytes(f.file.size)}
                </div>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => removeFile(i)}
                  disabled={disabled}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default InputPanel;
