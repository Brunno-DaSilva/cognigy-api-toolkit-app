const FormField = ({ label, required, children }) => (
  <div className="form-field">
    <label className="form-label">
      {label}
      {required && <span className="form-required"> *</span>}
    </label>
    {children}
  </div>
);

export default FormField;
