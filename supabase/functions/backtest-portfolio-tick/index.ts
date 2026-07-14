// Portfolio-mode backtest worker. Advances one job by one CPU-budgeted chunk,
// checkpoints to DB, and self-invokes to continue. Also handles resume mode
// (called by pg_cron every minute) — picks any active job that hasn't ticked
// in > 90s and gives it a nudge.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchDailyHistory, fetchDailyHistoryWindow } from "../_shared/yahoo-history.ts";
import type { DataSet } from "../_shared/signal-engine-v2.ts";
import {
  simulateChunk, forceCloseAll, computeReport, initState,
  DEFAULT_PARAMS, type SimParams, type SimState, type AdaptiveInputs, type Position,
} from "../_shared/backtest-sim.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CPU_BUDGET_MS = 20_000;    // per invocation; smaller chunks avoid edge worker resource spikes
const FETCH_BATCH = 5;           // tickers fetched per tick; keeps each request under gateway limits
const SIM_DAYS_PER_TICK = 10;    // bound bars loaded per simulation invocation
const NON_TRADING_DAY_TOLERANCE_MS = 4 * 24 * 3600 * 1000;

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

function dateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isFreshThroughEnd(lastDate: string | null, endDate: string): boolean {
  if (!lastDate) return false;
  // Backtests often end on weekends/holidays or today's date before the next
  // market close exists. Accept the latest trading bar when it is close enough
  // to the requested end date; the simulator still slices by actual bar dates.
  return lastDate >= dateMinusDays(endDate, Math.ceil(NON_TRADING_DAY_TOLERANCE_MS / (24 * 3600 * 1000)));
}

function isFreshlyWidened(fetchedAt: string | null, jobCreatedAt: string): boolean {
  return !!fetchedAt && fetchedAt >= jobCreatedAt;
}

function hasEnoughWarmup(firstDate: string | null, warmupStart: string, fetchedAt: string | null, jobCreatedAt: string): boolean {
  if (!firstDate) return false;
  if (firstDate <= warmupStart) return true;
  // If this job (or a newer long-range job) already re-fetched the ticker with
  // Yahoo's widest available range, a later first_date is the listing date / data
  // availability limit, not a cache miss. Accept it to avoid refetch loops.
  return isFreshlyWidened(fetchedAt, jobCreatedAt);
}

async function loadBars(service: any, tickers: string[]): Promise<Map<string, DataSet>> {
  const map = new Map<string, DataSet>();
  // Batch the .in() to avoid URL-length issues on unlimited-mode (500+ tickers)
  const BATCH = 100;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const chunk = tickers.slice(i, i + BATCH);
    // Retry transient errors — a single failed read must not fail the whole job.
    let lastErr: any = null;
    let data: any[] | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await service
        .from("backtest_bars_cache")
        .select("ticker,bars")
        .in("ticker", chunk)
        .eq("bars_version", "v1");
      if (!res.error) { data = res.data ?? []; break; }
      lastErr = res.error;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
    if (data == null) throw new Error(`loadBars failed: ${lastErr?.message ?? "unknown"}`);
    for (const row of data) map.set(row.ticker, row.bars as DataSet);
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

function isActiveInWindow(wins: { from: string; to: string | null }[] | undefined, date: string): boolean {
  if (!wins || wins.length === 0) return true;
  for (const w of wins) {
    if (date >= w.from && (w.to == null || date < w.to)) return true;
  }
  return false;
}

function pickSimulationTickers(
  universe: string[],
  dates: string[],
  activeWindows: Map<string, { from: string; to: string | null }[]> | undefined,
  state: SimState,
): string[] {
  const selected = new Set<string>();
  for (const p of state.positions) selected.add(p.ticker);

  if (!activeWindows || activeWindows.size === 0) {
    for (const t of universe) selected.add(t);
    return Array.from(selected);
  }

  for (const t of universe) {
    const wins = activeWindows.get(t);
    if (!wins || wins.length === 0) continue;
    for (const d of dates) {
      if (isActiveInWindow(wins, d)) {
        selected.add(t);
        break;
      }
    }
  }
  return Array.from(selected);
}


async function tickJob(service: any, job: any) {
  const params: SimParams = { ...DEFAULT_PARAMS, ...(job.params || {}), starting_nav: Number(job.starting_nav) };

  // Benchmark bars (SPY + ^VIX) are always fetched alongside the universe so
  // per-day adaptive tuning has real data. Cached under the same table.
  const BENCHMARKS = ["SPY", "^VIX"];
  const universeWithBench = Array.from(new Set([...(job.universe as string[]), ...BENCHMARKS]));

  // ── Stage: fetch_bars ──────────────────────────────────────────────────
  if (job.stage === "fetch_bars") {
    const cursor = job.cursor || { tickerIdx: 0 };
    const unavailable = new Set<string>(Array.isArray(cursor.unavailable) ? cursor.unavailable : []);
    const total = universeWithBench.length;
    // Which tickers still need fetching? Cache is global & shared across jobs,
    // so a ticker is only reusable when its cached range actually covers this
    // job's required window (start_date minus ~1yr warmup → end_date). A
    // shorter cached slice (e.g. from a 2023-2026 run) is treated as missing
    // for a 1990-2026 run and re-fetched with a wider Yahoo range, then
    // upserts (overwrite) the broader bars back into the shared cache — so
    // future narrow runs benefit from the widest range ever fetched.
    const warmupStart = (() => {
      const d = new Date(job.start_date);
      d.setDate(d.getDate() - 400); // ~200 trading-day warmup buffer
      return d.toISOString().slice(0, 10);
    })();
    const missing: string[] = [];
    const have = new Set<string>();
    const CHK = 100;
    for (let i = 0; i < universeWithBench.length; i += CHK) {
      const chunk = universeWithBench.slice(i, i + CHK);
      const { data: cached } = await service
        .from("backtest_bars_cache")
        .select("ticker,first_date,last_date,fetched_at")
        .in("ticker", chunk)
        .eq("bars_version", "v1");
      for (const r of cached ?? []) {
        const widenedThisJob = isFreshlyWidened(r.fetched_at, job.created_at);
        const covers = hasEnoughWarmup(r.first_date, warmupStart, r.fetched_at, job.created_at)
                    && (isFreshThroughEnd(r.last_date, job.end_date) || widenedThisJob);
        if (covers) have.add(r.ticker);
      }
    }
    for (const t of universeWithBench) if (!have.has(t) && !unavailable.has(t)) missing.push(t);



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
    const results = await Promise.all(batch.map(t =>
      fetchDailyHistoryWindow(t, warmupStart, job.end_date, 10_000)
        .then((d) => (d && d.close.length > 0 ? d : fetchDailyHistory(t, "max", 10_000)))
        .catch(() => null)
    ));
    const rows: any[] = [];
    for (let i = 0; i < batch.length; i++) {
      const d = results[i];
      if (!d || d.close.length < 50) {
        unavailable.add(batch[i]);
        continue;
      }
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
    const nextCursor = { ...cursor, unavailable: Array.from(unavailable).sort() };
    const fetchedNow = have.size + rows.length + unavailable.size;
    const pct = Math.min(19, Math.round(fetchedNow / total * 20));
    await service.from("backtest_portfolio_jobs").update({
      status: "fetching_bars",
      cursor: nextCursor,
      progress_pct: pct,
      current_step_note: unavailable.size > 0
        ? `Fetched ${Math.min(fetchedNow, total)}/${total} tickers (${unavailable.size} unavailable)…`
        : `Fetched ${Math.min(fetchedNow, total)}/${total} tickers…`,
      last_tick_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { advance: true };
  }

  // ── Stage: simulate ────────────────────────────────────────────────────
  if (job.stage === "simulate") {
    const state: SimState = (job.state && job.state.cash != null) ? job.state : initState(params);
    const indexName = job.params?.index_name || null;
    const activeWindows = indexName
      ? await loadActiveWindows(service, indexName, job.universe)
      : undefined;

    // Load benchmarks first and use SPY as the trading calendar. This avoids
    // parsing every ticker's full JSON history just to build the date union.
    const benchmarkBars = await loadBars(service, BENCHMARKS);
    const spyBars = benchmarkBars.get("SPY") ?? null;
    const vixBars = benchmarkBars.get("^VIX") ?? null;
    const dates = (spyBars?.timestamps ?? []).filter((ts) => ts >= job.start_date && ts <= job.end_date);
    if (dates.length === 0) {
      await service.from("backtest_portfolio_jobs").update({
        status: "failed", error: "No benchmark trading calendar available in cache.", finished_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { advance: false };
    }

    const cursor = { dayIdx: job.cursor?.dayIdx ?? 0, totalDays: dates.length };
    const simDates = dates.slice(cursor.dayIdx, Math.min(dates.length, cursor.dayIdx + SIM_DAYS_PER_TICK));
    const simTickers = pickSimulationTickers(job.universe, simDates, activeWindows, state);
    const barsMap = await loadBars(service, simTickers);
    if (barsMap.size === 0 && state.positions.length > 0) {
      await service.from("backtest_portfolio_jobs").update({
        status: "failed", error: "No bars available for active simulation tickers.", finished_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { advance: false };
    }

    // Slice each loaded series to the requested end date (keep pre-start bars for warmup).
    for (const [k, v] of barsMap) barsMap.set(k, sliceBarsByDate(v, job.start_date, job.end_date));

    // Load active nightly calibration weights (same source live uses).
    const { data: weightsRow } = await service
      .from("strategy_weights")
      .select("regime_floors, calibration_curve, strategy_tilts, ticker_calibration")
      .eq("is_active", true)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const adaptive: AdaptiveInputs = {
      spyBars: spyBars ? sliceBarsByDate(spyBars, job.start_date, job.end_date) : null,
      vixBars: vixBars ? sliceBarsByDate(vixBars, job.start_date, job.end_date) : null,
      regimeFloors: (weightsRow?.regime_floors as Record<string, number> | null) ?? null,
      strategyTilts: (weightsRow?.strategy_tilts as any) ?? null,
      calibrationCurve: (weightsRow?.calibration_curve as any) ?? null,
      tickerCalibration: (weightsRow?.ticker_calibration as any) ?? null,
    };

    const localCursor = { dayIdx: 0, totalDays: simDates.length };
    const out = simulateChunk(state, barsMap, simDates, params, localCursor, CPU_BUDGET_MS, activeWindows, adaptive);
    const nextDayIdx = Math.min(dates.length, cursor.dayIdx + out.cursor.dayIdx);



    const simPct = Math.min(99, 20 + Math.round((nextDayIdx / dates.length) * 79));
    if (nextDayIdx >= dates.length) {
      await service.from("backtest_portfolio_jobs").update({
        stage: "finalize", status: "finalizing",
        state: out.state, cursor: { dayIdx: nextDayIdx, totalDays: dates.length },
        progress_pct: 99, current_step_note: "Closing open positions and computing metrics…",
        last_tick_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      const currentDate = dates[Math.min(nextDayIdx, dates.length - 1)];
      await service.from("backtest_portfolio_jobs").update({
        status: "simulating",
        state: out.state, cursor: { dayIdx: nextDayIdx, totalDays: dates.length },
        progress_pct: simPct,
        current_step_note: `Simulating… ${currentDate} (${nextDayIdx}/${dates.length} days)`,
        last_tick_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    return { advance: true };
  }

  // ── Stage: finalize ────────────────────────────────────────────────────
  if (job.stage === "finalize") {
    const state: SimState = job.state;
    const openTickers = Array.from(new Set((state.positions ?? []).map((p: Position) => p.ticker)));
    const barsMap = await loadBars(service, openTickers);
    for (const [k, v] of barsMap) barsMap.set(k, sliceBarsByDate(v, job.start_date, job.end_date));
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

    // Do not recursively self-invoke. Cron/client nudges advance the job in
    // bounded chunks, avoiding overlapping workers and runaway server cost.

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
