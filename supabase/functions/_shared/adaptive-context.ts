// ============================================================================
// ADAPTIVE-CONTEXT — shared adaptive-tuning primitives.
//
// SINGLE SOURCE OF TRUTH. Both the live autotrader (autotrader-scan) and the
// portfolio backtest (backtest-sim) import from here. Any change to regime,
// VIX, vol-target, drawdown, or profile logic MUST live in this file — never
// duplicate in a call site. Divergence between live and backtest is a bug.
// ============================================================================
import { calculateSMA, type MacroContext } from "./signal-engine-v2.ts";

// ── Rolling drawdown circuit breaker ────────────────────────────────────────
export const ROLLING_DD_HARD_BLOCK_PCT = 10;

// ── CDaR (Conditional Drawdown-at-Risk) circuit breaker ─────────────────────
export const CDAR_ALPHA = 0.95;
export const CDAR_HARD_BLOCK_PCT = 12;
export const CDAR_HALF_EXPOSURE_PCT = 8;
export const CDAR_TIGHTEN_PCT = 5;

// ── Risk profile baselines ──────────────────────────────────────────────────
export const RISK_PROFILE_BASELINES = {
  conservative: { minConv: 78, maxPos: 5, maxNav: 60, maxSingle: 12 },
  balanced:     { minConv: 72, maxPos: 8, maxNav: 80, maxSingle: 20 },
  aggressive:   { minConv: 66, maxPos: 12, maxNav: 95, maxSingle: 28 },
} as const;
export type RiskProfileName = keyof typeof RISK_PROFILE_BASELINES;

// ── Vol-targeting constants ─────────────────────────────────────────────────
export const VOL_TARGET_ANNUAL = 0.16;
export const VOL_LOOKBACK = 63;
export const VOL_LOOKBACK_FAST = 20;
export const VOL_SCALAR_MIN = 0.5;
export const VOL_SCALAR_MAX = 1.25;

// ── Correlation gate ────────────────────────────────────────────────────────
export const CORR_LOOKBACK_BARS = 60;

// ── Types shared between live + backtest ────────────────────────────────────
export interface AdaptiveSettings {
  adaptive_mode: boolean;
  advanced_mode: boolean;
  risk_profile: RiskProfileName;
  starting_nav: number;
  min_conviction: number;
  max_positions: number;
  max_nav_exposure_pct: number;
  max_single_name_pct: number;
  daily_loss_limit_pct: number;
}

export interface EffectiveSettings extends AdaptiveSettings {
  current_drawdown_pct: number;
  current_cdar_pct: number;
}

export interface AdaptiveContext {
  vix: number | null;
  vixRegime: "calm" | "normal" | "elevated" | "crisis";
  spyTrend: "up" | "down" | "flat";
  recentPnlPct: number;
  windowDays: number;
  rollingDrawdownPct: number;
  rollingCdarPct: number;
  adjustments: string[];
}

// ── Regime helpers ──────────────────────────────────────────────────────────
export function spyTrendOf(macro: MacroContext | null): "up" | "down" | "flat" {
  if (!macro || macro.spyClose.length < 50) return "flat";
  const c = macro.spyClose;
  const sma = calculateSMA(c, 50);
  const last = sma[sma.length - 1];
  const prev = sma[sma.length - 6] ?? last;
  if (!Number.isFinite(last) || !Number.isFinite(prev)) return "flat";
  const slope = (last - prev) / prev;
  if (slope > 0.005) return "up";
  if (slope < -0.005) return "down";
  return "flat";
}

export function isBearishMacro(macro: MacroContext | null): boolean {
  return spyTrendOf(macro) === "down";
}

export function vixRegimeOf(vix: number | null): "calm" | "normal" | "elevated" | "crisis" {
  if (vix == null || !Number.isFinite(vix)) return "normal";
  if (vix < 15) return "calm";
  if (vix < 22) return "normal";
  if (vix < 30) return "elevated";
  return "crisis";
}

export function realizedVolAnnualized(close: number[], lookback: number): number | null {
  if (close.length < lookback + 1) return null;
  let sum = 0; const rets: number[] = [];
  for (let i = close.length - lookback; i < close.length; i++) {
    const a = close[i - 1], b = close[i];
    if (!(a > 0 && b > 0)) continue;
    const r = Math.log(b / a);
    rets.push(r); sum += r;
  }
  if (rets.length < 5) return null;
  const m = sum / rets.length;
  let v = 0; for (const r of rets) v += (r - m) * (r - m);
  v /= Math.max(1, rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

export function volTargetScalar(
  macro: MacroContext | null,
): { scalar: number; spyVol: number | null; spyVolFast: number | null } {
  if (!macro) return { scalar: 1, spyVol: null, spyVolFast: null };
  let spyVol = realizedVolAnnualized(macro.spyClose, VOL_LOOKBACK);
  const spyVolFast = realizedVolAnnualized(macro.spyClose, VOL_LOOKBACK_FAST);
  if (spyVol == null || spyVol <= 0) spyVol = spyVolFast;
  if (spyVol == null || spyVol <= 0) return { scalar: 1, spyVol: null, spyVolFast };
  const raw = VOL_TARGET_ANNUAL / spyVol;
  const scalar = Math.max(VOL_SCALAR_MIN, Math.min(VOL_SCALAR_MAX, raw));
  return { scalar, spyVol, spyVolFast };
}

// ── Correlation gate ────────────────────────────────────────────────────────
export function adaptiveCorrThreshold(
  marketRegime: string | null | undefined,
  vixRegime: "calm" | "normal" | "elevated" | "crisis",
): number {
  let t = 0.75;
  switch (marketRegime) {
    case "bull_quiet":     t = 0.80; break;
    case "bull_volatile":  t = 0.68; break;
    case "bear_quiet":     t = 0.68; break;
    case "bear_volatile":  t = 0.60; break;
    default:               t = 0.75;
  }
  if (vixRegime === "crisis")   t = Math.min(t, 0.58);
  else if (vixRegime === "elevated") t = Math.min(t, 0.66);
  return t;
}

export function dailyReturns(close: number[], lookback: number): number[] {
  const n = close.length;
  if (n < lookback + 1) return [];
  const out: number[] = [];
  for (let i = n - lookback; i < n; i++) {
    const prev = close[i - 1], cur = close[i];
    if (prev > 0 && cur > 0) out.push(Math.log(cur / prev));
  }
  return out;
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 60) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}

// ── Core adaptive-tuning engine ─────────────────────────────────────────────
// Ports the exact math from autotrader-scan `computeEffectiveSettings`. If you
// touch this, update ONE place — this is the source of truth.
export function computeEffectiveSettings<S extends AdaptiveSettings>(
  s: S,
  ctx: AdaptiveContext,
  regimeFloors: Record<string, number> | null,
): S & { current_drawdown_pct: number; current_cdar_pct: number } {
  const adjustments: string[] = [];

  let minConv: number;
  let maxPos: number;
  let maxNav: number;
  let maxSingle: number;

  if (s.adaptive_mode) {
    const baseline = RISK_PROFILE_BASELINES[s.risk_profile];
    minConv = baseline.minConv;
    maxPos = Math.min(baseline.maxPos, Math.max(3, Math.round(s.starting_nav / 12500)));
    maxNav = baseline.maxNav;
    maxSingle = baseline.maxSingle;
    adjustments.push(`base: ${s.risk_profile} profile`);
  } else if (s.advanced_mode) {
    minConv = s.min_conviction;
    maxPos = s.max_positions;
    maxNav = s.max_nav_exposure_pct;
    maxSingle = s.max_single_name_pct;
  } else {
    const baseline = RISK_PROFILE_BASELINES[s.risk_profile];
    minConv = baseline.minConv;
    maxPos = Math.min(baseline.maxPos, Math.max(3, Math.round(s.starting_nav / 12500)));
    maxNav = baseline.maxNav;
    maxSingle = baseline.maxSingle;
  }

  if (s.adaptive_mode) {
    const baselineMaxNav = maxNav;
    const vixVal = ctx.vix ?? 18;
    const vixScore = vixVal <= 14 ? 1.0
      : vixVal <= 18 ? 1.0 - 0.3 * ((vixVal - 14) / 4)
      : vixVal <= 25 ? 0.7 - 0.3 * ((vixVal - 18) / 7)
      : vixVal <= 35 ? 0.4 - 0.3 * ((vixVal - 25) / 10)
      : vixVal <= 45 ? 0.1 - 0.1 * ((vixVal - 35) / 10)
      : 0;
    const spyScore = ctx.spyTrend === "up" ? 1.0 : ctx.spyTrend === "flat" ? 0.7 : 0.3;
    const regimeScore = Math.max(0, Math.min(1, 0.6 * vixScore + 0.4 * spyScore));
    maxNav = Math.max(30, Math.min(baselineMaxNav, baselineMaxNav * (0.4 + 0.6 * regimeScore)));
    adjustments.push(`continuous regime NAV: vix=${vixVal.toFixed(1)} spy=${ctx.spyTrend} score=${regimeScore.toFixed(2)} → ${maxNav.toFixed(0)}% (base ${baselineMaxNav})`);

    switch (ctx.vixRegime) {
      case "calm":
        minConv -= 2; maxPos += 1;
        adjustments.push(`calm VIX (${ctx.vix?.toFixed(1) ?? "?"}): −2 conv, +1 pos`);
        break;
      case "normal":
        break;
      case "elevated":
        minConv += 4; maxPos -= 1; maxSingle -= 3;
        adjustments.push(`elevated VIX (${ctx.vix?.toFixed(1) ?? "?"}): +4 conv, −1 pos, −3 single`);
        break;
      case "crisis":
        minConv += 10; maxPos = Math.min(maxPos, 3); maxSingle = Math.min(maxSingle, 10);
        adjustments.push(`crisis VIX (${ctx.vix?.toFixed(1) ?? "?"}): +10 conv, hard caps applied`);
        break;
    }

    if (ctx.spyTrend === "down") {
      minConv += 4;
      adjustments.push(`SPY downtrend: +4 conv`);
    } else if (ctx.spyTrend === "up") {
      minConv -= 1;
      adjustments.push(`SPY uptrend: −1 conv`);
    }

    if (ctx.recentPnlPct <= -5) {
      minConv += 8; maxPos = Math.max(2, maxPos - 2); maxSingle = Math.max(8, maxSingle * 0.6);
      adjustments.push(`drawdown ${ctx.recentPnlPct.toFixed(1)}%: +8 conv, tighter caps`);
    } else if (ctx.recentPnlPct <= -2) {
      minConv += 3; maxSingle = Math.max(10, maxSingle * 0.8);
      adjustments.push(`mild drawdown ${ctx.recentPnlPct.toFixed(1)}%: +3 conv`);
    } else if (ctx.recentPnlPct >= 5) {
      minConv -= 2;
      adjustments.push(`strong P&L +${ctx.recentPnlPct.toFixed(1)}%: −2 conv`);
    }

    const dd = ctx.rollingDrawdownPct;
    if (dd >= 8) {
      minConv += 6; maxPos = Math.max(1, maxPos - 2); maxNav = Math.min(maxNav, maxNav * 0.6);
      adjustments.push(`30d drawdown ${dd.toFixed(1)}%: +6 conv, NAV×0.6`);
    } else if (dd >= 5) {
      minConv += 3; maxNav = Math.min(maxNav, maxNav * 0.8);
      adjustments.push(`30d drawdown ${dd.toFixed(1)}%: +3 conv, NAV×0.8`);
    }

    const cdar = ctx.rollingCdarPct;
    if (cdar >= CDAR_HALF_EXPOSURE_PCT) {
      minConv += 5; maxNav = Math.min(maxNav, maxNav * 0.5);
      adjustments.push(`CDaR ${cdar.toFixed(1)}%: +5 conv, NAV×0.5`);
    } else if (cdar >= CDAR_TIGHTEN_PCT) {
      minConv += 2; maxNav = Math.min(maxNav, maxNav * 0.85);
      adjustments.push(`CDaR ${cdar.toFixed(1)}%: +2 conv, NAV×0.85`);
    }

    if (regimeFloors) {
      const regimeKey = ctx.spyTrend === "down" ? "bear" : ctx.vixRegime === "calm" ? "bull" : "neutral";
      const calFloor = Number(regimeFloors[regimeKey]);
      if (Number.isFinite(calFloor) && calFloor > minConv) {
        adjustments.push(`calibration floor (${regimeKey}): conv raised ${minConv}→${calFloor}`);
        minConv = calFloor;
      }
    }
  }

  minConv = Math.max(55, Math.min(95, Math.round(minConv)));
  maxPos = Math.max(1, Math.min(20, Math.round(maxPos)));
  maxNav = Math.max(20, Math.min(100, maxNav));
  maxSingle = Math.max(5, Math.min(50, maxSingle));

  ctx.adjustments = adjustments;

  return {
    ...s,
    min_conviction: minConv,
    max_positions: maxPos,
    max_nav_exposure_pct: maxNav,
    max_single_name_pct: maxSingle,
    daily_loss_limit_pct: s.daily_loss_limit_pct,
    current_drawdown_pct: ctx.rollingDrawdownPct,
    current_cdar_pct: ctx.rollingCdarPct,
  };
}

// ── Rolling drawdown helpers ────────────────────────────────────────────────
// Compute peak-to-current drawdown + CDaR on a NAV history window.
export function computeRollingDrawdown(navHistory: number[], windowBars = 30): {
  drawdownPct: number; cdarPct: number;
} {
  if (navHistory.length < 2) return { drawdownPct: 0, cdarPct: 0 };
  const window = navHistory.slice(-windowBars);
  let peak = window[0];
  const dds: number[] = [];
  for (const n of window) {
    if (n > peak) peak = n;
    const dd = peak > 0 ? ((peak - n) / peak) * 100 : 0;
    dds.push(dd);
  }
  const drawdownPct = dds[dds.length - 1];
  // CDaR: mean of worst 5% of drawdowns
  const sorted = [...dds].sort((a, b) => b - a);
  const tailSize = Math.max(1, Math.floor(sorted.length * (1 - CDAR_ALPHA)));
  const tail = sorted.slice(0, tailSize);
  const cdarPct = tail.reduce((s, x) => s + x, 0) / tail.length;
  return { drawdownPct, cdarPct };
}
