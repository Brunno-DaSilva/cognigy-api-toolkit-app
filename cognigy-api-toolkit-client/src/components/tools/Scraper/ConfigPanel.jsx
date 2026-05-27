import { useState } from "react";

// Defaults mirrored on the server (cognigy-api-toolkit-backend/.../scraper/index.ts).
// If a tag is in `availableTags` and NOT in config.ignoreTags, the scraper KEEPS
// that tag in the page (chip is "off"). Default state: every tag ignored.
const AVAILABLE_TAGS = [
  "script", "style", "nav", "footer", "header",
  "iframe", "aside", "noscript", "svg", "img", "button",
];

const MIN_CAP = 800;
const MAX_CAP = 2000;

const ConfigPanel = ({ config, setConfig, disabled }) => {
  const [tagDraft, setTagDraft] = useState("");

  const toggleTag = (tag) => {
    setConfig((prev) => {
      const isIgnored = prev.ignoreTags.includes(tag);
      return {
        ...prev,
        ignoreTags: isIgnored
          ? prev.ignoreTags.filter((t) => t !== tag)
          : [...prev.ignoreTags, tag],
      };
    });
  };

  const updateMax = (val) => {
    const n = Math.min(MAX_CAP, Math.max(MIN_CAP, Number(val) || MIN_CAP));
    setConfig((prev) => ({
      ...prev,
      maxChunkSize: n,
      minChunkSize: Math.min(prev.minChunkSize, n - 1),
    }));
  };

  const updateMin = (val) => {
    const n = Math.max(MIN_CAP, Math.min(config.maxChunkSize - 1, Number(val) || MIN_CAP));
    setConfig((prev) => ({ ...prev, minChunkSize: n }));
  };

  const addCustomTag = () => {
    const t = tagDraft.trim();
    if (!t) return;
    if (config.customTags.includes(t)) {
      setTagDraft("");
      return;
    }
    setConfig((prev) => ({ ...prev, customTags: [...prev.customTags, t] }));
    setTagDraft("");
  };

  const removeCustomTag = (t) => {
    setConfig((prev) => ({
      ...prev,
      customTags: prev.customTags.filter((x) => x !== t),
    }));
  };

  return (
    <div className="card scraper-config">
      <div className="card-title">Configuration</div>

      <div className="form-field">
        <label className="form-label">
          Ignored HTML tags
          <span className="scraper-hint">
            — tags removed before content extraction. Click to toggle.
          </span>
        </label>
        <div className="chip-group">
          {AVAILABLE_TAGS.map((tag) => {
            const active = config.ignoreTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`type-chip ${active ? "type-chip--active" : ""}`}
                style={
                  active
                    ? { borderColor: "#ef4444", color: "#ef4444", background: "#ef444418" }
                    : {}
                }
                disabled={disabled}
                onClick={() => toggleTag(tag)}
              >
                <span
                  className="type-chip-dot"
                  style={{ background: active ? "#ef4444" : "#9ca3af" }}
                />
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      <div className="scraper-row">
        <div className="form-field">
          <label className="form-label">
            Max chunk size <span className="scraper-hint">— up to {MAX_CAP}</span>
          </label>
          <div className="scraper-slider-row">
            <input
              type="range"
              min={MIN_CAP}
              max={MAX_CAP}
              step={50}
              value={config.maxChunkSize}
              onChange={(e) => updateMax(e.target.value)}
              disabled={disabled}
            />
            <input
              type="number"
              className="input scraper-num"
              min={MIN_CAP}
              max={MAX_CAP}
              value={config.maxChunkSize}
              onChange={(e) => updateMax(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">
            Min chunk size <span className="scraper-hint">— at least {MIN_CAP}</span>
          </label>
          <div className="scraper-slider-row">
            <input
              type="range"
              min={MIN_CAP}
              max={config.maxChunkSize - 1}
              step={50}
              value={config.minChunkSize}
              onChange={(e) => updateMin(e.target.value)}
              disabled={disabled}
            />
            <input
              type="number"
              className="input scraper-num"
              min={MIN_CAP}
              max={config.maxChunkSize - 1}
              value={config.minChunkSize}
              onChange={(e) => updateMin(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">
          Custom tags
          <span className="scraper-hint">
            — added to every <code>.ctxt</code> file's tags header
          </span>
        </label>
        <div className="scraper-tag-input">
          <input
            type="text"
            className="input"
            placeholder="e.g. faq, billing, en-us"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomTag();
              }
            }}
            disabled={disabled}
          />
          <button
            type="button"
            className="btn btn--primary scraper-tag-add"
            onClick={addCustomTag}
            disabled={disabled || !tagDraft.trim()}
          >
            Add
          </button>
        </div>
        {config.customTags.length > 0 && (
          <div className="chip-group">
            {config.customTags.map((t) => (
              <button
                key={t}
                type="button"
                className="type-chip"
                onClick={() => removeCustomTag(t)}
                disabled={disabled}
                title="Remove"
              >
                {t} ×
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPanel;
