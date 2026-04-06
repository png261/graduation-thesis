import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { setAuthTokenGetter } from "../api/client";
import {
  authSessionFromStored,
  callbackError,
  clearStoredCognitoAuth,
  cognitoLogoutUrl,
  completeCognitoLogin,
  ensureFreshCognitoAuth,
  isCognitoCallback,
  resetCallbackUrl,
  startCognitoLogin,
  storedCognitoAuth,
} from "./cognitoAuth";

export type AuthProvider = "cognito";

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
  login: () => void;
  logout: () => Promise<void>;
  openUserSettings: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function formatAuthError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Authentication failed";
}

function currentReturnTo(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const syncSession = useCallback((auth = storedCognitoAuth()) => {
    setSession(authSessionFromStored(auth));
  }, []);

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        const auth = await ensureFreshCognitoAuth();
        syncSession(auth);
        return auth?.idToken || null;
      } catch {
        syncSession(null);
        return null;
      }
    });
    return () => setAuthTokenGetter(null);
  }, [syncSession]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      try {
        const oidcError = callbackError();
        if (oidcError) {
          clearStoredCognitoAuth();
          if (!cancelled) {
            setError(oidcError);
            syncSession(null);
            resetCallbackUrl("/");
          }
          return;
        }
        if (isCognitoCallback()) {
          const result = await completeCognitoLogin();
          if (!cancelled) {
            setError("");
            syncSession(result.auth);
            resetCallbackUrl(result.returnTo);
          }
          return;
        }
        const auth = await ensureFreshCognitoAuth();
        if (!cancelled) {
          setError("");
          syncSession(auth);
        }
      } catch (err) {
        clearStoredCognitoAuth();
        if (!cancelled) {
          setError(formatAuthError(err));
          syncSession(null);
          resetCallbackUrl("/");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [syncSession]);

  const login = useCallback(() => {
    setError("");
    void startCognitoLogin(currentReturnTo()).catch((err: unknown) => setError(formatAuthError(err)));
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const auth = await ensureFreshCognitoAuth();
      syncSession(auth);
      setError("");
    } catch (err) {
      setError(formatAuthError(err));
    }
  }, [syncSession]);

  const logout = useCallback(async () => {
    setError("");
    clearStoredCognitoAuth();
    syncSession(null);
    const url = await cognitoLogoutUrl().catch(() => "");
    window.location.assign(url || window.location.origin);
  }, [syncSession]);

  const openUserSettings = useCallback(() => {
    setError("User settings are not available in this Cognito setup.");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, error, refreshSession, login, logout, openUserSettings }),
    [error, loading, login, logout, openUserSettings, refreshSession, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
