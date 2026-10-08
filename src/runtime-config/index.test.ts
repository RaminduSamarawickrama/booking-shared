import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_BASE_URL,
  STORAGE_KEY,
  isLocalHost,
  normaliseApiUrl,
  resolveApiConfig,
  saveOverride,
  type KeyValueStore,
} from "./index";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

describe("normaliseApiUrl", () => {
  it("accepts https tunnel URLs and trims trailing slashes", () => {
    expect(normaliseApiUrl("https://brave-fox.trycloudflare.com/")).toBe("https://brave-fox.trycloudflare.com");
  });
  it("accepts http only for local and private addresses", () => {
    expect(normaliseApiUrl("http://192.168.1.20:8080")).toBe("http://192.168.1.20:8080");
    expect(normaliseApiUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(() => normaliseApiUrl("http://example.com")).toThrow(/Plain http/);
  });
  it("rejects credentials, odd schemes and query strings", () => {
    expect(() => normaliseApiUrl("https://user:pw@example.com")).toThrow(/credentials/);
    expect(() => normaliseApiUrl("javascript:alert(1)")).toThrow(/http and https/);
    expect(() => normaliseApiUrl("https://example.com?x=1")).toThrow(/query/);
    expect(() => normaliseApiUrl("not a url")).toThrow(/valid URL/);
  });
});

describe("isLocalHost", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.0.0.5", true],
    ["172.16.0.1", true],
    ["172.32.0.1", false],
    ["192.168.0.10", true],
    ["8.8.8.8", false],
    ["example.com", false],
  ])("%s -> %s", (host, expected) => expect(isLocalHost(host)).toBe(expected));
});

describe("resolveApiConfig", () => {
  it("falls back to localhost", () => {
    const { config } = resolveApiConfig({ allowOverride: true });
    expect(config).toEqual({
      apiBaseUrl: DEFAULT_API_BASE_URL,
      websocketUrl: "ws://localhost:8080/v1/live",
      source: "default",
    });
  });

  it("uses the build-time URL and derives a secure WebSocket URL", () => {
    const { config } = resolveApiConfig({ allowOverride: true, buildApiBaseUrl: "https://api.demo.example" });
    expect(config.websocketUrl).toBe("wss://api.demo.example/v1/live");
    expect(config.source).toBe("build");
  });

  it("never applies a ?api= link silently; it is pending until confirmed", () => {
    const store = memoryStore();
    const result = resolveApiConfig({
      allowOverride: true,
      store,
      search: "?api=https://brave-fox.trycloudflare.com",
    });
    expect(result.config.source).toBe("default");
    expect(result.pending).toBe("https://brave-fox.trycloudflare.com");
    expect(store.data[STORAGE_KEY]).toBeUndefined();
  });

  it("uses a saved override after the user confirmed it", () => {
    const store = memoryStore();
    saveOverride(store, "https://brave-fox.trycloudflare.com");
    const { config, pending } = resolveApiConfig({
      allowOverride: true,
      store,
      search: "?api=https://brave-fox.trycloudflare.com",
    });
    expect(config.source).toBe("override");
    expect(pending).toBeUndefined();
  });

  it("ignores overrides entirely when the build disallows them", () => {
    const store = memoryStore({ [STORAGE_KEY]: "https://elsewhere.example" });
    const result = resolveApiConfig({
      allowOverride: false,
      store,
      buildApiBaseUrl: "https://api.example",
      search: "?api=https://evil.example",
    });
    expect(result.config.apiBaseUrl).toBe("https://api.example");
    expect(result.pending).toBeUndefined();
  });

  it("drops a corrupted saved value and reports a bad link", () => {
    const store = memoryStore({ [STORAGE_KEY]: "http://example.com" });
    const result = resolveApiConfig({ allowOverride: true, store, search: "?api=ftp://x" });
    expect(result.config.source).toBe("default");
    expect(store.data[STORAGE_KEY]).toBeUndefined();
    expect(result.rejected).toMatch(/http and https/);
  });
});
