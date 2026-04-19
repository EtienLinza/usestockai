import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calculateATR } from "../_shared/indicators.ts";
import {
  aggregateToWeekly,
  classifyStockSimple,
  computeWeeklyBias,
  PROFILE_WEEKLY_PARAMS,
  type DataSet,
} from "../_shared/signal-engine.ts";

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

        // Hard stop: -8%
        if (pnlPct < -8) {
          alerts.push({ ticker: pos.ticker, reason: `Hard stop triggered (${pnlPct.toFixed(1)}% loss)`, current_price: currentPrice, position_id: pos.id });
        }
        // Take profit: custom or default 15%
        else if (pnlPct > takeProfitThreshold) {
          alerts.push({ ticker: pos.ticker, reason: `🎯 Profit target reached (+${pnlPct.toFixed(1)}% vs ${takeProfitThreshold}% goal)`, current_price: currentPrice, position_id: pos.id });
        }
        // Weekly reversal — uses canonical shared signal engine (Wilder's ADX, lookahead-fixed classifier)
        else if (data.close.length >= 200) {
          const profile = classifyStockSimple(data.close, data.high, data.low, pos.ticker);
          const weeklyData = aggregateToWeekly(data);
          const wIdx = weeklyData.close.length - 1;
          const params = PROFILE_WEEKLY_PARAMS[profile];
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
              alerts.push({ ticker: pos.ticker, reason: `Weekly trend reversed to ${wb.bias}`, current_price: currentPrice, position_id: pos.id });
            }
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
    return new Response(JSON.stringify({ error: error.message || "Failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
