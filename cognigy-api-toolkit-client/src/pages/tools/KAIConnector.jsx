import { useEffect, useMemo, useState } from "react";
import { useActiveProject } from "../../context/ActiveProjectContext";
import useKAIStore from "../../hooks/useKAIStore";
import useKAIDocuments from "../../hooks/useKAIDocuments";
import useKAISync from "../../hooks/useKAISync";
import LoadingScreen from "../../components/ui/LoadingScreen";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import NoActiveProject from "./NoActiveProject";
import StoreConfigPanel from "../../components/tools/KAIConnector/StoreConfigPanel";
import DocumentIndexTable from "../../components/tools/KAIConnector/DocumentIndexTable";
import HoldQueue from "../../components/tools/KAIConnector/HoldQueue";
import NightlySyncStatus from "../../components/tools/KAIConnector/NightlySyncStatus";
import SyncEventModal from "../../components/tools/KAIConnector/SyncEventModal";
import SyncLogPanel from "../../components/tools/KAIConnector/SyncLogPanel";

const TABS = [
  ["config", "Configuration"],
  ["documents", "Documents"],
  ["hold", "Hold queue"],
  ["nightly", "Nightly sync"],
  ["log", "Sync log & backups"],
];

const KAIConnector = () => {
  const {
    activeProjectId,
    activeCustomerId,
    project,
    customer,
    apiKeys,
    loading: projectLoading,
  } = useActiveProject();

  const {
    stores,
    azureKeys,
    sourceKeys,
    saveStore,
    createProviderKey,
  } = useKAIStore({ projectId: activeProjectId, customerId: activeCustomerId });

  const [activeStoreId, setActiveStoreId] = useState(null); // null = uninitialised, "" = new store
  const [tab, setTab] = useState("config");
  const [pageError, setPageError] = useState(null);
  const [historyDoc, setHistoryDoc] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [lastRun, setLastRun] = useState(null);

  // Default to the first store once, on initial load.
  useEffect(() => {
    if (activeStoreId === null && stores.length > 0) setActiveStoreId(stores[0].id);
    if (activeStoreId && !stores.some((s) => s.id === activeStoreId)) {
      setActiveStoreId(stores[0]?.id ?? "");
    }
  }, [stores, activeStoreId]);

  // Hide the shared page scrollbar only while KAI Connector is on screen.
  useEffect(() => {
    const el = document.querySelector(".main-content");
    el?.classList.add("kai-hide-scroll");
    return () => el?.classList.remove("kai-hide-scroll");
  }, []);

  const activeStore = useMemo(
    () => stores.find((s) => s.id === activeStoreId) ?? null,
    [stores, activeStoreId],
  );

  const {
    documents,
    events,
    backups,
    holdQueue,
    reload: reloadDocs,
    deleteDocument,
    resolveHold,
    signBackupDownload,
    restoreBackup,
  } = useKAIDocuments(activeStoreId);

  const { runNow, busy: running } = useKAISync();

  if (!activeProjectId) return <NoActiveProject toolName="KAI Connector" />;
  if (projectLoading) return <LoadingScreen text="Loading project…" />;
  if (!project) return <NoActiveProject toolName="KAI Connector" />;

  const handleSave = async (payload) => {
    const saved = await saveStore({ ...payload, id: activeStore?.id ?? payload.id });
    if (saved?.id) setActiveStoreId(saved.id);
    return saved;
  };

  const handleRunNow = async ({ dryRun = false } = {}) => {
    setPageError(null);
    try {
      const data = await runNow(activeStoreId, { dryRun });
      setLastRun(data?.summaries?.[0] ?? null);
      if (!dryRun) await reloadDocs();
    } catch (err) {
      setPageError(err.message || String(err));
    }
  };

  const handleResolve = async (hold, resolution) => {
    setBusyId(hold.id);
    setPageError(null);
    try {
      await resolveHold(hold.id, resolution);
    } catch (err) {
      setPageError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setBusyId(confirmDelete.id);
    setPageError(null);
    try {
      await deleteDocument(confirmDelete.id);
      setConfirmDelete(null);
    } catch (err) {
      setPageError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (backupId) => {
    setBusyId(backupId);
    try {
      await restoreBackup(backupId);
    } finally {
      setBusyId(null);
    }
  };

  const historyEvents = historyDoc
    ? events.filter((e) => e.document_id === historyDoc.id || e.matched_document_id === historyDoc.id)
    : [];

  return (
    <div className="admin-page kai-connector-page">
      <header className="admin-page-header">
        <div style={{ minWidth: 0 }}>
          <div className="admin-page-title">KAI Connector</div>
          <div className="admin-page-sub">{customer?.name} / {project.name}</div>
        </div>
        {stores.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 2,
              flex: "0 0 auto",
            }}
          >
            <span className="row-item-meta" style={{ fontSize: "0.72rem" }}>
              Active store
            </span>
            <select
              className="select"
              value={activeStoreId ?? ""}
              onChange={(e) => setActiveStoreId(e.target.value)}
              title={activeStore?.store_name || activeStore?.cognigy_store_id || "New store"}
              style={{ width: 220, maxWidth: 220 }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_name || s.cognigy_store_id}
                </option>
              ))}
              <option value="">+ New store…</option>
            </select>
          </div>
        )}
      </header>

      {pageError && <div className="form-error" style={{ marginBottom: 12 }}>{pageError}</div>}

      <div className="kai-tabs" role="tablist" aria-label="KAI Connector sections">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={"kai-tab" + (tab === key ? " kai-tab--active" : "")}
            onClick={() => setTab(key)}
          >
            {label}
            {key === "hold" && holdQueue.length > 0 ? (
              <span className="kai-tab-badge">{holdQueue.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "config" && (
        <StoreConfigPanel
          key={activeStoreId || "new"}
          store={activeStore}
          apiKeys={apiKeys}
          azureKeys={azureKeys}
          sourceKeys={sourceKeys}
          projectId={activeProjectId}
          cognigyProjectId={project.cognigy_project_id}
          onSave={handleSave}
          onCreateKey={createProviderKey}
        />
      )}

      {tab === "documents" && (
        <>
          <div className="section-header">
            <div className="section-title">
              Document index <span className="row-item-meta">({documents.length})</span>
            </div>
          </div>
          <DocumentIndexTable
            documents={documents}
            events={events}
            busyId={busyId}
            onViewHistory={setHistoryDoc}
            onDelete={setConfirmDelete}
          />
        </>
      )}

      {tab === "hold" && (
        <>
          <div className="section-header">
            <div className="section-title">
              Hold queue <span className="row-item-meta">({holdQueue.length})</span>
            </div>
          </div>
          <HoldQueue
            holds={holdQueue}
            documents={documents}
            busyId={busyId}
            onResolve={handleResolve}
          />
        </>
      )}

      {tab === "nightly" && (
        <NightlySyncStatus
          store={activeStore}
          running={running}
          onRunNow={handleRunNow}
          lastRun={lastRun}
        />
      )}

      {tab === "log" && (
        <SyncLogPanel
          events={events}
          backups={backups}
          storeName={activeStore?.store_name || activeStore?.cognigy_store_id}
          busyId={busyId}
          onSignDownload={signBackupDownload}
          onRestore={handleRestore}
        />
      )}

      <SyncEventModal
        open={!!historyDoc}
        doc={historyDoc}
        events={historyEvents}
        onClose={() => setHistoryDoc(null)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete document"
        message={
          confirmDelete
            ? `Delete "${confirmDelete.original_filename ?? confirmDelete.title ?? "this document"}" from Cognigy KAI and the local index? A backup is taken first. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        busy={busyId === confirmDelete?.id}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};

export default KAIConnector;
