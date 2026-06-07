// ============================================================================
// REGIME DETECTOR — classifies the current market into one of 4 states from
// SPY daily bars + computes a strategy-conditional conviction tilt.
//
// States:
//   bull_quiet      — 50d > 200d SMA AND ATR% < 1.2
//   bull_volatile   — 50d > 200d SMA AND ATR% ≥ 1.2
//   bear_quiet      — 50d < 200d SMA AND ATR% < 1.5
//   bear_volatile   — 50d < 200d SMA AND ATR% ≥ 1.5
//
// Tilts are SOFT (capped ±15%). Used as a supporting conviction factor in
// the signal engine — never a hard gate, never blocks an entry on its own.
// ============================================================================

import { calculateSMA, calculateATR } from "./indicators.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type MarketRegime =
  | "bull_quiet"
  | "bull_volatile"
  | "bear_quiet"
  | "bear_volatile"
  | "neutral";

export interface RegimeSnapshot {
  date: string; // YYYY-MM-DD
  regime: MarketRegime;
  atrPct: number;
  smaRatio: number;
  spyClose: number;
}

/** Classify a regime from SPY daily bars. Returns null if insufficient data. */
export function classifyRegime(
  close: number[],
  high: number[],
  low: number[],
): RegimeSnapshot | null {
  if (close.length < 210) return null;
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);
  const atr = calculateATR(high, low, close, 14);
  const last = close.length - 1;
  const c = close[last];
  const s50 = sma50[last];
  const s200 = sma200[last];
  const a = atr[last];
  if (!Number.isFinite(c) || !Number.isFinite(s50) || !Number.isFinite(s200) || !Number.isFinite(a) || c <= 0) {
    return null;
  }
  const atrPct = (a / c) * 100;
  const smaRatio = s50 / s200;
  const isBull = s50 > s200;
  let regime: MarketRegime;
  if (isBull) {
    regime = atrPct < 1.2 ? "bull_quiet" : "bull_volatile";
  } else {
    regime = atrPct < 1.5 ? "bear_quiet" : "bear_volatile";
  }
  return {
    date: new Date().toISOString().slice(0, 10),
    regime,
    atrPct: Math.round(atrPct * 100) / 100,
    smaRatio: Math.round(smaRatio * 10000) / 10000,
    spyClose: Math.round(c * 100) / 100,
  };
}

// Strategy × Regime conviction multipliers (capped ±15% — soft tilt).
// Rows: strategy. Columns: regime. Value: multiplier applied to conviction.
const TILT_MATRIX: Record<string, Record<MarketRegime, number>> = {
  trend: {
    bull_quiet:    1.10,
    bull_volatile: 1.00,
    bear_quiet:    0.92,
    bear_volatile: 0.85,
    neutral:       1.00,
  },
  mean_reversion: {
    bull_quiet:    0.92,
    bull_volatile: 1.12,
    bear_quiet:    1.00,
    bear_volatile: 0.90,
    neutral:       1.00,
  },
  breakout: {
    bull_quiet:    1.10,
    bull_volatile: 1.00,
    bear_quiet:    0.88,
    bear_volatile: 0.85,
    neutral:       1.00,
  },
  none: {
    bull_quiet: 1, bull_volatile: 1, bear_quiet: 1, bear_volatile: 1, neutral: 1,
  },
};

/** Soft conviction multiplier for a strategy in a given regime. Capped ±15%. */
export function regimeConvictionMultiplier(
  strategy: string | undefined | null,
  regime: MarketRegime | undefined | null,
): number {
  if (!strategy || !regime) return 1;
  const row = TILT_MATRIX[strategy] ?? TILT_MATRIX.none;
  const m = row[regime] ?? 1;
  return Math.max(0.85, Math.min(1.15, m));
}

// ── DB helpers ──────────────────────────────────────────────────────────────
let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

export async function upsertRegimeSnapshot(snap: RegimeSnapshot): Promise<void> {
  try {
    const { error } = await client()
      .from("market_regime")
      .upsert(
        {
          date: snap.date,
          regime: snap.regime,
          atr_pct: snap.atrPct,
          sma_ratio: snap.smaRatio,
          spy_close: snap.spyClose,
        },
        { onConflict: "date" },
      );
    if (error) console.warn("[regime upsert]", error.message);
  } catch (e) {
    console.warn("[regime upsert] failed", e instanceof Error ? e.message : e);
  }
}

export async function loadLatestRegime(): Promise<MarketRegime | null> {
  try {
    const { data, error } = await client()
      .from("market_regime")
      .select("regime")
      .order("date", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const r = (data[0] as { regime: string }).regime;
    return (r as MarketRegime) ?? null;
  } catch (e) {
    console.warn("[regime load] failed", e instanceof Error ? e.message : e);
    return null;
  }
}
