import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// Document index + sync events + backups for a KAI store. All reads are RLS
// scoped. Mutating actions (delete, hold resolution, restore) route through the
// kai-evaluator Edge Function so the raw Cognigy key stays server-side and the
// backup-before-delete invariant is enforced.
const useKAIDocuments = (storeId) => {
  const [documents, setDocuments] = useState([]);
  const [events, setEvents] = useState([]);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!storeId) {
      setDocuments([]);
      setEvents([]);
      setBackups([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [docsRes, evRes, bkRes] = await Promise.all([
        supabase
          .from("kai_documents")
          .select("*")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false }),
        supabase
          .from("kai_sync_events")
          .select("*")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false }),
        supabase
          .from("kai_document_backups")
          .select("*")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false }),
      ]);
      if (docsRes.error) throw docsRes.error;
      if (evRes.error) throw evRes.error;
      if (bkRes.error) throw bkRes.error;
      setDocuments(docsRes.data ?? []);
      setEvents(evRes.data ?? []);
      setBackups(bkRes.data ?? []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const holdQueue = useMemo(
    () => events.filter((e) => e.decision === "hold" && e.status === "done"),
    [events],
  );

  const deleteDocument = useCallback(
    async (documentId) => {
      const { data, error: err } = await supabase.functions.invoke("kai-evaluator", {
        body: { action: "delete_document", document_id: documentId },
      });
      if (err) throw err;
      if (data?.error) throw new Error(data.error);
      await reload();
      return data;
    },
    [reload],
  );

  const resolveHold = useCallback(
    async (eventId, resolution) => {
      const { data, error: err } = await supabase.functions.invoke("kai-evaluator", {
        body: { action: "resolve_hold", event_id: eventId, resolution },
      });
      if (err) throw err;
      if (data?.error) throw new Error(data.error);
      await reload();
      return data;
    },
    [reload],
  );

  const signBackupDownload = useCallback(async (backupId) => {
    const { data, error: err } = await supabase.functions.invoke("kai-evaluator", {
      body: { action: "sign_backup_download", backup_id: backupId },
    });
    if (err) throw err;
    if (data?.error) throw new Error(data.error);
    return data; // { url, filename }
  }, []);

  const restoreBackup = useCallback(
    async (backupId) => {
      const { data, error: err } = await supabase.functions.invoke("kai-evaluator", {
        body: { action: "restore_backup", backup_id: backupId },
      });
      if (err) throw err;
      if (data?.error) throw new Error(data.error);
      await reload();
      return data;
    },
    [reload],
  );

  return {
    documents,
    events,
    backups,
    holdQueue,
    loading,
    error,
    reload,
    deleteDocument,
    resolveHold,
    signBackupDownload,
    restoreBackup,
  };
};

export default useKAIDocuments;
