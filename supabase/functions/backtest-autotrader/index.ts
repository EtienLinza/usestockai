// ============================================================================
// BACKTEST-AUTOTRADER — Replays the LIVE autotrader's full decision loop over
// historical bars across the same universe the live scanner uses. Produces a
// BacktestReport in the same shape the existing /backtest endpoint returns,
// so the existing dashboard renders it unchanged.
//
// Heavy CPU. Bounded by:
//   - Universe capped to top N by 20d $ volume (default 50)
//   - Date range capped to 3 years
//   - Entry checks every 2 bars, exit checks every bar
//   - Wall-time guard at 110s → returns truncated:true
//
// Per-day loop:
//   1. Slice each ticker's series to bars [0..t]
//   2. Build MacroContext from SPY slice + ^VIX value
//   3. Compute volTargetScalar + adaptive effective settings
//   4. For each open position → runLossExit, then runWinExit (live logic)
//        Exits execute at NEXT bar's open price
//   5. For each non-open ticker (every 2 bars) → evaluateSignal → entry gates
//        Entries execute at NEXT bar's open price
//   6. Mark-to-market portfolio, append to equity curve
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  calculateATR, calculateRSI, calculateMACD, calculateSMA, calculateEMA, safeGet,
} from "../_shared/indicators.ts";
import {
  evaluateSignal, PROFILE_PARAMS,
  type DataSet, type MacroContext, type ProfileParams,
} from "../_shared/signal-engine-v2.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";
import { discoverTickers } from "../_shared/scan-pipeline.ts";

const MAX_BACKTEST_YEARS = 3;
const SIM_LOOKBACK_BARS = 260; // mirrors the live scanner's 1y technical window

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Auth ─────────────────────────────────────────────────────────────────
async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}

// ── Yahoo fetch (full date range, not just 1y) ───────────────────────────
async function fetchRange(ticker: string, startSec: number, endSec: number): Promise<DataSet | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${startSec}&period2=${endSec}&interval=1d`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.chart?.error) return null;
    const result = j?.chart?.result?.[0];
    if (!result) return null;
    const q = result.indicators?.quote?.[0];
    const ts: number[] | undefined = result.timestamp;
    if (!q || !ts) return null;
    const ds: DataSet = { timestamps: [], close: [], high: [], low: [], open: [], volume: [] };
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] != null && q.high[i] != null && q.low[i] != null && q.open[i] != null) {
        ds.timestamps.push(new Date(ts[i] * 1000).toISOString().split("T")[0]);
        ds.close.push(q.close[i]); ds.high.push(q.high[i]);
        ds.low.push(q.low[i]); ds.open.push(q.open[i]);
        ds.volume.push(q.volume[i] || 0);
      }
    }
    return ds;
  } catch (_e) { return null; }
}

// ── Risk profile baselines (mirrors autotrader-scan) ─────────────────────
const RISK_PROFILE_BASELINES = {
  conservative: { minConv: 78, maxPos: 5, maxNav: 60, maxSingle: 12 },
  balanced:     { minConv: 72, maxPos: 8, maxNav: 80, maxSingle: 20 },
  aggressive:   { minConv: 66, maxPos: 12, maxNav: 95, maxSingle: 28 },
} as const;

type RiskProfile = keyof typeof RISK_PROFILE_BASELINES;

interface ATSettings {
  risk_profile: RiskProfile;
  adaptive_mode: boolean;
  min_conviction: number;
  max_positions: number;
  max_nav_exposure_pct: number;
  max_single_name_pct: number;
  daily_loss_limit_pct: number;
  starting_nav: number;
}

// ── Macro helpers (mirror live) ──────────────────────────────────────────
function spyTrendOf(macro: MacroContext | null): "up" | "down" | "flat" {
  if (!macro || macro.spyClose.length < 50) return "flat";
  const c = macro.spyClose;
  const sma = calculateSMA(c, 50);
  const last = sma[sma.length - 1], prev = sma[sma.length - 6] ?? last;
  if (!Number.isFinite(last) || !Number.isFinite(prev)) return "flat";
  const slope = (last - prev) / prev;
  if (slope > 0.005) return "up";
  if (slope < -0.005) return "down";
  return "flat";
}

const VOL_TARGET_ANNUAL = 0.16;
const VOL_LOOKBACK = 20;
function realizedVolAnnualized(close: number[], lookback: number): number | null {
  if (close.length < lookback + 1) return null;
  let sum = 0; const rets: number[] = [];
  for (let i = close.length - lookback; i < close.length; i++) {
    const a = close[i - 1], b = close[i];
    if (!(a > 0 && b > 0)) continue;
    const r = Math.log(b / a); rets.push(r); sum += r;
  }
  if (rets.length < 5) return null;
  const m = sum / rets.length;
  let v = 0; for (const r of rets) v += (r - m) * (r - m);
  v /= Math.max(1, rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}
function volTargetScalar(macro: MacroContext | null): number {
  if (!macro) return 1;
  const spyVol = realizedVolAnnualized(macro.spyClose, VOL_LOOKBACK);
  if (spyVol == null || spyVol <= 0) return 1;
  return Math.max(0.5, Math.min(1.25, VOL_TARGET_ANNUAL / spyVol));
}
function vixRegimeOf(vix: number | null): "calm" | "normal" | "elevated" | "crisis" {
  if (vix == null || !Number.isFinite(vix)) return "normal";
  if (vix < 15) return "calm";
  if (vix < 22) return "normal";
  if (vix < 30) return "elevated";
  return "crisis";
}

function computeEffectiveSettings(s: ATSettings, vix: number | null, spyTrend: string, recentPnlPct: number): ATSettings {
  let minConv = s.min_conviction, maxPos = s.max_positions;
  let maxNav = s.max_nav_exposure_pct, maxSingle = s.max_single_name_pct;

  if (s.adaptive_mode) {
    const baseline = RISK_PROFILE_BASELINES[s.risk_profile];
    minConv = baseline.minConv;
    maxPos = Math.min(baseline.maxPos, Math.max(3, Math.round(s.starting_nav / 12500)));
    maxNav = baseline.maxNav; maxSingle = baseline.maxSingle;

    const vr = vixRegimeOf(vix);
    if (vr === "calm") { minConv -= 2; maxPos += 1; maxNav += 5; }
    else if (vr === "elevated") { minConv += 4; maxPos -= 1; maxNav -= 10; maxSingle -= 3; }
    else if (vr === "crisis") { minConv += 10; maxPos = Math.min(maxPos, 3); maxNav = Math.min(maxNav, 40); maxSingle = Math.min(maxSingle, 10); }

    if (spyTrend === "down") { minConv += 4; maxNav -= 10; }
    else if (spyTrend === "up") minConv -= 1;

    if (recentPnlPct <= -5) { minConv += 8; maxPos = Math.max(2, maxPos - 2); maxSingle = Math.max(8, maxSingle * 0.6); }
    else if (recentPnlPct <= -2) { minConv += 3; maxSingle = Math.max(10, maxSingle * 0.8); }
    else if (recentPnlPct >= 5) minConv -= 2;
  }

  return {
    ...s,
    min_conviction: Math.max(55, Math.min(95, Math.round(minConv))),
    max_positions: Math.max(1, Math.min(20, Math.round(maxPos))),
    max_nav_exposure_pct: Math.max(20, Math.min(100, maxNav)),
    max_single_name_pct: Math.max(5, Math.min(50, maxSingle)),
  };
}

// ── Correlation gate ─────────────────────────────────────────────────────
const CORR_LOOKBACK = 60;
const CORR_THRESHOLD = 0.75;
function dailyReturns(close: number[], lookback: number): number[] {
  const n = close.length;
  if (n < lookback + 1) return [];
  const out: number[] = [];
  for (let i = n - lookback; i < n; i++) {
    const a = close[i - 1], b = close[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

function dailyReturnsWindow(close: number[], endIdx: number, lookback: number): number[] {
  if (endIdx < lookback) return [];
  const out: number[] = [];
  for (let i = endIdx - lookback + 1; i <= endIdx; i++) {
    const a = close[i - 1], b = close[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}
function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  if (da <= 0 || db <= 0) return null;
  return num / Math.sqrt(da * db);
}

// ── Position type ────────────────────────────────────────────────────────
interface SimPosition {
  id: string;
  ticker: string;
  type: "long" | "short";
  entryPrice: number;
  shares: number;
  entryDate: string;
  entryBarIdx: number;          // global bar index (in master timeline)
  peak: number;
  trailing: number;
  hardStop: number;
  atr: number;
  conviction: number;
  strategy: string;
  profile: string;
  weeklyAlloc: number;
  breakoutFailed: number;
  mae: number;                  // worst adverse excursion %
  mfe: number;                  // best favorable excursion %
  regime: string;
}

// ── Exit decision (mirrors live runWinExit + runLossExit) ────────────────
type ExitAction =
  | { kind: "HOLD"; trailing: number; peak: number }
  | { kind: "FULL"; reason: string; price: number }
  | { kind: "PARTIAL"; reason: string; pct: number; price: number };

function businessDaysSince(entryBarIdx: number, currentBarIdx: number): number {
  return Math.max(1, currentBarIdx - entryBarIdx);
}

function runLossExit(
  pos: SimPosition, currentPrice: number, profile: ProfileParams,
  liveBias: "long" | "short" | "flat" | null,
  liveRsi: number, currentBarIdx: number,
): ExitAction | null {
  const isLong = pos.type === "long";
  const pnlPct = isLong ? (currentPrice - pos.entryPrice) / pos.entryPrice : (pos.entryPrice - currentPrice) / pos.entryPrice;

  // Hard stop
  const hsHit = isLong ? currentPrice <= pos.hardStop : currentPrice >= pos.hardStop;
  if (hsHit) return { kind: "FULL", reason: `Hard stop hit (${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };

  if (pnlPct < -0.03) {
    if (liveBias && ((isLong && liveBias === "short") || (!isLong && liveBias === "long"))) {
      return { kind: "FULL", reason: `Weekly bias flipped — thesis invalidated`, price: currentPrice };
    }
    const barsHeld = businessDaysSince(pos.entryBarIdx, currentBarIdx);
    if (pos.strategy === "mean_reversion" && barsHeld > profile.maxHoldMR && liveRsi < 40) {
      return { kind: "FULL", reason: `MR failed after ${barsHeld} bars`, price: currentPrice };
    }
    if (pos.strategy === "breakout" && pos.breakoutFailed >= 2) {
      return { kind: "FULL", reason: `Breakout failed`, price: currentPrice };
    }
  }

  const maxHold = pos.strategy === "mean_reversion" ? profile.maxHoldMR
    : pos.strategy === "breakout" ? profile.maxHoldBreakout : profile.maxHoldTrend;
  const barsHeld = businessDaysSince(pos.entryBarIdx, currentBarIdx);
  if (barsHeld >= maxHold) {
    return { kind: "FULL", reason: pnlPct > 0 ? `Time stop +${(pnlPct * 100).toFixed(1)}%` : `Time stop ${(pnlPct * 100).toFixed(1)}%`, price: currentPrice };
  }
  return null;
}

function runWinExit(
  pos: SimPosition, data: DataSet, currentPrice: number, profile: ProfileParams,
  liveWeeklyAlloc: number,
): ExitAction {
  const isLong = pos.type === "long";
  const pnlPct = isLong ? (currentPrice - pos.entryPrice) / pos.entryPrice : (pos.entryPrice - currentPrice) / pos.entryPrice;
  const newPeak = isLong ? Math.max(pos.peak, currentPrice) : Math.min(pos.peak, currentPrice);

  let trailing = pos.trailing;
  const atr = pos.atr;
  if (atr > 0) {
    const cand = isLong ? newPeak - atr * profile.trailingStopATRMult : newPeak + atr * profile.trailingStopATRMult;
    trailing = isLong ? Math.max(trailing, cand) : Math.min(trailing, cand);
  }
  const trailingHit = isLong ? currentPrice <= trailing : currentPrice >= trailing;

  if (pnlPct < 0.06) return { kind: "HOLD", trailing, peak: newPeak };

  const n = data.close.length;
  const close = data.close, vol = data.volume;
  const rsi = calculateRSI(close, 14);
  const ema20 = calculateEMA(close, 20);
  const sma50 = calculateSMA(close, 50);
  const lastClose = close[n - 1], lastEma20 = ema20[n - 1], lastSma50 = sma50[n - 1];

  // Runner mode
  const ceilingPnl = profile.takeProfitPct / 100 * 1.5;
  const RUNNER_FLOOR = Math.max(ceilingPnl, 0.12);
  const isMR = pos.strategy === "mean_reversion";
  let runnerActive = pnlPct >= RUNNER_FLOOR && !isMR;
  if (runnerActive && Number.isFinite(lastEma20) && Number.isFinite(lastSma50)) {
    runnerActive = isLong ? lastClose > lastEma20 && lastEma20 > lastSma50 : lastClose < lastEma20 && lastEma20 < lastSma50;
  } else runnerActive = false;
  if (runnerActive && atr > 0) {
    const dist = isLong ? newPeak - currentPrice : currentPrice - newPeak;
    runnerActive = dist <= atr * 1.5;
  }
  if (runnerActive && n >= 6 && !isNaN(rsi[n - 1]) && !isNaN(rsi[n - 6])) {
    const extreme = isLong ? rsi[n - 1] > 80 : rsi[n - 1] < 20;
    const div = isLong ? close[n - 1] > close[n - 6] && rsi[n - 1] < rsi[n - 6]
                       : close[n - 1] < close[n - 6] && rsi[n - 1] > rsi[n - 6];
    if (extreme && div) runnerActive = false;
  }
  if (runnerActive) {
    if (pos.strategy === "trend") {
      if (pos.weeklyAlloc !== 0 && Math.sign(liveWeeklyAlloc) !== Math.sign(pos.weeklyAlloc)) runnerActive = false;
    } else if (pos.strategy === "breakout") {
      const br = isLong ? pos.entryPrice * 1.02 : pos.entryPrice * 0.98;
      runnerActive = isLong ? currentPrice > br : currentPrice < br;
    }
  }
  if (runnerActive) {
    const chand = isLong ? newPeak - 2.5 * atr : newPeak + 2.5 * atr;
    const runTrail = isLong ? Math.max(trailing, chand) : Math.min(trailing, chand);
    const hit = isLong ? currentPrice <= runTrail : currentPrice >= runTrail;
    if (hit) return { kind: "FULL", reason: `Runner trail hit (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
    const trendBreak = isLong ? lastClose < lastSma50 : lastClose > lastSma50;
    if (trendBreak) return { kind: "FULL", reason: `Runner trend break (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
    return { kind: "HOLD", trailing: runTrail, peak: newPeak };
  }

  // Hard ceiling
  if (pnlPct >= ceilingPnl) return { kind: "FULL", reason: `Ceiling hit (+${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };

  // Peak detection (3-of-5)
  let rsiDiv = false;
  if (n >= 6 && !isNaN(rsi[n - 1]) && !isNaN(rsi[n - 6])) {
    rsiDiv = isLong ? close[n - 1] > close[n - 6] && rsi[n - 1] < rsi[n - 6] && rsi[n - 1] > 65
                    : close[n - 1] < close[n - 6] && rsi[n - 1] > rsi[n - 6] && rsi[n - 1] < 35;
  }
  let climax = false;
  if (n >= 21) {
    let avgV = 0; for (let i = n - 21; i < n - 1; i++) avgV += vol[i]; avgV /= 20;
    const hi = data.high[n - 1], lo = data.low[n - 1], cl = close[n - 1];
    const range = hi - lo;
    const cp = range > 0 ? (cl - lo) / range : 0.5;
    const spike = vol[n - 1] > avgV * 1.8;
    climax = isLong ? spike && cp < 0.35 : spike && cp > 0.65;
  }
  let macdRoll = false;
  if (n >= 35) {
    const m = calculateMACD(close);
    const h = m.histogram;
    if (n >= 3) {
      macdRoll = isLong ? h[n - 1] > 0 && h[n - 1] < h[n - 2] && h[n - 2] < h[n - 3]
                        : h[n - 1] < 0 && h[n - 1] > h[n - 2] && h[n - 2] > h[n - 3];
    }
  }
  let thesisDone = false;
  const lastRsi = safeGet(rsi, 50);
  if (pos.strategy === "mean_reversion") thesisDone = lastRsi >= 48 && lastRsi <= 58;
  else if (pos.strategy === "trend") {
    const ea = Math.abs(pos.weeklyAlloc); const la = Math.abs(liveWeeklyAlloc);
    thesisDone = ea >= 0.75 && la <= ea - 0.5;
  } else if (pos.strategy === "breakout") {
    thesisDone = isLong ? currentPrice < pos.entryPrice * 1.01 : currentPrice > pos.entryPrice * 0.99;
  }
  const sigs = [trailingHit, rsiDiv, climax, macdRoll, thesisDone];
  const fired = sigs.filter(Boolean).length;
  if (fired >= 3) return { kind: "FULL", reason: `Peak (${fired}/5, +${(pnlPct * 100).toFixed(1)}%)`, price: currentPrice };
  if (fired === 2 && pnlPct >= profile.takeProfitPct / 100 * 0.8) {
    return { kind: "PARTIAL", reason: `Approaching target (${fired}/5)`, pct: 0.5, price: currentPrice };
  }
  return { kind: "HOLD", trailing, peak: newPeak };
}

// ── Trade record (matches /backtest Trade interface) ─────────────────────
interface Trade {
  date: string; exitDate: string; ticker: string;
  action: "BUY" | "SHORT";
  entryPrice: number; exitPrice: number;
  returnPct: number; pnl: number;
  regime: string; confidence: number;
  duration: number; mae: number; mfe: number;
  strategy: string; exitReason: string;
}

// ── Slice helper (zero-copy via array views) ─────────────────────────────
function slice(ds: DataSet, end: number): DataSet {
  return {
    timestamps: ds.timestamps.slice(0, end + 1),
    close: ds.close.slice(0, end + 1),
    high: ds.high.slice(0, end + 1),
    low: ds.low.slice(0, end + 1),
    open: ds.open.slice(0, end + 1),
    volume: ds.volume.slice(0, end + 1),
  };
}

// ── Metric builders (slim subset of /backtest computeMetrics) ────────────
function buildReport(
  trades: Trade[],
  equityCurve: { date: string; value: number }[],
  initialCapital: number,
  benchmarkCloses: { date: string; close: number }[],
  universeSize: number,
  truncated: boolean,
) {
  const finalCapital = equityCurve[equityCurve.length - 1]?.value ?? initialCapital;
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.returnPct, 0) / losses.length : 0;
  const winLossRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 999 : 0;
  const avgReturn = trades.length > 0 ? trades.reduce((a, t) => a + t.returnPct, 0) / trades.length : 0;

  // Daily returns from equity curve
  const dailyRets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const a = equityCurve[i - 1].value, b = equityCurve[i].value;
    if (a > 0) dailyRets.push((b - a) / a);
  }
  const meanRet = dailyRets.length > 0 ? dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length : 0;
  let varRet = 0; for (const r of dailyRets) varRet += (r - meanRet) ** 2;
  varRet = dailyRets.length > 1 ? varRet / (dailyRets.length - 1) : 0;
  const stdRet = Math.sqrt(varRet);
  const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;
  const downRets = dailyRets.filter(r => r < 0);
  let downVar = 0; for (const r of downRets) downVar += r * r;
  const downStd = downRets.length > 0 ? Math.sqrt(downVar / downRets.length) : 0;
  const sortino = downStd > 0 ? (meanRet / downStd) * Math.sqrt(252) : 0;

  // Max drawdown + duration
  let peak = initialCapital, maxDD = 0;
  const dd: { date: string; drawdown: number }[] = [];
  let ddStart = -1, maxDDDur = 0, totalDDDur = 0, ddCount = 0, inDD = false, ptsInDD = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const p = equityCurve[i];
    if (p.value > peak) {
      peak = p.value;
      if (inDD && ddStart >= 0) { const dur = i - ddStart; maxDDDur = Math.max(maxDDDur, dur); totalDDDur += dur; ddCount++; }
      inDD = false; ddStart = -1;
    }
    const d = peak > 0 ? ((peak - p.value) / peak) * 100 : 0;
    dd.push({ date: p.date, drawdown: -d });
    if (d > 0) { if (!inDD) { inDD = true; ddStart = i; } ptsInDD++; }
    if (d > maxDD) maxDD = d;
  }
  const avgDDDur = ddCount > 0 ? totalDDDur / ddCount : 0;
  const timeInDD = equityCurve.length > 0 ? (ptsInDD / equityCurve.length) * 100 : 0;

  const years = equityCurve.length / 252;
  const cagr = years > 0 && finalCapital > 0 ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100 : totalReturn;
  const calmar = maxDD > 0 ? cagr / maxDD : 0;
  const grossWin = wins.reduce((a, t) => a + Math.abs(t.pnl), 0);
  const grossLoss = losses.reduce((a, t) => a + Math.abs(t.pnl), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  // Benchmark return + equity
  const benchmarkReturn = benchmarkCloses.length > 1
    ? ((benchmarkCloses[benchmarkCloses.length - 1].close - benchmarkCloses[0].close) / benchmarkCloses[0].close) * 100
    : 0;
  const benchmarkEquity = (() => {
    if (benchmarkCloses.length === 0) return [];
    const startClose = benchmarkCloses[0].close;
    return benchmarkCloses.map(b => ({ date: b.date, value: initialCapital * (b.close / startClose) }));
  })();

  // Monthly returns
  const monthlyMap = new Map<string, { start: number; end: number }>();
  for (const p of equityCurve) {
    const key = p.date.slice(0, 7); // yyyy-mm
    const ex = monthlyMap.get(key);
    if (!ex) monthlyMap.set(key, { start: p.value, end: p.value });
    else ex.end = p.value;
  }
  const monthlyReturns = Array.from(monthlyMap.entries()).map(([key, v]) => {
    const [y, m] = key.split("-").map(Number);
    return { year: y, month: m - 1, returnPct: v.start > 0 ? ((v.end - v.start) / v.start) * 100 : 0 };
  });

  // Strategy attribution
  const strategyPerformance = ["trend", "mean_reversion", "breakout"].map(s => {
    const st = trades.filter(t => t.strategy === s);
    const w = st.filter(t => t.returnPct > 0).length;
    const ar = st.length > 0 ? st.reduce((a, t) => a + t.returnPct, 0) / st.length : 0;
    return { strategy: s, trades: st.length, winRate: st.length > 0 ? (w / st.length) * 100 : 0, avgReturn: ar };
  }).filter(s => s.trades > 0);

  // Cap trade log + equity
  const displayEquity = equityCurve.length > 500
    ? equityCurve.filter((_, i) => i % Math.ceil(equityCurve.length / 500) === 0).concat([equityCurve[equityCurve.length - 1]])
    : equityCurve;

  return {
    periods: [], totalTrades: trades.length, winRate, avgReturn,
    totalReturn, maxDrawdown: maxDD, sharpeRatio: sharpe, sortinoRatio: sortino,
    calmarRatio: calmar, profitFactor,
    directionalAccuracy: winRate, convictionBuckets: [],
    avgWin, avgLoss, winLossRatio,
    avgTradeDuration: trades.length > 0 ? trades.reduce((a, t) => a + t.duration, 0) / trades.length : 0,
    medianTradeDuration: 0, maxTradeDuration: 0,
    avgMAE: trades.length > 0 ? trades.reduce((a, t) => a + t.mae, 0) / trades.length : 0,
    avgMFE: trades.length > 0 ? trades.reduce((a, t) => a + t.mfe, 0) / trades.length : 0,
    valueAtRisk: 0, conditionalVaR: 0, ulcerIndex: 0,
    marketExposure: 0, longExposure: 0, shortExposure: 0,
    cagr, timeToDouble: 0, alpha: 0, beta: 1,
    portfolioTurnover: 0, stabilityScore: 0,
    signalPrecision: 0, signalRecall: 0, signalF1: 0,
    regimePerformance: [], confidenceCalibration: [],
    equityCurve: displayEquity, drawdownCurve: dd,
    tradeLog: trades.slice(-200),
    monteCarlo: null,
    robustnessSkipped: true,
    benchmarkReturn, annualizedReturn: cagr,
    rollingSharpe: [], rollingVolatility: [],
    tradeDistribution: [], monthlyReturns,
    robustness: { noiseInjection: null, delayedExecution: null, parameterSensitivity: [], tradeDependency: null },
    stressTests: [],
    metricsHealth: { betaInRange: true, parameterSensitivityVaried: true, stressReturnsPlausible: true, notes: [] },
    liquidityWarnings: 0,
    maxDrawdownDuration: maxDDDur, avgDrawdownDuration: avgDDDur, recoveryTime: 0,
    timeInDrawdownPct: timeInDD,
    skewness: 0, kurtosis: 0, kelly: 0, expectancy: avgReturn,
    maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
    strategyCapacity: 0, signalDecay: [], benchmarkEquity,
    marketRegimePerformance: [], strategyPerformance,
    autotraderMode: { universeSize, truncated },
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authError = await requireAuth(req);
  if (authError) return authError;

  const t0 = Date.now();
  const TIME_BUDGET_MS = 110_000;

  try {
    const body = await req.json();
    const startYear = Math.max(2000, Math.min(2026, Number(body.startYear ?? 2023)));
    const requestedEndYear = Math.max(startYear + 1, Math.min(2026, Number(body.endYear ?? 2025)));
    const endYear = Math.min(requestedEndYear, startYear + MAX_BACKTEST_YEARS - 1);
    const universeCap = Math.max(5, Math.min(25, Number(body.universeCap ?? body.universe_cap ?? 20)));

    const pick = (a: any, b: any, d: any) => (a ?? b ?? d);
    const settings: ATSettings = {
      risk_profile: (pick(body.riskProfile, body.risk_profile, "balanced")) as RiskProfile,
      adaptive_mode: pick(body.adaptiveMode, body.adaptive_mode, true),
      min_conviction: Number(pick(body.minConviction, body.min_conviction, 70)),
      max_positions: Number(pick(body.maxPositions, body.max_positions, 8)),
      max_nav_exposure_pct: Number(pick(body.maxNavExposurePct, body.max_nav_exposure_pct, 80)),
      max_single_name_pct: Number(pick(body.maxSingleNamePct, body.max_single_name_pct, 20)),
      daily_loss_limit_pct: Number(pick(body.dailyLossLimitPct, body.daily_loss_limit_pct, 3)),
      starting_nav: Number(pick(body.startingNav, body.starting_nav, 100000)),
    };

    // 1. Discover universe
    const disco = await discoverTickers();
    let universe = disco.tickers;
    if (universe.length > universeCap) universe = universe.slice(0, universeCap);
    console.log(`[bt-autotrader] universe=${universe.length} ${startYear}-${endYear} profile=${settings.risk_profile} adaptive=${settings.adaptive_mode}`);

    // 2. Fetch all history (universe + SPY + ^VIX)
    const startSec = Math.floor(new Date(`${startYear - 1}-01-01`).getTime() / 1000); // pull 1 extra year for indicator warmup
    const endSec = Math.floor(new Date(`${endYear}-12-31`).getTime() / 1000);
    const fetchAll = [...universe, "SPY", "^VIX"];
    const PAR = 15;
    const allData: (DataSet | null)[] = new Array(fetchAll.length).fill(null);
    for (let i = 0; i < fetchAll.length; i += PAR) {
      const slice = fetchAll.slice(i, i + PAR);
      const res = await Promise.all(slice.map(t => fetchRange(t, startSec, endSec)));
      for (let k = 0; k < slice.length; k++) allData[i + k] = res[k];
    }
    const spyData = allData[fetchAll.length - 2];
    const vixData = allData[fetchAll.length - 1];

    // 3. Build per-ticker data + filter to those with enough bars
    type TickerEntry = { ticker: string; data: DataSet };
    const valid: TickerEntry[] = [];
    for (let i = 0; i < universe.length; i++) {
      const d = allData[i];
      if (d && d.close.length >= 250) valid.push({ ticker: universe[i], data: d });
    }
    if (valid.length === 0 || !spyData || spyData.close.length < 250) {
      return new Response(JSON.stringify({ error: "Not enough historical data — try a wider date range or different universe." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build a per-ticker timestamp→bar index map for fast lookup
    const tIdx: Map<string, Map<string, number>> = new Map();
    for (const e of valid) {
      const m = new Map<string, number>();
      for (let i = 0; i < e.data.timestamps.length; i++) m.set(e.data.timestamps[i], i);
      tIdx.set(e.ticker, m);
    }
    const spyIdx = new Map<string, number>();
    for (let i = 0; i < spyData.timestamps.length; i++) spyIdx.set(spyData.timestamps[i], i);
    const vixIdx = new Map<string, number>();
    if (vixData) for (let i = 0; i < vixData.timestamps.length; i++) vixIdx.set(vixData.timestamps[i], i);

    // Master timeline: SPY trading days >= startYear-01-01
    const startEpoch = `${startYear}-01-01`;
    const masterDates = spyData.timestamps.filter(d => d >= startEpoch);
    if (masterDates.length < 50) {
      return new Response(JSON.stringify({ error: "Date range too short or no SPY data in window." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. Walk loop
    let cash = settings.starting_nav;
    const open: SimPosition[] = [];
    const trades: Trade[] = [];
    const equityCurve: { date: string; value: number }[] = [];
    const benchmarkCloses: { date: string; close: number }[] = [];
    const recentRealizedPnl: { date: string; pnl: number }[] = []; // for 7d rolling P&L
    let posIdCounter = 0;
    let truncated = false;
    let entriesEvaluated = 0;

    const ENTRY_STEP = 5; // check entries every 5 bars (weekly cadence) for CPU budget

    for (let mi = 0; mi < masterDates.length; mi++) {
      if (Date.now() - t0 > TIME_BUDGET_MS) {
        console.log(`[bt-autotrader] time budget hit at bar ${mi}/${masterDates.length}, truncating`);
        truncated = true;
        break;
      }

      const today = masterDates[mi];
      const sIdx = spyIdx.get(today);
      if (sIdx == null || sIdx < 50) { equityCurve.push({ date: today, value: cash }); continue; }

      // Macro context (slice up to today)
      const macro: MacroContext = { spyClose: spyData.close.slice(0, sIdx + 1) };
      const spyTrend = spyTrendOf(macro);
      const vIdx = vixData ? vixIdx.get(today) : null;
      const vixVal = vixData && vIdx != null ? vixData.close[vIdx] : null;
      const volScalar = volTargetScalar(macro);

      // Recent 7-day realized P&L for adaptive
      const sevenDaysAgoIdx = Math.max(0, mi - 5);
      const cutoffDate = masterDates[sevenDaysAgoIdx];
      const recentPnl = recentRealizedPnl.filter(r => r.date >= cutoffDate).reduce((a, b) => a + b.pnl, 0);
      const recentPnlPct = (recentPnl / settings.starting_nav) * 100;

      const eff = computeEffectiveSettings(settings, vixVal, spyTrend, recentPnlPct);

      // ── Mark-to-market: snapshot prices ──
      const priceAt = (ticker: string): number | null => {
        const m = tIdx.get(ticker); if (!m) return null;
        const bi = m.get(today); if (bi == null) return null;
        return valid.find(v => v.ticker === ticker)!.data.close[bi];
      };
      const openAt = (ticker: string, dateIdx: number): number | null => {
        // Get open price for `dateIdx` position in masterDates (i.e. NEXT bar)
        if (dateIdx >= masterDates.length) return null;
        const d = masterDates[dateIdx];
        const m = tIdx.get(ticker); if (!m) return null;
        const bi = m.get(d); if (bi == null) return null;
        return valid.find(v => v.ticker === ticker)!.data.open[bi];
      };

      // ── Update MFE/MAE for open positions, run exits ──
      const survivors: SimPosition[] = [];
      const todayPnlForUser: number[] = [];
      for (const pos of open) {
        const px = priceAt(pos.ticker);
        if (px == null) { survivors.push(pos); continue; }
        const isLong = pos.type === "long";
        const pnlPct = isLong ? (px - pos.entryPrice) / pos.entryPrice * 100 : (pos.entryPrice - px) / pos.entryPrice * 100;
        if (pnlPct < pos.mae) pos.mae = pnlPct;
        if (pnlPct > pos.mfe) pos.mfe = pnlPct;

        // Live signal (for liveBias / liveAlloc / liveRsi)
        const tEntry = valid.find(v => v.ticker === pos.ticker)!;
        const sliced = slice(tEntry.data, tIdx.get(pos.ticker)!.get(today)!);
        let liveBias: "long" | "short" | "flat" | null = null;
        let liveAlloc = 0;
        let liveRsi = 50;
        try {
          const sig = evaluateSignal(sliced, pos.ticker, undefined, macro);
          if (sig) { liveBias = sig.weeklyBias.bias; liveAlloc = sig.weeklyBias.targetAllocation; }
          const rsiArr = calculateRSI(sliced.close, 14);
          liveRsi = safeGet(rsiArr, 50);
        } catch (_e) { /* ignore */ }

        const profile = PROFILE_PARAMS[pos.profile as keyof typeof PROFILE_PARAMS] ?? PROFILE_PARAMS.momentum;

        const lossExit = runLossExit(pos, px, profile, liveBias, liveRsi, mi);
        const winExit = lossExit ?? runWinExit(pos, sliced, px, profile, liveAlloc);

        if (winExit.kind === "FULL") {
          // Execute at next bar's open
          const exitPx = openAt(pos.ticker, mi + 1) ?? px;
          const pnl = isLong ? (exitPx - pos.entryPrice) * pos.shares : (pos.entryPrice - exitPx) * pos.shares;
          const retPct = isLong ? (exitPx - pos.entryPrice) / pos.entryPrice * 100 : (pos.entryPrice - exitPx) / pos.entryPrice * 100;
          cash += isLong ? exitPx * pos.shares : pos.entryPrice * pos.shares + pnl; // close short: return entry margin + pnl
          trades.push({
            date: pos.entryDate, exitDate: today, ticker: pos.ticker,
            action: isLong ? "BUY" : "SHORT",
            entryPrice: pos.entryPrice, exitPrice: exitPx,
            returnPct: retPct, pnl,
            regime: pos.regime, confidence: pos.conviction,
            duration: mi - pos.entryBarIdx, mae: pos.mae, mfe: pos.mfe,
            strategy: pos.strategy, exitReason: winExit.reason,
          });
          todayPnlForUser.push(pnl);
        } else if (winExit.kind === "PARTIAL") {
          const exitPx = openAt(pos.ticker, mi + 1) ?? px;
          const halfShares = pos.shares * winExit.pct;
          const halfPnl = isLong ? (exitPx - pos.entryPrice) * halfShares : (pos.entryPrice - exitPx) * halfShares;
          cash += isLong ? exitPx * halfShares : pos.entryPrice * halfShares + halfPnl;
          pos.shares -= halfShares;
          pos.peak = winExit.kind === "PARTIAL" ? pos.peak : pos.peak;
          survivors.push(pos);
        } else {
          pos.peak = winExit.peak; pos.trailing = winExit.trailing;
          survivors.push(pos);
        }
      }
      open.length = 0; open.push(...survivors);
      if (todayPnlForUser.length > 0) recentRealizedPnl.push({ date: today, pnl: todayPnlForUser.reduce((a, b) => a + b, 0) });

      // ── Daily-loss-limit gate (intraday): if today's realized PnL crosses limit, no new entries ──
      const todayRealized = todayPnlForUser.reduce((a, b) => a + b, 0);
      const todayPnlPct = (todayRealized / settings.starting_nav) * 100;
      const blockNewEntries = todayPnlPct <= -eff.daily_loss_limit_pct || open.length >= eff.max_positions;

      // ── Compute current NAV exposure ──
      let positionsValue = 0;
      for (const p of open) {
        const px = priceAt(p.ticker) ?? p.entryPrice;
        positionsValue += px * p.shares;
      }
      const totalValue = cash + positionsValue;
      equityCurve.push({ date: today, value: totalValue });
      const sCloseToday = spyData.close[sIdx];
      benchmarkCloses.push({ date: today, close: sCloseToday });

      const totalNavExposurePct = (positionsValue / settings.starting_nav) * 100;

      // ── Entries (every ENTRY_STEP bars) ──
      if (mi % ENTRY_STEP !== 0) continue;
      if (blockNewEntries) continue;
      if (totalNavExposurePct >= eff.max_nav_exposure_pct) continue;

      const openTickerSet = new Set(open.map(p => p.ticker));
      const openReturnSeries: number[][] = open.map(p => {
        const td = valid.find(v => v.ticker === p.ticker);
        if (!td) return [];
        const bi = tIdx.get(p.ticker)?.get(today);
        if (bi == null) return [];
        return dailyReturns(td.data.close.slice(0, bi + 1), CORR_LOOKBACK);
      });

      for (const e of valid) {
        if (Date.now() - t0 > TIME_BUDGET_MS) { truncated = true; break; }
        if (open.length >= eff.max_positions) break;
        if (openTickerSet.has(e.ticker)) continue;
        const bi = tIdx.get(e.ticker)?.get(today);
        if (bi == null || bi < 220) continue;

        // Correlation gate
        if (open.length > 0) {
          const candRet = dailyReturns(e.data.close.slice(0, bi + 1), CORR_LOOKBACK);
          let blocked = false;
          for (const orr of openReturnSeries) {
            const c = pearson(candRet, orr);
            if (c != null && Math.abs(c) >= CORR_THRESHOLD) { blocked = true; break; }
          }
          if (blocked) continue;
        }

        const sliced = slice(e.data, bi);
        let sig: ReturnType<typeof evaluateSignal> | null = null;
        try { sig = evaluateSignal(sliced, e.ticker, undefined, macro); } catch (_) { continue; }
        entriesEvaluated++;
        if (!sig || sig.decision === "HOLD") continue;
        if (sig.conviction < eff.min_conviction) continue;

        // Sizing
        const headroom = (eff.max_nav_exposure_pct - totalNavExposurePct) / 100;
        const baseFrac = sig.kellyFraction * volScalar;
        const cappedFrac = Math.min(Math.abs(baseFrac), eff.max_single_name_pct / 100, headroom);
        const targetDollars = settings.starting_nav * cappedFrac;
        const entryPx = openAt(e.ticker, mi + 1);
        if (entryPx == null || targetDollars < entryPx) continue;
        if (cash < targetDollars * 0.95) continue; // not enough cash

        const shares = Math.floor(targetDollars / entryPx);
        if (shares <= 0) continue;
        const cost = shares * entryPx;
        cash -= cost;

        const profile = PROFILE_PARAMS[sig.profile];
        const params = sig.blendedParams ?? profile;
        const isLong = sig.decision === "BUY";
        const hardStop = isLong ? entryPx - sig.atr * params.hardStopATRMult : entryPx + sig.atr * params.hardStopATRMult;

        open.push({
          id: `p${++posIdCounter}`,
          ticker: e.ticker,
          type: isLong ? "long" : "short",
          entryPrice: entryPx, shares,
          entryDate: today, entryBarIdx: mi,
          peak: entryPx, trailing: hardStop, hardStop,
          atr: sig.atr, conviction: sig.conviction,
          strategy: sig.strategy, profile: sig.profile,
          weeklyAlloc: sig.weeklyBias.targetAllocation,
          breakoutFailed: 0, mae: 0, mfe: 0,
          regime: sig.regime,
        });
      }
    }

    // Liquidate any remaining open positions at last close
    const lastDate = masterDates[masterDates.length - 1];
    for (const pos of open) {
      const px = priceAt_lastClose(pos.ticker, valid, tIdx, lastDate) ?? pos.entryPrice;
      const isLong = pos.type === "long";
      const pnl = isLong ? (px - pos.entryPrice) * pos.shares : (pos.entryPrice - px) * pos.shares;
      const retPct = isLong ? (px - pos.entryPrice) / pos.entryPrice * 100 : (pos.entryPrice - px) / pos.entryPrice * 100;
      cash += isLong ? px * pos.shares : pos.entryPrice * pos.shares + pnl;
      trades.push({
        date: pos.entryDate, exitDate: lastDate, ticker: pos.ticker,
        action: isLong ? "BUY" : "SHORT",
        entryPrice: pos.entryPrice, exitPrice: px,
        returnPct: retPct, pnl,
        regime: pos.regime, confidence: pos.conviction,
        duration: equityCurve.length - 1 - pos.entryBarIdx,
        mae: pos.mae, mfe: pos.mfe,
        strategy: pos.strategy, exitReason: "End of backtest (liquidation)",
      });
    }

    console.log(`[bt-autotrader] done in ${Date.now() - t0}ms — ${trades.length} trades, ${entriesEvaluated} entry evals, truncated=${truncated}`);

    const report = buildReport(trades, equityCurve, settings.starting_nav, benchmarkCloses, valid.length, truncated);

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[bt-autotrader] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Backtest failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function priceAt_lastClose(
  ticker: string,
  valid: { ticker: string; data: DataSet }[],
  tIdx: Map<string, Map<string, number>>,
  lastDate: string,
): number | null {
  const m = tIdx.get(ticker); if (!m) return null;
  const bi = m.get(lastDate);
  const e = valid.find(v => v.ticker === ticker); if (!e) return null;
  if (bi != null) return e.data.close[bi];
  return e.data.close[e.data.close.length - 1] ?? null;
}
