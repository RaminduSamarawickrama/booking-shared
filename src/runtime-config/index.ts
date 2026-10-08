/**
 * Decides which backend an app talks to, without rebuilding the app.
 *
 * Shared by customer web, admin web and (later) both React Native apps, so the
 * same build can point at localhost, a LAN IP, a Cloudflare quick tunnel or a
 * remote demo API. Resolution order:
 *
 *   1. a saved override (set from the in-app "Backend" panel, or a ?api= link the user confirmed)
 *   2. the build-time value (VITE_API_BASE_URL / EXPO_PUBLIC_API_BASE_URL)
 *   3. http://localhost:8080
 *
 * A ?api= link is never applied silently: it comes back as `pending` and the UI
 * must ask the user first. Otherwise anyone could send an admin a link that routes
 * their login to a server the attacker controls.
 */

export type ApiSource = "override" | "build" | "default";

export interface ApiConfig {
  apiBaseUrl: string;
  websocketUrl: string;
  source: ApiSource;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ResolveOptions {
  /** location.search of the page, e.g. "?api=https://abc.trycloudflare.com" */
  search?: string;
  store?: KeyValueStore | null;
  buildApiBaseUrl?: string;
  buildWebsocketUrl?: string;
  /** false in production builds: overrides are ignored and cannot be saved */
  allowOverride: boolean;
}

export interface Resolution {
  config: ApiConfig;
  /** a ?api= value waiting for the user's confirmation */
  pending?: string;
  /** why a ?api= value was rejected, for display */
  rejected?: string;
}

export const STORAGE_KEY = "booking.apiBaseUrl";
export const DEFAULT_API_BASE_URL = "http://localhost:8080";
export const WEBSOCKET_PATH = "/v1/live";

/** Normalises and validates a backend URL; throws with a readable reason. */
export function normaliseApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    throw new Error("Plain http is only allowed for localhost and private network addresses");
  }
  if (url.search || url.hash) {
    throw new Error("The URL must not contain a query or fragment");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** localhost, loopback and RFC 1918 addresses used when testing phones on Wi-Fi. */
export function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function websocketUrlFor(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/^http/, "ws") + WEBSOCKET_PATH;
}

export function resolveApiConfig(options: ResolveOptions): Resolution {
  const { store, allowOverride } = options;
  const result: Resolution = { config: fromBuildOrDefault(options) };

  if (!allowOverride) return result;

  const saved = safeGet(store);
  if (saved) {
    try {
      const apiBaseUrl = normaliseApiUrl(saved);
      result.config = { apiBaseUrl, websocketUrl: websocketUrlFor(apiBaseUrl), source: "override" };
    } catch {
      store?.removeItem(STORAGE_KEY);
    }
  }

  const requested = new URLSearchParams(options.search ?? "").get("api");
  if (requested) {
    try {
      const normalised = normaliseApiUrl(requested);
      if (normalised !== result.config.apiBaseUrl) result.pending = normalised;
    } catch (error) {
      result.rejected = `${requested}: ${(error as Error).message}`;
    }
  }
  return result;
}

export function saveOverride(store: KeyValueStore, rawUrl: string): ApiConfig {
  const apiBaseUrl = normaliseApiUrl(rawUrl);
  store.setItem(STORAGE_KEY, apiBaseUrl);
  return { apiBaseUrl, websocketUrl: websocketUrlFor(apiBaseUrl), source: "override" };
}

export function clearOverride(store: KeyValueStore): void {
  store.removeItem(STORAGE_KEY);
}

function fromBuildOrDefault(options: ResolveOptions): ApiConfig {
  if (options.buildApiBaseUrl) {
    const apiBaseUrl = normaliseApiUrl(options.buildApiBaseUrl);
    return {
      apiBaseUrl,
      websocketUrl: options.buildWebsocketUrl || websocketUrlFor(apiBaseUrl),
      source: "build",
    };
  }
  return {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    websocketUrl: websocketUrlFor(DEFAULT_API_BASE_URL),
    source: "default",
  };
}

function safeGet(store: KeyValueStore | null | undefined): string | null {
  try {
    return store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null; // private browsing or storage disabled
  }
}

export type HealthStatus =
  | { state: "up"; latencyMs: number }
  | { state: "down"; reason: string };

/** Calls the gateway's public health endpoint with a timeout. */
export async function checkHealth(apiBaseUrl: string, timeoutMs = 5000): Promise<HealthStatus> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl}/health`, { signal: controller.signal });
    if (!response.ok) return { state: "down", reason: `HTTP ${response.status}` };
    return { state: "up", latencyMs: Date.now() - started };
  } catch (error) {
    const aborted = (error as Error).name === "AbortError";
    return { state: "down", reason: aborted ? "timed out" : "unreachable (is the backend or tunnel running?)" };
  } finally {
    clearTimeout(timer);
  }
}
