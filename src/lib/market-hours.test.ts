import { describe, expect, it } from "vitest";
import { getMarketStatus, nextMarketOpen } from "./market-hours";

/** ISO instants are UTC; ET is UTC-4 (EDT) in summer and UTC-5 (EST) in winter. */
const at = (iso: string) => new Date(iso);

describe("getMarketStatus", () => {
  it("reports an open regular session", () => {
    const status = getMarketStatus(at("2025-06-18T14:00:00Z")); // Wed 10:00 ET
    expect(status).toMatchObject({ state: "open", isOpen: true, label: "Open", nextOpen: null });
  });

  it("treats 09:30 ET as open and 16:00 ET as closed", () => {
    expect(getMarketStatus(at("2025-06-18T13:30:00Z")).isOpen).toBe(true);
    expect(getMarketStatus(at("2025-06-18T13:29:00Z")).state).toBe("closed-pre-market");
    expect(getMarketStatus(at("2025-06-18T19:59:00Z")).isOpen).toBe(true);
    expect(getMarketStatus(at("2025-06-18T20:00:00Z")).state).toBe("closed-after-hours");
  });

  it("reports pre-market and after-hours on a weekday", () => {
    const pre = getMarketStatus(at("2025-06-18T12:00:00Z")); // 08:00 ET
    expect(pre.state).toBe("closed-pre-market");
    expect(pre.isOpen).toBe(false);
    expect(pre.label).toContain("Pre-market");
    expect(pre.nextOpen?.toISOString()).toBe("2025-06-18T13:30:00.000Z");

    const post = getMarketStatus(at("2025-06-18T21:00:00Z")); // 17:00 ET
    expect(post.state).toBe("closed-after-hours");
    expect(post.label).toContain("After hours");
    expect(post.nextOpen?.toISOString()).toBe("2025-06-20T13:30:00.000Z"); // Jun 19 is Juneteenth
  });

  it("reports weekends as closed with the next open on Monday", () => {
    const status = getMarketStatus(at("2025-06-21T15:00:00Z")); // Saturday
    expect(status.state).toBe("closed-weekend");
    expect(status.isOpen).toBe(false);
    expect(status.nextOpen?.toISOString()).toBe("2025-06-23T13:30:00.000Z");
  });

  it("reports NYSE holidays as closed even during regular hours", () => {
    const status = getMarketStatus(at("2025-06-19T15:00:00Z")); // Juneteenth, Thursday
    expect(status.state).toBe("closed-holiday");
    expect(status.isOpen).toBe(false);
    expect(status.label).toContain("holiday");
    expect(status.nextOpen?.toISOString()).toBe("2025-06-20T13:30:00.000Z");
  });

  it("flags half days and closes them at 13:00 ET", () => {
    const open = getMarketStatus(at("2025-11-28T15:00:00Z")); // 10:00 ET, day after Thanksgiving
    expect(open.state).toBe("early-close");
    expect(open.isOpen).toBe(true);
    expect(open.label).toContain("early close");

    const closed = getMarketStatus(at("2025-11-28T18:30:00Z")); // 13:30 ET
    expect(closed.state).toBe("closed-after-hours");
    expect(closed.isOpen).toBe(false);
  });
});

describe("nextMarketOpen", () => {
  it("returns today's open when it is still ahead", () => {
    expect(nextMarketOpen(at("2025-06-18T10:00:00Z")).toISOString()).toBe(
      "2025-06-18T13:30:00.000Z",
    );
  });

  it("skips the weekend after Friday's close", () => {
    expect(nextMarketOpen(at("2025-06-20T21:00:00Z")).toISOString()).toBe(
      "2025-06-23T13:30:00.000Z",
    );
  });

  it("skips holidays", () => {
    expect(nextMarketOpen(at("2025-12-24T22:00:00Z")).toISOString()).toBe(
      "2025-12-26T14:30:00.000Z",
    );
  });

  it("uses the EST offset in winter and EDT in summer", () => {
    expect(nextMarketOpen(at("2025-01-02T23:00:00Z")).toISOString()).toBe(
      "2025-01-03T14:30:00.000Z",
    );
    expect(nextMarketOpen(at("2025-07-07T00:00:00Z")).toISOString()).toBe(
      "2025-07-07T13:30:00.000Z",
    );
  });
});
