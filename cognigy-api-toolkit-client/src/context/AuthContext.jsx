import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // Safety net: if getSession() ever fails to resolve (corrupted local
    // storage, network hang, etc.), don't trap the app on the loading screen
    // forever. After 8s we treat it as "no session" and surface the login.
    const failsafe = setTimeout(() => {
      if (!active) return;
      console.warn("[AuthContext] getSession() timed out — clearing loader");
      setLoading(false);
    }, 8000);

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.warn("[AuthContext] getSession returned error", error);
        }
        setSession(data?.session ?? null);
      })
      .catch((err) => {
        // Corrupted token in localStorage can throw here. Drop the bad state
        // so the next render shows the login screen.
        console.error("[AuthContext] getSession threw", err);
        try {
          for (const k of Object.keys(localStorage)) {
            if (k.startsWith("sb-")) localStorage.removeItem(k);
          }
        } catch {
          // localStorage unavailable — nothing to clear
        }
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) {
          clearTimeout(failsafe);
          setLoading(false);
        }
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      active = false;
      clearTimeout(failsafe);
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      async login({ email, password }) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        return data;
      },

      async register({ email, password, displayName }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        });
        if (error) throw error;
        return data;
      },

      async logout() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
