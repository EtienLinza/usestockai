// ============================================================================
// AUTOTRADER SCAN — fully automated trade lifecycle, runs every 10 min via cron
//
// Per opted-in user:
//   1. Loads open virtual_positions + watchlist
//   2. Batch-fetches OHLCV (cached across users in this invocation)
//   3. For each open position → runExitDecision (Win + Loss in parallel)
//   4. For each watchlist ticker without a position → runEntryDecision
//   5. Executes (paper-mode by default), logs to autotrade_log, posts sell_alerts
//
// Reuses the canonical evaluateSignal() engine — same code path the backtest validates.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  calculateATR,
  calculateRSI,
  calculateMACD,
  calculateSMA,
  safeGet,
} from "../_shared/indicators.ts";
import {
  evaluateSignal,
  classifyStock,
  PROFILE_PARAMS,
  type DataSet,
  type MacroContext,
  type ProfileParams,
  type StockProfile,
} from "../_shared/signal-engine-v2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Yahoo fetch with caching (per invocation) ─────────────────────────────
const priceCache = new Map<string, DataSet | null>();

async function fetchYahooData(ticker: string): Promise<DataSet | null> {
  if (priceCache.has(ticker)) return priceCache.get(ticker)!;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) { priceCache.set(ticker, null); return null; }
    const j = await r.json();
    if (j.chart?.error) { priceCache.set(ticker, null); return null; }
    const res = j.chart.result[0];
    const q = res.indicators.quote[0];
    const ts = res.timestamp.map((x: number) => new Date(x * 1000).toISOString().split("T")[0]);
    const ds: DataSet = { timestamps: [], close: [], high: [], low: [], open: [], volume: [] };
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] != null && q.high[i] != null && q.low[i] != null && q.open[i] != null) {
        ds.timestamps.push(ts[i]);
        ds.close.push(q.close[i]); ds.high.push(q.high[i]); ds.low.push(q.low[i]);
        ds.open.push(q.open[i]); ds.volume.push(q.volume[i] || 0);
      }
    }
    priceCache.set(ticker, ds);
    return ds;
  } catch {
    priceCache.set(ticker, null);
    return null;
  }
}

async function batchFetch(tickers: string[]): Promise<void> {
  const need = tickers.filter(t => !priceCache.has(t));
  for (let i = 0; i < need.length; i += 5) {
    const batch = need.slice(i, i + 5);
    await Promise.all(batch.map(fetchYahooData));
    if (i + 5 < need.length) await new Promise(r => setTimeout(r, 200));
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface Position {
  id: string; user_id: string; ticker: string;
  position_type: "long" | "short";
  entry_price: number; shares: number;
  created_at: string;
  peak_price: number | null;
  trailing_stop_price: number | null;
  hard_stop_price: number | null;
  entry_atr: number | null;
  entry_conviction: number | null;
  entry_strategy: string | null;
  entry_profile: string | null;
  entry_weekly_alloc: number | null;
  breakout_failed_count: number;
  opened_by: string;
  signal_id: string | null;
}

interface Settings {
  user_id: string; enabled: boolean;
  min_conviction: number; max_positions: number;
  max_nav_exposure_pct: number; max_single_name_pct: number;
  daily_loss_limit_pct: number; starting_nav: number;
  paper_mode: boolean; notify_on_action: boolean;
  advanced_mode: boolean;
  scan_interval_minutes: number;
  last_scan_at: string | null;
  next_scan_at: string | null;
}

// ─── Autopilot defaults (used when advanced_mode = false) ────────────────
// The algorithm picks every threshold based on macro context, replacing
// whatever the user previously had stored in their settings row.
function resolveEffectiveSettings(s: Settings, macro: MacroContext | null): Settings {
  if (s.advanced_mode) return s;

  const bear = isBearishMacro(macro);
  const minConv = bear ? 78 : 72;
  const maxPos = Math.min(12, Math.max(4, Math.round(s.starting_nav / 12500)));
  const maxNav = bear ? 60 : 80;

  return {
    ...s,
    min_conviction: minConv,
    max_positions: maxPos,
    max_nav_exposure_pct: maxNav,
    max_single_name_pct: 20,    // Kelly fraction further caps this per-trade
    daily_loss_limit_pct: 3,    // safety floor
  };
}

// SPY 50-SMA slope check — same heuristic the signal engine uses
function isBearishMacro(macro: MacroContext | null): boolean {
  if (!macro || macro.spyClose.length < 50) return false;
  const c = macro.spyClose;
  const sma = calculateSMA(c, 50);
  const last = sma[sma.length - 1];
  const prev = sma[sma.length - 6] ?? last;
  return Number.isFinite(last) && Number.isFinite(prev) && last < prev;
}

// Autopilot scan cadence — tighter on volatile/open, looser on calm afternoons
function algoScanIntervalMinutes(macro: MacroContext | null): number {
  // Approx NY hour from UTC (DST-agnostic ±1h is acceptable for cadence)
  const utcHour = new Date().getUTCHours();
  const nyHour = (utcHour - 4 + 24) % 24;
  if (nyHour === 9 || nyHour === 10) return 5;     // first 90 min after open
  if (isBearishMacro(macro)) return 5;             // tighter risk in bear regimes
  if (nyHour >= 14 && nyHour < 16) return 15;      // sleepy afternoon
  return 10;
}

type ExitAction =
  | { kind: "HOLD"; reason: string; trailingUpdate?: number; peakUpdate?: number }
  | { kind: "FULL_EXIT"; reason: string; price: number }
  | { kind: "PARTIAL_EXIT"; reason: string; pct: number; price: number };

type EntryAction =
  | { kind: "ENTER"; conviction: number; kellyFraction: number; price: number;
      strategy: string; profile: StockProfile; atr: number; hardStop: number;
      weeklyAlloc: number; reasoning: string }
  | { kind: "HOLD" | "BLOCKED"; reason: string };

// ============================================================================
// WIN EXIT — peak detection (5 signals, 3-of-5 fires FULL_EXIT)
// Improvements over the basic ATR-trail:
//   • RSI bearish divergence (5-bar lookback)
//   • Volume climax + close-near-low candle
//   • MACD histogram rollover (2-bar decline)
//   • Strategy-aware thesis completion
//   • Peak detection only kicks in after +6% — below that, just hold/cut
// ============================================================================
function runWinExit(
  pos: Position, data: DataSet, currentPrice: number, profile: ProfileParams,
  liveWeeklyAlloc: number,
): ExitAction {
  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  const pnlPct = isLong ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;

  // Peak update
  const oldPeak = pos.peak_price ?? entry;
  const newPeak = isLong ? Math.max(oldPeak, currentPrice) : Math.min(oldPeak, currentPrice);

  // Trailing-stop ratchet
  const atr = pos.entry_atr ?? 0;
  let trailing = pos.trailing_stop_price ?? pos.hard_stop_price ?? (isLong ? entry * 0.95 : entry * 1.05);
  if (atr > 0) {
    const candidate = isLong
      ? newPeak - atr * profile.trailingStopATRMult
      : newPeak + atr * profile.trailingStopATRMult;
    trailing = isLong ? Math.max(trailing, candidate) : Math.min(trailing, candidate);
  }
  const trailingHit = isLong ? currentPrice <= trailing : currentPrice >= trailing;

  // Hard ceiling: take-profit × 1.5 — always exits regardless of signals
  if (pnlPct >= profile.takeProfitPct / 100 * 1.5) {
    return { kind: "FULL_EXIT", reason: `Hard take-profit ceiling hit (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
  }

  // Below +6% we don't try to time a peak — hold or let loss-engine cut
  const MIN_PROFIT_FOR_PEAK = 0.06;
  if (pnlPct < MIN_PROFIT_FOR_PEAK) {
    return { kind: "HOLD", reason: "below peak-detection floor", trailingUpdate: trailing, peakUpdate: newPeak };
  }

  const n = data.close.length;
  const close = data.close, vol = data.volume;

  // SIGNAL 1: trailing hit
  // (already computed)

  // SIGNAL 2: RSI bearish divergence (long) / bullish divergence (short)
  let rsiDivergence = false;
  const rsi = calculateRSI(close, 14);
  if (n >= 6 && !isNaN(rsi[n - 1]) && !isNaN(rsi[n - 6])) {
    if (isLong) {
      rsiDivergence = close[n - 1] > close[n - 6] && rsi[n - 1] < rsi[n - 6] && rsi[n - 1] > 65;
    } else {
      rsiDivergence = close[n - 1] < close[n - 6] && rsi[n - 1] > rsi[n - 6] && rsi[n - 1] < 35;
    }
  }

  // SIGNAL 3: Volume climax candle
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
      ? volSpike && closePos < 0.35   // distribution on long
      : volSpike && closePos > 0.65;  // accumulation on short
  }

  // SIGNAL 4: MACD histogram rollover
  let macdRoll = false;
  if (n >= 35) {
    const m = calculateMACD(close);
    const h = m.histogram;
    if (n >= 3) {
      if (isLong) {
        macdRoll = h[n - 1] > 0 && h[n - 1] < h[n - 2] && h[n - 2] < h[n - 3];
      } else {
        macdRoll = h[n - 1] < 0 && h[n - 1] > h[n - 2] && h[n - 2] > h[n - 3];
      }
    }
  }

  // SIGNAL 5: Thesis completion (strategy-aware)
  let thesisDone = false;
  const lastRsi = safeGet(rsi, 50);
  const strat = pos.entry_strategy ?? "trend";
  if (strat === "mean_reversion") {
    thesisDone = lastRsi >= 48 && lastRsi <= 58;
  } else if (strat === "trend") {
    const entryAlloc = Math.abs(pos.entry_weekly_alloc ?? 1.0);
    const liveAbs = Math.abs(liveWeeklyAlloc);
    thesisDone = entryAlloc >= 0.75 && liveAbs <= entryAlloc - 0.5;
  } else if (strat === "breakout") {
    // Price returned inside breakout zone (within 1% of entry)
    thesisDone = isLong
      ? currentPrice < entry * 1.01
      : currentPrice > entry * 0.99;
  }

  const signals = [trailingHit, rsiDivergence, climax, macdRoll, thesisDone];
  const fired = signals.filter(Boolean).length;
  const labels = ["trailing-stop", "RSI divergence", "volume climax", "MACD rollover", "thesis complete"];
  const firedLabels = labels.filter((_, i) => signals[i]);

  if (fired >= 3) {
    return { kind: "FULL_EXIT", reason: `Peak detection: ${firedLabels.join(" + ")} (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
  }
  if (fired === 2 && pnlPct >= profile.takeProfitPct / 100 * 0.8) {
    return { kind: "PARTIAL_EXIT", reason: `Approaching target with ${fired} peak signals: ${firedLabels.join(" + ")}`, pct: 0.5, price: currentPrice };
  }
  return { kind: "HOLD", reason: `peak-watch (${fired}/5)`, trailingUpdate: trailing, peakUpdate: newPeak };
}

// ============================================================================
// LOSS EXIT — thesis invalidation (priority order)
// ============================================================================
function runLossExit(
  pos: Position, _data: DataSet, currentPrice: number, profile: ProfileParams,
  liveDecision: "BUY" | "SHORT" | "HOLD" | null,
  liveWeeklyBias: "long" | "short" | "flat" | null,
  liveRsi: number,
): ExitAction | null {
  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  const pnlPct = isLong ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;

  // T1: Hard stop — non-negotiable
  if (pos.hard_stop_price != null) {
    const hit = isLong ? currentPrice <= pos.hard_stop_price : currentPrice >= pos.hard_stop_price;
    if (hit) {
      return { kind: "FULL_EXIT", reason: `Hard stop hit (${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
    }
  }

  // T2: Thesis invalidation (only when actually losing > 3%)
  if (pnlPct < -0.03) {
    if (liveWeeklyBias && ((isLong && liveWeeklyBias === "short") || (!isLong && liveWeeklyBias === "long"))) {
      return { kind: "FULL_EXIT", reason: `Weekly bias flipped to ${liveWeeklyBias} — thesis invalidated`, price: currentPrice };
    }
    // MR failure: held longer than max + RSI still extreme
    const barsHeld = businessDaysSince(pos.created_at);
    if (pos.entry_strategy === "mean_reversion" && barsHeld > profile.maxHoldMR && liveRsi < 40) {
      return { kind: "FULL_EXIT", reason: `Mean-reversion failed to materialize after ${barsHeld} bars`, price: currentPrice };
    }
    if (pos.entry_strategy === "breakout" && pos.breakout_failed_count >= 2) {
      return { kind: "FULL_EXIT", reason: `Breakout failed — price returned to range twice`, price: currentPrice };
    }
  }

  // T3: Time stop
  const maxHold = pos.entry_strategy === "mean_reversion"
    ? profile.maxHoldMR
    : pos.entry_strategy === "breakout"
    ? profile.maxHoldBreakout
    : profile.maxHoldTrend;
  const barsHeld = businessDaysSince(pos.created_at);
  if (barsHeld >= maxHold) {
    return {
      kind: "FULL_EXIT",
      reason: pnlPct > 0
        ? `Time stop — taking the profit (+${(pnlPct * 100).toFixed(1)}%)`
        : `Time stop — dead capital (${(pnlPct * 100).toFixed(1)}%)`,
      price: currentPrice,
    };
  }

  return null; // no loss-exit triggered
}

function businessDaysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  const days = ms / 86400000;
  return Math.max(1, Math.round(days * (5 / 7)));
}

// ============================================================================
// ENTRY DECISION
// ============================================================================
function runEntryDecision(
  ticker: string,
  data: DataSet,
  macro: MacroContext | null,
  settings: Settings,
  openCount: number,
  totalNavExposurePct: number,
  todayPnlPct: number,
): EntryAction {
  // Daily loss limit — block all new entries
  if (todayPnlPct <= -settings.daily_loss_limit_pct) {
    return { kind: "BLOCKED", reason: `Daily loss limit (${todayPnlPct.toFixed(1)}% vs −${settings.daily_loss_limit_pct}% cap)` };
  }
  if (openCount >= settings.max_positions) {
    return { kind: "BLOCKED", reason: `Max positions reached (${openCount}/${settings.max_positions})` };
  }
  if (totalNavExposurePct >= settings.max_nav_exposure_pct) {
    return { kind: "BLOCKED", reason: `NAV exposure cap reached (${totalNavExposurePct.toFixed(0)}% / ${settings.max_nav_exposure_pct}%)` };
  }

  const sig = evaluateSignal(data, ticker, undefined, macro);
  if (!sig) return { kind: "HOLD", reason: "Insufficient data" };
  if (sig.decision === "HOLD") return { kind: "HOLD", reason: sig.reasoning };
  if (sig.conviction < settings.min_conviction) {
    return { kind: "HOLD", reason: `Conviction ${sig.conviction} < min ${settings.min_conviction}` };
  }

  // Size
  const headroom = (settings.max_nav_exposure_pct - totalNavExposurePct) / 100;
  const baseFrac = sig.kellyFraction;
  const cappedFrac = Math.min(baseFrac, settings.max_single_name_pct / 100, headroom);
  const currentPrice = data.close[data.close.length - 1];
  const targetDollars = settings.starting_nav * cappedFrac;

  if (targetDollars < currentPrice) {
    return { kind: "HOLD", reason: "Position too small after caps" };
  }

  // Hard stop at entry
  const profile = PROFILE_PARAMS[sig.profile];
  const params = sig.blendedParams ?? profile;
  const atr = sig.atr;
  const isLong = sig.decision === "BUY";
  const hardStop = isLong
    ? currentPrice - atr * params.hardStopATRMult
    : currentPrice + atr * params.hardStopATRMult;

  return {
    kind: "ENTER",
    conviction: sig.conviction,
    kellyFraction: cappedFrac,
    price: currentPrice,
    strategy: sig.strategy,
    profile: sig.profile,
    atr,
    hardStop,
    weeklyAlloc: sig.weeklyBias.targetAllocation,
    reasoning: sig.reasoning,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary = { users: 0, entries: 0, exits: 0, partials: 0, holds: 0, blocked: 0, errors: 0 };

  try {
    // 1. Active users
    const { data: settingsRows, error: sErr } = await supabase
      .from("autotrade_settings")
      .select("*")
      .eq("enabled", true);
    if (sErr) throw sErr;
    if (!settingsRows || settingsRows.length === 0) {
      return json({ status: "no-active-users", summary });
    }
    summary.users = settingsRows.length;

    // 2. Pre-fetch SPY for macro context (shared across all users)
    const spy = await fetchYahooData("SPY");
    const macro: MacroContext | null = spy ? { spyClose: spy.close } : null;

    // 3. Per-user processing — gated by per-user next_scan_at
    const now = new Date();
    let skippedNotDue = 0;
    for (const settingsRow of settingsRows) {
      const rawSettings = settingsRow as Settings;

      // Per-user cadence gate
      if (rawSettings.next_scan_at && new Date(rawSettings.next_scan_at) > now) {
        skippedNotDue++;
        continue;
      }

      const settings = resolveEffectiveSettings(rawSettings, macro);
      try {
        await processUser(supabase, settings, macro, summary);

        // Update cadence timestamps
        const intervalMin = rawSettings.advanced_mode
          ? rawSettings.scan_interval_minutes
          : algoScanIntervalMinutes(macro);
        const nextScan = new Date(now.getTime() + intervalMin * 60_000);
        await supabase.from("autotrade_settings")
          .update({ last_scan_at: now.toISOString(), next_scan_at: nextScan.toISOString() })
          .eq("user_id", rawSettings.user_id);
      } catch (err) {
        console.error(`User ${rawSettings.user_id} failed:`, err);
        summary.errors++;
        await supabase.from("autotrade_log").insert({
          user_id: rawSettings.user_id, ticker: "—", action: "ERROR",
          reason: (err as Error).message ?? "Unknown error",
        });
      }
    }
    (summary as Record<string, unknown>).skipped_not_due = skippedNotDue;

    return json({ status: "ok", summary });
  } catch (err) {
    console.error("AutoTrader top-level error:", err);
    return json({ status: "error", error: (err as Error).message, summary }, 500);
  }
});

// ── Per-user pipeline ─────────────────────────────────────────────────────
async function processUser(
  supabase: ReturnType<typeof createClient>,
  settings: Settings,
  macro: MacroContext | null,
  summary: { entries: number; exits: number; partials: number; holds: number; blocked: number; errors: number },
) {
  const userId = settings.user_id;

  // Load open positions + watchlist
  const [posRes, watchRes] = await Promise.all([
    supabase.from("virtual_positions").select("*").eq("user_id", userId).eq("status", "open"),
    supabase.from("watchlist").select("ticker").eq("user_id", userId).eq("asset_type", "stock"),
  ]);
  const positions = (posRes.data ?? []) as unknown as Position[];
  const watchlist = (watchRes.data ?? []).map((w: any) => String(w.ticker).toUpperCase());

  // Build deduped ticker list
  const allTickers = Array.from(new Set([
    ...positions.map(p => p.ticker.toUpperCase()),
    ...watchlist,
  ]));
  if (allTickers.length === 0) return;

  await batchFetch(allTickers);

  // Compute today's P&L (realized today + unrealized today vs entry)
  const today = new Date().toISOString().split("T")[0];
  const { data: closedToday } = await supabase
    .from("virtual_positions")
    .select("pnl, exit_date")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("exit_date", today);
  const realizedToday = (closedToday ?? []).reduce((s: number, p: any) => s + Number(p.pnl ?? 0), 0);

  // ── EXITS first ─────────────────────────────────────────────────────────
  let totalNavExposureDollars = 0;
  let unrealizedToday = 0;

  for (const pos of positions) {
    const data = priceCache.get(pos.ticker.toUpperCase());
    if (!data || data.close.length < 200) continue;
    const currentPrice = data.close[data.close.length - 1];
    totalNavExposureDollars += currentPrice * Number(pos.shares);
    const pnlDollars = pos.position_type === "long"
      ? (currentPrice - Number(pos.entry_price)) * Number(pos.shares)
      : (Number(pos.entry_price) - currentPrice) * Number(pos.shares);
    unrealizedToday += pnlDollars;

    // Live evaluateSignal output for thesis check
    let liveBias: "long" | "short" | "flat" | null = null;
    let liveDecision: "BUY" | "SHORT" | "HOLD" | null = null;
    let liveWeeklyAlloc = pos.entry_weekly_alloc ?? 0;
    let liveRsi = 50;
    try {
      const sig = evaluateSignal(data, pos.ticker, undefined, macro);
      if (sig) {
        liveBias = sig.weeklyBias.bias;
        liveDecision = sig.decision;
        liveWeeklyAlloc = sig.weeklyBias.targetAllocation;
      }
      const rsiArr = calculateRSI(data.close, 14);
      liveRsi = safeGet(rsiArr, 50);
    } catch (e) { console.warn("live signal eval failed", pos.ticker, e); }

    // Profile
    const cls = classifyStock(data.close, data.high, data.low, pos.ticker);
    const profile = cls.blendedParams ?? PROFILE_PARAMS[
      (pos.entry_profile as StockProfile) ?? cls.classification
    ];

    // Run loss + win in priority order (loss wins ties)
    const lossAct = runLossExit(pos, data, currentPrice, profile, liveDecision, liveBias, liveRsi);
    const action: ExitAction = lossAct ?? runWinExit(pos, data, currentPrice, profile, liveWeeklyAlloc);

    await executeExit(supabase, pos, action, profile, summary);
  }

  // ── ENTRIES ─────────────────────────────────────────────────────────────
  const refreshedOpenCount = positions.length - summary.exits; // approximate
  const navExposurePct = (totalNavExposureDollars / settings.starting_nav) * 100;
  const todayPnlPct = ((realizedToday + unrealizedToday) / settings.starting_nav) * 100;

  const heldTickers = new Set(positions.map(p => p.ticker.toUpperCase()));
  for (const ticker of watchlist) {
    if (heldTickers.has(ticker)) continue;

    // Cooldown check (most-recent close)
    const { data: lastClose } = await supabase
      .from("virtual_positions")
      .select("cooldown_until")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .order("closed_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const cd = lastClose?.[0]?.cooldown_until;
    if (cd && new Date(cd as string).getTime() > Date.now()) {
      continue; // silent skip — cooldowns are noisy
    }

    const data = priceCache.get(ticker);
    if (!data || data.close.length < 200) continue;

    const decision = runEntryDecision(
      ticker, data, macro, settings,
      refreshedOpenCount,
      navExposurePct,
      todayPnlPct,
    );

    if (decision.kind === "ENTER") {
      await executeEntry(supabase, settings, ticker, decision, summary);
      // Update local counters so the same scan doesn't blow past caps
      const dollars = decision.kellyFraction * settings.starting_nav;
      totalNavExposureDollars += dollars;
    } else if (decision.kind === "BLOCKED") {
      summary.blocked++;
      await supabase.from("autotrade_log").insert({
        user_id: userId, ticker, action: "BLOCKED", reason: decision.reason,
      });
    } else {
      summary.holds++;
    }
  }

  // Portfolio snapshot
  await supabase.from("virtual_portfolio_log").upsert(
    {
      user_id: userId, date: today,
      total_value: settings.starting_nav - totalNavExposureDollars + totalNavExposureDollars + unrealizedToday,
      cash: settings.starting_nav - totalNavExposureDollars,
      positions_value: totalNavExposureDollars,
    },
    { onConflict: "user_id,date" },
  );
}

// ── Execute helpers ───────────────────────────────────────────────────────
async function executeExit(
  supabase: ReturnType<typeof createClient>,
  pos: Position, action: ExitAction, profile: ProfileParams,
  summary: { exits: number; partials: number; holds: number },
) {
  if (action.kind === "HOLD") {
    summary.holds++;
    // Persist trailing/peak updates if changed
    const updates: Record<string, number> = {};
    if (action.peakUpdate != null && action.peakUpdate !== pos.peak_price) updates.peak_price = action.peakUpdate;
    if (action.trailingUpdate != null && action.trailingUpdate !== pos.trailing_stop_price) updates.trailing_stop_price = action.trailingUpdate;
    if (Object.keys(updates).length > 0) {
      await supabase.from("virtual_positions").update(updates).eq("id", pos.id);
    }
    return;
  }

  const isLong = pos.position_type === "long";
  const entry = Number(pos.entry_price);
  const pnlPct = isLong
    ? ((action.price - entry) / entry) * 100
    : ((entry - action.price) / entry) * 100;

  if (action.kind === "FULL_EXIT") {
    summary.exits++;
    const pnl = isLong
      ? (action.price - entry) * Number(pos.shares)
      : (entry - action.price) * Number(pos.shares);

    // Cooldown: 5–15 trading days based on profile
    const cdDays = pos.entry_profile === "value" ? 21
      : pos.entry_profile === "volatile" ? 11
      : pos.entry_profile === "index" ? 7
      : 14;
    const cooldownUntil = new Date(Date.now() + cdDays * 86400000).toISOString();

    await supabase.from("virtual_positions").update({
      status: "closed",
      exit_price: action.price,
      exit_date: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      exit_reason: action.reason,
      pnl,
      cooldown_until: cooldownUntil,
    }).eq("id", pos.id);

    await supabase.from("autotrade_log").insert({
      user_id: pos.user_id, ticker: pos.ticker, action: "FULL_EXIT",
      reason: action.reason, price: action.price, shares: pos.shares,
      pnl_pct: pnlPct, conviction: pos.entry_conviction, strategy: pos.entry_strategy,
      profile: pos.entry_profile, position_id: pos.id,
    });

    // Notify via sell_alerts (existing notification center reads this)
    await supabase.from("sell_alerts").insert({
      user_id: pos.user_id, ticker: pos.ticker,
      reason: `🤖 AutoTrader closed: ${action.reason}`,
      current_price: action.price, position_id: pos.id,
    });
    return;
  }

  if (action.kind === "PARTIAL_EXIT") {
    summary.partials++;
    const sharesToClose = Math.floor(Number(pos.shares) * action.pct);
    if (sharesToClose < 1) return;
    const remaining = Number(pos.shares) - sharesToClose;
    const partialPnl = isLong
      ? (action.price - entry) * sharesToClose
      : (entry - action.price) * sharesToClose;

    // Reduce shares on the open row
    await supabase.from("virtual_positions").update({ shares: remaining }).eq("id", pos.id);
    // Insert paired closed row for accounting
    await supabase.from("virtual_positions").insert({
      user_id: pos.user_id, ticker: pos.ticker,
      entry_price: entry, shares: sharesToClose,
      position_type: pos.position_type, signal_id: pos.signal_id,
      status: "closed", exit_price: action.price,
      exit_date: new Date().toISOString(), closed_at: new Date().toISOString(),
      exit_reason: `partial: ${action.reason}`, pnl: partialPnl,
      opened_by: pos.opened_by, entry_strategy: pos.entry_strategy,
      entry_profile: pos.entry_profile, entry_conviction: pos.entry_conviction,
    });

    await supabase.from("autotrade_log").insert({
      user_id: pos.user_id, ticker: pos.ticker, action: "PARTIAL_EXIT",
      reason: action.reason, price: action.price, shares: sharesToClose,
      pnl_pct: pnlPct, conviction: pos.entry_conviction, strategy: pos.entry_strategy,
      profile: pos.entry_profile, position_id: pos.id,
    });
  }
}

async function executeEntry(
  supabase: ReturnType<typeof createClient>,
  settings: Settings, ticker: string, e: Extract<EntryAction, { kind: "ENTER" }>,
  summary: { entries: number },
) {
  if (!settings.paper_mode) {
    // Live broker integration not implemented in v1
    await supabase.from("autotrade_log").insert({
      user_id: settings.user_id, ticker, action: "BLOCKED",
      reason: "Live mode not yet supported — enable paper_mode",
    });
    return;
  }

  const dollars = settings.starting_nav * e.kellyFraction;
  const shares = Math.floor(dollars / e.price);
  if (shares < 1) return;

  const positionType = (e.reasoning.toLowerCase().includes("short") ? "short" : "long");

  const { data: ins, error: insErr } = await supabase.from("virtual_positions").insert({
    user_id: settings.user_id, ticker, entry_price: e.price, shares,
    position_type: positionType,
    status: "open",
    opened_by: "autotrader",
    entry_atr: e.atr,
    entry_conviction: e.conviction,
    entry_strategy: e.strategy,
    entry_profile: e.profile,
    entry_weekly_alloc: e.weeklyAlloc,
    hard_stop_price: e.hardStop,
    trailing_stop_price: e.hardStop,
    peak_price: e.price,
  }).select("id").single();
  if (insErr) { console.error("entry insert failed", insErr); return; }

  summary.entries++;
  await supabase.from("autotrade_log").insert({
    user_id: settings.user_id, ticker, action: "ENTRY",
    reason: e.reasoning, price: e.price, shares,
    conviction: e.conviction, strategy: e.strategy, profile: e.profile,
    position_id: ins.id,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
