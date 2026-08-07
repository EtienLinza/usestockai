// ============================================================================
// TUNE-SIGNAL-THRESHOLDS (WS2) — nightly adaptive threshold learner.
//
// The engine's indicator thresholds (ADX floor, RSI oversold/overbought,
// conviction floor) were hand-set. This job learns small, clamped deltas on
// top of them per (stock profile × market regime) from what actually happened:
//
//   • TAKEN trades      → signal_outcomes.realized_pnl_pct
//   • REJECTED signals  → rejected_signals.counterfactual_return_pct
//                         (what we WOULD have made — lets us learn that a
//                          threshold is too tight, not just too loose)
//
// Objective = expectancy PER OPPORTUNITY: sum(return of accepted) / N_total.
// Filtering everything away scores 0, so over-tightening can't win.
//
// Two safety layers (both always on):
//   1. Shrinkage toward defaults by sample size + hard per-param clamps.
//   2. Walk-forward holdout: fit on the older 60%, validate on the recent 40%.
//      A candidate is promoted to `active` only if it beats the engine default
//      on the holdout by a margin. Everything else is stored as `shadow`.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { PROFILE_PARAMS } from "../_shared/signal-engine-v2.ts";
import { clampParam, type TunedParams } from "../_shared/adaptive-thresholds.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const WINDOW_DAYS = 180;
const MIN_SAMPLES = 40;          // per (profile × regime) bucket
const MIN_HOLDOUT = 12;
const TRAIN_FRACTION = 0.6;
const SHRINK_K = 50;             // n / (n + K) shrinkage toward defaults
const PROMOTE_MARGIN = 0.05;     // holdout expectancy must beat default by 0.05 %/opportunity
const INDICATOR_COVERAGE = 0.6;  // fraction of samples needing adx/rsi to tune them

type Side = "long" | "short";

interface Sample {
  ts: number;
  profile: string;
  regime: string;         // market regime
  strategy: string;
  side: Side;
  conviction: number;
  adx: number | null;
  rsi: number | null;
  ret: number;            // % return (realized or counterfactual)
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function baseFor(profile: string): TunedParams {
  const p = (PROFILE_PARAMS as any)[profile] ?? (PROFILE_PARAMS as any).momentum;
  return {
    adxThreshold: p.adxThreshold,
    rsiOversold: p.rsiOversold,
    rsiOverbought: p.rsiOverbought,
    buyThreshold: p.buyThreshold,
    shortThreshold: p.shortThreshold,
  };
}

/** Does this sample survive the candidate threshold set? */
function accepts(s: Sample, c: Required<TunedParams>, useIndicators: boolean): boolean {
  const convFloor = s.side === "long" ? c.buyThreshold : c.shortThreshold;
  if (s.conviction < convFloor) return false;
  if (!useIndicators) return true;
  if (s.strategy === "trend" || s.strategy === "breakout") {
    if (s.adx != null && s.adx < c.adxThreshold) return false;
  }
  if (s.strategy === "mean_reversion" && s.rsi != null) {
    if (s.side === "long" && s.rsi > c.rsiOversold + 15) return false;
    if (s.side === "short" && s.rsi < c.rsiOverbought - 15) return false;
  }
  return true;
}

/** Expectancy per opportunity (%): rewards keeping winners, punishes both
 *  letting losers through and filtering the book down to nothing. */
function score(samples: Sample[], c: Required<TunedParams>, useIndicators: boolean): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) if (accepts(s, c, useIndicators)) sum += s.ret;
  return sum / samples.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  const started = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
    const samples: Sample[] = [];

    // ── 1. Taken trades ────────────────────────────────────────────────────
    const { data: outcomes, error: oErr } = await supabase
      .from("signal_outcomes")
      .select("stock_profile, strategy, signal_type, conviction, realized_pnl_pct, entry_date, feature_snapshot, regime")
      .eq("status", "closed")
      .gte("entry_date", sinceIso)
      .not("realized_pnl_pct", "is", null)
      .limit(5000);
    if (oErr) throw oErr;

    for (const r of outcomes ?? []) {
      const snap = (r.feature_snapshot ?? {}) as Record<string, unknown>;
      const ret = num(r.realized_pnl_pct);
      const conv = num(r.conviction);
      if (ret == null || conv == null) continue;
      samples.push({
        ts: new Date(r.entry_date as string).getTime(),
        profile: String(snap._profile ?? r.stock_profile ?? "momentum").toLowerCase(),
        regime: String(snap._market_regime ?? "neutral").toLowerCase(),
        strategy: String(snap._strategy ?? r.strategy ?? "trend"),
        side: String(r.signal_type).toUpperCase() === "SHORT" ? "short" : "long",
        conviction: conv,
        adx: num(snap.adx_at_entry),
        rsi: num(snap.rsi_at_entry),
        ret,
      });
    }

    // ── 2. Rejected signals with counterfactual labels ─────────────────────
    const { data: rejects, error: rErr } = await supabase
      .from("rejected_signals")
      .select("strategy, calibrated_conviction, raw_conviction, counterfactual_return_pct, feature_snapshot, created_at, rejection_reason")
      .not("counterfactual_return_pct", "is", null)
      .gte("created_at", sinceIso)
      .in("rejection_reason", ["below_conviction_floor"])
      .limit(5000);
    if (rErr) throw rErr;

    for (const r of rejects ?? []) {
      const snap = (r.feature_snapshot ?? {}) as Record<string, unknown>;
      const ret = num(r.counterfactual_return_pct);
      const conv = num(r.calibrated_conviction) ?? num(r.raw_conviction);
      if (ret == null || conv == null) continue;
      samples.push({
        ts: new Date(r.created_at as string).getTime(),
        profile: String(snap.profile ?? "momentum").toLowerCase(),
        regime: String(snap.market_regime ?? snap.regime ?? "neutral").toLowerCase(),
        strategy: String(snap.strategy ?? r.strategy ?? "trend"),
        side: snap.side === "short" ? "short" : "long",
        conviction: conv,
        adx: num(snap.adx),
        rsi: num(snap.rsi),
        ret,
      });
    }

    if (samples.length === 0) {
      await recordHeartbeat("tune-signal-thresholds", started, "ok", "no samples yet (cold start)");
      return new Response(JSON.stringify({ ok: true, buckets: 0, promoted: 0, reason: "cold start" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Bucket by profile × market regime (+ a regime-agnostic `all` row) ─
    const buckets = new Map<string, Sample[]>();
    const push = (k: string, s: Sample) => {
      const arr = buckets.get(k);
      if (arr) arr.push(s); else buckets.set(k, [s]);
    };
    for (const s of samples) {
      push(`${s.profile}|${s.regime}`, s);
      push(`${s.profile}|all`, s);
    }

    // ── 4. Grid search per bucket ──────────────────────────────────────────
    const ADX_D = [-6, -3, 0, 3, 6];
    const OS_D = [-4, 0, 4];
    const OB_D = [-4, 0, 4];
    const CONV_D = [-5, 0, 5, 10];

    const rows: Record<string, unknown>[] = [];
    let promoted = 0, evaluated = 0;

    for (const [key, raw] of buckets) {
      if (raw.length < MIN_SAMPLES) continue;
      const [profile, regime] = key.split("|");
      const base = baseFor(profile) as Required<TunedParams>;
      const list = raw.slice().sort((a, b) => a.ts - b.ts);
      const cut = Math.floor(list.length * TRAIN_FRACTION);
      const train = list.slice(0, cut);
      const valid = list.slice(cut);
      if (valid.length < MIN_HOLDOUT) continue;
      evaluated++;

      const withInd = list.filter(s => s.adx != null || s.rsi != null).length;
      const useIndicators = withInd / list.length >= INDICATOR_COVERAGE;

      const shrink = list.length / (list.length + SHRINK_K);

      let best = { params: base, s: score(train, base, useIndicators) };
      const baseTrain = best.s;

      for (const da of (useIndicators ? ADX_D : [0])) {
        for (const dos of (useIndicators ? OS_D : [0])) {
          for (const dob of (useIndicators ? OB_D : [0])) {
            for (const dc of CONV_D) {
              const cand: Required<TunedParams> = {
                adxThreshold: base.adxThreshold + da,
                rsiOversold: base.rsiOversold + dos,
                rsiOverbought: base.rsiOverbought + dob,
                buyThreshold: base.buyThreshold + dc,
                shortThreshold: base.shortThreshold + dc,
              };
              const sc = score(train, cand, useIndicators);
              if (sc > best.s) best = { params: cand, s: sc };
            }
          }
        }
      }

      // Layer 1: shrink the winning deltas toward the defaults, then clamp.
      const tuned: Required<TunedParams> = { ...base };
      for (const k of Object.keys(base) as Array<keyof TunedParams>) {
        const delta = (best.params[k]! - base[k]!) * shrink;
        tuned[k] = clampParam(k, base[k]!, base[k]! + delta);
      }

      // Layer 2: walk-forward holdout must beat the engine default.
      const validTuned = score(valid, tuned, useIndicators);
      const validBase = score(valid, base, useIndicators);
      const improvement = validTuned - validBase;
      const pass = improvement >= PROMOTE_MARGIN;

      rows.push({
        profile,
        market_regime: regime,
        status: pass ? "active" : "shadow",
        params: tuned,
        baseline_params: base,
        sample_size: list.length,
        train_expectancy: Math.round(best.s * 1e4) / 1e4,
        valid_expectancy: Math.round(validTuned * 1e4) / 1e4,
        baseline_valid_expectancy: Math.round(validBase * 1e4) / 1e4,
        improvement: Math.round(improvement * 1e4) / 1e4,
        notes: {
          use_indicators: useIndicators,
          shrink: Math.round(shrink * 100) / 100,
          train_n: train.length,
          valid_n: valid.length,
          base_train_expectancy: Math.round(baseTrain * 1e4) / 1e4,
          taken_vs_counterfactual: `${list.filter(s => s.adx != null).length}/${list.length}`,
        },
        computed_at: new Date().toISOString(),
        promoted_at: pass ? new Date().toISOString() : null,
      });
      if (pass) promoted++;
    }

    // ── 5. Persist: retire previous actives for the buckets we re-decided ──
    if (rows.length > 0) {
      const keys = rows.map(r => `${r.profile}|${r.market_regime}`);
      const { data: actives } = await supabase
        .from("adaptive_signal_params")
        .select("id, profile, market_regime")
        .eq("status", "active");
      const staleIds = (actives ?? [])
        .filter((a: any) => keys.includes(`${a.profile}|${a.market_regime}`))
        .map((a: any) => a.id);
      if (staleIds.length > 0) {
        await supabase.from("adaptive_signal_params")
          .update({ status: "retired", retired_at: new Date().toISOString() })
          .in("id", staleIds);
      }
      const { error: insErr } = await supabase.from("adaptive_signal_params").insert(rows);
      if (insErr) throw insErr;
    }

    await recordHeartbeat(
      "tune-signal-thresholds", started, "ok",
      `${samples.length} samples · ${evaluated} buckets · ${promoted} promoted`,
    );

    return new Response(JSON.stringify({
      ok: true, samples: samples.length, buckets: evaluated, promoted, written: rows.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[tune-signal-thresholds]", msg);
    await recordHeartbeat("tune-signal-thresholds", started, "error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
