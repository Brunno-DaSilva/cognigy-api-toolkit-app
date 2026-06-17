import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useActiveProject } from "../../context/ActiveProjectContext";
import useKnowledgeStores from "../../hooks/useKnowledgeStores";
import useUploader from "../../hooks/useUploader";
import { slugify } from "../../utils";
import LoadingScreen from "../../components/ui/LoadingScreen";
import SlideOut from "../../components/ui/SlideOut";
import NoActiveProject from "./NoActiveProject";
import InputPanel from "../../components/tools/Uploader/InputPanel";
import ConfigPanel from "../../components/tools/Uploader/ConfigPanel";
import CreateStoreModal from "../../components/tools/Uploader/CreateStoreModal";
import Progress from "../../components/tools/Uploader/Progress";

// Defaults mirror upload_FEATURE/upload-files.mjs and the feature spec.
const DEFAULT_CONFIG = {
  delayBetweenUploads: 10000,
  batchSize: 5,
  batchDelay: 20000,
  maxRetries: 3,
  retryDelay: 35000,
};

const Uploader = () => {
  const { activeProjectId, project, customer, apiKeys, loading: projectLoading } =
    useActiveProject();

  // Derive the active key (defaulting to the first) instead of seeding it in an
  // effect — keeps the effect free of synchronous setState.
  const [apiKeyOverride, setApiKeyId] = useState("");
  const apiKeyId = apiKeyOverride || apiKeys[0]?.id || "";
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [files, setFiles] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [createOpen, setCreateOpen] = useState(false);
  const [slideOut, setSlideOut] = useState({ open: false, files: [] });

  const ks = useKnowledgeStores();
  const uploader = useUploader();

  // (Re)load knowledge stores whenever the key or project changes, and
  // auto-select the first one for convenience.
  const cognigyProjectId = project?.cognigy_project_id;
  const projectRowId = project?.id;
  const loadStores = ks.loadStores;

  useEffect(() => {
    if (!apiKeyId || !cognigyProjectId) return;
    let cancelled = false;
    (async () => {
      const list = await loadStores({
        apiKeyId,
        projectId: projectRowId,
        cognigyProjectId,
      });
      if (cancelled) return;
      setSelectedStoreId(list.length > 0 ? list[0]._id : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [apiKeyId, projectRowId, cognigyProjectId, loadStores]);

  const refreshStores = useCallback(async () => {
    if (!apiKeyId || !cognigyProjectId) return;
    const list = await loadStores({
      apiKeyId,
      projectId: projectRowId,
      cognigyProjectId,
    });
    if (list.length > 0 && !list.some((s) => s._id === selectedStoreId)) {
      setSelectedStoreId(list[0]._id);
    }
  }, [apiKeyId, projectRowId, cognigyProjectId, loadStores, selectedStoreId]);

  const handleCreate = useCallback(
    async ({ name, description }) => {
      const created = await ks.createStore({
        apiKeyId,
        projectId: projectRowId,
        cognigyProjectId,
        name,
        description,
      });
      if (created) {
        setSelectedStoreId(created._id);
        setCreateOpen(false);
      }
      return created;
    },
    [ks, apiKeyId, projectRowId, cognigyProjectId],
  );

  const selectedStore = useMemo(
    () => ks.stores.find((s) => s._id === selectedStoreId) ?? null,
    [ks.stores, selectedStoreId],
  );

  // Log "context" → mirrors the original "logos-ctxt-upload" naming, derived
  // from the target store (e.g. "product-knowledge-base-upload").
  const context = useMemo(
    () =>
      selectedStore?.name
        ? `${slugify(selectedStore.name)}-upload`
        : "knowledge-upload",
    [selectedStore],
  );

  if (!activeProjectId) return <NoActiveProject toolName="Uploader" />;
  if (projectLoading) return <LoadingScreen text="Loading project…" />;
  if (!project) return <NoActiveProject toolName="Uploader" />;

  const canStart =
    !uploader.running &&
    !!apiKeyId &&
    !!selectedStoreId &&
    files.length > 0;

  const handleStart = () => {
    if (!canStart) return;
    uploader.start({
      apiKeyId,
      projectId: project.id,
      knowledgeStoreId: selectedStoreId,
      context,
      files,
      config,
    });
  };

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <div className="admin-page-title">Uploader</div>
          <div className="admin-page-sub">
            Bulk-upload <code>.ctxt</code>, <code>.txt</code>, and{" "}
            <code>.pdf</code> documents from a local folder into a Cognigy
            Knowledge Store. Need to convert web pages or other docs first? Use
            the <Link className="btn-link" to="/tools/scraper">Scraper</Link>.
          </div>
        </div>
      </header>

      <div className="scraper-layout">
        <InputPanel
          customer={customer}
          project={project}
          apiKeys={apiKeys}
          apiKeyId={apiKeyId}
          setApiKeyId={setApiKeyId}
          stores={ks.stores}
          storesLoading={ks.loading}
          storesError={ks.error}
          selectedStoreId={selectedStoreId}
          setSelectedStoreId={setSelectedStoreId}
          onRefreshStores={refreshStores}
          onOpenCreate={() => setCreateOpen(true)}
          files={files}
          setFiles={setFiles}
          onUnsupported={(names) => setSlideOut({ open: true, files: names })}
          disabled={uploader.running}
        />
        <ConfigPanel
          config={config}
          setConfig={setConfig}
          disabled={uploader.running}
        />
      </div>

      <Progress
        uploader={uploader}
        fileCount={files.length}
        canStart={canStart}
        onStart={handleStart}
      />

      <CreateStoreModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        busy={ks.creating}
        error={ks.error}
      />

      <SlideOut
        open={slideOut.open}
        onClose={() => setSlideOut({ open: false, files: [] })}
        title="Some files can't be uploaded"
        footer={
          <Link
            className="btn btn--primary"
            to="/tools/scraper"
            onClick={() => setSlideOut({ open: false, files: [] })}
          >
            Open the Scraper →
          </Link>
        }
      >
        <p className="analytics-hint">
          Only <code>.ctxt</code>, <code>.txt</code>, and <code>.pdf</code>{" "}
          files can be uploaded to a Knowledge Store. The following were skipped:
        </p>
        <div className="scraper-doc-list">
          {slideOut.files.map((name, i) => (
            <div key={`${name}-${i}`} className="scraper-doc-row">
              <span className="scraper-doc-name">{name}</span>
            </div>
          ))}
        </div>
        <p className="analytics-hint">
          You can convert these into <code>.ctxt</code> files with the{" "}
          <strong>Scraper</strong> tool, then upload the results here.
        </p>
      </SlideOut>
    </div>
  );
};

export default Uploader;
