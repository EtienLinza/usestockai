import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// PHASE B — Nightly adaptive weighting job.
// Reads `signal_outcomes` (closed) over a rolling window and produces
// three adjustments the scanner uses on every run:
//
//   1. calibration_curve   — maps raw conviction → calibrated conviction
//                            (so "80" actually means ~80% historically)
//   2. strategy_tilts      — multipliers per strategy based on recent win
//                            rate × avg return in the *current* market regime
//   3. regime_floors       — per-regime conviction threshold (auto-tuned)
//
// Aggressive mode: all three are enabled.

const WINDOW_DAYS = 90;
const MIN_SAMPLES_BUCKET = 10;     // need ≥10 closed trades in a conviction bucket to trust it
const MIN_SAMPLES_STRATEGY = 15;   // need ≥15 closed trades to tilt a strategy
const MIN_SAMPLES_REGIME = 20;     // need ≥20 to override a regime floor
const TILT_MIN = 0.85;             // strategy multiplier floor
const TILT_MAX = 1.15;             // strategy multiplier ceiling
const FLOOR_MIN = 55;              // never let the floor drop below this
const FLOOR_MAX = 80;              // or rise above this
const DEFAULT_FLOOR = 65;          // baseline when there's not enough data

interface OutcomeRow {
  conviction: number;
  realized_pnl_pct: number | null;
  strategy: string | null;
  regime: string | null;
  signal_type: string | null;
  ticker: string | null;
  entry_date: string | null;
  max_favorable_excursion_pct: number | null;
  max_adverse_excursion_pct: number | null;
}

// Per-(strategy × regime) tilt requires fewer samples since the cell is narrower
const MIN_SAMPLES_STRATEGY_REGIME = 10;
// Exit calibration: per-strategy MFE-vs-realized ratio
const MIN_SAMPLES_EXIT = 12;
const TRAIL_MULT_MIN = 0.7;   // tighten trail at most 30%
const TRAIL_MULT_MAX = 1.4;   // loosen trail at most 40%
// Per-ticker calibration: Bayesian shrinkage toward global curve
const TICKER_PRIOR_STRENGTH = 30;  // equivalent to 30 "prior" trades
const MIN_SAMPLES_TICKER = 8;      // skip tickers with fewer than this

// Walk-forward time decay weights (recent → old, applied to all aggregates)
function timeWeight(entryDate: string | null, nowMs: number): number {
  if (!entryDate) return 1.0;
  const ageDays = (nowMs - new Date(entryDate).getTime()) / (24 * 3600 * 1000);
  if (ageDays <= 30) return 2.0;
  if (ageDays <= 60) return 1.5;
  return 1.0;
}

function bucketLabel(c: number): string {
  if (c < 60) return "lt60";
  if (c < 70) return "60-69";
  if (c < 80) return "70-79";
  if (c < 90) return "80-89";
  return "90-100";
}

function bucketCenter(label: string): number {
  switch (label) {
    case "lt60": return 55;
    case "60-69": return 65;
    case "70-79": return 75;
    case "80-89": return 85;
    case "90-100": return 95;
    default: return 65;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();

    const { data: closed, error } = await supabase
      .from("signal_outcomes")
      .select("conviction, realized_pnl_pct, strategy, regime, signal_type, ticker, entry_date, max_favorable_excursion_pct, max_adverse_excursion_pct")
      .eq("status", "closed")
      .gte("entry_date", sinceISO)
      .limit(10000);

    if (error) throw error;

    const rows = (closed ?? []) as OutcomeRow[];
    const sampleSize = rows.length;
    const nowMs = Date.now();
    // Pre-compute time weight per row so all aggregates use walk-forward decay.
    const tw = rows.map(r => timeWeight(r.entry_date, nowMs));

    // ─── 1) CALIBRATION CURVE (walk-forward weighted) ─────────────────────
    // Each trade's contribution to its bucket is scaled by `timeWeight`
    // (recent trades count 2× and 1.5× vs the oldest tier). The MIN_SAMPLES
    // gate still uses raw count so we don't act on cells of <10 actual trades.
    const buckets: Record<string, { wWins: number; wCount: number; raw: number }> = {};
    rows.forEach((r, i) => {
      const b = bucketLabel(Number(r.conviction));
      buckets[b] ??= { wWins: 0, wCount: 0, raw: 0 };
      buckets[b].raw++;
      buckets[b].wCount += tw[i];
      if (Number(r.realized_pnl_pct ?? 0) > 0) buckets[b].wWins += tw[i];
    });

    const calibration_curve: Record<string, { actualWinRate: number; expectedWinRate: number; adjust: number; count: number }> = {};
    for (const [label, v] of Object.entries(buckets)) {
      const expected = bucketCenter(label);
      if (v.raw < MIN_SAMPLES_BUCKET) {
        calibration_curve[label] = { actualWinRate: 0, expectedWinRate: expected, adjust: 0, count: v.raw };
        continue;
      }
      const actual = (v.wWins / v.wCount) * 100;
      const rawAdjust = actual - expected;
      const adjust = Math.max(-8, Math.min(8, Math.round(rawAdjust * 0.6)));
      calibration_curve[label] = { actualWinRate: actual, expectedWinRate: expected, adjust, count: v.raw };
    }

    // ─── 2) STRATEGY TILTS (walk-forward weighted) ─────────────────────────
    const strats: Record<string, { wWins: number; wCount: number; wSumRet: number; raw: number }> = {};
    rows.forEach((r, i) => {
      const k = r.strategy ?? "unknown";
      strats[k] ??= { wWins: 0, wCount: 0, wSumRet: 0, raw: 0 };
      strats[k].raw++;
      strats[k].wCount += tw[i];
      const ret = Number(r.realized_pnl_pct ?? 0);
      if (ret > 0) strats[k].wWins += tw[i];
      strats[k].wSumRet += ret * tw[i];
    });

    // Weighted universe expectancy (baseline for tilt z-scores)
    const totW = tw.reduce((s, x) => s + x, 0);
    const universeAvgRet = totW > 0
      ? rows.reduce((s, r, i) => s + Number(r.realized_pnl_pct ?? 0) * tw[i], 0) / totW
      : 0;

    const strategy_tilts: Record<string, { multiplier: number; winRate: number; avgReturn: number; count: number }> = {};
    for (const [k, v] of Object.entries(strats)) {
      if (v.raw < MIN_SAMPLES_STRATEGY) {
        strategy_tilts[k] = { multiplier: 1.0, winRate: 0, avgReturn: 0, count: v.raw };
        continue;
      }
      const winRate = (v.wWins / v.wCount) * 100;
      const avgRet = v.wSumRet / v.wCount;
      const winRateZ = (winRate - 50) / 50;
      const retZ = universeAvgRet !== 0
        ? Math.max(-1, Math.min(1, (avgRet - universeAvgRet) / Math.max(0.5, Math.abs(universeAvgRet))))
        : Math.max(-1, Math.min(1, avgRet / 2));
      const score = (winRateZ + retZ) / 2;
      const multiplier = Math.max(TILT_MIN, Math.min(TILT_MAX, 1 + score * 0.15));
      strategy_tilts[k] = { multiplier, winRate, avgReturn: avgRet, count: v.raw };
    }

    // ─── 2b) STRATEGY × REGIME TILTS (walk-forward weighted) ───────────────
    const stratRegime: Record<string, { wWins: number; wCount: number; wSumRet: number; raw: number }> = {};
    rows.forEach((r, i) => {
      const k = `${r.strategy ?? "unknown"}|${r.regime ?? "unknown"}`;
      stratRegime[k] ??= { wWins: 0, wCount: 0, wSumRet: 0, raw: 0 };
      stratRegime[k].raw++;
      stratRegime[k].wCount += tw[i];
      const ret = Number(r.realized_pnl_pct ?? 0);
      if (ret > 0) stratRegime[k].wWins += tw[i];
      stratRegime[k].wSumRet += ret * tw[i];
    });
    const strategy_regime_tilts: Record<string, { multiplier: number; winRate: number; avgReturn: number; count: number }> = {};
    for (const [k, v] of Object.entries(stratRegime)) {
      if (v.raw < MIN_SAMPLES_STRATEGY_REGIME) {
        strategy_regime_tilts[k] = { multiplier: 1.0, winRate: 0, avgReturn: 0, count: v.raw };
        continue;
      }
      const winRate = (v.wWins / v.wCount) * 100;
      const avgRet = v.wSumRet / v.wCount;
      const winRateZ = (winRate - 50) / 50;
      const retZ = universeAvgRet !== 0
        ? Math.max(-1, Math.min(1, (avgRet - universeAvgRet) / Math.max(0.5, Math.abs(universeAvgRet))))
        : Math.max(-1, Math.min(1, avgRet / 2));
      const score = (winRateZ + retZ) / 2;
      const multiplier = Math.max(TILT_MIN - 0.05, Math.min(TILT_MAX + 0.05, 1 + score * 0.18));
      strategy_regime_tilts[k] = { multiplier, winRate, avgReturn: avgRet, count: v.raw };
    }

    // ─── 2c) EXIT CALIBRATION (per strategy) ───────────────────────────────
    const exitGroups: Record<string, { winners: { mfe: number; realized: number; w: number }[]; total: number }> = {};
    rows.forEach((r, i) => {
      const k = r.strategy ?? "unknown";
      exitGroups[k] ??= { winners: [], total: 0 };
      exitGroups[k].total++;
      const realized = Number(r.realized_pnl_pct ?? 0);
      const mfe = Math.abs(Number(r.max_favorable_excursion_pct ?? 0));
      if (realized > 0 && mfe > 0) exitGroups[k].winners.push({ mfe, realized, w: tw[i] });
    });
    const exit_calibration: Record<string, { trailMultAdjust: number; captureRatio: number; winnerCount: number; sample: number }> = {};
    for (const [k, g] of Object.entries(exitGroups)) {
      if (g.winners.length < MIN_SAMPLES_EXIT) {
        exit_calibration[k] = { trailMultAdjust: 1.0, captureRatio: 0, winnerCount: g.winners.length, sample: g.total };
        continue;
      }
      const wSum = g.winners.reduce((s, w) => s + w.w, 0);
      const captureRatio = g.winners.reduce((s, w) => s + Math.max(0, Math.min(1.5, w.realized / w.mfe)) * w.w, 0) / wSum;
      let mult = 1.0;
      if (captureRatio < 0.45) mult = 1.0 + Math.min(0.40, (0.45 - captureRatio) * 1.5);
      else if (captureRatio < 0.65) mult = 1.0 + (0.65 - captureRatio) * 0.5;
      else if (captureRatio > 0.80) mult = 1.0 - Math.min(0.15, (captureRatio - 0.80) * 0.75);
      mult = Math.max(TRAIL_MULT_MIN, Math.min(TRAIL_MULT_MAX, mult));
      exit_calibration[k] = {
        trailMultAdjust: Number(mult.toFixed(3)),
        captureRatio: Number(captureRatio.toFixed(3)),
        winnerCount: g.winners.length,
        sample: g.total,
      };
    }

    // ─── 2d) PER-TICKER CALIBRATION (Bayesian shrinkage) ───────────────────
    // Some tickers consistently over- or under-deliver vs their conviction
    // bucket. Compute a per-ticker conviction adjustment that shrinks toward
    // the global bucket curve when sample size is low. Formula:
    //   adjust_ticker = (n / (n + PRIOR)) × (raw_ticker_adjust)
    // where raw_ticker_adjust = ticker_actual_WR − ticker_expected_WR (in
    // conviction points), and `expected` is the weighted-avg bucket center
    // for that ticker's trades. Capped at ±6 conviction points.
    const tickerStats: Record<string, { wWins: number; wCount: number; wExpected: number; raw: number }> = {};
    rows.forEach((r, i) => {
      const t = (r.ticker ?? "").toUpperCase();
      if (!t) return;
      tickerStats[t] ??= { wWins: 0, wCount: 0, wExpected: 0, raw: 0 };
      tickerStats[t].raw++;
      tickerStats[t].wCount += tw[i];
      tickerStats[t].wExpected += bucketCenter(bucketLabel(Number(r.conviction))) * tw[i];
      if (Number(r.realized_pnl_pct ?? 0) > 0) tickerStats[t].wWins += tw[i];
    });
    const ticker_calibration: Record<string, { adjust: number; actualWinRate: number; expectedWinRate: number; count: number }> = {};
    for (const [t, v] of Object.entries(tickerStats)) {
      if (v.raw < MIN_SAMPLES_TICKER) continue;
      const actual = (v.wWins / v.wCount) * 100;
      const expected = v.wExpected / v.wCount;
      const rawDelta = actual - expected;
      const shrink = v.raw / (v.raw + TICKER_PRIOR_STRENGTH);   // 0..1
      const adjust = Math.max(-6, Math.min(6, Math.round(rawDelta * shrink * 0.6)));
      if (adjust === 0) continue;  // omit no-op rows to keep payload lean
      ticker_calibration[t] = {
        adjust,
        actualWinRate: Number(actual.toFixed(1)),
        expectedWinRate: Number(expected.toFixed(1)),
        count: v.raw,
      };
    }

    // ─── 3) REGIME FLOORS (auto-tuned, aggressive mode) ────────────────────
    // For each regime, compute the conviction level above which historical
    // win rate is at least 55%. Use that as the floor (clamped 55-80).
    const regimeFloors: Record<string, { floor: number; sampleWinRate: number; count: number }> = {};
    const regimeGroups: Record<string, OutcomeRow[]> = {};
    for (const r of rows) {
      const k = r.regime ?? "unknown";
      regimeGroups[k] ??= [];
      regimeGroups[k].push(r);
    }

    for (const [regime, regRows] of Object.entries(regimeGroups)) {
      if (regRows.length < MIN_SAMPLES_REGIME) {
        regimeFloors[regime] = { floor: DEFAULT_FLOOR, sampleWinRate: 0, count: regRows.length };
        continue;
      }
      // Sort by conviction ascending; sweep upward, find smallest floor
      // where the *remaining* (≥floor) trades have win rate ≥55%.
      const sorted = [...regRows].sort((a, b) => Number(a.conviction) - Number(b.conviction));
      let chosenFloor = DEFAULT_FLOOR;
      let chosenWR = 0;
      for (let i = 0; i < sorted.length; i++) {
        const slice = sorted.slice(i);
        if (slice.length < 10) break;
        const wins = slice.filter(r => Number(r.realized_pnl_pct ?? 0) > 0).length;
        const wr = (wins / slice.length) * 100;
        if (wr >= 55) {
          chosenFloor = Math.round(Number(sorted[i].conviction));
          chosenWR = wr;
          break;
        }
      }
      // Overall regime hit rate also gates: if the regime is brutal, raise floor more.
      const overallWins = regRows.filter(r => Number(r.realized_pnl_pct ?? 0) > 0).length;
      const overallWR = (overallWins / regRows.length) * 100;
      if (overallWR < 40) chosenFloor = Math.max(chosenFloor, 75);
      else if (overallWR < 50) chosenFloor = Math.max(chosenFloor, 70);

      regimeFloors[regime] = {
        floor: Math.max(FLOOR_MIN, Math.min(FLOOR_MAX, chosenFloor)),
        sampleWinRate: chosenWR || overallWR,
        count: regRows.length,
      };
    }

    // ─── PERSIST ───────────────────────────────────────────────────────────
    // Deactivate previous active row, insert new active row.
    const { error: deactErr } = await supabase
      .from("strategy_weights")
      .update({ is_active: false })
      .eq("is_active", true);
    if (deactErr) console.error("Deactivate prev weights err:", deactErr);

    const insertRow = {
      is_active: true,
      window_days: WINDOW_DAYS,
      sample_size: sampleSize,
      calibration_curve,
      strategy_tilts,
      regime_floors: regimeFloors,
      exit_calibration,
      ticker_calibration,
      notes: {
        universeAvgReturnPct: universeAvgRet,
        strategy_regime_tilts,
        walkForwardWeights: { "0-30d": 2.0, "30-60d": 1.5, "60-90d": 1.0 },
        tickerCalibrationCount: Object.keys(ticker_calibration).length,
        thresholds: {
          MIN_SAMPLES_BUCKET, MIN_SAMPLES_STRATEGY, MIN_SAMPLES_REGIME,
          MIN_SAMPLES_STRATEGY_REGIME, MIN_SAMPLES_EXIT, MIN_SAMPLES_TICKER,
          TICKER_PRIOR_STRENGTH,
          TILT_MIN, TILT_MAX, FLOOR_MIN, FLOOR_MAX, DEFAULT_FLOOR,
          TRAIL_MULT_MIN, TRAIL_MULT_MAX,
        },
      },
    };
    const { data: inserted, error: insErr } = await supabase
      .from("strategy_weights")
      .insert(insertRow)
      .select()
      .single();
    if (insErr) throw insErr;

    await recordHeartbeat(
      "calibrate-weights",
      startedAt,
      "ok",
      `samples=${sampleSize} window=${WINDOW_DAYS}d`,
    );

    return new Response(JSON.stringify({
      ok: true,
      sampleSize,
      windowDays: WINDOW_DAYS,
      activeWeightsId: inserted?.id,
      calibration_curve,
      strategy_tilts,
      strategy_regime_tilts,
      regime_floors: regimeFloors,
      exit_calibration,
      ticker_calibration_count: Object.keys(ticker_calibration).length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("calibrate-weights error:", e);
    await recordHeartbeat("calibrate-weights", startedAt, "error", e?.message ?? "failed");
    return new Response(JSON.stringify({ error: e.message ?? "failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
