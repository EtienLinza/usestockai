import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStripe } from "@stripe/stripe-js";

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({ id: "stripe" })) }));

// The module reads the publishable token once at import time.
async function importStripeWith(token?: string) {
  vi.resetModules();
  if (token === undefined) vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "");
  else vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", token);
  return await import("./stripe");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getStripeEnvironment", () => {
  it("detects sandbox and live tokens by prefix", async () => {
    expect((await importStripeWith("pk_test_123")).getStripeEnvironment()).toBe("sandbox");
    expect((await importStripeWith("pk_live_123")).getStripeEnvironment()).toBe("live");
  });

  it("throws when payments are not configured", async () => {
    const mod = await importStripeWith("garbage");
    expect(() => mod.getStripeEnvironment()).toThrow(/Payments are not configured/);

    const unset = await importStripeWith(undefined);
    expect(() => unset.getStripeEnvironment()).toThrow(/Payments are not configured/);
  });
});

describe("isPaymentsConfigured", () => {
  it("is true only for a recognized publishable key", async () => {
    expect((await importStripeWith("pk_test_123")).isPaymentsConfigured()).toBe(true);
    expect((await importStripeWith("pk_live_123")).isPaymentsConfigured()).toBe(true);
    expect((await importStripeWith("sk_live_123")).isPaymentsConfigured()).toBe(false);
    expect((await importStripeWith(undefined)).isPaymentsConfigured()).toBe(false);
  });
});

describe("getStripe", () => {
  it("loads Stripe once and memoizes the promise", async () => {
    const { getStripe } = await importStripeWith("pk_test_123");

    const first = getStripe();
    const second = getStripe();

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ id: "stripe" });
    expect(loadStripe).toHaveBeenCalledExactlyOnceWith("pk_test_123");
  });

  it("throws instead of loading Stripe when payments are unconfigured", async () => {
    const { getStripe } = await importStripeWith(undefined);

    expect(() => getStripe()).toThrow(/Payments are not configured/);
    expect(loadStripe).not.toHaveBeenCalled();
  });
});
