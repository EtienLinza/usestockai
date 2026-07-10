// Portfolio-mode backtest worker. Advances one job by one CPU-budgeted chunk,
// checkpoints to DB, and self-invokes to continue. Also handles resume mode
// (called by pg_cron every minute) — picks any active job that hasn't ticked
// in > 90s and gives it a nudge.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import type { DataSet } from "../_shared/signal-engine-v2.ts";
import {
  simulateChunk, forceCloseAll, computeReport, initState,
  DEFAULT_PARAMS, type SimParams, type SimState,
} from "../_shared/backtest-sim.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CPU_BUDGET_MS = 55_000;    // per invocation
const FETCH_BATCH = 15;          // tickers fetched per tick during fetch_bars stage
const YAHOO_RANGE_YEARS = 10;    // capped range fed to yahoo (10y is max stable)

function pickYahooRange(startDate: string, endDate: string): string {
  const start = new Date(startDate).getTime();
  const now = Date.now();
  const yrs = (now - start) / (365.25 * 24 * 3600 * 1000);
  if (yrs > 10) return "max";
  if (yrs > 5) return "10y";
  if (yrs > 2) return "5y";
  if (yrs > 1) return "2y";
  return "1y";
  void endDate;
}

function sliceBarsByDate(d: DataSet, startDate: string, endDate: string): DataSet {
  // We need a 200-bar warmup BEFORE startDate for indicators. So keep all
  // bars up through startDate for lookback, then cut at endDate.
  const out: DataSet = { timestamps: [], open: [], high: [], low: [], close: [], volume: [] };
  for (let i = 0; i < d.timestamps.length; i++) {
    if (d.timestamps[i] <= endDate) {
      out.timestamps.push(d.timestamps[i]);
      out.open.push(d.open[i]);
      out.high.push(d.high[i]);
      out.low.push(d.low[i]);
      out.close.push(d.close[i]);
      out.volume.push(d.volume[i]);
    }
  }
  return out;
}

async function loadBars(service: any, tickers: string[]): Promise<Map<string, DataSet>> {
  const map = new Map<string, DataSet>();
  // Batch the .in() to avoid URL-length issues on unlimited-mode (500+ tickers)
  const BATCH = 100;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const chunk = tickers.slice(i, i + BATCH);
    const { data } = await service
      .from("backtest_bars_cache")
      .select("ticker,bars")
      .in("ticker", chunk)
      .eq("bars_version", "v1");
    for (const row of data ?? []) map.set(row.ticker, row.bars as DataSet);
  }
  return map;
}

// Load per-ticker index-membership windows so the simulator only trades a
// name on dates it was actually a constituent (e.g. no TSLA before 2010).
async function loadActiveWindows(
  service: any, indexName: string, tickers: string[],
): Promise<Map<string, { from: string; to: string | null }[]>> {
  const out = new Map<string, { from: string; to: string | null }[]>();
  if (!indexName) return out;
  const BATCH = 200;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const chunk = tickers.slice(i, i + BATCH);
    const { data } = await service
      .from("historical_constituents")
      .select("ticker, effective_from, effective_to")
      .eq("index_name", indexName)
      .in("ticker", chunk);
    for (const row of data ?? []) {
      const arr = out.get(row.ticker) ?? [];
      arr.push({ from: row.effective_from, to: row.effective_to });
      out.set(row.ticker, arr);
    }
  }
  return out;
}


async function tickJob(service: any, job: any) {
  const params: SimParams = { ...DEFAULT_PARAMS, ...(job.params || {}), starting_nav: Number(job.starting_nav) };

  // ── Stage: fetch_bars ──────────────────────────────────────────────────
  if (job.stage === "fetch_bars") {
    const cursor = job.cursor || { tickerIdx: 0 };
    const total = job.universe.length;
    const range = pickYahooRange(job.start_date, job.end_date);
    // Which tickers still need fetching? Check cache first.
    const missing: string[] = [];
    const { data: cached } = await service
      .from("backtest_bars_cache")
      .select("ticker")
      .in("ticker", job.universe)
      .eq("bars_version", "v1");
    const have = new Set((cached ?? []).map((r: any) => r.ticker));
    for (const t of job.universe) if (!have.has(t)) missing.push(t);

    if (missing.length === 0) {
      // All bars available → move to simulate stage
      await service.from("backtest_portfolio_jobs").update({
        stage: "simulate",
        status: "simulating",
        cursor: { dayIdx: 0 },
        state: initState(params),
        progress_pct: 20,
        current_step_note: `Fetched ${total}/${total} tickers. Simulating…`,
        last_tick_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { advance: true };
    }

    // Fetch next batch
    const batch = missing.slice(0, FETCH_BATCH);
    const results = await Promise.all(batch.map(t => fetchDailyHistory(t, range).catch(() => null)));
    const rows: any[] = [];
    for (let i = 0; i < batch.length; i++) {
      const d = results[i];
      if (!d || d.close.length < 50) continue;
      rows.push({
        ticker: batch[i],
        bars_version: "v1",
        first_date: d.timestamps[0],
        last_date: d.timestamps[d.timestamps.length - 1],
        bars: d,
        fetched_at: new Date().toISOString(),
      });
    }
    if (rows.length > 0) {
      await service.from("backtest_bars_cache").upsert(rows, { onConflict: "ticker,bars_version" });
    }
    const fetchedNow = have.size + rows.length;
    const pct = Math.min(19, Math.round(fetchedNow / total * 20));
    await service.from("backtest_portfolio_jobs").update({
      status: "fetching_bars",
      cursor,
      progress_pct: pct,
      current_step_note: `Fetched ${fetchedNow}/${total} tickers…`,
      last_tick_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { advance: true };
  }

  // ── Stage: simulate ────────────────────────────────────────────────────
  if (job.stage === "simulate") {
    const barsMap = await loadBars(service, job.universe);
    if (barsMap.size === 0) {
      await service.from("backtest_portfolio_jobs").update({
        status: "failed", error: "No bars available in cache.", finished_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { advance: false };
    }
    // Slice each series to the requested end date (keep pre-start bars for warmup).
    for (const [k, v] of barsMap) barsMap.set(k, sliceBarsByDate(v, job.start_date, job.end_date));
    // Build the union of trading dates that fall within [start_date, end_date].
    const dateSet = new Set<string>();
    for (const d of barsMap.values()) {
      for (const ts of d.timestamps) {
        if (ts >= job.start_date && ts <= job.end_date) dateSet.add(ts);
      }
    }
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) {
      await service.from("backtest_portfolio_jobs").update({
        status: "failed", error: "No trading days in range.", finished_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { advance: false };
    }

    const state: SimState = (job.state && job.state.cash != null) ? job.state : initState(params);
    const cursor = { dayIdx: job.cursor?.dayIdx ?? 0, totalDays: dates.length };

    const out = simulateChunk(state, barsMap, dates, params, cursor, CPU_BUDGET_MS);

    const simPct = Math.min(99, 20 + Math.round((out.cursor.dayIdx / dates.length) * 79));
    if (out.done) {
      await service.from("backtest_portfolio_jobs").update({
        stage: "finalize", status: "finalizing",
        state: out.state, cursor: out.cursor,
        progress_pct: 99, current_step_note: "Closing open positions and computing metrics…",
        last_tick_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      const currentDate = dates[Math.min(out.cursor.dayIdx, dates.length - 1)];
      await service.from("backtest_portfolio_jobs").update({
        status: "simulating",
        state: out.state, cursor: out.cursor,
        progress_pct: simPct,
        current_step_note: `Simulating… ${currentDate} (${out.cursor.dayIdx}/${dates.length} days)`,
        last_tick_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    return { advance: true };
  }

  // ── Stage: finalize ────────────────────────────────────────────────────
  if (job.stage === "finalize") {
    const barsMap = await loadBars(service, job.universe);
    for (const [k, v] of barsMap) barsMap.set(k, sliceBarsByDate(v, job.start_date, job.end_date));
    const state: SimState = job.state;
    forceCloseAll(state, barsMap);
    const report = computeReport(state, Number(job.starting_nav));
    await service.from("backtest_portfolio_jobs").update({
      status: "done", progress_pct: 100, report, state,
      current_step_note: `Done — ${report.totalTrades} trades, ${report.totalReturn}% return`,
      finished_at: new Date().toISOString(),
      last_tick_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { advance: false };
  }

  return { advance: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    let jobId: string | null = body?.job_id ?? null;

    if (!jobId) {
      // Resume mode: pick the oldest active job that hasn't ticked in > 90s.
      const cutoff = new Date(Date.now() - 90_000).toISOString();
      const { data: candidates } = await service
        .from("backtest_portfolio_jobs")
        .select("id")
        .in("status", ["queued", "fetching_bars", "simulating", "finalizing"])
        .or(`last_tick_at.is.null,last_tick_at.lt.${cutoff}`)
        .order("created_at", { ascending: true })
        .limit(1);
      jobId = candidates?.[0]?.id ?? null;
      if (!jobId) {
        return new Response(JSON.stringify({ ok: true, note: "no active jobs need resuming" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: job } = await service
      .from("backtest_portfolio_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (["done", "failed", "cancelled"].includes(job.status)) {
      return new Response(JSON.stringify({ ok: true, terminal: job.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startedAt = Date.now();
    let result: { advance: boolean } = { advance: false };
    try {
      result = await tickJob(service, job);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      await service.from("backtest_portfolio_jobs").update({
        status: "failed", error: m, finished_at: new Date().toISOString(),
      }).eq("id", job.id);
      return new Response(JSON.stringify({ error: m }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Increment CPU counter.
    const elapsed = Date.now() - startedAt;
    await service.from("backtest_portfolio_jobs").update({
      cpu_ms_spent: Number(job.cpu_ms_spent || 0) + elapsed,
    }).eq("id", job.id);

    // Self-invoke to keep going.
    if (result.advance) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/backtest-portfolio-tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
        body: JSON.stringify({ job_id: job.id }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, elapsed_ms: elapsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: m }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
