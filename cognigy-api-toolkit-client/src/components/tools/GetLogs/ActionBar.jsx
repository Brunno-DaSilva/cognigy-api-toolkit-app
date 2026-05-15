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

const DownloadIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export default ActionBar;
