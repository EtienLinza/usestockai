// ============================================================================
// NYSE MARKET CALENDAR — full-closure and early-close holidays for 2025–2027
// ----------------------------------------------------------------------------
// Hardcoded so the autotrader does not trade on Thanksgiving, July 4, etc.
// Update yearly in December for the following year. Source: NYSE official schedule.
// All dates are in America/New_York wall-clock terms.
// ============================================================================

/** Days the NYSE is fully closed (no regular session). */
export const NYSE_FULL_CLOSURES: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01", // New Year's Day
  "2025-01-09", // Day of mourning (Jimmy Carter)
  "2025-01-20", // MLK Day
  "2025-02-17", // Presidents Day
  "2025-04-18", // Good Friday
  "2025-05-26", // Memorial Day
  "2025-06-19", // Juneteenth
  "2025-07-04", // Independence Day
  "2025-09-01", // Labor Day
  "2025-11-27", // Thanksgiving
  "2025-12-25", // Christmas
  // 2026
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03", // Observed (July 4 = Saturday)
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  // 2027
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18", // Observed (June 19 = Saturday)
  "2027-07-05", // Observed (July 4 = Sunday)
  "2027-09-06",
  "2027-11-25",
  "2027-12-24", // Observed (Dec 25 = Saturday)
]);

/** Days the NYSE closes early at 13:00 ET (1pm). */
export const NYSE_EARLY_CLOSES: ReadonlySet<string> = new Set([
  "2025-07-03", // July 3 (day before Independence Day)
  "2025-11-28", // Day after Thanksgiving
  "2025-12-24", // Christmas Eve
  "2026-11-27",
  "2026-12-24",
  "2027-11-26",
]);

/** Returns the YYYY-MM-DD date string for the given Date in America/New_York. */
export function toEtDateString(d: Date): string {
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

/** True when the given date is a full NYSE closure (not just a weekend). */
export function isMarketHoliday(d: Date = new Date()): boolean {
  return NYSE_FULL_CLOSURES.has(toEtDateString(d));
}

/** Returns close minute-of-day in ET (16:00 normally, 13:00 on early-close days). */
export function nyseCloseMinute(d: Date = new Date()): number {
  return NYSE_EARLY_CLOSES.has(toEtDateString(d)) ? 13 * 60 : 16 * 60;
}

/** Minute-of-day (0..1439) in America/New_York for the given UTC instant. */
export function etMinuteOfDay(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (h % 24) * 60 + m;
}

/** Day-of-week 0..6 (Sun..Sat) in America/New_York. */
export function etDayOfWeek(d: Date = new Date()): number {
  const wk = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(d);
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wk] ?? 0;
}
