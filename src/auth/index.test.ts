import { describe, expect, it, vi } from "vitest";
import type { KeyValueStore } from "../runtime-config/index.js";
import { ApiError, SESSION_KEY, createAuthClient, hasRole, type Session } from "./index.js";

const T0 = Date.parse("2026-10-09T10:00:00Z");

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function session(n: number, accessMinutes = 15): Session {
  return {
    accessToken: `access-${n}`,
    accessTokenExpiresAt: new Date(T0 + accessMinutes * 60_000).toISOString(),
    refreshToken: `refresh-${n}`,
    refreshTokenExpiresAt: new Date(T0 + 30 * 86_400_000).toISOString(),
    user: { id: "u1", email: "ada@example.test", fullName: "Ada", phone: null, roles: ["CUSTOMER"] },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("auth client", () => {
  it("signs in, stores the session and sends the token", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/v1/auth/login")) return json(200, session(1));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-1");
      return json(200, { ok: true });
    });
    const client = createAuthClient({ baseUrl: "http://api", store, fetchImpl, now: () => T0 });

    await client.login("ada@example.test", "a long passphrase");
    expect(JSON.parse(store.data.get(SESSION_KEY)!).refreshToken).toBe("refresh-1");
    await expect(client.request("/v1/things")).resolves.toEqual({ ok: true });
  });

  it("refreshes once for concurrent requests when the token is about to expire", async () => {
    const store = memoryStore();
    store.setItem(SESSION_KEY, JSON.stringify(session(1, 0.25)));
    let refreshes = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/v1/auth/refresh")) {
        refreshes++;
        expect(JSON.parse(String(init?.body)).refreshToken).toBe("refresh-1");
        return json(200, session(2));
      }
      return json(200, { token: new Headers(init?.headers).get("Authorization") });
    });
    const client = createAuthClient({ baseUrl: "http://api", store, fetchImpl, now: () => T0 });

    const results = await Promise.all([client.request("/a"), client.request("/b")]);
    expect(refreshes).toBe(1);
    expect(results).toEqual([{ token: "Bearer access-2" }, { token: "Bearer access-2" }]);
  });

  it("signs out locally when the refresh token is rejected", async () => {
    const store = memoryStore();
    store.setItem(SESSION_KEY, JSON.stringify(session(1, 0)));
    const fetchImpl = vi.fn(async () =>
      json(401, { code: "refresh_token_reused", detail: "Sign in again.", requestId: "req-1" }),
    );
    const client = createAuthClient({ baseUrl: "http://api", store, fetchImpl, now: () => T0 });
    const seen: unknown[] = [];
    client.subscribe((s) => seen.push(s));

    await expect(client.request("/a")).rejects.toMatchObject({ code: "refresh_token_reused", status: 401 });
    expect(client.current()).toBeNull();
    expect(store.data.has(SESSION_KEY)).toBe(false);
    expect(seen).toEqual([null]);
  });

  it("turns problem responses into ApiError with field errors", async () => {
    const fetchImpl = vi.fn(async () =>
      json(400, { code: "validation_failed", detail: "Some fields are invalid.", errors: [{ field: "email", message: "must be a well-formed email address" }] }),
    );
    const client = createAuthClient({ baseUrl: "http://api", fetchImpl, now: () => T0 });

    const error = await client.register({ email: "x", password: "y", fullName: "z" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors[0].field).toBe("email");
  });

  it("reads the base URL on every call so a switched backend applies at once", async () => {
    let base = "http://one";
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return json(200, session(1));
    });
    const client = createAuthClient({ baseUrl: () => base, fetchImpl, now: () => T0 });
    await client.login("a", "b");
    base = "https://two.trycloudflare.com";
    await client.login("a", "b");
    expect(urls).toEqual(["http://one/v1/auth/login", "https://two.trycloudflare.com/v1/auth/login"]);
  });

  it("reports network failures with a helpful code", async () => {
    const client = createAuthClient({
      baseUrl: "http://api",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(client.login("a", "b")).rejects.toMatchObject({ code: "network_error", status: 0 });
  });

  it("ignores an expired stored session and checks roles", () => {
    const store = memoryStore();
    const old = { ...session(1), refreshTokenExpiresAt: new Date(T0 - 1).toISOString() };
    store.setItem(SESSION_KEY, JSON.stringify(old));
    expect(createAuthClient({ baseUrl: "http://api", store, now: () => T0 }).current()).toBeNull();
    expect(hasRole(session(1), "ADMIN")).toBe(false);
    expect(hasRole(session(1), "ADMIN", "CUSTOMER")).toBe(true);
  });
});
