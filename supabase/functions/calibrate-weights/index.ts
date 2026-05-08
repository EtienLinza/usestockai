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
      .select("conviction, realized_pnl_pct, strategy, regime, signal_type, max_favorable_excursion_pct, max_adverse_excursion_pct")
      .eq("status", "closed")
      .gte("entry_date", sinceISO)
      .limit(10000);

    if (error) throw error;

    const rows = (closed ?? []) as OutcomeRow[];
    const sampleSize = rows.length;

    // ─── 1) CALIBRATION CURVE ──────────────────────────────────────────────
    // For each conviction bucket, compare realized win rate to the bucket's
    // expected win rate (its center). Store an `adjust` value in conviction
    // points the scanner will add/subtract when this bucket fires.
    const buckets: Record<string, { wins: number; count: number }> = {};
    for (const r of rows) {
      const b = bucketLabel(Number(r.conviction));
      buckets[b] ??= { wins: 0, count: 0 };
      buckets[b].count++;
      if (Number(r.realized_pnl_pct ?? 0) > 0) buckets[b].wins++;
    }

    const calibration_curve: Record<string, { actualWinRate: number; expectedWinRate: number; adjust: number; count: number }> = {};
    for (const [label, v] of Object.entries(buckets)) {
      const expected = bucketCenter(label);
      if (v.count < MIN_SAMPLES_BUCKET) {
        calibration_curve[label] = { actualWinRate: 0, expectedWinRate: expected, adjust: 0, count: v.count };
        continue;
      }
      const actual = (v.wins / v.count) * 100;
      // Aggressive: shift conviction toward observed win rate, capped at ±8 points
      const rawAdjust = actual - expected;
      const adjust = Math.max(-8, Math.min(8, Math.round(rawAdjust * 0.6)));
      calibration_curve[label] = {
        actualWinRate: actual,
        expectedWinRate: expected,
        adjust,
        count: v.count,
      };
    }

    // ─── 2) STRATEGY TILTS ─────────────────────────────────────────────────
    // Per-strategy multiplier from win rate × avg return. We reward
    // strategies that both win often AND make money when they win.
    const strats: Record<string, { wins: number; count: number; sumRet: number }> = {};
    for (const r of rows) {
      const k = r.strategy ?? "unknown";
      strats[k] ??= { wins: 0, count: 0, sumRet: 0 };
      strats[k].count++;
      if (Number(r.realized_pnl_pct ?? 0) > 0) strats[k].wins++;
      strats[k].sumRet += Number(r.realized_pnl_pct ?? 0);
    }

    // Universe average expectancy (avg return per trade) is the baseline.
    const universeAvgRet = rows.length
      ? rows.reduce((s, r) => s + Number(r.realized_pnl_pct ?? 0), 0) / rows.length
      : 0;

    const strategy_tilts: Record<string, { multiplier: number; winRate: number; avgReturn: number; count: number }> = {};
    for (const [k, v] of Object.entries(strats)) {
      if (v.count < MIN_SAMPLES_STRATEGY) {
        strategy_tilts[k] = { multiplier: 1.0, winRate: 0, avgReturn: 0, count: v.count };
        continue;
      }
      const winRate = (v.wins / v.count) * 100;
      const avgRet = v.sumRet / v.count;
      // Score ranges roughly -1..+1. Win rate 50% & avg ret = baseline → 0.
      const winRateZ = (winRate - 50) / 50;             // -1..+1
      const retZ = universeAvgRet !== 0
        ? Math.max(-1, Math.min(1, (avgRet - universeAvgRet) / Math.max(0.5, Math.abs(universeAvgRet))))
        : Math.max(-1, Math.min(1, avgRet / 2));
      const score = (winRateZ + retZ) / 2;              // -1..+1
      const multiplier = Math.max(TILT_MIN, Math.min(TILT_MAX, 1 + score * 0.15));
      strategy_tilts[k] = { multiplier, winRate, avgReturn: avgRet, count: v.count };
    }

    // ─── 2b) STRATEGY × REGIME TILTS ───────────────────────────────────────
    // Mean-reversion in risk_off behaves very differently from risk_on.
    // 2-D matrix keyed "strategy|regime" → multiplier. Scanner falls back
    // to the 1-D strategy_tilts entry when sample size is too small.
    const stratRegime: Record<string, { wins: number; count: number; sumRet: number }> = {};
    for (const r of rows) {
      const k = `${r.strategy ?? "unknown"}|${r.regime ?? "unknown"}`;
      stratRegime[k] ??= { wins: 0, count: 0, sumRet: 0 };
      stratRegime[k].count++;
      if (Number(r.realized_pnl_pct ?? 0) > 0) stratRegime[k].wins++;
      stratRegime[k].sumRet += Number(r.realized_pnl_pct ?? 0);
    }
    const strategy_regime_tilts: Record<string, { multiplier: number; winRate: number; avgReturn: number; count: number }> = {};
    for (const [k, v] of Object.entries(stratRegime)) {
      if (v.count < MIN_SAMPLES_STRATEGY_REGIME) {
        strategy_regime_tilts[k] = { multiplier: 1.0, winRate: 0, avgReturn: 0, count: v.count };
        continue;
      }
      const winRate = (v.wins / v.count) * 100;
      const avgRet = v.sumRet / v.count;
      const winRateZ = (winRate - 50) / 50;
      const retZ = universeAvgRet !== 0
        ? Math.max(-1, Math.min(1, (avgRet - universeAvgRet) / Math.max(0.5, Math.abs(universeAvgRet))))
        : Math.max(-1, Math.min(1, avgRet / 2));
      const score = (winRateZ + retZ) / 2;
      const multiplier = Math.max(TILT_MIN - 0.05, Math.min(TILT_MAX + 0.05, 1 + score * 0.18));
      strategy_regime_tilts[k] = { multiplier, winRate, avgReturn: avgRet, count: v.count };
    }

    // ─── 2c) EXIT CALIBRATION (per strategy) ───────────────────────────────
    // Compare MFE vs realized PnL among winners. Low capture → loosen trail;
    // high capture but losers running → slightly tighten.
    const exitGroups: Record<string, { winners: { mfe: number; realized: number }[]; total: number }> = {};
    for (const r of rows) {
      const k = r.strategy ?? "unknown";
      exitGroups[k] ??= { winners: [], total: 0 };
      exitGroups[k].total++;
      const realized = Number(r.realized_pnl_pct ?? 0);
      const mfe = Math.abs(Number(r.max_favorable_excursion_pct ?? 0));
      if (realized > 0 && mfe > 0) exitGroups[k].winners.push({ mfe, realized });
    }
    const exit_calibration: Record<string, { trailMultAdjust: number; captureRatio: number; winnerCount: number; sample: number }> = {};
    for (const [k, g] of Object.entries(exitGroups)) {
      if (g.winners.length < MIN_SAMPLES_EXIT) {
        exit_calibration[k] = { trailMultAdjust: 1.0, captureRatio: 0, winnerCount: g.winners.length, sample: g.total };
        continue;
      }
      const ratios = g.winners.map(w => Math.max(0, Math.min(1.5, w.realized / w.mfe)));
      const captureRatio = ratios.reduce((s, x) => s + x, 0) / ratios.length;
      // capture <0.45 → trail too tight → loosen up to ×1.40
      // 0.45–0.65 → mild loosen
      // 0.65–0.80 → well-tuned ×1.0
      // >0.80 → tighten slightly
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
      notes: {
        universeAvgReturnPct: universeAvgRet,
        strategy_regime_tilts,
        thresholds: {
          MIN_SAMPLES_BUCKET, MIN_SAMPLES_STRATEGY, MIN_SAMPLES_REGIME,
          MIN_SAMPLES_STRATEGY_REGIME, MIN_SAMPLES_EXIT,
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
