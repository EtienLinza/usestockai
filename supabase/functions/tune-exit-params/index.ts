// ============================================================================
// TUNE-EXIT-PARAMS (WS3) — nightly adaptive exit-geometry learner.
//
// The engine's exit geometry (trailing-stop ATR multiple, hard-stop ATR
// multiple, take-profit ceiling) was hand-set per stock profile. This job
// learns small, clamped deltas on top of them per (profile × market regime)
// by REPLAYING each closed trade's realised excursion envelope:
//
//   MFE% (max favourable) / MAE% (max adverse) / ATR% at entry
//
// against candidate geometries:
//
//   stop%  = hardStopATRMult × ATR%
//   if MAE ≥ stop%              → trade would have stopped out at −stop%
//   else if MFE ≥ takeProfitPct → trade would have taken profit at +TP
//   else                        → trailed out at MFE − trailMult × ATR%
//                                 (floored at −stop%, capped at realised MFE)
//
// Objective = mean simulated return per trade. Two safety layers (always on):
//   1. Shrinkage toward defaults by sample size + hard per-param clamps.
//   2. Walk-forward holdout: fit on the older 60 %, validate on the recent
//      40 %. Promoted to `active` only if it beats the engine default on the
//      holdout by a margin; everything else is stored as `shadow`.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { PROFILE_PARAMS } from "../_shared/signal-engine-v2.ts";
import { clampExitParam, type TunedExitParams } from "../_shared/adaptive-exits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const WINDOW_DAYS = 240;
const MIN_SAMPLES = 30;        // per (profile × regime) bucket
const MIN_HOLDOUT = 10;
const TRAIN_FRACTION = 0.6;
const SHRINK_K = 40;
const PROMOTE_MARGIN = 0.10;   // holdout mean return must beat default by 0.10 %

interface Trade {
  ts: number;
  profile: string;
  regime: string;
  atrPct: number;   // fraction, e.g. 0.025
  mfe: number;      // % (positive)
  mae: number;      // % (positive magnitude)
  slipPct: number;  // adverse gap-through-stop slippage, %
}

type Geometry = Required<TunedExitParams>;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function baseFor(profile: string): Geometry {
  const p = (PROFILE_PARAMS as any)[profile] ?? (PROFILE_PARAMS as any).momentum;
  return {
    trailingStopATRMult: p.trailingStopATRMult,
    hardStopATRMult: p.hardStopATRMult,
    takeProfitPct: p.takeProfitPct,
  };
}

/** Replay one trade against a candidate geometry → simulated return %. */
function simulate(t: Trade, g: Geometry): number {
  const atrPct = t.atrPct * 100; // → %
  const stop = Math.max(0.5, g.hardStopATRMult * atrPct);
  if (t.mae >= stop) return -(stop + t.slipPct);
  if (t.mfe >= g.takeProfitPct) return g.takeProfitPct;
  const giveback = g.trailingStopATRMult * atrPct;
  return Math.max(-stop, Math.min(t.mfe, t.mfe - giveback));
}

function score(trades: Trade[], g: Geometry): number {
  if (trades.length === 0) return 0;
  let sum = 0;
  for (const t of trades) sum += simulate(t, g);
  return sum / trades.length;
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
    const { data: rows, error } = await supabase
      .from("signal_outcomes")
      .select("stock_profile, regime, entry_date, feature_snapshot, mfe_pct, mae_pct, max_favorable_excursion_pct, max_adverse_excursion_pct, realized_pnl_pct, slippage_bps_est")
      .eq("status", "closed")
      .gte("entry_date", sinceIso)
      .not("realized_pnl_pct", "is", null)
      .limit(5000);
    if (error) throw error;

    const trades: Trade[] = [];
    for (const r of rows ?? []) {
      const snap = (r.feature_snapshot ?? {}) as Record<string, unknown>;
      const mfe = num(r.mfe_pct) ?? num(r.max_favorable_excursion_pct);
      const mae = num(r.mae_pct) ?? num(r.max_adverse_excursion_pct);
      const atrPct = num(snap.atr_pct);
      if (mfe == null || mae == null || atrPct == null || atrPct <= 0) continue;
      const slipBps = num(r.slippage_bps_est) ?? 0;
      trades.push({
        ts: new Date(r.entry_date as string).getTime(),
        profile: String(snap._profile ?? r.stock_profile ?? "momentum").toLowerCase(),
        regime: String(snap._market_regime ?? r.regime ?? "neutral").toLowerCase(),
        atrPct,
        mfe: Math.abs(mfe),
        mae: Math.abs(mae),
        slipPct: Math.max(0, Math.min(3, slipBps / 100)),
      });
    }

    if (trades.length === 0) {
      await recordHeartbeat("tune-exit-params", started, "ok", "no excursion samples yet (cold start)");
      return new Response(JSON.stringify({ ok: true, buckets: 0, promoted: 0, reason: "cold start" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Bucket by profile × regime (+ regime-agnostic `all`) ──────────────
    const buckets = new Map<string, Trade[]>();
    const push = (k: string, t: Trade) => {
      const arr = buckets.get(k);
      if (arr) arr.push(t); else buckets.set(k, [t]);
    };
    for (const t of trades) {
      push(`${t.profile}|${t.regime}`, t);
      push(`${t.profile}|all`, t);
    }

    const TRAIL_D = [-0.6, -0.3, 0, 0.3, 0.6];
    const STOP_D = [-0.5, -0.25, 0, 0.25, 0.5];
    const TP_D = [-4, -2, 0, 2, 4];

    const out: Record<string, unknown>[] = [];
    let promoted = 0, evaluated = 0;

    for (const [key, raw] of buckets) {
      if (raw.length < MIN_SAMPLES) continue;
      const [profile, regime] = key.split("|");
      const base = baseFor(profile);
      const list = raw.slice().sort((a, b) => a.ts - b.ts);
      const cut = Math.floor(list.length * TRAIN_FRACTION);
      const train = list.slice(0, cut);
      const valid = list.slice(cut);
      if (valid.length < MIN_HOLDOUT) continue;
      evaluated++;

      const shrink = list.length / (list.length + SHRINK_K);
      let best = { g: base, s: score(train, base) };
      const baseTrain = best.s;

      for (const dt of TRAIL_D) {
        for (const ds of STOP_D) {
          for (const dp of TP_D) {
            const cand: Geometry = {
              trailingStopATRMult: base.trailingStopATRMult + dt,
              hardStopATRMult: base.hardStopATRMult + ds,
              takeProfitPct: base.takeProfitPct + dp,
            };
            const s = score(train, cand);
            if (s > best.s) best = { g: cand, s };
          }
        }
      }

      // Layer 1 — shrink winning deltas toward defaults, then hard-clamp.
      const tuned: Geometry = { ...base };
      for (const k of Object.keys(base) as Array<keyof Geometry>) {
        const delta = (best.g[k] - base[k]) * shrink;
        tuned[k] = clampExitParam(k, base[k], base[k] + delta);
      }

      // Layer 2 — walk-forward holdout must beat the engine default.
      const validTuned = score(valid, tuned);
      const validBase = score(valid, base);
      const improvement = validTuned - validBase;
      const pass = improvement >= PROMOTE_MARGIN;

      out.push({
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
          shrink: Math.round(shrink * 100) / 100,
          train_n: train.length,
          valid_n: valid.length,
          base_train_expectancy: Math.round(baseTrain * 1e4) / 1e4,
          avg_atr_pct: Math.round((list.reduce((s, t) => s + t.atrPct, 0) / list.length) * 1e4) / 1e4,
        },
        computed_at: new Date().toISOString(),
        promoted_at: pass ? new Date().toISOString() : null,
      });
      if (pass) promoted++;
    }

    if (out.length > 0) {
      const keys = out.map(r => `${r.profile}|${r.market_regime}`);
      const { data: actives } = await supabase
        .from("adaptive_exit_params")
        .select("id, profile, market_regime")
        .eq("status", "active");
      const staleIds = (actives ?? [])
        .filter((a: any) => keys.includes(`${a.profile}|${a.market_regime}`))
        .map((a: any) => a.id);
      if (staleIds.length > 0) {
        await supabase.from("adaptive_exit_params")
          .update({ status: "retired", retired_at: new Date().toISOString() })
          .in("id", staleIds);
      }
      const { error: insErr } = await supabase.from("adaptive_exit_params").insert(out);
      if (insErr) throw insErr;
    }

    await recordHeartbeat(
      "tune-exit-params", started, "ok",
      `${trades.length} trades · ${evaluated} buckets · ${promoted} promoted`,
    );

    return new Response(JSON.stringify({
      ok: true, trades: trades.length, buckets: evaluated, promoted, written: out.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[tune-exit-params]", msg);
    await recordHeartbeat("tune-exit-params", started, "error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
