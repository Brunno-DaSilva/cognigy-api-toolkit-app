import { useEffect } from "react";

// Right-side slide-out panel. Lighter-weight than Modal for non-blocking
// notices (e.g. "these files aren't supported"). Closes on Escape or overlay
// click. `open` toggles the visible state so the CSS transition can play.
const SlideOut = ({ open, onClose, title, children, footer }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`slideout-overlay ${open ? "slideout-overlay--open" : ""}`}
      onMouseDown={onClose}
      aria-hidden={!open}
    >
      <div
        className={`slideout ${open ? "slideout--open" : ""}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="slideout-header">
          <h2 className="slideout-title">{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="slideout-body">{children}</div>
        {footer && <div className="slideout-footer">{footer}</div>}
      </div>
    </div>
  );
};

export default SlideOut;
