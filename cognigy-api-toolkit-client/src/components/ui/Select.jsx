import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CaretIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/**
 * App-wide custom dropdown. Replaces native <select> so the open list matches
 * the rest of the app (purple highlight, rounded corners, custom caret) — none
 * of which are stylable on a native select's OS-rendered option popup.
 *
 * The list renders in a portal with fixed positioning so it never gets clipped
 * inside modals or scrollable panels.
 *
 * Props:
 *   value       current value (compared as string)
 *   onChange    (value) => void — receives the chosen value, not an event
 *   options     [{ value, label, disabled? }]
 *   placeholder shown when no option matches value (default "Select…")
 *   className   passthrough to the trigger so it matches sibling inputs
 *               (e.g. "select", "field-input", "select select--sm")
 *   disabled    disables the whole control
 */
const Select = ({
  value,
  onChange,
  options = [],
  placeholder = "Select…",
  className = "",
  disabled = false,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));
  const label = selected ? selected.label : placeholder;

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 240 && r.top > spaceBelow;
    setCoords({
      left: r.left,
      width: r.width,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.max(160, (openUp ? r.top : spaceBelow) - 12),
    });
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target) &&
        listRef.current &&
        !listRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => setOpen(false);
    // Close when the page/container behind the dropdown scrolls, but NOT when
    // the user is scrolling inside the option list itself.
    const onScroll = (e) => {
      if (listRef.current && listRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const pick = (v) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`app-select-trigger ${className}`.trim()}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span
          className={
            "app-select-value" +
            (selected ? "" : " app-select-value--placeholder")
          }
        >
          {label}
        </span>
        <CaretIcon />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={listRef}
            className="app-select-list"
            role="listbox"
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              bottom: coords.bottom,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
          >
            {options.length === 0 ? (
              <div className="app-select-empty">No options</div>
            ) : (
              options.map((o) => {
                const active = String(o.value) === String(value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={
                      "app-select-option" +
                      (active ? " app-select-option--active" : "")
                    }
                    onClick={() => pick(o.value)}
                    disabled={o.disabled}
                  >
                    <span className="app-select-option-label">{o.label}</span>
                    {active && (
                      <span className="app-select-option-check">
                        <CheckIcon />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </>
  );
};

export default Select;
