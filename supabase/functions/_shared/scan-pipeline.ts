// ============================================================================
// SCAN-PIPELINE — shared helpers used by scan-orchestrator, scan-worker, and
// prefetch-bars. Lifted verbatim from market-scanner so behaviour is identical.
// ============================================================================

import {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateADX,
  safeGet,
} from "./indicators.ts";
import { fetchDailyHistory } from "./yahoo-history.ts";
import type { DataSet } from "./signal-engine-v2.ts";

// ── TICKER REGEX ────────────────────────────────────────────────────────────
export const TICKER_REGEX = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

// ── SECTOR ETF MAP ──────────────────────────────────────────────────────────
export const TICKER_TO_SECTOR_ETF: Record<string, string> = {
  AAPL: "XLK", MSFT: "XLK", NVDA: "XLK", GOOGL: "XLK", META: "XLK", AVGO: "XLK",
  CRM: "XLK", AMD: "XLK", ADBE: "XLK", ORCL: "XLK", INTC: "XLK", CSCO: "XLK",
  ACN: "XLK", IBM: "XLK", NOW: "XLK", UBER: "XLK", SHOP: "XLK", SQ: "XLK",
  SNOW: "XLK", PLTR: "XLK", NET: "XLK", CRWD: "XLK", PANW: "XLK", DDOG: "XLK",
  UNH: "XLV", JNJ: "XLV", LLY: "XLV", PFE: "XLV", ABBV: "XLV", MRK: "XLV",
  TMO: "XLV", ABT: "XLV", BMY: "XLV", AMGN: "XLV", GILD: "XLV", ISRG: "XLV",
  JPM: "XLF", V: "XLF", MA: "XLF", BAC: "XLF", GS: "XLF", MS: "XLF",
  BLK: "XLF", AXP: "XLF", C: "XLF", WFC: "XLF", SCHW: "XLF",
  AMZN: "XLY", TSLA: "XLY", HD: "XLY", MCD: "XLY", NKE: "XLY", SBUX: "XLY",
  LOW: "XLY", TJX: "XLY", BKNG: "XLY", CMG: "XLY",
  NFLX: "XLC", DIS: "XLC", CMCSA: "XLC", T: "XLC", VZ: "XLC", TMUS: "XLC",
  CAT: "XLI", HON: "XLI", UPS: "XLI", BA: "XLI", GE: "XLI", RTX: "XLI", DE: "XLI",
  LMT: "XLI", FDX: "XLI", MMM: "XLI",
  PG: "XLP", KO: "XLP", PEP: "XLP", COST: "XLP", WMT: "XLP", PM: "XLP",
  CL: "XLP", MDLZ: "XLP",
  XOM: "XLE", CVX: "XLE", COP: "XLE", SLB: "XLE", EOG: "XLE", MPC: "XLE",
  NEE: "XLU", DUK: "XLU", SO: "XLU", AEP: "XLU", D: "XLU",
  PLD: "XLRE", AMT: "XLRE", CCI: "XLRE", SPG: "XLRE",
  LIN: "XLB", APD: "XLB", SHW: "XLB", FCX: "XLB", NEM: "XLB",
};
export const SECTOR_ETFS = ["XLK", "XLV", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC"];

export type SectorMomentum = Record<string, number>;

export async function fetchSectorMomentum(): Promise<SectorMomentum> {
  const momentum: SectorMomentum = {};
  const results = await Promise.all(SECTOR_ETFS.map(etf => fetchDailyHistory(etf, "2mo")));
  for (let i = 0; i < SECTOR_ETFS.length; i++) {
    const data = results[i];
    if (data && data.close.length >= 21) {
      const cur = data.close[data.close.length - 1];
      const past = data.close[data.close.length - 21];
      momentum[SECTOR_ETFS[i]] = ((cur - past) / past) * 100;
    } else {
      momentum[SECTOR_ETFS[i]] = 0;
    }
  }
  return momentum;
}

export function getSectorConvictionModifier(ticker: string, sectorMomentum: SectorMomentum) {
  const etf = TICKER_TO_SECTOR_ETF[ticker.toUpperCase()];
  if (!etf || !sectorMomentum[etf]) return { bonus: 0, label: "" };
  const all = Object.values(sectorMomentum).sort((a, b) => b - a);
  const rank = all.indexOf(sectorMomentum[etf]);
  if (rank < 3) return { bonus: 4, label: `Sector tailwind (${etf} top ${rank + 1})` };
  if (rank >= all.length - 3) return { bonus: -4, label: `Sector headwind (${etf} bottom ${all.length - rank})` };
  return { bonus: 0, label: "" };
}

// ── MACRO REGIME ────────────────────────────────────────────────────────────
export interface MacroRegime {
  score: number; label: string;
  trend: number; volatility: number; breadth: number; credit: number;
  spyClose: number[]; vixLevel: number | null; notes: string;
}
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const pctChange = (a: number[], lb: number) => {
  if (a.length <= lb) return null;
  const x = a[a.length - 1], y = a[a.length - 1 - lb];
  if (!y) return null;
  return ((x - y) / y) * 100;
};

export async function computeMacroRegime(): Promise<MacroRegime> {
  const [spy, vix, hyg, lqd, rsp] = await Promise.all([
    fetchDailyHistory("SPY", "1y"),
    fetchDailyHistory("^VIX", "3mo"),
    fetchDailyHistory("HYG", "6mo"),
    fetchDailyHistory("LQD", "6mo"),
    fetchDailyHistory("RSP", "6mo"),
  ]);
  const notes: string[] = [];
  const spyClose = spy?.close ?? [];

  let trend = 50;
  if (spyClose.length >= 200) {
    const sma50 = calculateSMA(spyClose, 50);
    const sma200 = calculateSMA(spyClose, 200);
    const px = spyClose[spyClose.length - 1];
    const s50 = safeGet(sma50, px), s200 = safeGet(sma200, px);
    const s200_20ago = sma200[sma200.length - 21] ?? s200;
    const slope = s200_20ago > 0 ? ((s200 - s200_20ago) / s200_20ago) * 100 : 0;
    let t = 50;
    if (px > s50) t += 15;
    if (px > s200) t += 20;
    if (s50 > s200) t += 10;
    t += Math.max(-15, Math.min(15, slope * 5));
    trend = clamp(t);
    notes.push(`trend px${px > s200 ? ">" : "<"}200SMA slope=${slope.toFixed(2)}%`);
  }

  let vol = 50, vixLevel: number | null = null;
  if (vix && vix.close.length > 0) {
    vixLevel = vix.close[vix.close.length - 1];
    if (vixLevel <= 12) vol = 100;
    else if (vixLevel >= 40) vol = 0;
    else vol = clamp(100 - ((vixLevel - 12) / 28) * 100);
    notes.push(`vix=${vixLevel.toFixed(1)}`);
  }

  let breadth = 50;
  if (rsp && spyClose.length >= 61 && rsp.close.length >= 61) {
    const r = pctChange(rsp.close, 60), s = pctChange(spyClose, 60);
    if (r !== null && s !== null) breadth = clamp(50 + (r - s) * 10);
  }

  let credit = 50;
  if (hyg && lqd && hyg.close.length >= 61 && lqd.close.length >= 61) {
    const ratio: number[] = [];
    const minLen = Math.min(hyg.close.length, lqd.close.length);
    for (let i = 0; i < minLen; i++) if (lqd.close[i] > 0) ratio.push(hyg.close[i] / lqd.close[i]);
    const r = pctChange(ratio, 60);
    if (r !== null) credit = clamp(50 + r * 25);
  }

  const score = Math.round((trend + vol + breadth + credit) / 4);
  const label = score >= 65 ? "risk_on" : score <= 40 ? "risk_off" : "neutral";
  return {
    score, label,
    trend: Math.round(trend), volatility: Math.round(vol),
    breadth: Math.round(breadth), credit: Math.round(credit),
    spyClose, vixLevel, notes: notes.join(" | "),
  };
}

export function macroFloorAdjust(s: number): number {
  if (s <= 30) return 12;
  if (s <= 40) return 8;
  if (s <= 55) return 3;
  if (s < 65) return 0;
  if (s < 80) return -3;
  return -5;
}

// ── DYNAMIC TICKER DISCOVERY ───────────────────────────────────────────────
const SCREENER_IDS = [
  "most_actives", "day_gainers", "day_losers",
  "undervalued_growth_stocks", "undervalued_large_caps",
  "growth_technology_stocks", "aggressive_small_caps",
  "small_cap_gainers", "high_yield_bond", "portfolio_anchors",
  "solid_large_growth_funds", "top_mutual_funds",
];
const SCREENER_COUNT = 100;

export const FALLBACK_TICKERS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AVGO", "AMZN", "TSLA",
  "JPM", "V", "MA", "UNH", "JNJ", "LLY", "XOM", "CVX",
];

interface ScreenerQuote {
  symbol: string; marketCap?: number;
  averageDailyVolume3Month?: number; regularMarketVolume?: number;
  quoteType?: string;
}

async function fetchIndexConstituents(): Promise<string[]> {
  const sources = [
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
    "https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed-symbols.csv",
  ];
  const out: string[] = [];
  await Promise.all(sources.map(async url => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      const text = await r.text();
      for (const line of text.split("\n").slice(1)) {
        const sym = line.split(",")[0]?.trim().toUpperCase();
        if (sym && TICKER_REGEX.test(sym)) out.push(sym);
      }
    } catch (e) { console.warn(`index ${url}`, e); }
  }));
  return Array.from(new Set(out));
}

async function fetchScreenerTickers(id: string): Promise<ScreenerQuote[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${id}&count=${SCREENER_COUNT}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.finance?.result?.[0]?.quotes || []).map((q: any) => ({
      symbol: q.symbol, marketCap: q.marketCap,
      averageDailyVolume3Month: q.averageDailyVolume3Month,
      regularMarketVolume: q.regularMarketVolume, quoteType: q.quoteType,
    }));
  } catch { return []; }
}

function preFilterQuotes(quotes: ScreenerQuote[]): string[] {
  const out: string[] = [];
  for (const q of quotes) {
    if (!q.symbol || !TICKER_REGEX.test(q.symbol)) continue;
    if (q.quoteType && q.quoteType !== "EQUITY") continue;
    if (q.marketCap != null && q.marketCap < 1_000_000_000) continue;
    const vol = q.averageDailyVolume3Month || q.regularMarketVolume || 0;
    if (vol < 500_000) continue;
    out.push(q.symbol);
  }
  return out;
}

export interface DiscoveryResult {
  tickers: string[];
  breakdown: {
    indexCount: number; screenerCount: number; overlapCount: number;
    fallbackUsed: boolean;
    perScreener: Record<string, number>;
    sampleTickers: { index: string[]; screeners: Record<string, string[]> };
  };
}

export async function discoverTickers(): Promise<DiscoveryResult> {
  const [indexTickers, ...screenerResults] = await Promise.all([
    fetchIndexConstituents(),
    ...SCREENER_IDS.map(id => fetchScreenerTickers(id)),
  ]);
  const perScreener: Record<string, number> = {};
  const sampleScreeners: Record<string, string[]> = {};
  const allQuotes: ScreenerQuote[] = [];
  SCREENER_IDS.forEach((id, i) => {
    const q = screenerResults[i] || [];
    const filt = preFilterQuotes(q);
    perScreener[id] = filt.length;
    sampleScreeners[id] = filt.slice(0, 8);
    allQuotes.push(...q);
  });
  const screenerTickers = preFilterQuotes(allQuotes);
  const indexSet = new Set(indexTickers);
  const overlap = [...new Set(screenerTickers)].filter(t => indexSet.has(t)).length;
  const merged = Array.from(new Set([...indexTickers, ...screenerTickers]));
  let fallbackUsed = false;
  let final = merged;
  if (final.length < 50) {
    final = Array.from(new Set([...final, ...FALLBACK_TICKERS]));
    fallbackUsed = true;
  }
  return {
    tickers: final,
    breakdown: {
      indexCount: indexTickers.length,
      screenerCount: screenerTickers.length,
      overlapCount: overlap, fallbackUsed,
      perScreener,
      sampleTickers: { index: indexTickers.slice(0, 8), screeners: sampleScreeners },
    },
  };
}

// ── PRE-SCREEN ──────────────────────────────────────────────────────────────
// Fast rejection pass: if a ticker can't possibly satisfy any of the strategy
// gates inside evaluateSignal(), skip the deep analysis. Conservative bounds
// ensure no true-positive is dropped.
export function preScreen(data: DataSet): boolean {
  const n = data.close.length;
  if (n < 200) return false;
  const close = data.close, volume = data.volume;

  // Liquidity: 20d avg dollar volume >= $5M
  let dv = 0, count = Math.min(20, n);
  for (let i = n - count; i < n; i++) dv += (close[i] || 0) * (volume[i] || 0);
  const adv = dv / count;
  if (adv < 5_000_000) return false;

  // Cheap signal probes
  const adx = calculateADX(data.high, data.low, close, 14);
  const adxV = safeGet(adx.adx, 0);
  const rsi = calculateRSI(close, 14);
  const rsiV = safeGet(rsi, 50);

  const last20 = close.slice(-20);
  const hi20 = Math.max(...last20);
  const lo20 = Math.min(...last20);
  const px = close[n - 1];
  const nearHi = px >= hi20 * 0.97;
  const nearLo = px <= lo20 * 1.03;

  // Trend OR mean-reversion OR breakout candidate
  if (adxV > 18) return true;
  if (rsiV < 32 || rsiV > 68) return true;
  if (nearHi || nearLo) return true;

  // Momentum-pullback candidate (price near 20-EMA in uptrend)
  const ema20 = calculateEMA(close, 20);
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);
  const e20 = safeGet(ema20, px), s50 = safeGet(sma50, px), s200 = safeGet(sma200, px);
  if (px > s200 && px > s50 && Math.abs(px - e20) / e20 < 0.025) return true;

  return false;
}
