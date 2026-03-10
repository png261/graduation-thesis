import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { API_URL } from "../api/client";

export type AuthProvider = "google" | "github";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  providers: AuthProvider[];
}

export interface AuthSession {
  authenticated: boolean;
  user?: AuthUser;
  expiresAt?: string | null;
}

interface AuthContextValue {
  session: AuthSession;
  loading: boolean;
  error: string;
  refreshSession: () => Promise<void>;
  login: (provider: AuthProvider) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(): Promise<AuthSession> {
  const response = await fetch(`${API_URL}/api/auth/session`, {
    credentials: "include",
  });
  if (!response.ok) {
    return { authenticated: false };
  }
  const data = (await response.json()) as AuthSession;
  if (!data.authenticated) return { authenticated: false };
  return data;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshSession = useCallback(async () => {
    try {
      const nextSession = await fetchSession();
      setSession(nextSession);
      setError("");
    } catch (err) {
      setSession({ authenticated: false });
      setError(err instanceof Error ? err.message : "Failed to load session");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextSession = await fetchSession();
        if (cancelled) return;
        setSession(nextSession);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((provider: AuthProvider) => {
    window.location.href = `${API_URL}/api/auth/${provider}/login`;
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    await refreshSession();
  }, [refreshSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      error,
      refreshSession,
      login,
      logout,
    }),
    [session, loading, error, refreshSession, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
