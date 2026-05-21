import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Loads the merged snapshot view for a project:
//   - currents:  Cognigy's live snapshot list (source of truth), each row enriched
//                with the matching DB row so the UI can tell whether we hold the
//                .csnap binary in our store.
//   - archived:  DB rows with status='archived' (binary in our Storage, gone from
//                Cognigy).
// Also exposes startJob() / importExisting() and polls while any job is active.
const useSnapshots = ({ projectId, cognigyProjectId, apiKeyId }) => {
  const [currents, setCurrents] = useState([]);
  const [archived, setArchived] = useState([]);
  const [activeJobs, setActiveJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [remoteListError, setRemoteListError] = useState(null);

  const activeJobsRef = useRef([]);
  const advancingRef = useRef(false);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [snapsRes, jobsRes] = await Promise.all([
        supabase
          .from("snapshots")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false }),
        supabase
          .from("snapshot_promotions")
          .select("*")
          .eq("target_project_id", projectId)
          .in("status", ["pending", "running"])
          .order("created_at", { ascending: false }),
      ]);
      if (snapsRes.error) throw snapsRes.error;
      if (jobsRes.error) throw jobsRes.error;

      const localSnaps = snapsRes.data ?? [];
      const localByCognigyId = new Map(
        localSnaps
          .filter((s) => s.cognigy_snapshot_id)
          .map((s) => [s.cognigy_snapshot_id, s]),
      );

      // Fetch Cognigy's live list (best-effort — if it fails we still render
      // the archived list and the in-flight jobs).
      let remoteCurrents = [];
      if (apiKeyId && cognigyProjectId) {
        try {
          const { data: remote, error: remoteErr } = await supabase.functions.invoke(
            "cognigy-snapshots",
            {
              body: {
                action: "list_remote",
                api_key_id: apiKeyId,
                cognigy_project_id: cognigyProjectId,
              },
            },
          );
          if (remoteErr) throw remoteErr;
          const items = remote?.items ?? [];
          remoteCurrents = items
            .map((c) => ({
              cognigy_snapshot_id: c._id,
              cognigy_name: c.name,
              cognigy_description: c.description,
              cognigy_created_at: c.createdAt,
              cognigy_is_packaged: c.isPackaged,
              localRow: localByCognigyId.get(c._id) ?? null,
            }))
            .sort(
              (a, b) =>
                (b.cognigy_created_at ?? 0) - (a.cognigy_created_at ?? 0),
            );
          setRemoteListError(null);
        } catch (err) {
          setRemoteListError(err.message || String(err));
        }
      }

      setCurrents(remoteCurrents);
      setArchived(localSnaps.filter((s) => s.status === "archived"));
      setActiveJobs(jobsRes.data ?? []);
      activeJobsRef.current = jobsRes.data ?? [];
      setError(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, cognigyProjectId, apiKeyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Polling: every 2.5s while at least one job is active, advance one and reload.
  useEffect(() => {
    if (activeJobs.length === 0) return;
    let cancelled = false;

    const tick = async () => {
      if (advancingRef.current || cancelled) return;
      const job = activeJobsRef.current[0];
      if (!job) return;
      advancingRef.current = true;
      try {
        await supabase.functions.invoke("snapshot-worker", {
          body: { job_id: job.id },
        });
        if (!cancelled) await reload();
      } catch (err) {
        console.warn("worker advance failed", err);
      } finally {
        advancingRef.current = false;
      }
    };

    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeJobs.length, reload]);

  const startJob = useCallback(
    async ({
      kind,
      targetProjectId,
      targetApiKeyId,
      sourceSnapshotId,
      sourceApiKeyId,
      sourceCognigySnapshotId,
    }) => {
      const { data: jobId, error: rpcErr } = await supabase.rpc(
        "start_snapshot_job",
        {
          p_kind: kind,
          p_target_project_id: targetProjectId,
          p_target_api_key_id: targetApiKeyId,
          p_source_snapshot_id: sourceSnapshotId ?? null,
          p_source_api_key_id: sourceApiKeyId ?? null,
          p_source_cognigy_snapshot_id: sourceCognigySnapshotId ?? null,
        },
      );
      if (rpcErr) throw rpcErr;
      await reload();
      supabase.functions
        .invoke("snapshot-worker", { body: { job_id: jobId } })
        .then(() => reload())
        .catch((e) => console.warn("worker initial invoke failed", e));
      return jobId;
    },
    [reload],
  );

  const importExisting = useCallback(
    (cognigySnapshotId) =>
      startJob({
        kind: "import",
        targetProjectId: projectId,
        targetApiKeyId: apiKeyId,
        sourceCognigySnapshotId: cognigySnapshotId,
      }),
    [startJob, projectId, apiKeyId],
  );

  return {
    currents,
    archived,
    activeJobs,
    loading,
    error,
    remoteListError,
    reload,
    startJob,
    importExisting,
  };
};

export default useSnapshots;
