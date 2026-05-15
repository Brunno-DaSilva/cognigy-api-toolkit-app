const Card = ({ title, children, className = "" }) => (
  <div className={`card ${className}`}>
    {title && <div className="card-title">{title}</div>}
    {children}
  </div>
);

export default Card;
