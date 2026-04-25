// ============================================================================
// MARKET HOURS — shared NYSE schedule helpers (frontend)
// ----------------------------------------------------------------------------
// Mirrors supabase/functions/_shared/market-calendar.ts so the UI countdown
// agrees with the autotrader's market-open gate. Update both files when new
// holidays are added.
// ============================================================================

/** Days the NYSE is fully closed (no regular session). */
const NYSE_FULL_CLOSURES: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18",
  "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27",
  "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Days the NYSE closes early at 13:00 ET. */
const NYSE_EARLY_CLOSES: ReadonlySet<string> = new Set([
  "2025-07-03", "2025-11-28", "2025-12-24",
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

export type MarketState = "open" | "early-close" | "closed-weekend" | "closed-holiday" | "closed-after-hours" | "closed-pre-market";

export interface MarketStatus {
  state: MarketState;
  isOpen: boolean;
  /** Friendly label for the user, formatted in their local timezone. */
  label: string;
  /** UTC Date for the next regular open, or null if already open. */
  nextOpen: Date | null;
}

/** YYYY-MM-DD date string in America/New_York. */
function toEtDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function etWeekdayShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(d);
}

function etMinutesOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const REGULAR_CLOSE_MIN = 16 * 60; // 16:00 ET
const EARLY_CLOSE_MIN = 13 * 60; // 13:00 ET

function isHoliday(d: Date): boolean {
  return NYSE_FULL_CLOSURES.has(toEtDateString(d));
}
function isEarlyClose(d: Date): boolean {
  return NYSE_EARLY_CLOSES.has(toEtDateString(d));
}
function isWeekend(d: Date): boolean {
  const wd = etWeekdayShort(d);
  return wd === "Sat" || wd === "Sun";
}

/** Compute the next regular NYSE open after `from`, skipping weekends + holidays. */
export function nextMarketOpen(from: Date = new Date()): Date {
  for (let i = 0; i < 14; i++) {
    const candidate = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    if (isWeekend(candidate) || isHoliday(candidate)) continue;

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(candidate);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !d) continue;

    // Determine ET UTC offset for this date by probing 12:00 UTC.
    const probe = new Date(`${y}-${m}-${d}T12:00:00Z`);
    const etHourAtProbe = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hour12: false,
      })
        .formatToParts(probe)
        .find((p) => p.type === "hour")?.value ?? "0",
    );
    const offsetHours = 12 - etHourAtProbe; // EST=5, EDT=4
    const openUtc = new Date(`${y}-${m}-${d}T09:30:00Z`);
    openUtc.setUTCHours(openUtc.getUTCHours() + offsetHours);
    if (openUtc.getTime() > from.getTime()) return openUtc;
  }
  return from;
}

function formatLocal(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Comprehensive NYSE status with a viewer-local friendly label. */
export function getMarketStatus(now: Date = new Date()): MarketStatus {
  if (isHoliday(now)) {
    const next = nextMarketOpen(now);
    return {
      state: "closed-holiday",
      isOpen: false,
      label: `Market closed (holiday) · opens ${formatLocal(next)}`,
      nextOpen: next,
    };
  }
  if (isWeekend(now)) {
    const next = nextMarketOpen(now);
    return {
      state: "closed-weekend",
      isOpen: false,
      label: `Market closed · opens ${formatLocal(next)}`,
      nextOpen: next,
    };
  }
  const closeMin = isEarlyClose(now) ? EARLY_CLOSE_MIN : REGULAR_CLOSE_MIN;
  const minutes = etMinutesOfDay(now);
  if (minutes < OPEN_MIN) {
    const next = nextMarketOpen(now);
    return {
      state: "closed-pre-market",
      isOpen: false,
      label: `Pre-market · opens ${formatLocal(next)}`,
      nextOpen: next,
    };
  }
  if (minutes >= closeMin) {
    const next = nextMarketOpen(now);
    return {
      state: "closed-after-hours",
      isOpen: false,
      label: `After hours · opens ${formatLocal(next)}`,
      nextOpen: next,
    };
  }
  return {
    state: isEarlyClose(now) ? "early-close" : "open",
    isOpen: true,
    label: isEarlyClose(now) ? "Open (early close 1pm ET)" : "Open",
    nextOpen: null,
  };
}
