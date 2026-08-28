// Client-side polling helpers.
//
// Goal: keep every feature exactly as-is, but stop paying for backend calls
// nobody is looking at (hidden tab) or that cannot change (market closed).

/** True when the browser tab is currently visible to the user. */
export function isTabVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

/**
 * True Mon–Fri, 09:25–16:10 America/New_York (small buffer around the cash
 * session so opening/closing prints still refresh). DST-safe: derived from
 * the Intl timezone formatter rather than a fixed UTC offset.
 */
export function isMarketOpenET(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = String(parts.weekday ?? "");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 25 && minutes <= 16 * 60 + 10;
}

/** Poll only when the user can see the result. */
export function shouldPoll(): boolean {
  return isTabVisible();
}

/** Poll live prices only when visible AND prices can actually move. */
export function shouldPollPrices(): boolean {
  return isTabVisible() && isMarketOpenET();
}

/**
 * Re-runs `fn` whenever the tab becomes visible again, so a paused poller
 * refreshes immediately instead of waiting out its interval.
 */
export function onVisible(fn: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (document.visibilityState === "visible") fn();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
