import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

const STORAGE_PROJECT_KEY     = "cognigy-toolkit:active-project-id";
const STORAGE_CUSTOMER_KEY    = "cognigy-toolkit:active-customer-id";
const STORAGE_ENVIRONMENT_KEY = "cognigy-toolkit:active-environment-id";

const readStored = (key) => {
  try {
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
};

const writeStored = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage unavailable — selection won't persist this session
  }
};

const ActiveProjectContext = createContext(null);

export const ActiveProjectProvider = ({ children }) => {
  const { session } = useAuth();

  const [activeCustomerId, setActiveCustomerIdState] = useState(() =>
    readStored(STORAGE_CUSTOMER_KEY),
  );
  const [activeEnvironmentId, setActiveEnvironmentIdState] = useState(() =>
    readStored(STORAGE_ENVIRONMENT_KEY),
  );
  const [activeProjectId, setActiveProjectIdState] = useState(() =>
    readStored(STORAGE_PROJECT_KEY),
  );

  // Data loaded from DB based on the active selections
  const [customer, setCustomer] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [environment, setEnvironment] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);
  const [customers, setCustomers] = useState([]);  // for top-bar dropdown
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ---- Setters with cascade ------------------------------------------------
  const setActiveCustomerId = useCallback((id) => {
    setActiveCustomerIdState(id);
    writeStored(STORAGE_CUSTOMER_KEY, id);
    // Reset env + project when customer changes
    setActiveEnvironmentIdState(null);
    writeStored(STORAGE_ENVIRONMENT_KEY, null);
    setActiveProjectIdState(null);
    writeStored(STORAGE_PROJECT_KEY, null);
  }, []);

  const setActiveEnvironmentId = useCallback((id) => {
    setActiveEnvironmentIdState(id);
    writeStored(STORAGE_ENVIRONMENT_KEY, id);
    // Reset project when env changes (project may not belong to new env)
    setActiveProjectIdState(null);
    writeStored(STORAGE_PROJECT_KEY, null);
  }, []);

  const setActiveProjectId = useCallback((id) => {
    setActiveProjectIdState(id);
    writeStored(STORAGE_PROJECT_KEY, id);
  }, []);

  const clear = useCallback(() => {
    setActiveCustomerIdState(null);
    writeStored(STORAGE_CUSTOMER_KEY, null);
    setActiveEnvironmentIdState(null);
    writeStored(STORAGE_ENVIRONMENT_KEY, null);
    setActiveProjectIdState(null);
    writeStored(STORAGE_PROJECT_KEY, null);
  }, []);

  // ---- Loaders -------------------------------------------------------------
  // Always-loaded: the list of customers (for the top-bar dropdown).
  const loadCustomers = useCallback(async () => {
    if (!session) {
      setCustomers([]);
      return [];
    }
    const { data, error: err } = await supabase
      .from("customers")
      .select("id, name, base_url, platform, created_at")
      .order("name");
    if (err) {
      setError(err.message);
      return [];
    }
    setCustomers(data ?? []);
    return data ?? [];
  }, [session]);

  // Per-customer: load envs + projects + api_keys for the active customer.
  const reload = useCallback(async () => {
    if (!session) {
      setCustomer(null);
      setEnvironments([]);
      setEnvironment(null);
      setProjects([]);
      setProject(null);
      setApiKeys([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const allCustomers = await loadCustomers();

      // Backward compat: if we have a stored projectId but no customerId,
      // derive customerId from the project.
      let effectiveCustomerId = activeCustomerId;
      if (!effectiveCustomerId && activeProjectId) {
        const { data: p } = await supabase
          .from("projects")
          .select("customer_id")
          .eq("id", activeProjectId)
          .maybeSingle();
        if (p?.customer_id) {
          effectiveCustomerId = p.customer_id;
          setActiveCustomerIdState(effectiveCustomerId);
          writeStored(STORAGE_CUSTOMER_KEY, effectiveCustomerId);
        }
      }

      if (!effectiveCustomerId) {
        setCustomer(null);
        setEnvironments([]);
        setEnvironment(null);
        setProjects([]);
        setProject(null);
        setApiKeys([]);
        return;
      }

      // Active customer record
      const c = allCustomers.find((x) => x.id === effectiveCustomerId) ?? null;
      if (!c) {
        // Stale customer id (deleted or not ours). Drop it.
        setActiveCustomerIdState(null);
        writeStored(STORAGE_CUSTOMER_KEY, null);
        setCustomer(null);
        setEnvironments([]);
        setProjects([]);
        setProject(null);
        setApiKeys([]);
        return;
      }
      setCustomer(c);

      // Envs + projects + api_keys for this customer
      const [envsRes, projsRes, keysRes] = await Promise.all([
        supabase
          .from("environments")
          .select("id, name, base_url, created_at")
          .eq("customer_id", effectiveCustomerId)
          .order("name"),
        supabase
          .from("projects")
          .select("id, name, cognigy_project_id, environment_id, created_at")
          .eq("customer_id", effectiveCustomerId)
          .order("name"),
        supabase
          .from("api_keys")
          .select("id, name, key_last4, created_at")
          .eq("customer_id", effectiveCustomerId)
          .order("created_at", { ascending: false }),
      ]);

      if (envsRes.error) throw envsRes.error;
      if (projsRes.error) throw projsRes.error;
      if (keysRes.error) throw keysRes.error;

      const envs = envsRes.data ?? [];
      const projs = projsRes.data ?? [];
      const keys = keysRes.data ?? [];

      setEnvironments(envs);
      setProjects(projs);
      setApiKeys(keys);

      // Active env: if stored env doesn't belong to this customer, drop it.
      const envMatch =
        activeEnvironmentId
          ? envs.find((e) => e.id === activeEnvironmentId) ?? null
          : null;
      if (activeEnvironmentId && !envMatch) {
        setActiveEnvironmentIdState(null);
        writeStored(STORAGE_ENVIRONMENT_KEY, null);
      }
      setEnvironment(envMatch);

      // Active project: must belong to this customer; if env is active, must
      // also belong to that env.
      let projMatch =
        activeProjectId
          ? projs.find((p) => p.id === activeProjectId) ?? null
          : null;
      if (projMatch && envMatch && projMatch.environment_id !== envMatch.id) {
        projMatch = null;
      }
      if (activeProjectId && !projMatch) {
        setActiveProjectIdState(null);
        writeStored(STORAGE_PROJECT_KEY, null);
      }
      setProject(projMatch);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [session, activeCustomerId, activeEnvironmentId, activeProjectId, loadCustomers]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Projects scoped to the active env (or all customer projects if no env active)
  const visibleProjects = useMemo(() => {
    if (!environment) return projects;
    return projects.filter((p) => p.environment_id === environment.id);
  }, [projects, environment]);

  const value = useMemo(
    () => ({
      // ID accessors
      activeCustomerId,
      activeEnvironmentId,
      activeProjectId,
      // Setters with cascade
      setActiveCustomerId,
      setActiveEnvironmentId,
      setActiveProjectId,
      clear,
      reload,
      // Resolved records
      customer,
      customers,           // full list for top-bar dropdown
      environment,
      environments,        // list under active customer
      project,
      projects,            // full list under active customer
      visibleProjects,     // filtered by env if env active
      apiKeys,
      // Status
      loading,
      error,
    }),
    [
      activeCustomerId,
      activeEnvironmentId,
      activeProjectId,
      setActiveCustomerId,
      setActiveEnvironmentId,
      setActiveProjectId,
      clear,
      reload,
      customer,
      customers,
      environment,
      environments,
      project,
      projects,
      visibleProjects,
      apiKeys,
      loading,
      error,
    ],
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
