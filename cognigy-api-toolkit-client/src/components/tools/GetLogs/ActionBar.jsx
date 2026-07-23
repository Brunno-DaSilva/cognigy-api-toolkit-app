import DownloadIcon from "../../ui/DownloadIcon";

const ActionBar = ({ running, done, logCount, onFetch, onDownload }) => (
  <div className="action-bar">
    {done && logCount > 0 && (
      <button className="btn btn--success" onClick={onDownload}>
        <DownloadIcon />
        Download {logCount.toLocaleString()} logs
      </button>
    )}
    <button className="btn btn--primary" onClick={onFetch} disabled={running}>
      {running ? (
        <>
          <span className="spinner" />
          Fetching...
        </>
      ) : (
        <>
          <PlayIcon />
          Fetch All Logs
        </>
      )}
    </button>
  </div>
);

const PlayIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export default ActionBar;
