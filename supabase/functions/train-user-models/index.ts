// ============================================================================
// TRAIN-USER-MODELS — Milestone 3 nightly cron.
//
// For every user with an `autotrade_settings` row:
//   1. Load their closed `virtual_positions` from the last 180 days.
//   2. Assign an archetype from the shared K=4 seed set (cold-start default).
//   3. Fit a Bayesian-shrunk personalisation blob (sizing scalar, filter
//      threshold, per-strategy bias, per-regime bias, Beta-Binomial priors,
//      dynamic k, consistency score).
//   4. Upsert into `user_model_state`.
//
// Also seeds the four default archetypes on first run if the table is empty.
// Fails soft — a user with <3 closed trades still gets an archetype-only
// cold-start row; users with none are skipped.
//
// Aligned with the plan: pure JS, no deps, ~50 ms per user. One nightly cron.
// Everything else (scanner-side application of these tilts, online updates
// after every close) is a downstream integration.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import {
  DEFAULT_ARCHETYPES,
  assignArchetype,
  fitUserModel,
  type ArchetypeRow,
  type ClosedTrade,
  type UserContextFeatures,
} from "../_shared/user-models.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const WINDOW_DAYS = 180;

function riskOrd(profile: string | null | undefined): number {
  switch ((profile || "").toLowerCase()) {
    case "conservative": return 0;
    case "aggressive": return 2;
    default: return 1;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireCronOrUser(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const started = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Ensure archetypes exist.
    const { data: archRows } = await supabase.from("user_archetypes").select("*");
    if (!archRows || archRows.length === 0) {
      const seeds = DEFAULT_ARCHETYPES.map((a) => ({
        archetype_key: a.archetype_key,
        display_name: a.display_name,
        description: a.description,
        centroid: a.centroid as unknown as Record<string, unknown>,
        default_strategy_bias: a.default_strategy_bias,
        default_regime_bias: a.default_regime_bias,
        default_sizing_scalar: a.default_sizing_scalar,
        default_filter_threshold: a.default_filter_threshold,
      }));
      const { error: seedErr } = await supabase.from("user_archetypes").insert(seeds);
      if (seedErr) console.warn("[archetype seed] insert:", seedErr.message);
    }

    const { data: freshArch } = await supabase.from("user_archetypes").select("*");
    const archetypes: ArchetypeRow[] = (freshArch ?? []).map((r: any) => ({
      archetype_key: r.archetype_key,
      centroid: r.centroid ?? {},
      default_strategy_bias: r.default_strategy_bias ?? {},
      default_regime_bias: r.default_regime_bias ?? {},
      default_sizing_scalar: Number(r.default_sizing_scalar ?? 1.0),
      default_filter_threshold: Number(r.default_filter_threshold ?? 68),
    }));

    // 2. Compute global baselines from all closed positions in the window.
    const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: allClosed } = await supabase
      .from("virtual_positions")
      .select("user_id, entry_strategy, entry_conviction, entry_price, exit_price, pnl, closed_at, entry_profile")
      .eq("status", "closed")
      .gte("closed_at", sinceIso)
      .limit(50000);

    const closed = (allClosed ?? []) as any[];
    const winsGlobal = closed.filter((r) => Number(r.pnl) > 0).length;
    const globalWinRate = closed.length > 0 ? winsGlobal / closed.length : 0.5;

    const stratWR: Record<string, { w: number; n: number }> = {};
    const regWR: Record<string, { w: number; n: number }> = {};
    for (const r of closed) {
      const s = r.entry_strategy || "none";
      const rg = r.entry_profile || "";
      const win = Number(r.pnl) > 0;
      (stratWR[s] ??= { w: 0, n: 0 }); stratWR[s].n++; if (win) stratWR[s].w++;
      if (rg) { (regWR[rg] ??= { w: 0, n: 0 }); regWR[rg].n++; if (win) regWR[rg].w++; }
    }
    const globalStrategyWR: Record<string, number> = {};
    for (const [k, v] of Object.entries(stratWR)) if (v.n >= 20) globalStrategyWR[k] = v.w / v.n;
    const globalRegimeWR: Record<string, number> = {};
    for (const [k, v] of Object.entries(regWR)) if (v.n >= 20) globalRegimeWR[k] = v.w / v.n;

    // 3. For each user, fit their per-user layer.
    const { data: settings } = await supabase
      .from("autotrade_settings")
      .select("user_id, starting_nav, risk_profile, max_positions, max_single_name_pct, min_conviction");

    let fitted = 0, coldStart = 0, skipped = 0;
    for (const s of (settings ?? []) as any[]) {
      const userId = s.user_id as string;
      const { data: trades } = await supabase
        .from("virtual_positions")
        .select("entry_strategy, entry_conviction, entry_profile, entry_price, exit_price, pnl, created_at, closed_at")
        .eq("user_id", userId)
        .eq("status", "closed")
        .gte("closed_at", sinceIso)
        .limit(2000);

      const closedForUser = (trades ?? []) as any[];
      const converted: ClosedTrade[] = closedForUser.map((t) => ({
        strategy: t.entry_strategy ?? null,
        regime: t.entry_profile ?? null,
        profile: t.entry_profile ?? null,
        conviction: t.entry_conviction != null ? Number(t.entry_conviction) : null,
        pnl_pct: t.entry_price > 0 && t.exit_price != null
          ? ((Number(t.exit_price) - Number(t.entry_price)) / Number(t.entry_price)) * 100
          : Number(t.pnl ?? 0),
        closed_at: t.closed_at,
      })).filter((t) => Number.isFinite(t.pnl_pct));

      const wins = converted.filter((t) => t.pnl_pct > 0).length;

      // Real hold days from created_at → closed_at when both present, else fallback.
      const holdDays = closedForUser
        .filter((r) => r.closed_at && r.created_at)
        .map((r) => {
          const dt = (new Date(r.closed_at).getTime() - new Date(r.created_at).getTime()) / (24 * 3600 * 1000);
          return Number.isFinite(dt) && dt > 0 ? dt : 0;
        })
        .filter((d) => d > 0 && d < 365);

      const ctx: UserContextFeatures = {
        starting_nav: Number(s.starting_nav ?? 10000),
        risk_profile_ord: riskOrd(s.risk_profile),
        max_positions: Number(s.max_positions ?? 8),
        max_single_name_pct: Number(s.max_single_name_pct ?? 20),
        min_conviction: Number(s.min_conviction ?? 68),
        avg_hold_days: holdDays.length ? holdDays.reduce((a, b) => a + b, 0) / holdDays.length : 5,
        trade_frequency: converted.length / Math.max(1, WINDOW_DAYS / 7),
        win_rate: converted.length ? wins / converted.length : globalWinRate,
        avg_return_pct: converted.length ? converted.reduce((a, b) => a + b.pnl_pct, 0) / converted.length : 0,
      };

      const archetype = assignArchetype(ctx, archetypes);

      // Cold-start: <3 closed trades → archetype-only defaults, no shrinkage math.
      if (converted.length < 3) {
        await supabase.from("user_model_state").upsert({
          user_id: userId,
          archetype_key: archetype?.archetype_key ?? null,
          sizing_scalar: archetype?.default_sizing_scalar ?? 1.0,
          filter_threshold: archetype?.default_filter_threshold ?? 68,
          strategy_bias: archetype?.default_strategy_bias ?? {},
          regime_bias: archetype?.default_regime_bias ?? {},
          feature_bias: {},
          beta_binomial_priors: {},
          shrinkage_k: 30,
          sample_size: converted.length,
          consistency_score: null,
          last_trained_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        coldStart++;
        continue;
      }

      const fit = fitUserModel(converted, ctx, { globalWinRate, globalStrategyWR, globalRegimeWR }, archetype);
      const { error: upErr } = await supabase.from("user_model_state").upsert({
        user_id: userId,
        archetype_key: fit.archetype_key,
        sizing_scalar: fit.sizing_scalar,
        filter_threshold: fit.filter_threshold,
        strategy_bias: fit.strategy_bias,
        regime_bias: fit.regime_bias,
        feature_bias: {},
        beta_binomial_priors: fit.beta_binomial_priors,
        shrinkage_k: fit.shrinkage_k,
        sample_size: fit.sample_size,
        consistency_score: fit.consistency_score,
        last_trained_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (upErr) { console.warn("[user fit] upsert", userId, upErr.message); skipped++; continue; }
      fitted++;
    }

    const ms = Date.now() - started;
    await recordHeartbeat("train-user-models", started, "ok",
      `fitted=${fitted} cold=${coldStart} skipped=${skipped}`);
    return new Response(JSON.stringify({
      ok: true,
      global_win_rate: Math.round(globalWinRate * 1000) / 10,
      archetypes: archetypes.length,
      users_processed: (settings ?? []).length,
      fitted, cold_start: coldStart, skipped, ms,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[train-user-models] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
