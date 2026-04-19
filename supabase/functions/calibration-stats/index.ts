import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PHASE A — Calibration stats: read closed signal_outcomes and produce
// the *real* conviction → win-rate curve, plus per-strategy and per-regime
// breakdowns. This is the substrate Phase B will read to recalibrate.

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days") ?? "90")));
    const sinceISO = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const { data: closed, error } = await supabase
      .from("signal_outcomes")
      .select("*")
      .eq("status", "closed")
      .gte("entry_date", sinceISO)
      .order("entry_date", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const { data: open } = await supabase
      .from("signal_outcomes")
      .select("id, ticker, conviction, regime, strategy, entry_date, max_favorable_excursion_pct, max_adverse_excursion_pct")
      .eq("status", "open")
      .order("entry_date", { ascending: false })
      .limit(500);

    const closedRows = closed ?? [];

    // Conviction buckets: 60-69, 70-79, 80-89, 90-100
    const buckets = [
      { label: "60-69", min: 60, max: 70 },
      { label: "70-79", min: 70, max: 80 },
      { label: "80-89", min: 80, max: 90 },
      { label: "90-100", min: 90, max: 101 },
    ].map(b => {
      const inB = closedRows.filter(r => Number(r.conviction) >= b.min && Number(r.conviction) < b.max);
      const wins = inB.filter(r => Number(r.realized_pnl_pct ?? 0) > 0).length;
      const avgRet = inB.length ? inB.reduce((s, r) => s + Number(r.realized_pnl_pct ?? 0), 0) / inB.length : 0;
      return {
        bucket: b.label,
        count: inB.length,
        winRate: inB.length ? (wins / inB.length) * 100 : 0,
        avgReturnPct: avgRet,
        // Calibration target: conviction 75 should mean ~75% win rate
        expectedWinRate: (b.min + b.max - 1) / 2,
      };
    });

    // Per-strategy
    const strategies: Record<string, { count: number; wins: number; sumRet: number }> = {};
    for (const r of closedRows) {
      const k = r.strategy ?? "unknown";
      strategies[k] ??= { count: 0, wins: 0, sumRet: 0 };
      strategies[k].count++;
      if (Number(r.realized_pnl_pct ?? 0) > 0) strategies[k].wins++;
      strategies[k].sumRet += Number(r.realized_pnl_pct ?? 0);
    }
    const byStrategy = Object.entries(strategies).map(([k, v]) => ({
      strategy: k,
      count: v.count,
      winRate: v.count ? (v.wins / v.count) * 100 : 0,
      avgReturnPct: v.count ? v.sumRet / v.count : 0,
    })).sort((a, b) => b.count - a.count);

    // Per-regime
    const regimes: Record<string, { count: number; wins: number; sumRet: number }> = {};
    for (const r of closedRows) {
      const k = r.regime ?? "unknown";
      regimes[k] ??= { count: 0, wins: 0, sumRet: 0 };
      regimes[k].count++;
      if (Number(r.realized_pnl_pct ?? 0) > 0) regimes[k].wins++;
      regimes[k].sumRet += Number(r.realized_pnl_pct ?? 0);
    }
    const byRegime = Object.entries(regimes).map(([k, v]) => ({
      regime: k,
      count: v.count,
      winRate: v.count ? (v.wins / v.count) * 100 : 0,
      avgReturnPct: v.count ? v.sumRet / v.count : 0,
    })).sort((a, b) => b.count - a.count);

    // Exit reason mix
    const exits: Record<string, number> = {};
    for (const r of closedRows) {
      const k = r.exit_reason ?? "unknown";
      exits[k] = (exits[k] ?? 0) + 1;
    }
    const exitMix = Object.entries(exits)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Aggregate metrics
    const totalClosed = closedRows.length;
    const wins = closedRows.filter(r => Number(r.realized_pnl_pct ?? 0) > 0).length;
    const winRate = totalClosed ? (wins / totalClosed) * 100 : 0;
    const avgReturn = totalClosed
      ? closedRows.reduce((s, r) => s + Number(r.realized_pnl_pct ?? 0), 0) / totalClosed
      : 0;
    const avgMFE = totalClosed
      ? closedRows.reduce((s, r) => s + Number(r.max_favorable_excursion_pct ?? 0), 0) / totalClosed
      : 0;
    const avgMAE = totalClosed
      ? closedRows.reduce((s, r) => s + Number(r.max_adverse_excursion_pct ?? 0), 0) / totalClosed
      : 0;

    return new Response(JSON.stringify({
      windowDays: days,
      summary: {
        totalClosed,
        totalOpen: open?.length ?? 0,
        winRate,
        avgReturnPct: avgReturn,
        avgMFE,
        avgMAE,
      },
      convictionBuckets: buckets,
      byStrategy,
      byRegime,
      exitMix,
      recentOpen: (open ?? []).slice(0, 50),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("calibration-stats error:", e);
    return new Response(JSON.stringify({ error: e.message ?? "failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
