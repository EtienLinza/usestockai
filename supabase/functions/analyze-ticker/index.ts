// ============================================================================
// ANALYZE-TICKER — on-demand single-ticker analysis. Runs the canonical
// signal engine for any ticker and returns BUY/SELL/HOLD with reasoning.
// Does NOT persist to live_signals — purely ephemeral.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { evaluateSignal, type MacroContext } from "../_shared/signal-engine-v2.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker ?? "").trim().toUpperCase();
    if (!ticker || !TICKER_RE.test(ticker)) {
      return new Response(
        JSON.stringify({ error: "Invalid ticker" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch ~1y of daily bars (engine requires ≥200 closes).
    const data = await fetchDailyHistory(ticker, "1y");
    if (!data || data.close.length < 200) {
      return new Response(
        JSON.stringify({
          ticker,
          decision: "HOLD",
          confidence: 0,
          reasoning: data
            ? `Insufficient history (${data.close.length} bars, need ≥200)`
            : "Unable to fetch price history for this ticker",
          insufficientData: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const spyCtx = await fetchSpyContext();
    const macro: MacroContext | null = null; // on-demand call skips heavy macro fetch

    const sig = evaluateSignal(data, ticker, spyCtx, macro);
    const lastPrice = data.close[data.close.length - 1];

    if (!sig) {
      return new Response(
        JSON.stringify({
          ticker,
          decision: "HOLD",
          confidence: 0,
          currentPrice: lastPrice,
          reasoning: "Not enough data to evaluate (needs ≥200 daily bars).",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Derive suggested stop / target based on the engine's ATR + profile.
    const atrMult = sig.blendedParams?.hardStopATRMult ?? 2.5;
    const tpPct = sig.blendedParams?.takeProfitPct ?? 10;
    const dir = sig.decision === "BUY" ? 1 : sig.decision === "SHORT" ? -1 : 0;
    const stop = dir !== 0 && sig.atr > 0
      ? lastPrice - dir * atrMult * sig.atr
      : null;
    const target = dir !== 0
      ? lastPrice * (1 + dir * (tpPct / 100))
      : null;

    // Normalize SHORT → SELL for client display
    const decision = sig.decision === "SHORT" ? "SELL" : sig.decision;

    return new Response(
      JSON.stringify({
        ticker,
        decision,
        confidence: sig.conviction,
        currentPrice: lastPrice,
        suggestedEntry: dir !== 0 ? lastPrice : null,
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("analyze-ticker error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
