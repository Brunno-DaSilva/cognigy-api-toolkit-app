// Centered animated-logo loader. Sized to fill its container — works as a
// full-viewport loader (auth guard) or as a content-area loader (tool pages
// waiting on project context).
//
// `text` is optional; pass null/"" to show just the logo.
const LoadingScreen = ({ text = "Loading…" }) => (
  <div className="loading-screen">
    <img
      className="loading-screen-logo"
      src="/favicon-animated.svg"
      alt=""
      width={120}
      height={190}
    />
    {text ? <div className="loading-screen-text">{text}</div> : null}
  </div>
);

export default LoadingScreen;
