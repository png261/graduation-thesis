import {
  useAuth as useClerkAuth,
  useClerk,
  useSignIn,
  useUser,
} from "@clerk/clerk-react";
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

export type AuthProvider = "github";

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

function extractProviders(externalProviders: string[]): AuthProvider[] {
  return externalProviders.some((value) => value.includes("github")) ? ["github"] : [];
}

function formatAuthError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (!err || typeof err !== "object") return "Authentication failed";
  const value = err as { errors?: Array<{ code?: string; longMessage?: string; message?: string }> };
  const first = value.errors?.[0];
  if (first?.code && first?.longMessage) return `${first.code}: ${first.longMessage}`;
  if (first?.code && first?.message) return `${first.code}: ${first.message}`;
  return first?.longMessage || first?.message || "Authentication failed";
}

function isClerkEnvironmentServerError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const value = err as { status?: number; errors?: Array<{ code?: string; longMessage?: string; message?: string }> };
  const status = typeof value.status === "number" ? value.status : null;
  const first = value.errors?.[0];
  const code = String(first?.code || "").toLowerCase();
  const message = String(first?.longMessage || first?.message || "").toLowerCase();
  return status !== null && status >= 500
    ? true
    : code.includes("internal") ||
        message.includes("internal server error") ||
        message.includes("/v1/environment");
}

async function retryAfterClerkCacheClear<T>(action: () => Promise<T>, clearCache: () => void): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (!isClerkEnvironmentServerError(err)) throw err;
    clearCache();
    return action();
  }
}

function oauthRedirectUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return typeof window === "undefined" ? normalized : `${window.location.origin}${normalized}`;
}

function setOAuthError(setError: (value: string) => void, err: unknown): void {
  setError(formatAuthError(err));
}

const GITHUB_SCOPES = ["repo", "read:user", "user:email"] as const;

function githubOAuthUrls() {
  return {
    redirectUrl: oauthRedirectUrl("/sso-callback"),
    redirectUrlComplete: oauthRedirectUrl("/"),
  };
}

function isAuthLoadingState(isLoaded: boolean, isSignedIn: boolean, user: ReturnType<typeof useUser>["user"]): boolean {
  return !isLoaded || (isSignedIn && !user);
}

function openGithubScopesInProfile(clerk: ReturnType<typeof useClerk>): boolean {
  const openProfile = (clerk as { openUserProfile?: (props?: Record<string, unknown>) => void }).openUserProfile;
  if (!openProfile) return false;
  openProfile({ additionalOAuthScopes: { github: [...GITHUB_SCOPES] } });
  return true;
}

function createGithubExternalAccount(
  user: ReturnType<typeof useUser>["user"],
  clerk: ReturnType<typeof useClerk>,
): Promise<unknown> {
  if (!user?.createExternalAccount) {
    throw new Error("Unable to link social account");
  }
  const { redirectUrl } = githubOAuthUrls();
  return retryAfterClerkCacheClear(
    () =>
      user.createExternalAccount({
        strategy: "oauth_github",
        redirectUrl,
        additionalScopes: [...GITHUB_SCOPES],
      }),
    () => clerk.client?.clearCache(),
  );
}

function authenticateWithGithubRedirect(
  signIn: ReturnType<typeof useSignIn>["signIn"],
  clerk: ReturnType<typeof useClerk>,
): Promise<unknown> {
  const authenticate = signIn?.authenticateWithRedirect;
  if (!authenticate) throw new Error("Clerk OAuth redirect is not available");
  const { redirectUrl, redirectUrlComplete } = githubOAuthUrls();
  return retryAfterClerkCacheClear(
    () =>
      authenticate({
        strategy: "oauth_github",
        redirectUrl,
        redirectUrlComplete,
      }),
    () => clerk.client?.clearCache(),
  );
}

function useAuthTokenBinding(getToken: ReturnType<typeof useClerkAuth>["getToken"]) {
  useEffect(() => {
    setAuthTokenGetter(async () => (await getToken()) ?? null);
    return () => setAuthTokenGetter(null);
  }, [getToken]);
}

function useSessionActions(clerk: ReturnType<typeof useClerk>, setError: (value: string) => void) {
  const refreshSession = useCallback(async () => {
    try {
      await clerk.session?.reload();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh session");
    }
  }, [clerk, setError]);

  const logout = useCallback(async () => {
    await clerk.signOut();
    setError("");
  }, [clerk, setError]);

  return { refreshSession, logout };
}

function buildSession(
  isLoaded: boolean,
  isSignedIn: boolean,
  user: ReturnType<typeof useUser>["user"],
  sessionClaims: ReturnType<typeof useClerkAuth>["sessionClaims"],
): AuthSession {
  if (!isLoaded || !isSignedIn || !user) return { authenticated: false };
  const claims = (sessionClaims as Record<string, unknown> | null) ?? null;
  const exp = claims && typeof claims.exp === "number" ? claims.exp : null;
  const providers = extractProviders(
    (user.externalAccounts ?? [])
      .map((account) => String(account.provider || ""))
      .filter(Boolean),
  );
  return {
    authenticated: true,
    user: {
      id: user.id,
      name: user.fullName || user.username || "User",
      email: user.primaryEmailAddress?.emailAddress || "",
      avatarUrl: user.imageUrl || null,
      providers,
    },
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
  };
}

function useGithubLogin(setError: (value: string) => void) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user } = useUser();
  const { signIn } = useSignIn();
  const clerk = useClerk();

  return useCallback(() => {
    setError("");
    if (isAuthLoadingState(isLoaded, Boolean(isSignedIn), user)) {
      setError("Authentication is still loading. Please try again.");
      return;
    }
    if (isSignedIn && user) {
      if (openGithubScopesInProfile(clerk)) {
        return;
      }
      void createGithubExternalAccount(user, clerk).catch((err: unknown) => setOAuthError(setError, err));
      return;
    }
    void authenticateWithGithubRedirect(signIn, clerk).catch((err: unknown) => setOAuthError(setError, err));
  }, [clerk, isLoaded, isSignedIn, setError, signIn, user]);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, getToken, sessionClaims } = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const [error, setError] = useState("");
  const login = useGithubLogin(setError);
  const { refreshSession, logout } = useSessionActions(clerk, setError);
  useAuthTokenBinding(getToken);

  const session = useMemo(() => buildSession(isLoaded, Boolean(isSignedIn), user, sessionClaims), [isLoaded, isSignedIn, sessionClaims, user]);
  const value = useMemo<AuthContextValue>(
    () => ({ session, loading: !isLoaded, error, refreshSession, login, logout }),
    [error, isLoaded, login, logout, refreshSession, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
