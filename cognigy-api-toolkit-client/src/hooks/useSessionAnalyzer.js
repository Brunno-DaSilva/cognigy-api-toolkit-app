import { useCallback, useState } from "react";
import { supabase } from "../lib/supabase";

// Talks to the `session-analyzer` edge function. Holds the chat history and
// exposes send() — each call appends the user's turn, invokes the agent (which
// pulls Cognigy logs server-side and reasons about them), and appends Claude's
// reply. The full history is sent each time so follow-up questions have context.
const useSessionAnalyzer = () => {
  const [messages, setMessages] = useState([]); // { role: "user" | "assistant", content }
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const send = useCallback(
    async ({
      apiKeyId,
      projectId,
      cognigyProjectId,
      sessionId,
      userId,
      question,
    }) => {
      if (!question?.trim()) return;
      setError(null);
      setRunning(true);

      const outgoing = [...messages, { role: "user", content: question }];
      setMessages(outgoing); // optimistic — show the user's turn immediately

      try {
        const { data, error: invokeError } = await supabase.functions.invoke(
          "session-analyzer",
          {
            body: {
              api_key_id: apiKeyId,
              project_id: projectId,
              cognigy_project_id: cognigyProjectId,
              sessionId,
              userId,
              messages: outgoing,
            },
          }
        );

        if (invokeError) {
          // The function wraps real failures as JSON in the response body;
          // dig it out so the user sees the actual cause, not "non-2xx".
          let detail = invokeError.message;
          if (invokeError.context?.text) {
            try {
              const raw = await invokeError.context.text();
              try {
                const body = JSON.parse(raw);
                detail = body.error || body.detail || detail;
              } catch {
                detail = raw.slice(0, 500) || detail;
              }
            } catch {
              // body unreadable — keep the generic message
            }
          }
          throw new Error(detail);
        }

        if (data?.error) throw new Error(data.error);

        const reply = (data?.content ?? "").trim() || "(no response)";
        setMessages([...outgoing, { role: "assistant", content: reply }]);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setRunning(false);
      }
    },
    [messages]
  );

  return { messages, running, error, send, reset };
};

export default useSessionAnalyzer;
