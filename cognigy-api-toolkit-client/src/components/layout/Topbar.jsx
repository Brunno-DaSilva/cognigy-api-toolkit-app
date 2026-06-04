import { useEffect, useRef, useState } from "react";
import { useActiveProject } from "../../context/ActiveProjectContext";

const CaretIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const Topbar = () => {
  const {
    customers,
    customer,
    setActiveCustomerId,
    activeCustomerId,
  } = useActiveProject();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handlePick = (id) => {
    setActiveCustomerId(id);
    setOpen(false);
  };

  return (
    <header className="topbar">
      <div className="topbar-spacer" />
      <div className="topbar-customer" ref={wrapRef}>
        <button
          type="button"
          className="topbar-customer-trigger"
          onClick={() => setOpen((o) => !o)}
          title={customer ? `Active customer: ${customer.name}` : "Select a customer"}
        >
          <span className="topbar-customer-label">Customer</span>
          <span className="topbar-customer-name">
            {customer?.name || "Select a customer…"}
          </span>
          <CaretIcon />
        </button>

        {open && (
          <div className="topbar-customer-dropdown" role="menu">
            {customers.length === 0 ? (
              <div className="topbar-customer-empty">
                No customers yet. Add one in <strong>Customers</strong>.
              </div>
            ) : (
              customers.map((c) => {
                const isActive = c.id === activeCustomerId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={
                      "topbar-customer-option" +
                      (isActive ? " topbar-customer-option--active" : "")
                    }
                    onClick={() => handlePick(c.id)}
                  >
                    <span className="topbar-customer-option-name">{c.name}</span>
                    {c.base_url && (
                      <span className="topbar-customer-option-meta">
                        {c.base_url}
                      </span>
                    )}
                    {isActive && (
                      <span className="topbar-customer-option-check">
                        <CheckIcon />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default Topbar;
