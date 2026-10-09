/**
 * Payment API for the customer apps. Guests pay with their booking's manage token; signed-in
 * customers with their account. The amount always comes from the booking on the server.
 */
import type { AuthClient } from "../auth/index.js";

export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";

export interface Payment {
  paymentId: string;
  bookingReference: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  /** "mock" shows our own test-card form; "stripe" shows Stripe's Payment Element. */
  provider: "mock" | "stripe" | string;
  failureCode: string | null;
  failureMessage: string | null;
  /** Stripe only, on start: what Stripe.js needs. */
  clientSecret: string | null;
  publishableKey: string | null;
}

/** Test cards accepted by the mock provider (the same numbers work in Stripe test mode). */
export const TEST_CARDS = [
  { number: "4242 4242 4242 4242", outcome: "Succeeds" },
  { number: "4000 0000 0000 0002", outcome: "Declined" },
  { number: "4000 0000 0000 9995", outcome: "Insufficient funds" },
] as const;

export function createPaymentsApi(client: AuthClient) {
  return {
    start: (bookingReference: string, manageToken?: string) =>
      client.request<Payment>("/v1/payments", {
        method: "POST",
        body: JSON.stringify({ bookingReference }),
        headers: manageToken ? { "X-Booking-Token": manageToken } : {},
      }),
    get: (paymentId: string) => client.request<Payment>(`/v1/payments/${encodeURIComponent(paymentId)}`),
    confirmMock: (paymentId: string, cardNumber: string) =>
      client.request<Payment>(`/v1/payments/${encodeURIComponent(paymentId)}/mock-confirm`, {
        method: "POST",
        body: JSON.stringify({ cardNumber }),
      }),
  };
}

export type PaymentsApi = ReturnType<typeof createPaymentsApi>;

/** "4242424242424242" -> "4242 4242 4242 4242" while typing. */
export function formatCardNumber(typed: string): string {
  return typed.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}
