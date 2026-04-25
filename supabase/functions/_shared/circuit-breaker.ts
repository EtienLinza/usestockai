// ============================================================================
// CIRCUIT BREAKER — deterministic data-quality checks for the autotrader.
//
// Returns a verdict the scanner uses to decide whether to halt the global
// kill switch and abort. All thresholds are conservative on purpose: a false
// positive costs you a missed scan; a false negative costs you a bad fill.
// ============================================================================

import type { DataSet } from "./signal-engine-v2.ts";

/** A single ticker's price data + freshness as seen during a scan. */
export interface TickerHealth {
  ticker: string;
  /** OHLCV dataset returned by the fetcher (null = fetch failed). */
  data: DataSet | null;
  /** Live quote price (latest known price, intraday if market open). */
  livePrice?: number | null;
  /** Live quote timestamp in ms (epoch). */
  liveQuoteAt?: number | null;
  /** Previous-scan close for the gap check, if known. */
  previousClose?: number | null;
}

/** Verdict returned by evaluateScanHealth. */
export interface BreakerVerdict {
  trip: boolean;
  reason: string | null;
  /** Per-ticker tags so the scanner can skip individually suspect tickers
   *  even when the overall scan does NOT trip the global breaker. */
  suspectTickers: Set<string>;
  /** Diagnostic counters for logging. */
  stats: {
    total: number;
    nullPrice: number;
    stale: number;
    gapped: number;
    fetchFailed: number;
  };
}

const NULL_PRICE_THRESHOLD = 0.20;       // >20% of tickers with null/zero prices
const STALE_QUOTE_MAX_AGE_MS = 30 * 60_000; // 30 min during RTH
const GAP_THRESHOLD = 0.25;              // >25% intraday gap is suspect
const FETCH_FAIL_THRESHOLD = 0.50;       // >50% of tickers errored

function priceLooksValid(p: number | null | undefined): boolean {
  return typeof p === "number" && Number.isFinite(p) && p > 0;
}

/**
 * Evaluate the health of a completed batch fetch.
 * @param healths - one entry per ticker the scanner tried to fetch
 * @param marketIsOpen - if the NYSE regular session is currently open;
 *   the stale-quote check is skipped when the market is closed (closes are
 *   legitimately stale outside RTH)
 */
export function evaluateScanHealth(
  healths: TickerHealth[],
  marketIsOpen: boolean,
): BreakerVerdict {
  const suspect = new Set<string>();
  let nullPrice = 0;
  let stale = 0;
  let gapped = 0;
  let fetchFailed = 0;

  const now = Date.now();

  for (const h of healths) {
    if (!h.data || h.data.close.length === 0) {
      fetchFailed++;
      suspect.add(h.ticker);
      continue;
    }

    const lastClose = h.data.close[h.data.close.length - 1];
    const livePrice = h.livePrice ?? lastClose;

    if (!priceLooksValid(lastClose) || !priceLooksValid(livePrice)) {
      nullPrice++;
      suspect.add(h.ticker);
      continue;
    }

    if (
      marketIsOpen &&
      h.liveQuoteAt &&
      now - h.liveQuoteAt > STALE_QUOTE_MAX_AGE_MS
    ) {
      stale++;
      suspect.add(h.ticker);
      continue;
    }

    // Implausible gap vs previous close (catches bad ticks / unadjusted splits)
    if (h.previousClose && h.previousClose > 0) {
      const gap = Math.abs(livePrice - h.previousClose) / h.previousClose;
      if (gap > GAP_THRESHOLD) {
        gapped++;
        suspect.add(h.ticker);
        // Note: we do NOT trip the global breaker on gaps alone — splits and
        // earnings can legitimately move a stock 25%. We just skip the ticker.
      }
    }
  }

  const total = healths.length;
  const stats = { total, nullPrice, stale, gapped, fetchFailed };

  if (total === 0) {
    return {
      trip: false,
      reason: null,
      suspectTickers: suspect,
      stats,
    };
  }

  // Trip rules — any ONE of these flips the global kill switch.
  if (nullPrice / total > NULL_PRICE_THRESHOLD) {
    return {
      trip: true,
      reason:
        `Bad price data: ${nullPrice}/${total} (${((nullPrice / total) * 100).toFixed(0)}%) ` +
        `tickers returned null/zero prices`,
      suspectTickers: suspect,
      stats,
    };
  }

  if (fetchFailed / total > FETCH_FAIL_THRESHOLD) {
    return {
      trip: true,
      reason:
        `Data feed failure: ${fetchFailed}/${total} (${((fetchFailed / total) * 100).toFixed(0)}%) ` +
        `tickers failed to fetch — possible upstream outage`,
      suspectTickers: suspect,
      stats,
    };
  }

  if (marketIsOpen && stale / total > NULL_PRICE_THRESHOLD) {
    return {
      trip: true,
      reason:
        `Stale data: ${stale}/${total} (${((stale / total) * 100).toFixed(0)}%) ` +
        `tickers returned quotes >30 min old during regular hours`,
      suspectTickers: suspect,
      stats,
    };
  }

  return {
    trip: false,
    reason: null,
    suspectTickers: suspect,
    stats,
  };
}
