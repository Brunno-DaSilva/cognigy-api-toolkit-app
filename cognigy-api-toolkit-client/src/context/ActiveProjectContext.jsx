import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

const STORAGE_KEY = "cognigy-toolkit:active-project-id";

const ActiveProjectContext = createContext(null);

export const ActiveProjectProvider = ({ children }) => {
  const { session } = useAuth();
  const [activeProjectId, setActiveProjectIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  const [project, setProject] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const setActiveProjectId = useCallback((id) => {
    setActiveProjectIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const clear = useCallback(() => setActiveProjectId(null), [setActiveProjectId]);

  const reload = useCallback(async () => {
    if (!activeProjectId || !session) {
      setProject(null);
      setCustomer(null);
      setApiKeys([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: p, error: pe } = await supabase
        .from("projects")
        .select("id, customer_id, name, cognigy_project_id")
        .eq("id", activeProjectId)
        .maybeSingle();
      if (pe) throw pe;
      if (!p) {
        // Stale id (project was deleted or belongs to another user). Drop it.
        setActiveProjectId(null);
        return;
      }
      setProject(p);

      const [{ data: c, error: ce }, { data: keys, error: ke }] = await Promise.all([
        supabase
          .from("customers")
          .select("id, name, base_url")
          .eq("id", p.customer_id)
          .maybeSingle(),
        supabase
          .from("api_keys")
          .select("id, name, key_last4, created_at")
          .eq("customer_id", p.customer_id)
          .order("created_at", { ascending: false }),
      ]);
      if (ce) throw ce;
      if (ke) throw ke;
      setCustomer(c);
      setApiKeys(keys ?? []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, session, setActiveProjectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(
    () => ({
      activeProjectId,
      setActiveProjectId,
      clear,
      reload,
      project,
      customer,
      apiKeys,
      loading,
      error,
    }),
    [
      activeProjectId,
      setActiveProjectId,
      clear,
      reload,
      project,
      customer,
      apiKeys,
      loading,
      error,
    ]
  );

  return (
    <ActiveProjectContext.Provider value={value}>
      {children}
    </ActiveProjectContext.Provider>
  );
};

export const useActiveProject = () => {
  const ctx = useContext(ActiveProjectContext);
  if (!ctx)
    throw new Error("useActiveProject must be used inside <ActiveProjectProvider>");
  return ctx;
};
