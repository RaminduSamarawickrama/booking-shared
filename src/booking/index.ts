/**
 * Booking API used by the customer web and mobile apps. Every call works without an
 * account; when the customer is signed in, the auth client adds their token and the booking
 * is saved to their account.
 */
import type { AuthClient } from "../auth/index.js";

export interface VehicleCategory {
  code: string;
  name: string;
  description: string;
  exampleModels: string;
  maxPassengers: number;
  maxLuggage: number;
}

export interface Extra {
  code: string;
  name: string;
  description: string;
  maxQuantity: number;
}

export interface Place {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  airportIata: string | null;
  terminal: string | null;
}

export interface QuoteOption {
  categoryCode: string;
  priceMinor: number;
}

export interface Quote {
  id: string;
  createdAt: string;
  expiresAt: string;
  currency: string;
  pickupAt: string;
  pickup: Place;
  dropoff: Place;
  passengers: number;
  luggage: number;
  distanceMeters: number;
  durationSeconds: number;
  options: QuoteOption[];
  extras: { code: string; priceMinor: number }[];
}

export interface QuoteInput {
  pickupPlaceId: string;
  dropoffPlaceId: string;
  /** ISO 8601 with offset, e.g. 2026-10-12T09:30:00+01:00 */
  pickupAt: string;
  passengers: number;
  luggage: number;
}

export type BookingStatus = "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "EXPIRED";

export interface Booking {
  reference: string;
  status: BookingStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  pickup: Place;
  dropoff: Place;
  pickupAt: string;
  passengers: number;
  luggage: number;
  flightNumber: string | null;
  driverNotes: string | null;
  categoryCode: string;
  currency: string;
  vehiclePriceMinor: number;
  extras: { code: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
  extrasTotalMinor: number;
  totalMinor: number;
  distanceMeters: number;
  durationSeconds: number;
  linkedToAccount: boolean;
  createdAt: string;
}

export interface BookingInput {
  quoteId: string;
  categoryCode: string;
  extras: { code: string; quantity: number }[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  flightNumber?: string;
  driverNotes?: string;
}

export interface CreatedBooking {
  booking: Booking;
  /** Shown once. Keep it: it is the guest's key to view or cancel the booking. */
  manageToken: string;
}

const TOKEN_HEADER = "X-Booking-Token";

export function createBookingApi(client: AuthClient) {
  const tokenHeader = (token?: string): HeadersInit => (token ? { [TOKEN_HEADER]: token } : {});
  return {
    vehicleCategories: () => client.request<VehicleCategory[]>("/v1/catalog/vehicle-categories"),
    extras: () => client.request<Extra[]>("/v1/catalog/extras"),
    searchPlaces: (query: string, signal?: AbortSignal) =>
      client.request<Place[]>(`/v1/places?q=${encodeURIComponent(query)}&limit=8`, { signal }),
    quote: (input: QuoteInput) => client.request<Quote>("/v1/quotes", { method: "POST", body: JSON.stringify(input) }),
    /** Pass the same idempotencyKey when retrying so a lost response can't create a second booking. */
    create: (input: BookingInput, idempotencyKey: string) =>
      client.request<CreatedBooking>("/v1/bookings", {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    get: (reference: string, manageToken?: string) =>
      client.request<Booking>(`/v1/bookings/${encodeURIComponent(reference)}`, { headers: tokenHeader(manageToken) }),
    cancel: (reference: string, manageToken?: string) =>
      client.request<Booking>(`/v1/bookings/${encodeURIComponent(reference)}/cancel`, {
        method: "POST",
        headers: tokenHeader(manageToken),
      }),
    claim: (reference: string, manageToken: string) =>
      client.request<Booking>(`/v1/bookings/${encodeURIComponent(reference)}/claim`, {
        method: "POST",
        headers: tokenHeader(manageToken),
      }),
    mine: () => client.request<Booking[]>("/v1/bookings/mine"),
  };
}

export type BookingApi = ReturnType<typeof createBookingApi>;

/** 12345 + "GBP" -> "£123.45" in the visitor's locale. */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 })
    .format(minor / 100);
}

/** A random key for one booking attempt (Idempotency-Key). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
