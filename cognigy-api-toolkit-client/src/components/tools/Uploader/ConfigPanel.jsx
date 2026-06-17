// Upload throttle settings — defaults mirror upload_FEATURE/upload-files.mjs and
// the feature spec. All are editable before a run. Time fields are entered in
// milliseconds (matching the underlying delays) with a seconds hint.
const FIELDS = [
  {
    key: "delayBetweenUploads",
    label: "Delay between uploads",
    unit: "ms",
    min: 0,
    step: 500,
    hint: "wait between each individual file",
  },
  {
    key: "batchSize",
    label: "Batch size",
    unit: "files",
    min: 1,
    step: 1,
    hint: "files per batch before a longer pause",
  },
  {
    key: "batchDelay",
    label: "Batch delay",
    unit: "ms",
    min: 0,
    step: 1000,
    hint: "pause after completing each batch",
  },
  {
    key: "maxRetries",
    label: "Max retries",
    unit: "attempts",
    min: 1,
    step: 1,
    hint: "retry attempts for a failed upload",
  },
  {
    key: "retryDelay",
    label: "Retry delay",
    unit: "ms",
    min: 0,
    step: 1000,
    hint: "wait before retrying (per API guidance)",
  },
];

const ConfigPanel = ({ config, setConfig, disabled }) => {
  const update = (key, raw, min) => {
    const n = Math.max(min, Math.floor(Number(raw) || 0));
    setConfig((prev) => ({ ...prev, [key]: n }));
  };

  return (
    <div className="card scraper-config">
      <div className="card-title">Upload settings</div>

      {FIELDS.map((f) => {
        const value = config[f.key];
        const isMs = f.unit === "ms";
        return (
          <div className="form-field" key={f.key}>
            <label className="form-label">
              {f.label}
              <span className="scraper-hint">— {f.hint}</span>
            </label>
            <div className="scraper-slider-row">
              <input
                type="number"
                className="input scraper-num"
                min={f.min}
                step={f.step}
                value={value}
                onChange={(e) => update(f.key, e.target.value, f.min)}
                disabled={disabled}
              />
              <span className="uploader-unit">
                {f.unit}
                {isMs && value > 0 ? ` · ${(value / 1000).toFixed(value % 1000 ? 1 : 0)}s` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ConfigPanel;
