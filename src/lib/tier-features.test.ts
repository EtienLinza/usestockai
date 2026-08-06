import { describe, expect, it } from "vitest";
import {
  FEATURE_LABELS,
  FEATURE_REQUIRES,
  TIER_FEATURE_LIST,
  TIER_LIMITS,
  TIER_RANK,
  canUseFeature,
  tierMeets,
  type FeatureKey,
  type Tier,
} from "./tier-features";

const TIERS: Tier[] = ["free", "pro", "elite"];

describe("tierMeets", () => {
  it("is true when the user tier ranks at or above the requirement", () => {
    expect(tierMeets("free", "free")).toBe(true);
    expect(tierMeets("pro", "free")).toBe(true);
    expect(tierMeets("elite", "pro")).toBe(true);
  });

  it("is false when the user tier ranks below the requirement", () => {
    expect(tierMeets("free", "pro")).toBe(false);
    expect(tierMeets("pro", "elite")).toBe(false);
  });

  it("is monotonic across tiers for every requirement", () => {
    for (const required of TIERS) {
      const results = TIERS.map((t) => tierMeets(t, required));
      expect(results).toEqual([...results].sort((a, b) => Number(a) - Number(b)));
    }
  });
});

describe("canUseFeature", () => {
  it("gates paid features away from free users", () => {
    expect(canUseFeature("free", "signals")).toBe(true);
    expect(canUseFeature("free", "price_alerts")).toBe(false);
    expect(canUseFeature("free", "autotrader")).toBe(false);
  });

  it("grants pro features to pro but keeps elite features locked", () => {
    expect(canUseFeature("pro", "backtest_monte_carlo")).toBe(true);
    expect(canUseFeature("pro", "weekly_digest")).toBe(true);
    expect(canUseFeature("pro", "calibration_stats")).toBe(false);
    expect(canUseFeature("pro", "backtest_robustness")).toBe(false);
  });

  it("grants every feature to elite", () => {
    for (const feature of Object.keys(FEATURE_REQUIRES) as FeatureKey[]) {
      expect(canUseFeature("elite", feature)).toBe(true);
    }
  });

  it("agrees with the declared requirement for every tier/feature pair", () => {
    for (const feature of Object.keys(FEATURE_REQUIRES) as FeatureKey[]) {
      for (const tier of TIERS) {
        expect(canUseFeature(tier, feature)).toBe(
          TIER_RANK[tier] >= TIER_RANK[FEATURE_REQUIRES[feature]],
        );
      }
    }
  });
});

describe("tier metadata", () => {
  it("labels every feature key", () => {
    expect(Object.keys(FEATURE_LABELS).sort()).toEqual(Object.keys(FEATURE_REQUIRES).sort());
  });

  it("lists selling points for every tier", () => {
    for (const tier of TIERS) expect(TIER_FEATURE_LIST[tier].length).toBeGreaterThan(0);
  });

  it("increases limits monotonically with tier", () => {
    expect(TIER_LIMITS.free.backtests_per_month).toBeLessThan(TIER_LIMITS.pro.backtests_per_month);
    expect(TIER_LIMITS.pro.backtests_per_month).toBeLessThan(TIER_LIMITS.elite.backtests_per_month);
    expect(TIER_LIMITS.free.max_tickers_per_backtest).toBeLessThan(
      TIER_LIMITS.pro.max_tickers_per_backtest,
    );
    expect(TIER_LIMITS.pro.max_tickers_per_backtest).toBeLessThan(
      TIER_LIMITS.elite.max_tickers_per_backtest,
    );
    expect(TIER_LIMITS.elite.max_backtest_years).toBe(Infinity);
  });
});
