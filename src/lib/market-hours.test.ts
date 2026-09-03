import { describe, it, expect } from "vitest";
import { getMarketStatus, nextMarketOpen } from "./market-hours";

// All dates below are UTC; NYSE regular session is 14:30–21:00 UTC during EDT.
describe("market-hours", () => {
  it("reports open during a regular weekday session", () => {
    const s = getMarketStatus(new Date("2026-09-02T16:00:00Z"));
    expect(s.isOpen).toBe(true);
    expect(s.state).toBe("open");
  });

  it("reports closed on a weekend", () => {
    const s = getMarketStatus(new Date("2026-09-05T16:00:00Z"));
    expect(s.isOpen).toBe(false);
    expect(s.state).toBe("closed-weekend");
  });

  it("reports closed on a full NYSE holiday", () => {
    const s = getMarketStatus(new Date("2026-12-25T16:00:00Z"));
    expect(s.isOpen).toBe(false);
    expect(s.state).toBe("closed-holiday");
  });

  it("never returns a next open in the past", () => {
    const from = new Date("2026-09-05T16:00:00Z");
    expect(nextMarketOpen(from).getTime()).toBeGreaterThan(from.getTime());
  });
});
