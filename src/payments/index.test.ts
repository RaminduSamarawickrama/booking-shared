import { describe, expect, it, vi } from "vitest";
import { createAuthClient } from "../auth/index.js";
import { createPaymentsApi, formatCardNumber } from "./index.js";

describe("payments api", () => {
  it("starts a guest payment with the manage token", async () => {
    const seen: { url: string; headers: Headers; body?: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body as string });
      return new Response(JSON.stringify({ paymentId: "p1", status: "PENDING" }), { status: 201 });
    });
    const api = createPaymentsApi(createAuthClient({ baseUrl: "http://api", fetchImpl }));
    await api.start("TR7K4P9Q", "tok");
    await api.confirmMock("p1", "4242424242424242");
    expect(seen[0].headers.get("X-Booking-Token")).toBe("tok");
    expect(JSON.parse(seen[0].body!)).toEqual({ bookingReference: "TR7K4P9Q" });
    expect(seen[1].url).toBe("http://api/v1/payments/p1/mock-confirm");
  });

  it("groups card numbers in fours", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("4242-42")).toBe("4242 42");
  });
});
