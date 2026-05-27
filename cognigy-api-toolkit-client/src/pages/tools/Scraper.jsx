import { useState } from "react";
import { useActiveProject } from "../../context/ActiveProjectContext";
import useScraper from "../../hooks/useScraper";
import NoActiveProject from "./NoActiveProject";

// Composed in subsequent tasks — these components own their own sections.
import ConfigPanel from "../../components/tools/Scraper/ConfigPanel";
import InputPanel from "../../components/tools/Scraper/InputPanel";
import Progress from "../../components/tools/Scraper/Progress";

const DEFAULT_IGNORE_TAGS = [
  "script", "style", "nav", "footer", "header",
  "iframe", "aside", "noscript", "svg", "img", "button",
];

const DEFAULT_CONFIG = {
  ignoreTags: [...DEFAULT_IGNORE_TAGS],
  maxChunkSize: 1700,
  minChunkSize: 800,
  customTags: [],
};

const Scraper = () => {
  const { activeProjectId, project, loading: projectLoading } = useActiveProject();
  const [urls, setUrls] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const scraper = useScraper();

  if (!activeProjectId) return <NoActiveProject toolName="Scraper" />;
  if (projectLoading) return <div className="admin-page">Loading project…</div>;
  if (!project) return <NoActiveProject toolName="Scraper" />;

  const handleStart = () => {
    scraper.start({ urls, config });
  };

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Scraper</div>
          <div className="admin-page-sub">
            Convert web pages into <code>.ctxt</code> files ready for the
            Cognigy Knowledge Store. Output is downloaded directly — nothing is
            stored on the server.
          </div>
        </div>
      </header>

      <div className="scraper-layout">
        <InputPanel urls={urls} setUrls={setUrls} disabled={scraper.running} />
        <ConfigPanel config={config} setConfig={setConfig} disabled={scraper.running} />
      </div>

      <Progress
        scraper={scraper}
        urlCount={urls.length}
        onStart={handleStart}
      />
    </div>
  );
};

export default Scraper;
