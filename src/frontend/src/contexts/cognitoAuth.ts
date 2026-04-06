import type { AuthSession } from "./AuthContext";

interface CognitoConfig {
  clientId: string;
  domain: string;
  redirectUri: string;
  logoutUri: string;
  scopes: string[];
}

export interface StoredCognitoAuth {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  claims: Record<string, unknown>;
}

export interface CognitoCallbackResult {
  auth: StoredCognitoAuth;
  returnTo: string;
}

interface StoredFlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const STORAGE_PREFIX = "deepagents.cognito";
const AUTH_STORAGE_KEY = `${STORAGE_PREFIX}.auth`;
const FLOW_STORAGE_KEY = `${STORAGE_PREFIX}.flow`;
const DEFAULT_CALLBACK_PATH = "/auth/callback";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

function trimEnv(value: string | undefined): string {
  return value?.trim() || "";
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function authStorage() {
  return window.localStorage;
}

function flowStorage() {
  return window.sessionStorage;
}

function setAuthStorage(value: StoredCognitoAuth): void {
  authStorage().setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
}

function flowState(): StoredFlowState | null {
  return parseJson<StoredFlowState>(flowStorage().getItem(FLOW_STORAGE_KEY));
}

function saveFlowState(value: StoredFlowState): void {
  flowStorage().setItem(FLOW_STORAGE_KEY, JSON.stringify(value));
}

function clearFlowState(): void {
  flowStorage().removeItem(FLOW_STORAGE_KEY);
}

function callbackUri(): string {
  const configured = trimEnv(import.meta.env.VITE_COGNITO_REDIRECT_URI);
  return configured || `${window.location.origin}${DEFAULT_CALLBACK_PATH}`;
}

function callbackPath(): string {
  return new URL(callbackUri(), window.location.origin).pathname;
}

function configuredScopes(): string[] {
  const raw = trimEnv(import.meta.env.VITE_COGNITO_SCOPES) || trimEnv(import.meta.env.VITE_COGNITO_SCOPE);
  const items = raw
    ? raw.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean)
    : DEFAULT_SCOPES;
  return items.includes("openid") ? items : ["openid", ...items];
}

function cognitoConfig(): CognitoConfig {
  return {
    clientId: trimEnv(import.meta.env.VITE_COGNITO_CLIENT_ID),
    domain: trimEnv(import.meta.env.VITE_COGNITO_DOMAIN).replace(/\/+$/, ""),
    redirectUri: callbackUri(),
    logoutUri: window.location.origin,
    scopes: configuredScopes(),
  };
}

export function missingCognitoEnv(): string[] {
  return [
    !trimEnv(import.meta.env.VITE_COGNITO_DOMAIN) ? "VITE_COGNITO_DOMAIN" : null,
    !trimEnv(import.meta.env.VITE_COGNITO_CLIENT_ID) ? "VITE_COGNITO_CLIENT_ID" : null,
  ].filter((value): value is string => Boolean(value));
}

export function storedCognitoAuth(): StoredCognitoAuth | null {
  return parseJson<StoredCognitoAuth>(authStorage().getItem(AUTH_STORAGE_KEY));
}

export function clearStoredCognitoAuth(): void {
  authStorage().removeItem(AUTH_STORAGE_KEY);
}

export function isCognitoCallback(): boolean {
  return window.location.pathname === callbackPath();
}

function callbackParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function callbackError(): string {
  const params = callbackParams();
  const error = params.get("error");
  if (!error) return "";
  const detail = params.get("error_description") || "";
  return detail ? `${error}: ${detail}` : error;
}

function base64UrlEncode(value: Uint8Array): string {
  const text = btoa(String.fromCharCode(...value));
  return text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return atob(padded);
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  const [, payload = ""] = token.split(".");
  return JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
}

function expiryIso(expiresIn: number | undefined): string | null {
  return typeof expiresIn === "number" && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
}

function authFromTokenResponse(response: TokenResponse, refreshToken: string | null = null): StoredCognitoAuth {
  const accessToken = String(response.access_token || "").trim();
  const idToken = String(response.id_token || "").trim();
  if (!accessToken || !idToken) {
    throw new Error("Cognito token response did not include access and id tokens.");
  }
  return {
    accessToken,
    idToken,
    refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : refreshToken,
    expiresAt: expiryIso(response.expires_in),
    claims: decodeJwtClaims(idToken),
  };
}

function authExpired(auth: StoredCognitoAuth): boolean {
  if (!auth.expiresAt) return false;
  return new Date(auth.expiresAt).getTime() <= Date.now() + 30_000;
}

async function sha256Base64Url(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes);
  window.crypto.getRandomValues(value);
  return base64UrlEncode(value);
}

function tokenEndpoint(config: CognitoConfig): string {
  return `${config.domain}/oauth2/token`;
}

function authorizeEndpoint(config: CognitoConfig): string {
  return `${config.domain}/oauth2/authorize`;
}

async function tokenRequest(endpoint: string, body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(detail || "Cognito token request failed");
  }
  return response.json() as Promise<TokenResponse>;
}

export async function startCognitoLogin(returnTo: string): Promise<void> {
  const config = cognitoConfig();
  const state = randomBase64Url(24);
  const nonce = randomBase64Url(24);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  saveFlowState({ state, nonce, codeVerifier, returnTo });
  window.location.assign(`${authorizeEndpoint(config)}?${params.toString()}`);
}

export async function completeCognitoLogin(): Promise<CognitoCallbackResult> {
  const config = cognitoConfig();
  const flow = flowState();
  const params = callbackParams();
  const state = params.get("state") || "";
  const code = params.get("code") || "";
  if (!flow || state !== flow.state || !code) {
    clearFlowState();
    throw new Error("Invalid Cognito callback state");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: flow.codeVerifier,
  });
  const auth = authFromTokenResponse(await tokenRequest(tokenEndpoint(config), body));
  if (String(auth.claims.nonce || "") !== flow.nonce) {
    clearFlowState();
    throw new Error("Invalid Cognito nonce");
  }
  setAuthStorage(auth);
  clearFlowState();
  return { auth, returnTo: flow.returnTo || "/" };
}

export async function refreshCognitoAuth(auth: StoredCognitoAuth): Promise<StoredCognitoAuth | null> {
  const refreshToken = String(auth.refreshToken || "").trim();
  if (!refreshToken) return null;
  const config = cognitoConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
  const next = authFromTokenResponse(await tokenRequest(tokenEndpoint(config), body), refreshToken);
  setAuthStorage(next);
  return next;
}

export async function ensureFreshCognitoAuth(): Promise<StoredCognitoAuth | null> {
  const auth = storedCognitoAuth();
  if (!auth) return null;
  if (!authExpired(auth)) return auth;
  const refreshed = await refreshCognitoAuth(auth);
  if (refreshed) return refreshed;
  clearStoredCognitoAuth();
  return null;
}

export async function cognitoLogoutUrl(): Promise<string> {
  const config = cognitoConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: config.logoutUri,
  });
  return `${config.domain}/logout?${params.toString()}`;
}

function claimString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];
  return typeof value === "string" ? value : "";
}

export function authSessionFromStored(auth: StoredCognitoAuth | null): AuthSession {
  if (!auth) return { authenticated: false };
  const userId = claimString(auth.claims, "sub");
  const email = claimString(auth.claims, "email");
  const name = claimString(auth.claims, "name") || claimString(auth.claims, "cognito:username") || email || "User";
  const avatarUrl = claimString(auth.claims, "picture") || null;
  return {
    authenticated: Boolean(userId),
    user: {
      id: userId,
      name,
      email,
      avatarUrl,
      providers: ["cognito"],
    },
    expiresAt: auth.expiresAt,
  };
}

export function resetCallbackUrl(target: string): void {
  window.history.replaceState({}, document.title, target || "/");
}
