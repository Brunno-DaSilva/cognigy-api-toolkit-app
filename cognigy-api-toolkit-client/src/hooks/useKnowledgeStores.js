import { useCallback, useState } from "react";
import { supabase } from "../lib/supabase";

// Lists + creates Cognigy Knowledge Stores for the active project. Both are
// plain JSON calls, so they go through the existing `cognigy-proxy` Edge
// Function (which decrypts the key server-side) — only the binary file upload
// needs the dedicated `knowledge-upload` function.
//
// Cognigy's list endpoint paginates with items[]/total; we pull a generous
// first page (stores per project are typically a handful).

// Surface a useful message out of a supabase-js FunctionsHttpError, which
// otherwise reports a generic "non-2xx status code" with no body.
const extractError = async (error) => {
  let detail = error.message;
  if (error.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.json();
      detail = body.error || body.detail || body.title || detail;
    } catch {
      // non-JSON body — keep the generic message
    }
  }
  return detail;
};

const parseStores = (data) => {
  const list = data?.items ?? data?._embedded?.knowledgeStore ?? [];
  return Array.isArray(list) ? list : [];
};

const useKnowledgeStores = () => {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // Returns the parsed store list (also stored in state) so callers can act on
  // the fresh result without waiting for a re-render.
  const loadStores = useCallback(
    async ({ apiKeyId, projectId, cognigyProjectId }) => {
      if (!apiKeyId || !cognigyProjectId) {
        setStores([]);
        return [];
      }
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "cognigy-proxy",
          {
            body: {
              api_key_id: apiKeyId,
              project_id: projectId,
              path: "/v2.0/knowledgestores",
              query: { projectId: cognigyProjectId, limit: 100, skip: 0 },
              accept: "application/json",
            },
          },
        );
        if (fnError) {
          setError(await extractError(fnError));
          setStores([]);
          return [];
        }
        const list = parseStores(data);
        setStores(list);
        return list;
      } catch (e) {
        setError(e.message);
        setStores([]);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Creates a store, then re-lists (per Cognigy guidance — the create response
  // isn't relied on for the id) and returns the newly created store record.
  const createStore = useCallback(
    async ({ apiKeyId, projectId, cognigyProjectId, name, description }) => {
      setCreating(true);
      setError(null);
      try {
        const { error: fnError } = await supabase.functions.invoke(
          "cognigy-proxy",
          {
            body: {
              api_key_id: apiKeyId,
              project_id: projectId,
              path: "/v2.0/knowledgestores",
              method: "POST",
              accept: "application/json",
              body: {
                name,
                projectId: cognigyProjectId,
                description: description || "",
                embeddingModelId: "",
              },
            },
          },
        );
        if (fnError) {
          const detail = await extractError(fnError);
          setError(detail);
          throw new Error(detail);
        }

        const list = await loadStores({ apiKeyId, projectId, cognigyProjectId });
        // Match on the name we just created; if duplicates, take the newest.
        const matches = list.filter((s) => s.name === name);
        const created =
          matches.length > 0 ? matches[matches.length - 1] : null;
        return created;
      } finally {
        setCreating(false);
      }
    },
    [loadStores],
  );

  return { stores, loading, creating, error, loadStores, createStore };
};

export default useKnowledgeStores;
