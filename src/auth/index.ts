/**
 * Client for auth-service, shared by the web and mobile apps.
 *
 * Keeps the session (short-lived access token + rotating refresh token) in the store you
 * pass in, refreshes it shortly before the access token expires, and retries a request
 * once after a refresh if the API answers 401. Concurrent callers share one refresh.
 *
 * Web apps store the session in localStorage for this demo. A production web build should
 * move the refresh token into an httpOnly cookie so page scripts cannot read it.
 */
import type { KeyValueStore } from "../runtime-config/index.js";

export type Role = "CUSTOMER" | "DRIVER" | "DISPATCHER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  roles: Role[];
}

export interface Session {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: User;
}

export interface FieldError {
  field: string;
  message: string;
}

/** An RFC 9457 problem response from the API, with its stable `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export interface AuthClientOptions {
  /**
   * Gateway base URL, or a function returning it so a backend switched at runtime (the
   * connection panel) takes effect on the next request.
   */
  baseUrl: string | (() => string);
  store?: KeyValueStore | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Refresh this long before the access token expires. */
  refreshLeewayMs?: number;
}

export const SESSION_KEY = "booking.session";

type Listener = (session: Session | null) => void;

export function createAuthClient(options: AuthClientOptions) {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? Date.now;
  const leeway = options.refreshLeewayMs ?? 30_000;
  const store = options.store ?? null;
  const listeners = new Set<Listener>();
  let session: Session | null = load();
  let refreshing: Promise<Session | null> | null = null;

  function load(): Session | null {
    try {
      const raw = store?.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      return Date.parse(parsed.refreshTokenExpiresAt) > now() ? parsed : null;
    } catch {
      return null;
    }
  }

  function set(next: Session | null) {
    session = next;
    try {
      if (next) store?.setItem(SESSION_KEY, JSON.stringify(next));
      else store?.removeItem(SESSION_KEY);
    } catch {
      // storage unavailable (private mode): the session lives in memory only
    }
    listeners.forEach((listener) => listener(next));
  }

  async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response: Response;
    try {
      const base = typeof options.baseUrl === "function" ? options.baseUrl() : options.baseUrl;
      response = await fetchImpl(`${base}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, "network_error", "Can't reach the server. Check your connection or the backend panel.");
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const body = text ? safeJson(text) : undefined;
    if (!response.ok) {
      const problem = (body ?? {}) as { code?: string; detail?: string; title?: string; requestId?: string; errors?: FieldError[] };
      throw new ApiError(
        response.status,
        problem.code ?? `http_${response.status}`,
        problem.detail ?? problem.title ?? `Request failed (${response.status})`,
        problem.requestId ?? response.headers.get("X-Request-Id") ?? undefined,
        problem.errors ?? [],
      );
    }
    return body as T;
  }

  async function refresh(): Promise<Session | null> {
    const current = session;
    if (!current) return null;
    refreshing ??= call<Session>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    })
      .then((next) => {
        set(next);
        return next;
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) set(null);
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function validAccessToken(): Promise<string | null> {
    if (!session) return null;
    if (Date.parse(session.accessTokenExpiresAt) - leeway > now()) return session.accessToken;
    return (await refresh())?.accessToken ?? null;
  }

  return {
    current: () => session,

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async register(input: RegisterInput): Promise<Session> {
      const next = await call<Session>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) });
      set(next);
      return next;
    },

    async login(email: string, password: string): Promise<Session> {
      const next = await call<Session>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      set(next);
      return next;
    },

    async logout(): Promise<void> {
      const current = session;
      set(null);
      if (current) {
        await call<void>("/v1/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        }).catch(() => undefined);
      }
    },

    /** Calls an API path with the user's token, refreshing once on 401. */
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const token = await validAccessToken();
      try {
        return await call<T>(path, init, token ?? undefined);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && session) {
          const next = await refresh();
          if (next) return call<T>(path, init, next.accessToken);
        }
        throw error;
      }
    },
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;

export function hasRole(session: Session | null, ...roles: Role[]): boolean {
  return !!session && session.user.roles.some((role) => roles.includes(role));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
