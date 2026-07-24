// Upload throttle settings — sliders in the Scraper's look & feel. Each slider
// is index-based so it snaps ONLY to the fixed stops below (their spacing is
// non-uniform, which a plain step slider can't express). Time values are stored
// in milliseconds (matching the upload logic) and shown in seconds.
const FIELDS = [
  {
    key: "delayBetweenUploads",
    label: "Delay between uploads",
    hint: "wait between each individual file",
    stops: [1000, 5000, 10000, 15000, 20000],
    toSeconds: true,
  },
  {
    key: "batchSize",
    label: "Batch size",
    hint: "files per batch before a longer pause",
    stops: [1, 3, 5, 7, 10],
    unit: "files",
  },
  {
    key: "batchDelay",
    label: "Batch delay",
    hint: "pause after completing each batch",
    stops: [2000, 5000, 10000, 15000, 20000, 25000, 30000],
    toSeconds: true,
  },
  {
    key: "maxRetries",
    label: "Max retries",
    hint: "retry attempts for a failed upload",
    stops: [1, 2, 3, 4, 5],
    unit: "attempts",
  },
  {
    key: "retryDelay",
    label: "Retry delay",
    hint: "wait before retrying (per API guidance)",
    stops: [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000],
    toSeconds: true,
  },
];

// Nearest stop index for a value — keeps the handle valid even if a stored
// value isn't exactly one of the stops.
const nearestIndex = (stops, value) => {
  let best = 0;
  let bestDist = Infinity;
  stops.forEach((s, i) => {
    const d = Math.abs(s - value);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
};

const formatValue = (f, value) =>
  f.toSeconds ? `${Math.round(value / 1000)}s` : `${value} ${f.unit}`;

const ConfigPanel = ({ config, setConfig, disabled }) => {
  return (
    <div className="card scraper-config">
      <div className="card-title">Upload settings</div>

      {FIELDS.map((f) => {
        const idx = nearestIndex(f.stops, config[f.key]);
        return (
          <div className="form-field" key={f.key}>
            <label className="form-label">
              {f.label}
              <span className="scraper-hint">— {f.hint}</span>
            </label>
            <div className="scraper-slider-row">
              <input
                type="range"
                min={0}
                max={f.stops.length - 1}
                step={1}
                value={idx}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    [f.key]: f.stops[Number(e.target.value)],
                  }))
                }
                disabled={disabled}
                aria-label={f.label}
              />
              <span className="uploader-slider-value">
                {formatValue(f, f.stops[idx])}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ConfigPanel;
