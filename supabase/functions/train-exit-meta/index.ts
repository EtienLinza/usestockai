// ============================================================================
// TRAIN-EXIT-META — nightly build of the "should I still be in this?" grid.
//
// Reads closed trades from `signal_outcomes` (which carry mfe_pct / mae_pct /
// realized_pnl_pct), buckets each by peak excursion and terminal give-back,
// and records the share that still finished profitable in each cell.
//
// The result is stored as an `exit_meta` row in `model_versions` and read live
// by `_shared/exit-meta.ts`. Cells below the minimum sample are dropped, so a
// thin grid degrades to a no-op rather than to noise.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { cellKey, MFE_EDGES, GIVEBACK_EDGES, type ExitMetaGrid } from "../_shared/exit-meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const WINDOW_DAYS = 365;
const MIN_CELL = 12;   // cells thinner than this are dropped from the grid
const MIN_TOTAL = 60;  // below this we don't publish a model at all

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
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("signal_outcomes")
      .select("realized_pnl_pct, mfe_pct, max_favorable_excursion_pct, exit_date")
      .eq("status", "closed")
      .not("realized_pnl_pct", "is", null)
      .gte("exit_date", since)
      .limit(20000);
    if (error) throw error;

    const agg = new Map<string, { n: number; wins: number }>();
    let used = 0;
    for (const r of rows ?? []) {
      const pnl = Number((r as any).realized_pnl_pct);
      const mfeRaw = (r as any).mfe_pct ?? (r as any).max_favorable_excursion_pct;
      const mfe = Number(mfeRaw);
      if (!Number.isFinite(pnl) || !Number.isFinite(mfe) || mfe <= 0) continue;
      const giveback = Math.max(0, (mfe - pnl) / mfe);
      const key = cellKey(mfe, giveback);
      const a = agg.get(key) ?? { n: 0, wins: 0 };
      a.n += 1;
      if (pnl > 0) a.wins += 1;
      agg.set(key, a);
      used += 1;
    }

    if (used < MIN_TOTAL) {
      await recordHeartbeat("train-exit-meta", started, "ok", `insufficient sample (${used}/${MIN_TOTAL})`);
      return new Response(JSON.stringify({ ok: true, trained: false, sample: used }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const grid: ExitMetaGrid = {};
    for (const [key, a] of agg.entries()) {
      if (a.n < MIN_CELL) continue;
      grid[key] = { n: a.n, winRate: Math.round((a.wins / a.n) * 10000) / 10000 };
    }
    if (Object.keys(grid).length === 0) {
      await recordHeartbeat("train-exit-meta", started, "ok", "no cell met the minimum population");
      return new Response(JSON.stringify({ ok: true, trained: false, sample: used }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retire the previous champion, publish the new one.
    await supabase.from("model_versions")
      .update({ status: "retired", retired_at: new Date().toISOString() })
      .eq("model_kind", "exit_meta").eq("status", "active");

    const { error: ie } = await supabase.from("model_versions").insert({
      model_kind: "exit_meta",
      status: "active",
      training_window_start: since,
      training_window_end: new Date().toISOString(),
      feature_list: { mfe_edges: MFE_EDGES, giveback_edges: GIVEBACK_EDGES },
      hyperparams: { min_cell: MIN_CELL, window_days: WINDOW_DAYS },
      coefficients: { grid },
      validation_metrics: { sample_size: used, cells: Object.keys(grid).length },
      deployed_at: new Date().toISOString(),
      notes: "empirical recovery-odds grid over (peak excursion, give-back)",
    });
    if (ie) throw ie;

    const ms = Date.now() - started;
    await recordHeartbeat("train-exit-meta", started, "ok",
      `sample=${used} cells=${Object.keys(grid).length} ${ms}ms`);
    return new Response(JSON.stringify({ ok: true, trained: true, sample: used, cells: grid, ms }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[train-exit-meta] fatal:", msg);
    await recordHeartbeat("train-exit-meta", started, "error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
