import { describe, it, expect } from "vitest";
import { passwordStrength } from "./password-strength";
import { winbackState, WINBACK_WINDOW_MS } from "./winback";
import { recommendTier, riskProfileFor } from "./paywall";

const H = 3_600_000;
const NOW = Date.parse("2026-10-04T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("passwordStrength", () => {
  it("rejects short passwords", () => {
    const s = passwordStrength("Ab1!");
    expect(s.score).toBe(0);
    expect(s.acceptable).toBe(false);
    expect(s.hint).toMatch(/6 characters/);
  });
  it("caps passwords missing a class at Fair", () => {
    const s = passwordStrength("abcdefghijklmnop1");
    expect(s.acceptable).toBe(false);
    expect(s.score).toBeLessThanOrEqual(2);
    expect(s.hint).toMatch(/uppercase/);
  });
  it("accepts all four classes", () => {
    expect(passwordStrength("Abc12!").acceptable).toBe(true);
  });
  it("rates long varied passwords Strong", () => {
    const s = passwordStrength("Tr4ding!Signals#2026");
    expect(s.label).toBe("Strong");
    expect(s.hint).toBeNull();
  });
  it("penalizes repeats", () => {
    expect(passwordStrength("Aaaaaaaaa1!x").score).toBeLessThan(passwordStrength("Abcdefgh1!xy").score);
  });
});

describe("winbackState", () => {
  const base = { tier: "free", paywallDismissedAt: iso(NOW - 25 * H), winbackShownAt: null, dismissedLocally: false, now: NOW };
  it("shows first time after 24h", () => {
    const s = winbackState(base);
    expect(s).toEqual({ show: true, expiresAt: NOW + WINBACK_WINDOW_MS, firstShow: true });
  });
  it("waits for 24h", () => {
    expect(winbackState({ ...base, paywallDismissedAt: iso(NOW - 23 * H) }).show).toBe(false);
  });
  it("never shows to paid users or non-decliners", () => {
    expect(winbackState({ ...base, tier: "pro" }).show).toBe(false);
    expect(winbackState({ ...base, paywallDismissedAt: null }).show).toBe(false);
  });
  it("stays visible inside the window, then never again", () => {
    expect(winbackState({ ...base, winbackShownAt: iso(NOW - 2 * H) })).toMatchObject({ show: true, firstShow: false });
    expect(winbackState({ ...base, winbackShownAt: iso(NOW - 25 * H) }).show).toBe(false);
  });
  it("respects dismissal", () => {
    expect(winbackState({ ...base, dismissedLocally: true }).show).toBe(false);
  });
});

describe("paywall recommendations", () => {
  it("routes automation goals to Elite", () => {
    expect(recommendTier("automate", "starting")).toBe("elite");
    expect(recommendTier("ideas", "professional")).toBe("elite");
    expect(recommendTier("ideas", "starting")).toBe("pro");
    expect(recommendTier(null, null)).toBe("pro");
  });
  it("maps experience to risk profile", () => {
    expect(riskProfileFor("starting")).toBe("conservative");
    expect(riskProfileFor(null)).toBe("balanced");
  });
});
