import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Store configuration CRUD for KAI Connector, plus management of the KAI helper
// keys (Azure embedding key, customer source key). Those keys are stored in the
// existing api_keys table — encrypted via the create_provider_api_key RPC, with
// only key_last4 ever returned — exactly like the main Cognigy key. They carry a
// non-'cognigy' provider so they never appear in the Cognigy key dropdowns.
const useKAIStore = ({ projectId, customerId }) => {
  const [stores, setStores] = useState([]);
  const [azureKeys, setAzureKeys] = useState([]);
  const [sourceKeys, setSourceKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadProviderKeys = useCallback(async () => {
    if (!customerId) {
      setAzureKeys([]);
      setSourceKeys([]);
      return;
    }
    const { data, error: err } = await supabase
      .from("api_keys")
      .select("id, name, key_last4, provider, created_at")
      .eq("customer_id", customerId)
      .in("provider", ["azure_openai", "source"])
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    const rows = data ?? [];
    setAzureKeys(rows.filter((k) => k.provider === "azure_openai"));
    setSourceKeys(rows.filter((k) => k.provider === "source"));
  }, [customerId]);

  const reload = useCallback(async () => {
    if (!projectId) {
      setStores([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("kai_stores")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (err) throw err;
      setStores(data ?? []);
      await loadProviderKeys();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, loadProviderKeys]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Insert (no id) or update (id present). Returns the saved row.
  const saveStore = useCallback(
    async (payload) => {
      const { id, ...fields } = payload;
      if (id) {
        const { data, error: err } = await supabase
          .from("kai_stores")
          .update(fields)
          .eq("id", id)
          .select("*")
          .single();
        if (err) throw err;
        await reload();
        return data;
      }
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("not authenticated");
      const { data, error: err } = await supabase
        .from("kai_stores")
        .insert({ ...fields, user_id: userId, customer_id: customerId, project_id: projectId })
        .select("*")
        .single();
      if (err) throw err;
      await reload();
      return data;
    },
    [reload, customerId, projectId],
  );

  const deleteStore = useCallback(
    async (storeId) => {
      const { error: err } = await supabase.from("kai_stores").delete().eq("id", storeId);
      if (err) throw err;
      await reload();
    },
    [reload],
  );

  // Create an encrypted helper key (provider 'azure_openai' | 'source').
  const createProviderKey = useCallback(
    async ({ name, key, provider }) => {
      const { data, error: err } = await supabase.rpc("create_provider_api_key", {
        p_customer_id: customerId,
        p_name: name,
        p_key_plaintext: key,
        p_provider: provider,
      });
      if (err) throw err;
      await loadProviderKeys();
      return data;
    },
    [customerId, loadProviderKeys],
  );

  const deleteProviderKey = useCallback(
    async (keyId) => {
      const { error: err } = await supabase.from("api_keys").delete().eq("id", keyId);
      if (err) throw err;
      await loadProviderKeys();
    },
    [loadProviderKeys],
  );

  return {
    stores,
    azureKeys,
    sourceKeys,
    loading,
    error,
    reload,
    saveStore,
    deleteStore,
    createProviderKey,
    deleteProviderKey,
  };
};

export default useKAIStore;
