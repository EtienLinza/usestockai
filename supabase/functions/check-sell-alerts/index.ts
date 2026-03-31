import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Technical helpers (minimal set needed for weekly bias) ──

function calculateEMA(prices: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  if (prices.length < period) {
    ema[0] = prices[0];
    for (let i = 1; i < prices.length; i++) ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
    return ema;
  }
  const smaSum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  for (let i = 0; i < period - 1; i++) ema[i] = NaN;
  ema[period - 1] = smaSum / period;
  for (let i = period; i < prices.length; i++) ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  return ema;
}

function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) sma[i] = NaN;
    else sma[i] = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  }
  return sma;
}

function calculateRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i <= period; i++) rsi[i] = NaN;
  for (let i = 1; i <= period; i++) {
    const c = prices[i] - prices[i - 1];
    avgGain += c > 0 ? c : 0;
    avgLoss += c < 0 ? -c : 0;
  }
  avgGain /= period; avgLoss /= period;
  rsi[period] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
  for (let i = period + 1; i < prices.length; i++) {
    const c = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (c > 0 ? c : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (c < 0 ? -c : 0)) / period;
    rsi[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
  }
  return rsi;
}

function calculateATR(high: number[], low: number[], close: number[], period = 14): number[] {
  const tr: number[] = [high[0] - low[0]];
  for (let i = 1; i < close.length; i++)
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  const atr: number[] = [NaN];
  for (let i = 1; i < period; i++) atr[i] = NaN;
  if (tr.length >= period) {
    atr[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < tr.length; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calculateADX(high: number[], low: number[], close: number[], period = 14) {
  if (close.length < 2) return { adx: [] as number[], plusDI: [] as number[], minusDI: [] as number[] };
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const up = high[i] - high[i - 1], down = low[i - 1] - low[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const sTR = calculateEMA(tr, period), sPDM = calculateEMA(plusDM, period), sMDM = calculateEMA(minusDM, period);
  const pDI = sPDM.map((v, i) => sTR[i] === 0 ? 0 : (v / sTR[i]) * 100);
  const mDI = sMDM.map((v, i) => sTR[i] === 0 ? 0 : (v / sTR[i]) * 100);
  const dx = pDI.map((v, i) => { const s = v + mDI[i]; return s === 0 ? 0 : (Math.abs(v - mDI[i]) / s) * 100; });
  const adxRaw = calculateEMA(dx.filter(v => !isNaN(v)), period);
  const pad = close.length - adxRaw.length;
  return { adx: new Array(Math.max(0, pad)).fill(NaN).concat(adxRaw), plusDI: [NaN, ...pDI], minusDI: [NaN, ...mDI] };
}

function safeGet(arr: number[], d: number): number {
  if (!arr || arr.length === 0) return d;
  const v = arr[arr.length - 1];
  return v == null || isNaN(v) ? d : v;
}

type DataSet = { timestamps: string[]; close: number[]; high: number[]; low: number[]; open: number[]; volume: number[] };

function aggregateToWeekly(data: DataSet): DataSet {
  const weeks: { open: number; high: number; low: number; close: number; volume: number; date: string }[] = [];
  let wO = data.open[0], wH = data.high[0], wL = data.low[0], wV = data.volume[0], wD = data.timestamps[0];
  for (let i = 1; i < data.close.length; i++) {
    const prev = new Date(data.timestamps[i - 1]), curr = new Date(data.timestamps[i]);
    if (curr.getUTCDay() < prev.getUTCDay() || curr.getTime() - prev.getTime() > 4 * 86400000) {
      weeks.push({ open: wO, high: wH, low: wL, close: data.close[i - 1], volume: wV, date: wD });
      wO = data.open[i]; wH = data.high[i]; wL = data.low[i]; wV = data.volume[i]; wD = data.timestamps[i];
    } else { wH = Math.max(wH, data.high[i]); wL = Math.min(wL, data.low[i]); wV += data.volume[i]; }
  }
  weeks.push({ open: wO, high: wH, low: wL, close: data.close[data.close.length - 1], volume: wV, date: wD });
  return { timestamps: weeks.map(w => w.date), open: weeks.map(w => w.open), high: weeks.map(w => w.high), low: weeks.map(w => w.low), close: weeks.map(w => w.close), volume: weeks.map(w => w.volume) };
}

type StockProfile = "momentum" | "value" | "index" | "volatile";
const INDEX_TICKERS = new Set(["SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "IVV", "RSP"]);

function classifyStockSimple(close: number[], high: number[], low: number[], ticker: string): StockProfile {
  if (INDEX_TICKERS.has(ticker.toUpperCase())) return "index";
  const n = close.length;
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((close[i] - close[i - 1]) / close[i - 1]);
  const atr = calculateATR(high, low, close, 14);
  let atrPctSum = 0, atrPctCount = 0;
  for (let i = 14; i < n; i++) { if (!isNaN(atr[i]) && close[i] > 0) { atrPctSum += atr[i] / close[i]; atrPctCount++; } }
  const atrPctAvg = atrPctCount > 0 ? atrPctSum / atrPctCount : 0.02;
  const sma50 = calculateSMA(close, 50), sma200 = calculateSMA(close, 200);
  let maAligned = 0, maValid = 0;
  for (let i = 199; i < n; i++) { if (!isNaN(sma50[i]) && !isNaN(sma200[i])) { maValid++; if (close[i] > sma50[i] && sma50[i] > sma200[i]) maAligned++; } }
  const trendScore = maValid > 0 ? maAligned / maValid : 0;
  if (atrPctAvg > 0.025 && trendScore < 0.4) return "volatile";
  if (trendScore > 0.6) return "momentum";
  return "index";
}

const PROFILE_WEEKLY_PARAMS: Record<StockProfile, { fastMA: number; slowMA: number; rsiLong: number }> = {
  momentum: { fastMA: 10, slowMA: 40, rsiLong: 45 },
  value: { fastMA: 13, slowMA: 50, rsiLong: 35 },
  index: { fastMA: 10, slowMA: 40, rsiLong: 40 },
  volatile: { fastMA: 8, slowMA: 30, rsiLong: 50 },
};

function computeWeeklyBias(wClose: number[], wHigh: number[], wLow: number[], idx: number, params: { fastMA: number; slowMA: number; rsiLong: number }, isLowVol = false) {
  if (idx < params.slowMA + 10) return { bias: "flat" as const, targetAllocation: 0 };
  const slice = wClose.slice(0, idx + 1), hS = wHigh.slice(0, idx + 1), lS = wLow.slice(0, idx + 1);
  const fast = safeGet(calculateEMA(slice, params.fastMA), slice[slice.length - 1]);
  const slow = safeGet(calculateEMA(slice, params.slowMA), slice[slice.length - 1]);
  const rsiVal = safeGet(calculateRSI(slice, 14), 50);
  const adxVal = safeGet(calculateADX(hS, lS, slice, 14).adx, 0);
  const c = slice[slice.length - 1];

  if (isLowVol) {
    if (rsiVal < 30 && c > slow) return { bias: "long" as const, targetAllocation: 0.75 };
    if (rsiVal < 35 && c > slow && adxVal < 25) return { bias: "long" as const, targetAllocation: 0.5 };
    if (rsiVal > 70) return { bias: "flat" as const, targetAllocation: 0 };
    if (rsiVal >= 35 && rsiVal <= 65 && c > slow) return { bias: "long" as const, targetAllocation: 0.25 };
    return { bias: "flat" as const, targetAllocation: 0 };
  }
  if (c > fast && fast > slow) {
    if (rsiVal >= params.rsiLong && rsiVal <= 75 && adxVal > 20) return { bias: "long" as const, targetAllocation: 1.0 };
    if (rsiVal > 75) return { bias: "long" as const, targetAllocation: 0.25 };
    return { bias: "long" as const, targetAllocation: 0.5 };
  }
  if (fast > slow && c <= fast && c > slow) return { bias: "long" as const, targetAllocation: 0.25 };
  if (c < fast && fast < slow && rsiVal < 40 && adxVal > 20) return { bias: "short" as const, targetAllocation: -0.5 };
  return { bias: "flat" as const, targetAllocation: 0 };
}

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
        // Weekly reversal
        else if (data.close.length >= 200) {
          const profile = classifyStockSimple(data.close, data.high, data.low, pos.ticker);
          const weeklyData = aggregateToWeekly(data);
          const wIdx = weeklyData.close.length - 1;
          const params = PROFILE_WEEKLY_PARAMS[profile];
          const weeklyATR = calculateATR(weeklyData.high, weeklyData.low, weeklyData.close, 14);
          let isLowVol = false;
          let wAtrSum = 0, wAtrCt = 0;
          for (let wi = 14; wi < weeklyData.close.length; wi++) {
            if (!isNaN(weeklyATR[wi]) && weeklyData.close[wi] > 0) { wAtrSum += weeklyATR[wi] / weeklyData.close[wi]; wAtrCt++; }
          }
          isLowVol = wAtrCt > 0 && (wAtrSum / wAtrCt) < 0.02;

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
