import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calculateATR } from "../_shared/indicators.ts";
import {
  aggregateToWeekly,
  classifyStock,
  computeWeeklyBias,
  PROFILE_PARAMS,
  type DataSet,
} from "../_shared/signal-engine-v2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchYahooData(ticker: string): Promise<DataSet | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.chart?.error) return null;
    const result = data.chart.result[0];
    const quotes = result.indicators.quote[0];
    const ts = result.timestamp.map((t: number) => new Date(t * 1000).toISOString().split("T")[0]);
    const close: number[] = [], high: number[] = [], low: number[] = [], open: number[] = [], volume: number[] = [], dates: string[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (quotes.close[i] != null && quotes.high[i] != null && quotes.low[i] != null && quotes.open[i] != null) {
        close.push(quotes.close[i]); high.push(quotes.high[i]); low.push(quotes.low[i]);
        open.push(quotes.open[i]); volume.push(quotes.volume[i] || 0); dates.push(ts[i]);
      }
    }
    return { timestamps: dates, close, high, low, open, volume };
  } catch { return null; }
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get ALL users with open positions
    const { data: openPositions, error: posErr } = await supabase
      .from("virtual_positions")
      .select("*")
      .eq("status", "open");

    if (posErr) throw posErr;
    if (!openPositions || openPositions.length === 0) {
      return new Response(JSON.stringify({ checked: 0, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group positions by user
    const byUser: Record<string, typeof openPositions> = {};
    for (const pos of openPositions) {
      (byUser[pos.user_id] ??= []).push(pos);
    }

    // Collect unique tickers and fetch prices
    const allTickers = [...new Set(openPositions.map(p => p.ticker))];
    const priceData: Record<string, DataSet> = {};

    // Fetch in batches of 5
    for (let i = 0; i < allTickers.length; i += 5) {
      const batch = allTickers.slice(i, i + 5);
      const results = await Promise.all(batch.map(t => fetchYahooData(t)));
      batch.forEach((t, j) => { if (results[j]) priceData[t] = results[j]!; });
      if (i + 5 < allTickers.length) await new Promise(r => setTimeout(r, 200));
    }

    let totalAlerts = 0;

    // ─────────────────────────────────────────────────────────────────────
    // PHASE A — Outcome memory: update MFE/MAE for every open outcome on
    // every check, and close outcomes when their position is closed or a
    // sell alert fires (so the conviction→win-rate curve has real data).
    // ─────────────────────────────────────────────────────────────────────
    const { data: openOutcomes } = await supabase
      .from("signal_outcomes")
      .select("id, ticker, signal_type, entry_price, max_favorable_excursion_pct, max_adverse_excursion_pct, entry_date")
      .eq("status", "open");
    const outcomesByTicker = new Map<string, any[]>();
    for (const o of openOutcomes ?? []) {
      if (!outcomesByTicker.has(o.ticker)) outcomesByTicker.set(o.ticker, []);
      outcomesByTicker.get(o.ticker)!.push(o);
    }

    // Update MFE/MAE for every open outcome that has fresh price data
    for (const [ticker, outcomes] of outcomesByTicker.entries()) {
      const data = priceData[ticker];
      if (!data) continue;
      const currentPrice = data.close[data.close.length - 1];
      for (const o of outcomes) {
        const entry = Number(o.entry_price);
        if (!entry) continue;
        const pnlPct = o.signal_type === "long"
          ? ((currentPrice - entry) / entry) * 100
          : ((entry - currentPrice) / entry) * 100;
        const newMFE = Math.max(Number(o.max_favorable_excursion_pct ?? -Infinity), pnlPct);
        const newMAE = Math.min(Number(o.max_adverse_excursion_pct ?? Infinity), pnlPct);
        await supabase.from("signal_outcomes").update({
          max_favorable_excursion_pct: isFinite(newMFE) ? newMFE : pnlPct,
          max_adverse_excursion_pct: isFinite(newMAE) ? newMAE : pnlPct,
        }).eq("id", o.id);
      }
    }

    for (const [userId, positions] of Object.entries(byUser)) {
      const alerts: { ticker: string; reason: string; current_price: number; position_id: string }[] = [];
      let totalPositionsValue = 0;

      for (const pos of positions) {
        const data = priceData[pos.ticker];
        if (!data) continue;

        const currentPrice = data.close[data.close.length - 1];
        totalPositionsValue += currentPrice * Number(pos.shares);

        const pnlPct = pos.position_type === "long"
          ? ((currentPrice - Number(pos.entry_price)) / Number(pos.entry_price)) * 100
          : ((Number(pos.entry_price) - currentPrice) / Number(pos.entry_price)) * 100;

        const takeProfitThreshold = pos.target_profit_pct != null ? Number(pos.target_profit_pct) : 15;
        let triggeredReason: string | null = null;

        // Hard stop: -8%
        if (pnlPct < -8) {
          triggeredReason = `Hard stop triggered (${pnlPct.toFixed(1)}% loss)`;
          alerts.push({ ticker: pos.ticker, reason: triggeredReason, current_price: currentPrice, position_id: pos.id });
        }
        // Take profit: custom or default 15%
        else if (pnlPct > takeProfitThreshold) {
          triggeredReason = `🎯 Profit target reached (+${pnlPct.toFixed(1)}% vs ${takeProfitThreshold}% goal)`;
          alerts.push({ ticker: pos.ticker, reason: triggeredReason, current_price: currentPrice, position_id: pos.id });
        }
        // Weekly reversal — uses canonical shared signal engine v2 (full blended classifier)
        else if (data.close.length >= 200) {
          const cls = classifyStock(data.close, data.high, data.low, pos.ticker);
          const activeProfile = cls.blendedParams || PROFILE_PARAMS[cls.classification];
          const params = {
            fastMA: activeProfile.weeklyFastMA,
            slowMA: activeProfile.weeklySlowMA,
            rsiLong: activeProfile.weeklyRSILong,
          };
          const weeklyData = aggregateToWeekly(data);
          const wIdx = weeklyData.close.length - 1;
          const weeklyATR = calculateATR(weeklyData.high, weeklyData.low, weeklyData.close, 14);
          let wAtrSum = 0, wAtrCt = 0;
          for (let wi = 14; wi < weeklyData.close.length; wi++) {
            if (!isNaN(weeklyATR[wi]) && weeklyData.close[wi] > 0) { wAtrSum += weeklyATR[wi] / weeklyData.close[wi]; wAtrCt++; }
          }
          const isLowVol = wAtrCt > 0 && (wAtrSum / wAtrCt) < 0.02;

          if (wIdx >= params.slowMA + 10) {
            const wb = computeWeeklyBias(weeklyData.close, weeklyData.high, weeklyData.low, wIdx, params, isLowVol);
            if ((pos.position_type === "long" && wb.bias !== "long") ||
                (pos.position_type === "short" && wb.bias !== "short")) {
              triggeredReason = `Weekly trend reversed to ${wb.bias}`;
              alerts.push({ ticker: pos.ticker, reason: triggeredReason, current_price: currentPrice, position_id: pos.id });
            }
          }
        }

        // PHASE A — close any open outcome for this ticker when an alert fires
        // (the user is being told to exit; treat that as the outcome).
        if (triggeredReason) {
          const matching = (outcomesByTicker.get(pos.ticker) ?? []).filter(
            o => o.signal_type === pos.position_type
          );
          for (const o of matching) {
            const entry = Number(o.entry_price);
            const realizedPct = o.signal_type === "long"
              ? ((currentPrice - entry) / entry) * 100
              : ((entry - currentPrice) / entry) * 100;
            const entryDate = new Date(o.entry_date).getTime();
            const barsHeld = Math.max(1, Math.round((Date.now() - entryDate) / (24 * 3600 * 1000)));
            const exitReason = triggeredReason.startsWith("Hard stop")
              ? "stop_loss"
              : triggeredReason.startsWith("🎯")
              ? "take_profit"
              : "weekly_reversal";
            await supabase.from("signal_outcomes").update({
              status: "closed",
              exit_price: currentPrice,
              exit_date: new Date().toISOString(),
              exit_reason: exitReason,
              bars_held: barsHeld,
              realized_pnl_pct: realizedPct,
            }).eq("id", o.id);
          }
        }
      }

      // Upsert alerts (avoid duplicates per position+reason)
      if (alerts.length > 0) {
        for (const alert of alerts) {
          // Check if non-dismissed alert already exists for this position+reason
          const { data: existing } = await supabase
            .from("sell_alerts")
            .select("id")
            .eq("user_id", userId)
            .eq("position_id", alert.position_id)
            .eq("reason", alert.reason)
            .eq("is_dismissed", false)
            .limit(1);

          if (!existing || existing.length === 0) {
            await supabase.from("sell_alerts").insert({
              user_id: userId,
              ticker: alert.ticker,
              reason: alert.reason,
              current_price: alert.current_price,
              position_id: alert.position_id,
            });
            totalAlerts++;
          } else {
            // Update the price on existing alert
            await supabase.from("sell_alerts").update({ current_price: alert.current_price }).eq("id", existing[0].id);
          }
        }
      }

      // Log portfolio snapshot
      const STARTING_CASH = 100000;
      const totalInvested = positions.reduce((sum, p) => sum + Number(p.entry_price) * Number(p.shares), 0);
      const cash = STARTING_CASH - totalInvested;
      const totalValue = cash + totalPositionsValue;
      const today = new Date().toISOString().split("T")[0];

      await supabase.from("virtual_portfolio_log").upsert(
        { user_id: userId, date: today, total_value: totalValue, cash, positions_value: totalPositionsValue },
        { onConflict: "user_id,date", ignoreDuplicates: false }
      );
    }

    console.log(`Sell alert check complete: ${openPositions.length} positions, ${totalAlerts} new alerts`);

    return new Response(JSON.stringify({
      checked: openPositions.length,
      users: Object.keys(byUser).length,
      alerts: totalAlerts,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Check sell alerts error:", error);
    const message = error instanceof Error ? error.message : "Failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
