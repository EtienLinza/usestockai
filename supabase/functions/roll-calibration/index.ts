// ============================================================================
// ROLL-CALIBRATION — daily rolling calibration job.
//
// 1. Marks-to-market all open signal_outcomes (updates MFE/MAE) and force-closes
//    any open outcomes older than STALE_DAYS using the latest price.
// 2. Triggers calibrate-weights to refresh the active strategy_weights row.
// 3. Computes a fresh aggregate snapshot (win rate, avg return, Sharpe,
//    forward-projected returns over D/W/M/Q/Y) from the rolling window of
//    closed outcomes and upserts it into calibration_snapshots for today.
//
// Designed to be safe to run multiple times per day (idempotent upsert).
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WINDOW_DAYS = 90;
const STALE_DAYS = 30;          // close any open outcome held longer than this
const TRADING_DAYS_PER_YEAR = 252;
const TRADING_DAYS_PER_WEEK = 5;
const TRADING_DAYS_PER_MONTH = 21;
const TRADING_DAYS_PER_QUARTER = 63;

interface OutcomeRow {
  id: string;
  ticker: string;
  signal_type: string | null;
  entry_price: number;
  entry_date: string;
  status: string;
  realized_pnl_pct: number | null;
  exit_date: string | null;
  conviction: number | null;
  max_favorable_excursion_pct: number | null;
  max_adverse_excursion_pct: number | null;
}

function bucketLabel(c: number): string {
  if (c < 60) return "lt60";
  if (c < 70) return "60-69";
  if (c < 80) return "70-79";
  if (c < 90) return "80-89";
  return "90-100";
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ─────────────────────────────────────────────────────────────────
    // 1) Refresh open outcomes — update MFE/MAE; force-close stale ones
    // ─────────────────────────────────────────────────────────────────
    const { data: openRows } = await supabase
      .from("signal_outcomes")
      .select("id, ticker, signal_type, entry_price, entry_date, status, realized_pnl_pct, exit_date, conviction, max_favorable_excursion_pct, max_adverse_excursion_pct")
      .eq("status", "open")
      .limit(2000);

    const open = (openRows ?? []) as OutcomeRow[];
    let closedStale = 0;
    let updatedMfeMae = 0;

    // Group by ticker to dedupe price fetches
    const tickers = [...new Set(open.map(o => o.ticker))];
    const priceByTicker = new Map<string, number>();

    // Fetch in small parallel batches
    const BATCH = 6;
    for (let i = 0; i < tickers.length; i += BATCH) {
      const slice = tickers.slice(i, i + BATCH);
      await Promise.all(slice.map(async t => {
        const ds = await fetchDailyHistory(t, "1mo");
        if (ds && ds.close.length) priceByTicker.set(t, ds.close[ds.close.length - 1]);
      }));
      if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 150));
    }

    const now = Date.now();
    for (const o of open) {
      const px = priceByTicker.get(o.ticker);
      if (!px || !o.entry_price) continue;
      const entry = Number(o.entry_price);
      const pnlPct = o.signal_type === "short"
        ? ((entry - px) / entry) * 100
        : ((px - entry) / entry) * 100;
      const newMFE = Math.max(Number(o.max_favorable_excursion_pct ?? -Infinity), pnlPct);
      const newMAE = Math.min(Number(o.max_adverse_excursion_pct ?? Infinity), pnlPct);

      const ageDays = (now - new Date(o.entry_date).getTime()) / (24 * 3600 * 1000);
      if (ageDays > STALE_DAYS) {
        await supabase.from("signal_outcomes").update({
          status: "closed",
          exit_price: px,
          exit_date: new Date().toISOString(),
          exit_reason: "time_stop_rolling",
          bars_held: Math.max(1, Math.round(ageDays)),
          realized_pnl_pct: pnlPct,
          max_favorable_excursion_pct: isFinite(newMFE) ? newMFE : pnlPct,
          max_adverse_excursion_pct: isFinite(newMAE) ? newMAE : pnlPct,
        }).eq("id", o.id);
        closedStale++;
      } else {
        await supabase.from("signal_outcomes").update({
          max_favorable_excursion_pct: isFinite(newMFE) ? newMFE : pnlPct,
          max_adverse_excursion_pct: isFinite(newMAE) ? newMAE : pnlPct,
        }).eq("id", o.id);
        updatedMfeMae++;
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // 2) Trigger calibrate-weights (fire-and-forget; failure is non-fatal)
    // ─────────────────────────────────────────────────────────────────
    try {
      await supabase.functions.invoke("calibrate-weights", { body: {} });
    } catch (e) {
      console.warn("calibrate-weights invoke failed:", e instanceof Error ? e.message : e);
    }

    // ─────────────────────────────────────────────────────────────────
    // 3) Compute fresh aggregate snapshot from rolling window
    // ─────────────────────────────────────────────────────────────────
    const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();

    const { data: closedRows } = await supabase
      .from("signal_outcomes")
      .select("conviction, realized_pnl_pct, entry_date, exit_date, status")
      .eq("status", "closed")
      .gte("entry_date", sinceISO)
      .order("exit_date", { ascending: true })
      .limit(10000);

    const closed = (closedRows ?? []).filter(r => r.realized_pnl_pct != null) as OutcomeRow[];
    const totalClosed = closed.length;

    const { count: openCount } = await supabase
      .from("signal_outcomes")
      .select("*", { count: "exact", head: true })
      .eq("status", "open");

    const returns = closed.map(r => Number(r.realized_pnl_pct ?? 0));
    const wins = returns.filter(r => r > 0).length;
    const winRate = totalClosed ? (wins / totalClosed) * 100 : 0;
    const avgReturn = totalClosed ? returns.reduce((a, b) => a + b, 0) / totalClosed : 0;

    // Sharpe from per-trade returns annualized, treating each trade as a
    // single observation. Conservative — assumes trades are independent.
    const sd = stdev(returns);
    const tradesPerWeek = totalClosed > 0
      ? (totalClosed / WINDOW_DAYS) * 7
      : 0;
    const tradesPerYear = tradesPerWeek * 52;
    const sharpe = sd > 0
      ? (avgReturn / sd) * Math.sqrt(Math.max(1, tradesPerYear))
      : 0;

    // Forward projections: avg return per trade × expected trades in horizon.
    // Returns are in % so we use linear additive projection (compounding for
    // small per-trade %s overstates over long horizons; this is intentionally
    // conservative).
    const tradesPerDay = totalClosed > 0 ? totalClosed / WINDOW_DAYS : 0;
    const projDaily = avgReturn * tradesPerDay;
    const projWeekly = projDaily * TRADING_DAYS_PER_WEEK;
    const projMonthly = projDaily * TRADING_DAYS_PER_MONTH;
    const projQuarterly = projDaily * TRADING_DAYS_PER_QUARTER;
    const projYearly = projDaily * TRADING_DAYS_PER_YEAR;

    // Conviction-bucket breakdown
    const buckets: Record<string, { count: number; wins: number; sumRet: number }> = {};
    for (const r of closed) {
      const b = bucketLabel(Number(r.conviction ?? 0));
      buckets[b] ??= { count: 0, wins: 0, sumRet: 0 };
      buckets[b].count++;
      if (Number(r.realized_pnl_pct ?? 0) > 0) buckets[b].wins++;
      buckets[b].sumRet += Number(r.realized_pnl_pct ?? 0);
    }
    const conviction_buckets = Object.entries(buckets).map(([label, v]) => ({
      bucket: label,
      count: v.count,
      winRate: v.count ? (v.wins / v.count) * 100 : 0,
      avgReturnPct: v.count ? v.sumRet / v.count : 0,
    }));

    const today = new Date().toISOString().slice(0, 10);

    const snapshot = {
      snapshot_date: today,
      window_days: WINDOW_DAYS,
      closed_count: totalClosed,
      open_count: openCount ?? 0,
      win_rate: winRate,
      avg_return_pct: avgReturn,
      sharpe,
      trades_per_week: tradesPerWeek,
      projected_daily_pct: projDaily,
      projected_weekly_pct: projWeekly,
      projected_monthly_pct: projMonthly,
      projected_quarterly_pct: projQuarterly,
      projected_yearly_pct: projYearly,
      conviction_buckets,
    };

    const { error: upErr } = await supabase
      .from("calibration_snapshots")
      .upsert(snapshot, { onConflict: "snapshot_date" });
    if (upErr) throw upErr;

    await recordHeartbeat(
      "roll-calibration",
      startedAt,
      "ok",
      `closed=${totalClosed} open=${openCount ?? 0} stale_closed=${closedStale}`,
    );

    return new Response(JSON.stringify({
      ok: true,
      snapshotDate: today,
      closedStale,
      updatedMfeMae,
      totalClosed,
      openCount: openCount ?? 0,
      winRate,
      avgReturn,
      sharpe,
      projections: {
        daily: projDaily,
        weekly: projWeekly,
        monthly: projMonthly,
        quarterly: projQuarterly,
        yearly: projYearly,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("roll-calibration error:", e);
    await recordHeartbeat("roll-calibration", startedAt, "error", e?.message ?? "failed");
    return new Response(JSON.stringify({ error: e?.message ?? "failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
