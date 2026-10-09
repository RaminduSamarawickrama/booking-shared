import { describe, expect, it, vi } from "vitest";
import { createAuthClient } from "../auth/index.js";
import { createBookingApi, formatMoney, newIdempotencyKey } from "./index.js";

describe("booking api", () => {
  it("works for guests and sends the manage token and idempotency key", async () => {
    const calls: { url: string; headers: Headers; method?: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), method: init?.method });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const api = createBookingApi(createAuthClient({ baseUrl: "http://api", fetchImpl }));

    await api.searchPlaces("king's cross");
    await api.create({ quoteId: "q", categoryCode: "STANDARD", extras: [], customerName: "a", customerEmail: "b", customerPhone: "c" }, "key-123");
    await api.get("TR7K4P9Q", "secret");

    expect(calls[0].url).toBe("http://api/v1/places?q=king's%20cross&limit=8");
    expect(calls[0].headers.has("Authorization")).toBe(false);
    expect(calls[1].headers.get("Idempotency-Key")).toBe("key-123");
    expect(calls[1].method).toBe("POST");
    expect(calls[2].headers.get("X-Booking-Token")).toBe("secret");
  });

  it("formats prices and makes unique keys", () => {
    expect(formatMoney(6500, "GBP", "en-GB")).toBe("£65");
    expect(formatMoney(6550, "GBP", "en-GB")).toBe("£65.50");
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{36}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});
