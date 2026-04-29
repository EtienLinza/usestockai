// ============================================================================
// CHECK-SELL-ALERTS — manual-position smart exit advisor
//
// This function shadows the autotrader's exit brain (runWinExit + runLossExit)
// but for **manually-opened** positions only. It never executes trades — it
// just posts entries into `sell_alerts` so the user can decide.
//
// Hand-off rule (avoid double-managing a position):
//   • Positions with opened_by = 'autotrader'  → SKIP. The autotrader-scan
//     loop owns their lifecycle (it will close them or post its own alerts).
//   • Positions with opened_by = 'manual'      → run smart-exit checks here.
//
// Smart-exit logic (mirrors autotrader-scan/index.ts):
//   T1  Hard ATR stop hit (or −8% fallback if no entry_atr)
//   T2  Hard take-profit ceiling (custom target × 1.5, else +22.5%)
//   T3  Peak detection: ≥3 of 5 signals fire
//         • trailing-stop (peak − ATR × profile.trailingStopATRMult)
//         • RSI bearish/bullish divergence (5-bar)
//         • volume climax candle
//         • MACD histogram rollover (3-bar)
//         • thesis completion (strategy-aware)
//   T4  Thesis invalidation while losing > 3% (weekly bias flipped against us)
//   T5  Time stop (per-strategy maxHold from profile params)
//   T6  Custom target hit (user-set target_profit_pct)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  calculateATR,
  calculateRSI,
  calculateMACD,
  safeGet,
} from "../_shared/indicators.ts";
import {
  aggregateToWeekly,
  classifyStock,
  computeWeeklyBias,
  PROFILE_PARAMS,
  type DataSet,
  type ProfileParams,
} from "../_shared/signal-engine-v2.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import { getQuoteWithFallback } from "../_shared/finnhub.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchYahooData(ticker: string): Promise<DataSet | null> {
  return await fetchDailyHistory(ticker, "1y");
}

function businessDaysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  const days = ms / 86400000;
  return Math.max(1, Math.round(days * (5 / 7)));
}

// ── Smart-exit evaluator ─────────────────────────────────────────────────────
// Returns the most-pressing reason to sell, or null to hold.
// Order matters: hard stops first, then ceiling, then peak detection, then
// thesis/time stops. We only ever post one alert per position per check.
function evaluateSmartExit(
  pos: any,
  data: DataSet,
  currentPrice: number,
  profile: ProfileParams,
  liveWeeklyBias: "long" | "short" | "flat" | null,
): string | null {
  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  if (!entry || !Number.isFinite(currentPrice)) return null;

  const pnlPct = isLong
    ? ((currentPrice - entry) / entry) * 100
    : ((entry - currentPrice) / entry) * 100;

  // ── T1: Hard stop ────────────────────────────────────────────────────────
  if (pos.hard_stop_price != null) {
    const hit = isLong
      ? currentPrice <= Number(pos.hard_stop_price)
      : currentPrice >= Number(pos.hard_stop_price);
    if (hit) return `Hard stop hit (${pnlPct.toFixed(1)}%)`;
  } else if (pnlPct < -8) {
    return `Hard stop triggered (${pnlPct.toFixed(1)}% loss)`;
  }

  // ── T2: Hard take-profit ceiling ─────────────────────────────────────────
  const customTarget = pos.target_profit_pct != null ? Number(pos.target_profit_pct) : null;
  const ceiling = customTarget != null ? customTarget * 1.5 : profile.takeProfitPct * 1.5;
  if (pnlPct >= ceiling) {
    return `🎯 Hard take-profit ceiling (+${pnlPct.toFixed(1)}% vs ${ceiling.toFixed(1)}% cap)`;
  }

  // ── T6: Custom target reached (only if user set one and we're past it) ──
  if (customTarget != null && pnlPct >= customTarget) {
    return `🎯 Profit target reached (+${pnlPct.toFixed(1)}% vs ${customTarget.toFixed(1)}% goal)`;
  }

  const n = data.close.length;
  const close = data.close;
  const vol = data.volume;

  // ── T3: Peak detection (only when comfortably in profit) ─────────────────
  const MIN_PROFIT_FOR_PEAK = 6; // %
  const atr = pos.entry_atr != null ? Number(pos.entry_atr) : 0;

  if (pnlPct >= MIN_PROFIT_FOR_PEAK && n >= 35) {
    const oldPeak = pos.peak_price != null ? Number(pos.peak_price) : entry;
    const newPeak = isLong ? Math.max(oldPeak, currentPrice) : Math.min(oldPeak, currentPrice);

    // SIGNAL 1: trailing stop
    let trailingHit = false;
    if (atr > 0) {
      const trail = isLong
        ? newPeak - atr * profile.trailingStopATRMult
        : newPeak + atr * profile.trailingStopATRMult;
      trailingHit = isLong ? currentPrice <= trail : currentPrice >= trail;
    }

    // SIGNAL 2: RSI divergence
    let rsiDivergence = false;
    const rsi = calculateRSI(close, 14);
    if (n >= 6 && !isNaN(rsi[n - 1]) && !isNaN(rsi[n - 6])) {
      if (isLong) {
        rsiDivergence = close[n - 1] > close[n - 6] && rsi[n - 1] < rsi[n - 6] && rsi[n - 1] > 65;
      } else {
        rsiDivergence = close[n - 1] < close[n - 6] && rsi[n - 1] > rsi[n - 6] && rsi[n - 1] < 35;
      }
    }

    // SIGNAL 3: Volume climax
    let climax = false;
    if (n >= 21) {
      let avgV = 0;
      for (let i = n - 21; i < n - 1; i++) avgV += vol[i];
      avgV /= 20;
      const hi = data.high[n - 1], lo = data.low[n - 1], cl = close[n - 1];
      const range = hi - lo;
      const closePos = range > 0 ? (cl - lo) / range : 0.5;
      const volSpike = vol[n - 1] > avgV * 1.8;
      climax = isLong
        ? volSpike && closePos < 0.35
        : volSpike && closePos > 0.65;
    }

    // SIGNAL 4: MACD histogram rollover
    let macdRoll = false;
    const m = calculateMACD(close);
    const h = m.histogram;
    if (n >= 3) {
      if (isLong) {
        macdRoll = h[n - 1] > 0 && h[n - 1] < h[n - 2] && h[n - 2] < h[n - 3];
      } else {
        macdRoll = h[n - 1] < 0 && h[n - 1] > h[n - 2] && h[n - 2] > h[n - 3];
      }
    }

    // SIGNAL 5: Thesis completion (strategy-aware)
    let thesisDone = false;
    const lastRsi = safeGet(rsi, 50);
    const strat = pos.entry_strategy ?? "trend";
    if (strat === "mean_reversion") {
      thesisDone = lastRsi >= 48 && lastRsi <= 58;
    } else if (strat === "trend") {
      // Without a fresh weeklyAlloc here we approximate: if weekly bias has gone
      // flat/opposite that's a softer thesis-done signal handled in T4.
      thesisDone = false;
    } else if (strat === "breakout") {
      thesisDone = isLong ? currentPrice < entry * 1.01 : currentPrice > entry * 0.99;
    }

    const signals = [trailingHit, rsiDivergence, climax, macdRoll, thesisDone];
    const fired = signals.filter(Boolean).length;
    const labels = ["trailing-stop", "RSI divergence", "volume climax", "MACD rollover", "thesis complete"];
    const firedLabels = labels.filter((_, i) => signals[i]);

    if (fired >= 3) {
      return `Peak detection: ${firedLabels.join(" + ")} (+${pnlPct.toFixed(1)}%)`;
    }
  }

  // ── T4: Thesis invalidation — weekly bias flipped while losing ──────────
  if (pnlPct < -3 && liveWeeklyBias) {
    if ((isLong && liveWeeklyBias === "short") || (!isLong && liveWeeklyBias === "long")) {
      return `Weekly trend reversed to ${liveWeeklyBias} — thesis invalidated (${pnlPct.toFixed(1)}%)`;
    }
  }

  // ── T5: Time stop ────────────────────────────────────────────────────────
  const strat = pos.entry_strategy ?? "trend";
  const maxHold = strat === "mean_reversion"
    ? profile.maxHoldMR
    : strat === "breakout"
    ? profile.maxHoldBreakout
    : profile.maxHoldTrend;
  const barsHeld = businessDaysSince(pos.created_at);
  if (barsHeld >= maxHold) {
    return pnlPct > 0
      ? `Time stop — taking the profit (+${pnlPct.toFixed(1)}% after ${barsHeld} bars)`
      : `Time stop — dead capital (${pnlPct.toFixed(1)}% after ${barsHeld} bars)`;
  }

  return null;
}

// ── Compute live weekly bias for a ticker (for T4 thesis invalidation) ─────
function liveWeeklyBiasFor(data: DataSet, ticker: string): "long" | "short" | "flat" | null {
  if (data.close.length < 200) return null;
  const cls = classifyStock(data.close, data.high, data.low, ticker);
  const activeProfile = cls.blendedParams || PROFILE_PARAMS[cls.classification];
  const params = {
    fastMA: activeProfile.weeklyFastMA,
    slowMA: activeProfile.weeklySlowMA,
    rsiLong: activeProfile.weeklyRSILong,
  };
  const wd = aggregateToWeekly(data);
  const wIdx = wd.close.length - 1;
  if (wIdx < params.slowMA + 10) return null;

  const weeklyATR = calculateATR(wd.high, wd.low, wd.close, 14);
  let wAtrSum = 0, wAtrCt = 0;
  for (let wi = 14; wi < wd.close.length; wi++) {
    if (!isNaN(weeklyATR[wi]) && wd.close[wi] > 0) {
      wAtrSum += weeklyATR[wi] / wd.close[wi];
      wAtrCt++;
    }
  }
  const isLowVol = wAtrCt > 0 && (wAtrSum / wAtrCt) < 0.02;
  const wb = computeWeeklyBias(wd.close, wd.high, wd.low, wIdx, params, isLowVol);
  return wb.bias;
}

// ── Pick the right ProfileParams for a position ────────────────────────────
function profileFor(pos: any, data: DataSet): ProfileParams {
  // Prefer the profile recorded at entry; fall back to live classification.
  if (pos.entry_profile && PROFILE_PARAMS[pos.entry_profile as keyof typeof PROFILE_PARAMS]) {
    return PROFILE_PARAMS[pos.entry_profile as keyof typeof PROFILE_PARAMS];
  }
  if (data.close.length >= 200) {
    const cls = classifyStock(data.close, data.high, data.low, pos.ticker);
    return cls.blendedParams || PROFILE_PARAMS[cls.classification];
  }
  return PROFILE_PARAMS.momentum; // safe default
}

// ── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get ALL open positions
    const { data: openPositions, error: posErr } = await supabase
      .from("virtual_positions")
      .select("*")
      .eq("status", "open");

    if (posErr) throw posErr;
    if (!openPositions || openPositions.length === 0) {
      await recordHeartbeat("check-sell-alerts", startedAt, "ok", "no-open-positions");
      return new Response(JSON.stringify({ checked: 0, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── HAND-OFF: skip positions owned by the autotrader loop ──────────────
    // The autotrader manages those positions itself (it will close them or
    // post its own sell_alerts via that scan). Avoid double-managing.
    const manualPositions = openPositions.filter(p => p.opened_by !== "autotrader");
    const skippedAutotraded = openPositions.length - manualPositions.length;

    if (manualPositions.length === 0) {
      await recordHeartbeat(
        "check-sell-alerts",
        startedAt,
        "ok",
        `all ${openPositions.length} positions managed by autotrader`,
      );
      return new Response(JSON.stringify({
        checked: 0,
        skipped_autotraded: skippedAutotraded,
        alerts: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Group manual positions by user (autotraded ones are out)
    const byUser: Record<string, typeof manualPositions> = {};
    for (const pos of manualPositions) {
      (byUser[pos.user_id] ??= []).push(pos);
    }

    // Collect unique tickers across MANUAL positions and fetch prices
    const allTickers = [...new Set(manualPositions.map(p => p.ticker))];
    const priceData: Record<string, DataSet> = {};

    for (let i = 0; i < allTickers.length; i += 5) {
      const batch = allTickers.slice(i, i + 5);
      const results = await Promise.all(batch.map(t => fetchYahooData(t)));
      batch.forEach((t, j) => { if (results[j]) priceData[t] = results[j]!; });
      if (i + 5 < allTickers.length) await new Promise(r => setTimeout(r, 200));
    }

    // Overlay LATEST live quote onto each dataset's last close (real-time PnL)
    for (let i = 0; i < allTickers.length; i += 5) {
      const batch = allTickers.slice(i, i + 5);
      const quotes = await Promise.all(batch.map(t => getQuoteWithFallback(t)));
      batch.forEach((t, j) => {
        const q = quotes[j];
        const ds = priceData[t];
        if (q && ds && ds.close.length > 0) {
          ds.close[ds.close.length - 1] = q.price;
        }
      });
      if (i + 5 < allTickers.length) await new Promise(r => setTimeout(r, 100));
    }

    let totalAlerts = 0;

    // ─────────────────────────────────────────────────────────────────────
    // PHASE A — Outcome memory: update MFE/MAE and close on alert
    // (kept identical to before — drives the conviction→win-rate calibration)
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

    // ── Per-user smart-exit pass on manual positions ───────────────────────
    for (const [userId, positions] of Object.entries(byUser)) {
      const alerts: { ticker: string; reason: string; current_price: number; position_id: string }[] = [];
      let totalPositionsValue = 0;

      for (const pos of positions) {
        const data = priceData[pos.ticker];
        if (!data) continue;

        const currentPrice = data.close[data.close.length - 1];
        totalPositionsValue += currentPrice * Number(pos.shares);

        const profile = profileFor(pos, data);
        const liveBias = liveWeeklyBiasFor(data, pos.ticker);

        const reason = evaluateSmartExit(pos, data, currentPrice, profile, liveBias);

        if (reason) {
          alerts.push({
            ticker: pos.ticker,
            reason,
            current_price: currentPrice,
            position_id: pos.id,
          });

          // Close any matching open outcome (used by calibration)
          const matching = (outcomesByTicker.get(pos.ticker) ?? []).filter(
            o => o.signal_type === pos.position_type,
          );
          for (const o of matching) {
            const entry = Number(o.entry_price);
            const realizedPct = o.signal_type === "long"
              ? ((currentPrice - entry) / entry) * 100
              : ((entry - currentPrice) / entry) * 100;
            const entryDate = new Date(o.entry_date).getTime();
            const barsHeld = Math.max(1, Math.round((Date.now() - entryDate) / (24 * 3600 * 1000)));
            const exitReason = reason.startsWith("Hard stop")
              ? "stop_loss"
              : reason.startsWith("🎯")
              ? "take_profit"
              : reason.startsWith("Peak detection")
              ? "peak_detection"
              : reason.startsWith("Time stop")
              ? "time_stop"
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
            await supabase.from("sell_alerts")
              .update({ current_price: alert.current_price })
              .eq("id", existing[0].id);
          }
        }
      }

      // Log portfolio snapshot (manual positions only — autotrader logs its own)
      const STARTING_CASH = 100000;
      const totalInvested = positions.reduce(
        (sum, p) => sum + Number(p.entry_price) * Number(p.shares), 0,
      );
      const cash = STARTING_CASH - totalInvested;
      const totalValue = cash + totalPositionsValue;
      const today = new Date().toISOString().split("T")[0];

      await supabase.from("virtual_portfolio_log").upsert(
        { user_id: userId, date: today, total_value: totalValue, cash, positions_value: totalPositionsValue },
        { onConflict: "user_id,date", ignoreDuplicates: false },
      );
    }

    console.log(
      `Sell alert check: ${manualPositions.length} manual positions, ` +
      `${skippedAutotraded} autotraded skipped, ${totalAlerts} new alerts`,
    );

    await recordHeartbeat(
      "check-sell-alerts",
      startedAt,
      "ok",
      `manual=${manualPositions.length} skipped=${skippedAutotraded} alerts=${totalAlerts}`,
    );

    return new Response(JSON.stringify({
      checked: manualPositions.length,
      skipped_autotraded: skippedAutotraded,
      users: Object.keys(byUser).length,
      alerts: totalAlerts,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Check sell alerts error:", error);
    const message = error instanceof Error ? error.message : "Failed";
    await recordHeartbeat("check-sell-alerts", startedAt, "error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
