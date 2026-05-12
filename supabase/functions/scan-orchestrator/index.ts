// ============================================================================
// SCAN-ORCHESTRATOR — single client invoke that drives the whole scan:
//   1. Discover universe (cached for 24h)
//   2. Compute macro + sector momentum + load adaptive weights (parallel)
//   3. Pre-screen using cached bars (fast, no AI math)
//   4. Fan out scan-worker invocations in parallel for survivors
//   5. Merge signals, upsert live_signals, log signal_outcomes
//
// Live progress is written to scan_runs so the dashboard can poll/realtime.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import {
  discoverTickers, computeMacroRegime, fetchSectorMomentum, preScreen,
  type MacroRegime, type SectorMomentum,
} from "../_shared/scan-pipeline.ts";
import { loadCachedBars } from "../_shared/bars-cache.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { isMarketHoliday, etMinuteOfDay, etDayOfWeek } from "../_shared/market-calendar.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const WORKER_CHUNK = 80;        // tickers per worker call
const WORKER_PARALLELISM = 10;  // concurrent worker invocations
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireCronOrUser(req, { allowAuthenticatedUser: true });
  if (denied) return denied;

  const heartbeatStart = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Create a scan_runs row up front for live progress
  const { data: runRow } = await supabase
    .from("scan_runs")
    .insert({ phase: "discovering", processed: 0, total: 0, signals_found: 0 })
    .select("id")
    .single();
  const runId = (runRow as any)?.id ?? null;

  const setProgress = async (patch: Record<string, unknown>) => {
    if (!runId) return;
    await supabase.from("scan_runs").update(patch).eq("id", runId);
  };

  try {
    const body = await req.json().catch(() => ({}));
    const refresh = body?.refresh === true;
    const mode: "premarket" | "live" = body?.mode === "premarket" ? "premarket" : "live";

    // Pre-market mode: only run on real NYSE trading days, and only inside the
    // 08:30–09:25 ET window. The cron fires twice (covering EST + EDT) — the
    // off-DST invocation no-ops here so we never double-scan.
    if (mode === "premarket") {
      const now = new Date();
      const dow = etDayOfWeek(now);
      const min = etMinuteOfDay(now);
      const skip =
        dow === 0 || dow === 6 ||
        isMarketHoliday(now) ||
        min < 8 * 60 + 30 || min > 9 * 60 + 25;
      if (skip) {
        await setProgress({ phase: "skipped", finished_at: new Date().toISOString() });
        await recordHeartbeat("scan-orchestrator", heartbeatStart, "ok",
          `premarket skip dow=${dow} etMin=${min}`);
        return new Response(JSON.stringify({ ok: true, skipped: true, runId, mode }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── 1. Discovery (reuse most-recent scan_universe_log if fresh) ──────
    let allTickers: string[] = [];
    let discoveryBreakdown: any = null;
    if (!refresh) {
      const { data: lastUni } = await supabase
        .from("scan_universe_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastUni && Date.now() - new Date((lastUni as any).created_at).getTime() < DISCOVERY_TTL_MS) {
        // We need the tickers themselves — discovery log only stores counts/samples.
        // So re-run discovery only if we don't have a cached ticker list (keep simple: always rediscover but it's <2s).
      }
    }
    const disco = await discoverTickers();
    allTickers = disco.tickers;
    discoveryBreakdown = disco.breakdown;

    await setProgress({ universe_size: allTickers.length, total: allTickers.length, phase: "context" });

    // Log universe attribution (fire-and-forget)
    try {
      await supabase.from("scan_universe_log").insert({
        total_tickers: allTickers.length,
        index_count: discoveryBreakdown.indexCount,
        screener_count: discoveryBreakdown.screenerCount,
        overlap_count: discoveryBreakdown.overlapCount,
        fallback_used: discoveryBreakdown.fallbackUsed,
        source_breakdown: discoveryBreakdown.perScreener,
        sample_tickers: discoveryBreakdown.sampleTickers,
      });
    } catch (e) { console.warn("scan_universe_log insert", e); }

    // ─── 2. Context: macro + sector + weights in parallel ─────────────────
    const [macro, sectorMomentum, weightsRow] = await Promise.all([
      computeMacroRegime(),
      fetchSectorMomentum(),
      supabase.from("strategy_weights")
        .select("id, calibration_curve, strategy_tilts, regime_floors, exit_calibration, ticker_calibration, notes")
        .eq("is_active", true).maybeSingle()
        .then((r: any) => r.data ?? null),
    ]);
    const spyBearish = macro.score <= 40;
    const weights = {
      activeWeightsId: weightsRow?.id ?? null,
      calibrationCurve: weightsRow?.calibration_curve ?? {},
      strategyTilts: weightsRow?.strategy_tilts ?? {},
      strategyRegimeTilts: weightsRow?.notes?.strategy_regime_tilts ?? {},
      regimeFloors: weightsRow?.regime_floors ?? {},
      exitCalibration: weightsRow?.exit_calibration ?? {},
      tickerCalibration: weightsRow?.ticker_calibration ?? {},
    };
    console.log(`Macro=${macro.score}/${macro.label} sectors=${Object.keys(sectorMomentum).length}`);

    await setProgress({ phase: "prescreening" });

    // ─── 3. Pre-screen using cached bars (no inline fetch — defer misses to workers) ──
    const cache = await loadCachedBars(allTickers);
    const cacheHit = cache.size;
    const survivors: string[] = [];
    let prescreenRejected = 0;
    for (const t of allTickers) {
      const data = cache.get(t);
      if (!data) {
        // Cache miss: forward to workers; they'll fetch + pre-screen + evaluate.
        survivors.push(t);
        continue;
      }
      if (preScreen(data)) survivors.push(t);
      else prescreenRejected++;
    }
    console.log(`pre-screen: hit=${cacheHit} survivors=${survivors.length} rejected=${prescreenRejected} misses-deferred=${allTickers.length - cacheHit}`);

    // Fire-and-forget: warm the cache for next run (don't await).
    try {
      const cs = Deno.env.get("CRON_SECRET");
      supabase.functions.invoke("prefetch-bars", {
        body: {},
        headers: cs ? { "x-cron-secret": cs } : {},
      }).catch(() => {});
    } catch (_) {}

    await setProgress({
      survivors: survivors.length, total: survivors.length,
      processed: 0, phase: "analyzing",
    });
    console.log(`Survivors: ${survivors.length} of ${allTickers.length}`);

    // ─── 4. Fan out workers in parallel ───────────────────────────────────
    const chunks: string[][] = [];
    for (let i = 0; i < survivors.length; i += WORKER_CHUNK) {
      chunks.push(survivors.slice(i, i + WORKER_CHUNK));
    }

    const workerPayloadBase = {
      spyContext: { spyBearish, spyClose: macro.spyClose.slice(-30) },
      macro,
      sectorMomentum,
      weights,
      mode,
    };

    const allSignals: any[] = [];
    let processed = 0;
    for (let i = 0; i < chunks.length; i += WORKER_PARALLELISM) {
      const wave = chunks.slice(i, i + WORKER_PARALLELISM);
      const results = await Promise.all(wave.map(async (chunk) => {
        const { data, error } = await supabase.functions.invoke("scan-worker", {
          body: { ...workerPayloadBase, tickers: chunk },
        });
        if (error) { console.error("worker err", error); return []; }
        return (data?.signals ?? []) as any[];
      }));
      for (const sigs of results) allSignals.push(...sigs);
      processed += wave.reduce((a, c) => a + c.length, 0);
      await setProgress({ processed, signals_found: allSignals.length });
    }

    // ─── 5. Persist signals + outcomes ────────────────────────────────────
    allSignals.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

    if (allSignals.length > 0) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const rows = allSignals.map(s => ({
        ticker: s.ticker, signal_type: s.signal_type,
        entry_price: s.entry_price, confidence: s.confidence,
        regime: s.regime, stock_profile: s.stock_profile,
        weekly_bias: s.weekly_bias, target_allocation: s.target_allocation,
        reasoning: s.reasoning, strategy: s.strategy,
        expires_at: expiresAt,
      }));
      const { data: upserted, error } = await supabase
        .from("live_signals").upsert(rows, { onConflict: "ticker" }).select("id, ticker");
      if (error) console.error("live_signals upsert err:", error);

      try {
        const idByTicker = new Map<string, string>();
        (upserted ?? []).forEach((r: any) => idByTicker.set(r.ticker, r.id));
        const tickers = allSignals.map(s => s.ticker);
        const { data: existingOpen } = await supabase
          .from("signal_outcomes").select("ticker").eq("status", "open").in("ticker", tickers);
        const openSet = new Set((existingOpen ?? []).map((r: any) => r.ticker));
        const outcomeRows = allSignals.filter(s => !openSet.has(s.ticker)).map(s => ({
          signal_id: idByTicker.get(s.ticker) ?? null,
          ticker: s.ticker,
          signal_type: s.signal_type === "BUY" ? "long" : "short",
          regime: s.regime, stock_profile: s.stock_profile,
          weekly_bias: s.weekly_bias, conviction: s.confidence,
          strategy: s.strategy, entry_thesis: s.strategy,
          contributing_rules: { reasoning: s.reasoning },
          entry_price: s.entry_price,
          spy_at_entry: macro.spyClose[macro.spyClose.length - 1] ?? null,
          macro_score: macro.score, macro_label: macro.label,
          weights_id: weights.activeWeightsId, status: "open",
        }));
        if (outcomeRows.length > 0) {
          const { error: oe } = await supabase.from("signal_outcomes").insert(outcomeRows);
          if (oe) console.error("signal_outcomes insert err:", oe);
        }
      } catch (e) { console.error("outcome logging:", e); }
    }

    const elapsed = Date.now() - heartbeatStart;
    await setProgress({
      phase: "done", finished_at: new Date().toISOString(),
      signals_found: allSignals.length, processed: survivors.length,
    });
    await recordHeartbeat("scan-orchestrator", heartbeatStart, "ok",
      `signals=${allSignals.length} survivors=${survivors.length}/${allTickers.length} ${elapsed}ms`);

    return new Response(JSON.stringify({
      ok: true, runId,
      signals: allSignals.length,
      survivors: survivors.length,
      universe: allTickers.length,
      cacheHitRate: allTickers.length > 0 ? cacheHit / allTickers.length : 0,
      elapsed,
      macro: {
        score: macro.score, label: macro.label,
        trend: macro.trend, volatility: macro.volatility,
        breadth: macro.breadth, credit: macro.credit,
        vixLevel: macro.vixLevel, notes: macro.notes,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("orchestrator error:", e);
    await setProgress({ phase: "error", error: m, finished_at: new Date().toISOString() });
    await recordHeartbeat("scan-orchestrator", heartbeatStart, "error", m);
    return new Response(JSON.stringify({ error: m, runId }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
