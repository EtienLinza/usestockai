// ============================================================================
// SCAN-WORKER — stateless deep-analysis worker. Receives a ticker chunk plus
// pre-computed macro/sector/weights context, runs the canonical evaluateSignal
// for each, and returns the resulting signal objects. No DB writes here —
// orchestrator merges and persists.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { evaluateSignal, type DataSet, type MacroContext } from "../_shared/signal-engine-v2.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import { loadCachedBars, upsertBars } from "../_shared/bars-cache.ts";
import { getSectorConvictionModifier, macroFloorAdjust, preScreen, type SectorMomentum, type MacroRegime } from "../_shared/scan-pipeline.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  tickers: string[];
  spyContext: { spyBearish: boolean; spyClose: number[] };
  macro: MacroRegime | null;
  sectorMomentum: SectorMomentum;
  weights: {
    activeWeightsId: string | null;
    calibrationCurve: Record<string, { adjust: number }>;
    strategyTilts: Record<string, { multiplier: number }>;
    strategyRegimeTilts?: Record<string, { multiplier: number; count: number }>;
    regimeFloors: Record<string, { floor: number }>;
    exitCalibration?: Record<string, { trailMultAdjust: number }>;
    tickerCalibration?: Record<string, { adjust: number }>;
  };
}

function bucketKey(c: number): string {
  if (c < 60) return "lt60";
  if (c < 70) return "60-69";
  if (c < 80) return "70-79";
  if (c < 90) return "80-89";
  return "90-100";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json() as Body;
    const { tickers, spyContext, macro, sectorMomentum, weights } = body;
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ signals: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load cached bars; fetch misses with bounded parallelism, pre-screen, and warm cache.
    const cache = await loadCachedBars(tickers);
    const misses = tickers.filter(t => !cache.has(t));
    if (misses.length > 0) {
      const PAR = 20;
      const warm: { ticker: string; bars: DataSet }[] = [];
      for (let i = 0; i < misses.length; i += PAR) {
        const slice = misses.slice(i, i + PAR);
        const fetched = await Promise.all(slice.map(t => fetchDailyHistory(t, "1y")));
        slice.forEach((t, k) => {
          const d = fetched[k];
          if (d && d.close.length >= 200 && preScreen(d)) {
            cache.set(t, d);
            warm.push({ ticker: t, bars: d });
          }
        });
      }
      if (warm.length > 0) { upsertBars(warm).catch(() => {}); }
    }

    const signals: any[] = [];
    for (const ticker of tickers) {
      const data = cache.get(ticker);
      if (!data || data.close.length < 200) continue;
      try {
        const sig = evaluateSignal(
          data, ticker,
          { spyBearish: spyContext.spyBearish },
          (macro as MacroContext | null) ?? null,
        );
        if (!sig || sig.decision === "HOLD") continue;
        const { regime, strategy, weeklyBias, profile, atrPct } = sig;
        const annualizedVol = atrPct * Math.sqrt(252) * 100;

        let conviction = sig.conviction;
        // Prefer regime×strategy tilt if we have ≥10 samples for that cell;
        // else fall back to the per-strategy tilt.
        const cellKey = `${strategy}|${regime}`;
        const cell = weights.strategyRegimeTilts?.[cellKey];
        const tilt = (cell && cell.count >= 10)
          ? cell.multiplier
          : (weights.strategyTilts[strategy]?.multiplier ?? 1.0);
        conviction = conviction * tilt;
        const adj = weights.calibrationCurve[bucketKey(conviction)]?.adjust ?? 0;
        conviction = conviction + adj;
        // Per-ticker calibration (Bayesian-shrunk vs global curve).
        const tickAdj = weights.tickerCalibration?.[ticker.toUpperCase()]?.adjust ?? 0;
        conviction = Math.max(0, Math.min(100, Math.round(conviction + tickAdj)));

        const sectorMod = getSectorConvictionModifier(ticker, sectorMomentum);
        if (sectorMod.bonus !== 0) {
          conviction = Math.max(0, Math.min(100, Math.round(conviction + sectorMod.bonus)));
        }

        // Volume z-score modifier: today's volume vs 20d mean (Phase 1 #2).
        // Strong volume confirmation on a signal day is a robust quality cue;
        // pathologically low volume is a fade tell.
        const vol = data.volume;
        if (vol.length >= 21) {
          const recent = vol.slice(-21, -1); // last 20 bars excluding today
          const today = vol[vol.length - 1] || 0;
          const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
          const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
          const std = Math.sqrt(variance);
          if (std > 0 && mean > 0) {
            const z = Math.max(-2, Math.min(2, (today - mean) / std));
            // Map z ∈ [-2, 2] → conviction adj ∈ [-5, +5]
            const volAdj = Math.round(z * 2.5);
            if (volAdj !== 0) {
              conviction = Math.max(0, Math.min(100, conviction + volAdj));
            }
          }
        }

        const baselineFloor = strategy === "mean_reversion" ? 60 : 65;
        const adaptiveFloor = weights.regimeFloors[regime]?.floor ?? baselineFloor;
        const macroAdj = macro ? macroFloorAdjust(macro.score) : 0;
        const minConviction = Math.max(50, Math.min(90, adaptiveFloor + macroAdj));
        if (conviction < minConviction) continue;

        const qualityScore = annualizedVol > 0 ? conviction / annualizedVol : conviction;

        signals.push({
          ticker,
          signal_type: sig.decision === "BUY" ? "BUY" : "SELL",
          entry_price: data.close[data.close.length - 1],
          confidence: conviction,
          regime,
          stock_profile: profile,
          weekly_bias: weeklyBias.bias,
          target_allocation: Math.abs(weeklyBias.targetAllocation),
          reasoning: sig.reasoning,
          strategy,
          qualityScore,
        });
      } catch (err) {
        console.error(`worker ${ticker}:`, err);
      }
    }

    return new Response(JSON.stringify({ signals }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: m }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
