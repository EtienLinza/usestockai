// ============================================================================
// ANALYZE-TICKER — on-demand single-ticker analysis. Runs the canonical
// signal engine for any ticker and returns BUY/SELL/HOLD plus a rich set of
// derived technical stats so the UI always shows real numbers (never empty).
// Does NOT persist to live_signals — purely ephemeral.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { evaluateSignal, type MacroContext } from "../_shared/signal-engine-v2.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import {
  calculateRSI, calculateMACD, calculateSMA, calculateATR, calculateADX,
} from "../_shared/indicators.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const TICKER_RE = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

async function fetchSpyContext(): Promise<{ spyBearish: boolean }> {
  try {
    const spy = await fetchDailyHistory("SPY", "1y");
    if (!spy || spy.close.length < 200) return { spyBearish: false };
    const closes = spy.close;
    const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    const last = closes[closes.length - 1];
    return { spyBearish: last < sma200 };
  } catch {
    return { spyBearish: false };
  }
}

const lastFinite = (arr: number[]): number | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i];
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireCronOrUser(req, { allowAuthenticatedUser: true });
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker ?? "").trim().toUpperCase();
    if (!ticker || !TICKER_RE.test(ticker)) {
      return new Response(JSON.stringify({ error: "Invalid ticker" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await fetchDailyHistory(ticker, "1y");
    if (!data || data.close.length < 30) {
      return new Response(JSON.stringify({
        ticker, decision: "HOLD", confidence: 0,
        reasoning: "Unable to fetch enough price history for this ticker",
        insufficientData: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Derived technical stats (always populated when we have bars) ------
    const { close, high, low, volume } = data;
    const last = close[close.length - 1];
    const prev = close[close.length - 2] ?? last;
    const changePct = prev > 0 ? ((last - prev) / prev) * 100 : 0;

    const rsi = lastFinite(calculateRSI(close, 14));
    const macd = calculateMACD(close);
    const macdHist = lastFinite(macd.histogram);
    const macdLine = lastFinite(macd.macd);
    const macdSig = lastFinite(macd.signal);
    const sma20 = lastFinite(calculateSMA(close, 20));
    const sma50 = lastFinite(calculateSMA(close, 50));
    const sma200 = close.length >= 200 ? lastFinite(calculateSMA(close, 200)) : null;
    const atrArr = calculateATR(high, low, close, 14);
    const atrLast = lastFinite(atrArr) ?? 0;
    const atrPctLast = last > 0 ? (atrLast / last) * 100 : 0;
    const adxArr = calculateADX(high, low, close, 14);
    const adxLast = lastFinite(adxArr.adx);

    // 52-week range from up to 1y of daily bars
    const hi52 = Math.max(...high);
    const lo52 = Math.min(...low);
    const rangePos = hi52 > lo52 ? ((last - lo52) / (hi52 - lo52)) * 100 : 50;

    // Volume vs 20-bar average
    const recentVol = volume.slice(-21, -1);
    const avgVol = recentVol.length ? recentVol.reduce((a, b) => a + b, 0) / recentVol.length : 0;
    const volRatio = avgVol > 0 ? (volume[volume.length - 1] || 0) / avgVol : null;

    // Trend label from SMA stack
    let trend = "neutral";
    if (sma50 && sma200 && last) {
      if (last > sma50 && sma50 > sma200) trend = "uptrend";
      else if (last < sma50 && sma50 < sma200) trend = "downtrend";
      else if (sma200 && last > sma200) trend = "mixed bullish";
      else trend = "mixed bearish";
    } else if (sma50) {
      trend = last > sma50 ? "short-term uptrend" : "short-term downtrend";
    }

    const stats = {
      changePct,
      rsi,
      macdHist, macdLine, macdSignal: macdSig,
      sma20, sma50, sma200,
      adx: adxLast,
      atr: atrLast,
      atrPctDaily: atrPctLast,
      annualizedVolPct: atrPctLast * Math.sqrt(252),
      high52w: hi52,
      low52w: lo52,
      rangePosition: rangePos,
      volume: volume[volume.length - 1] ?? null,
      avgVolume20: avgVol || null,
      volRatio,
      trend,
      bars: close.length,
    };

    // ---- Engine signal (requires ≥200 bars) -------------------------------
    if (close.length < 200) {
      return new Response(JSON.stringify({
        ticker, decision: "HOLD", confidence: 0, currentPrice: last,
        reasoning: `Only ${close.length} daily bars available — full signal engine needs ≥200.`,
        stats,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const spyCtx = await fetchSpyContext();
    const macro: MacroContext | null = null;
    const sig = evaluateSignal(data, ticker, spyCtx, macro);

    if (!sig) {
      return new Response(JSON.stringify({
        ticker, decision: "HOLD", confidence: 0, currentPrice: last,
        reasoning: "Signal engine could not evaluate this ticker.",
        stats,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const atrMult = sig.blendedParams?.hardStopATRMult ?? 2.5;
    const tpPct = sig.blendedParams?.takeProfitPct ?? 10;
    const decision = sig.decision === "SHORT" ? "SELL" : sig.decision;
    const dir = decision === "BUY" ? 1 : decision === "SELL" ? -1 : 0;

    const biasDir = sig.weeklyBias.bias === "long" ? 1 : sig.weeklyBias.bias === "short" ? -1 : 0;
    const useDir = dir !== 0 ? dir : biasDir;
    const atrForStop = sig.atr > 0 ? sig.atr : atrLast;
    const stop = useDir !== 0 && atrForStop > 0 ? last - useDir * atrMult * atrForStop : null;
    const target = useDir !== 0 ? last * (1 + useDir * (tpPct / 100)) : null;

    // Derived technical confidence — used when the engine gates conviction to
    // 0 (HOLD due to bias mismatch / weak weekly / sub-threshold). Gives the
    // UI a meaningful 0–100 read of how strong the technicals look right now.
    const techConfidence = (() => {
      const parts: number[] = [];
      if (sma50 && sma200) {
        const aligned = (last > sma50 && sma50 > sma200) || (last < sma50 && sma50 < sma200);
        parts.push(aligned ? 1 : 0.4);
      }
      if (adxLast != null) parts.push(Math.min(1, adxLast / 40));
      if (rsi != null) parts.push(Math.min(1, Math.abs(rsi - 50) / 25));
      if (macdHist != null && last > 0) {
        parts.push(Math.min(1, Math.abs(macdHist) / (last * 0.005)));
      }
      if (rangePos != null) parts.push(Math.min(1, Math.abs(rangePos - 50) / 40));
      const wkAlloc = Math.abs(sig.weeklyBias?.targetAllocation ?? 0);
      parts.push(Math.min(1, wkAlloc));
      if (!parts.length) return 0;
      const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
      // Map to 30..90 so HOLDs read as moderate, not zero.
      return Math.round(30 + avg * 60);
    })();

    const finalConfidence = sig.conviction > 0 ? sig.conviction : techConfidence;

    return new Response(JSON.stringify({
      ticker,
      decision,
      confidence: finalConfidence,
      engineConviction: sig.conviction,
      derivedConfidence: sig.conviction > 0 ? null : techConfidence,
      currentPrice: last,
      suggestedEntry: last,
      suggestedStop: stop,
      suggestedTarget: target,
      regime: sig.regime,
      strategy: sig.strategy,
      profile: sig.profile,
      weeklyBias: sig.weeklyBias?.bias ?? null,
      weeklyAllocation: sig.weeklyBias?.targetAllocation ?? null,
      atrPct: sig.atrPct,
      kellyFraction: sig.kellyFraction,
      reasoning: sig.reasoning,
      stats,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("analyze-ticker error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
