const TypeChip = ({ label, color, active, onClick }) => (
  <button
    className={`type-chip ${active ? "type-chip--active" : ""}`}
    style={active ? { borderColor: color, color, background: color + "18" } : {}}
    onClick={onClick}
    type="button"
  >
    <span className="type-chip-dot" style={{ background: active ? color : "#9ca3af" }} />
    {label}
  </button>
);

export default TypeChip;
