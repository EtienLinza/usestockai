import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  etDayOfWeek,
  etMinuteOfDay,
  isMarketHoliday,
  NYSE_EARLY_CLOSES,
  NYSE_FULL_CLOSURES,
  nyseCloseMinute,
  toEtDateString,
} from "./market-calendar.ts";

Deno.test("toEtDateString: converts UTC instants to the ET calendar day", () => {
  assertEquals(toEtDateString(new Date("2025-06-18T14:00:00Z")), "2025-06-18");
  // 00:30 UTC is still the previous evening in New York.
  assertEquals(toEtDateString(new Date("2025-06-19T00:30:00Z")), "2025-06-18");
  // Winter rolls over five hours later than UTC.
  assertEquals(toEtDateString(new Date("2025-01-02T04:59:00Z")), "2025-01-01");
});

Deno.test("isMarketHoliday: recognizes closures using the ET day, not the UTC day", () => {
  assertEquals(isMarketHoliday(new Date("2025-07-04T15:00:00Z")), true);
  assertEquals(isMarketHoliday(new Date("2025-07-07T15:00:00Z")), false);
  // 01:00 UTC on Jul 5 is still Jul 4 in New York.
  assertEquals(isMarketHoliday(new Date("2025-07-05T01:00:00Z")), true);
});

Deno.test("isMarketHoliday: weekends are not holidays — only full closures are", () => {
  assertEquals(isMarketHoliday(new Date("2025-06-21T15:00:00Z")), false); // Saturday
});

Deno.test("nyseCloseMinute: 16:00 ET normally, 13:00 ET on early-close days", () => {
  assertEquals(nyseCloseMinute(new Date("2025-06-18T15:00:00Z")), 960);
  assertEquals(nyseCloseMinute(new Date("2025-11-28T15:00:00Z")), 780);
  assertEquals(nyseCloseMinute(new Date("2025-12-24T15:00:00Z")), 780);
});

Deno.test("etMinuteOfDay: reports ET wall-clock minutes across DST", () => {
  assertEquals(etMinuteOfDay(new Date("2025-06-18T13:30:00Z")), 9 * 60 + 30); // EDT
  assertEquals(etMinuteOfDay(new Date("2025-01-02T14:30:00Z")), 9 * 60 + 30); // EST
  assertEquals(etMinuteOfDay(new Date("2025-06-18T04:00:00Z")), 0); // midnight ET
});

Deno.test("etDayOfWeek: maps ET weekdays onto Sun=0..Sat=6", () => {
  assertEquals(etDayOfWeek(new Date("2025-06-22T15:00:00Z")), 0); // Sunday
  assertEquals(etDayOfWeek(new Date("2025-06-18T15:00:00Z")), 3); // Wednesday
  assertEquals(etDayOfWeek(new Date("2025-06-21T15:00:00Z")), 6); // Saturday
  // 01:00 UTC Monday is still Sunday evening in New York.
  assertEquals(etDayOfWeek(new Date("2025-06-23T01:00:00Z")), 0);
});

Deno.test("calendar data: closures and early closes are disjoint and sorted-date valid", () => {
  for (const day of NYSE_EARLY_CLOSES) {
    assertEquals(NYSE_FULL_CLOSURES.has(day), false, `${day} cannot be both closed and half-day`);
  }
  for (const day of [...NYSE_FULL_CLOSURES, ...NYSE_EARLY_CLOSES]) {
    assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(day), true, `${day} is not a YYYY-MM-DD date`);
  }
});
