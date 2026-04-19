import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// TECHNICAL INDICATORS — imported from canonical shared module
// (See supabase/functions/_shared/indicators.ts)
// ============================================================================
import {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateADX,
  calculateStochastic,
  calculateATR,
  calculateVolatility,
  calculateOBV,
  safeGet,
} from "../_shared/indicators.ts";

// ============================================================================
// [NEW] DIVERGENCE DETECTION (ported from stock-predict)
// ============================================================================

function detectDivergence(close: number[], indicator: number[], lookback: number = 20): { bullish: boolean; bearish: boolean } {
  const n = close.length;
  if (n < lookback + 5) return { bullish: false, bearish: false };

  const recentClose = close.slice(n - lookback);
  const recentInd = indicator.slice(n - lookback);

  // Find two most recent swing lows/highs
  let bullish = false;
  let bearish = false;

  // Bullish: price makes lower low, indicator makes higher low
  let priceLow1 = Infinity, priceLow1Idx = -1;
  let priceLow2 = Infinity, priceLow2Idx = -1;
  for (let i = 2; i < recentClose.length - 2; i++) {
    if (recentClose[i] <= recentClose[i - 1] && recentClose[i] <= recentClose[i - 2] &&
        recentClose[i] <= recentClose[i + 1] && recentClose[i] <= recentClose[i + 2]) {
      if (priceLow1Idx === -1) { priceLow1 = recentClose[i]; priceLow1Idx = i; }
      else if (i - priceLow1Idx >= 3) { priceLow2 = recentClose[i]; priceLow2Idx = i; }
    }
  }
  if (priceLow1Idx >= 0 && priceLow2Idx > priceLow1Idx) {
    const ind1 = recentInd[priceLow1Idx];
    const ind2 = recentInd[priceLow2Idx];
    if (!isNaN(ind1) && !isNaN(ind2) && priceLow2 < priceLow1 && ind2 > ind1) {
      bullish = true;
    }
  }

  // Bearish: price makes higher high, indicator makes lower high
  let priceHigh1 = -Infinity, priceHigh1Idx = -1;
  let priceHigh2 = -Infinity, priceHigh2Idx = -1;
  for (let i = 2; i < recentClose.length - 2; i++) {
    if (recentClose[i] >= recentClose[i - 1] && recentClose[i] >= recentClose[i - 2] &&
        recentClose[i] >= recentClose[i + 1] && recentClose[i] >= recentClose[i + 2]) {
      if (priceHigh1Idx === -1) { priceHigh1 = recentClose[i]; priceHigh1Idx = i; }
      else if (i - priceHigh1Idx >= 3) { priceHigh2 = recentClose[i]; priceHigh2Idx = i; }
    }
  }
  if (priceHigh1Idx >= 0 && priceHigh2Idx > priceHigh1Idx) {
    const ind1 = recentInd[priceHigh1Idx];
    const ind2 = recentInd[priceHigh2Idx];
    if (!isNaN(ind1) && !isNaN(ind2) && priceHigh2 > priceHigh1 && ind2 < ind1) {
      bearish = true;
    }
  }

  return { bullish, bearish };
}

// ============================================================================
// [NEW] RELATIVE STRENGTH vs SPY
// ============================================================================

function calculateRelativeStrength(stockClose: number[], spyClose: number[], period: number = 20): number {
  const sLen = Math.min(stockClose.length, spyClose.length);
  if (sLen < period + 1) return 0;
  const stockReturn = (stockClose[sLen - 1] - stockClose[sLen - 1 - period]) / stockClose[sLen - 1 - period];
  const spyReturn = (spyClose[sLen - 1] - spyClose[sLen - 1 - period]) / spyClose[sLen - 1 - period];
  return (stockReturn - spyReturn) * 100; // percentage points of outperformance
}

// ============================================================================
// SIGNAL ENGINE — imported from canonical shared module
// (See supabase/functions/_shared/signal-engine.ts)
// ============================================================================
import {
  aggregateToWeekly,
  computeWeeklyBias,
  hasDailyEntrySignal,
  classifyStockSimple,
  PROFILE_WEEKLY_PARAMS,
  INDEX_TICKERS,
  type DataSet,
  type StockProfile,
  type WeeklyBias,
} from "../_shared/signal-engine.ts";


// ============================================================================
// [NEW] SECTOR ROTATION — ticker-to-sector ETF mapping
// ============================================================================

const TICKER_TO_SECTOR_ETF: Record<string, string> = {
  // Technology
  AAPL: "XLK", MSFT: "XLK", NVDA: "XLK", GOOGL: "XLK", META: "XLK", AVGO: "XLK",
  CRM: "XLK", AMD: "XLK", ADBE: "XLK", ORCL: "XLK", INTC: "XLK", CSCO: "XLK",
  ACN: "XLK", IBM: "XLK", NOW: "XLK", UBER: "XLK", SHOP: "XLK", SQ: "XLK",
  SNOW: "XLK", PLTR: "XLK", NET: "XLK", CRWD: "XLK", PANW: "XLK", DDOG: "XLK",
  // Healthcare
  UNH: "XLV", JNJ: "XLV", LLY: "XLV", PFE: "XLV", ABBV: "XLV", MRK: "XLV",
  TMO: "XLV", ABT: "XLV", BMY: "XLV", AMGN: "XLV", GILD: "XLV", ISRG: "XLV",
  // Financials
  JPM: "XLF", V: "XLF", MA: "XLF", BAC: "XLF", GS: "XLF", MS: "XLF",
  BLK: "XLF", AXP: "XLF", C: "XLF", WFC: "XLF", SCHW: "XLF",
  // Consumer Discretionary
  AMZN: "XLY", TSLA: "XLY", HD: "XLY", MCD: "XLY", NKE: "XLY", SBUX: "XLY",
  LOW: "XLY", TJX: "XLY", BKNG: "XLY", CMG: "XLY",
  // Communication Services
  NFLX: "XLC", DIS: "XLC", CMCSA: "XLC", T: "XLC", VZ: "XLC", TMUS: "XLC",
  // Industrials
  CAT: "XLI", HON: "XLI", UPS: "XLI", BA: "XLI", GE: "XLI", RTX: "XLI", DE: "XLI",
  LMT: "XLI", FDX: "XLI", MMM: "XLI",
  // Consumer Staples
  PG: "XLP", KO: "XLP", PEP: "XLP", COST: "XLP", WMT: "XLP", PM: "XLP",
  CL: "XLP", MDLZ: "XLP",
  // Energy
  XOM: "XLE", CVX: "XLE", COP: "XLE", SLB: "XLE", EOG: "XLE", MPC: "XLE",
  // Utilities
  NEE: "XLU", DUK: "XLU", SO: "XLU", AEP: "XLU", D: "XLU",
  // Real Estate
  PLD: "XLRE", AMT: "XLRE", CCI: "XLRE", SPG: "XLRE",
  // Materials
  LIN: "XLB", APD: "XLB", SHW: "XLB", FCX: "XLB", NEM: "XLB",
};

const SECTOR_ETFS = ["XLK", "XLV", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC"];

interface SectorMomentum {
  [etf: string]: number; // 20-day return as %
}

async function fetchSectorMomentum(): Promise<SectorMomentum> {
  const momentum: SectorMomentum = {};
  const results = await Promise.all(SECTOR_ETFS.map(etf => fetchYahooData(etf, "2mo")));
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

function getSectorConvictionModifier(ticker: string, sectorMomentum: SectorMomentum): { bonus: number; label: string } {
  const etf = TICKER_TO_SECTOR_ETF[ticker.toUpperCase()];
  if (!etf || !sectorMomentum[etf]) return { bonus: 0, label: "" };

  const allMomentums = Object.values(sectorMomentum).sort((a, b) => b - a);
  const rank = allMomentums.indexOf(sectorMomentum[etf]);
  const totalSectors = allMomentums.length;

  if (rank < 3) return { bonus: 4, label: `Sector tailwind (${etf} top ${rank + 1})` };
  if (rank >= totalSectors - 3) return { bonus: -4, label: `Sector headwind (${etf} bottom ${totalSectors - rank})` };
  return { bonus: 0, label: "" };
}

// ============================================================================
// SIGNAL STRENGTH / CONVICTION COMPUTATION (ENHANCED)
// ============================================================================

interface SpyContext {
  spyBearish: boolean;
  spyClose: number[];
}

function computeSignalConviction(
  close: number[], high: number[], low: number[], volume: number[],
  spyContext: SpyContext | null,
  sectorMomentum: SectorMomentum,
  ticker: string,
): { conviction: number; regime: string; strategy: string; reasoning: string; annualizedVol: number } {
  const n = close.length;
  const currentPrice = close[n - 1];

  const ema12 = calculateEMA(close, 12);
  const ema20 = calculateEMA(close, 20);
  const ema26 = calculateEMA(close, 26);
  const sma50 = calculateSMA(close, 50);
  const sma200 = calculateSMA(close, 200);
  const rsi = calculateRSI(close, 14);
  const macdData = calculateMACD(close);
  const bb = calculateBollingerBands(close, 20, 2);
  const adxData = calculateADX(high, low, close, 14);
  const stochK = calculateStochastic(close, high, low, 14);
  const obv = calculateOBV(close, volume);
  const volatility = calculateVolatility(close, 20);

  const rsiVal = safeGet(rsi, 50);
  const adxVal = safeGet(adxData.adx, 0);
  const pdi = safeGet(adxData.plusDI, 0);
  const mdi = safeGet(adxData.minusDI, 0);
  const e12 = safeGet(ema12, currentPrice);
  const e20 = safeGet(ema20, currentPrice);
  const e26 = safeGet(ema26, currentPrice);
  const s50 = safeGet(sma50, currentPrice);
  const s200 = safeGet(sma200, currentPrice);
  const macdH = safeGet(macdData.histogram, 0);
  const sk = safeGet(stochK, 50);
  const dailyVol = safeGet(volatility, 0.02);
  const annualizedVol = dailyVol * Math.sqrt(252);

  // [FIX #1] Volume analysis
  const avgVolume20 = volume.length >= 20
    ? volume.slice(-20).reduce((a, b) => a + b, 0) / 20
    : volume.reduce((a, b) => a + b, 0) / volume.length;
  const currentVolume = volume[n - 1];
  const volumeRatio = avgVolume20 > 0 ? currentVolume / avgVolume20 : 1;

  // OBV trend: is OBV rising over last 10 bars?
  const obvEma10 = calculateEMA(obv.slice(-30), 10);
  const obvTrendUp = obvEma10.length >= 2 && obvEma10[obvEma10.length - 1] > obvEma10[obvEma10.length - 2];

  let regime = "neutral";
  if (adxVal > 40 && pdi > mdi && rsiVal > 60) regime = "strong_bullish";
  else if (adxVal > 40 && mdi > pdi && rsiVal < 40) regime = "strong_bearish";
  else if (adxVal > 25 && pdi > mdi) regime = "bullish";
  else if (adxVal > 25 && mdi > pdi) regime = "bearish";
  else if (rsiVal > 70) regime = "overbought";
  else if (rsiVal < 30) regime = "oversold";

  // ============================================================
  // Phase 3b (#7): SEPARATE base conviction from bonus pool
  // Base = strategy condition score (0-80 ish).
  // Bonuses (positive) accumulated into bonusPool, then folded into
  // remaining headroom with diminishing returns (max 65% of headroom).
  // Penalties applied directly (they should bite full strength).
  // ============================================================
  let conviction = 0;
  let bonusPool = 0;
  const MAX_BONUS_POOL = 35; // tuned: trend(3) + RS(8) + momentum(4) + ATR(3) + sector(±) + RSIdiv(8) + MACDdiv(5) ≈ 31-35
  const applyBonusPool = (base: number) => {
    if (bonusPool <= 0) return base;
    const headroom = Math.max(0, 100 - base);
    const fillRatio = Math.min(1, bonusPool / MAX_BONUS_POOL);
    return Math.min(100, base + headroom * fillRatio * 0.65);
  };

  let strategy = "none";
  const reasons: string[] = [];

  // ── Strategy 1: Trend Following ──
  if (adxVal > 20) {
    const trendBuy = [e12 > e26, currentPrice > s50, macdH > 0, rsiVal >= 35 && rsiVal <= 75];
    const trendScore = trendBuy.filter(Boolean).length;
    if (trendScore >= 3 && currentPrice > s200) {
      conviction = trendScore * 15 + Math.min((adxVal - 20) * 0.5, 10) + Math.min(Math.abs(macdH) * 5, 8);
      strategy = "trend";
      reasons.push(`Trend: ${trendScore}/4 conditions met`);
      if (e12 > e26) reasons.push("EMA12 > EMA26");
      if (currentPrice > s50) reasons.push("Price > SMA50");
      if (macdH > 0) reasons.push("MACD positive");
    }
  }

  // ── Strategy 2: Mean Reversion ──
  if (conviction < 50 && (rsiVal < 30 || currentPrice < safeGet(bb.lower, currentPrice * 0.9))) {
    const mrScore = [rsiVal < 30, currentPrice < safeGet(bb.lower, currentPrice * 0.9), sk < 20].filter(Boolean).length;
    if (mrScore >= 2) {
      conviction = Math.max(conviction, mrScore * 16 + Math.min(Math.abs(rsiVal - 50) * 0.3, 10));
      strategy = "mean_reversion";
      reasons.push(`Mean Reversion: RSI=${rsiVal.toFixed(0)}, oversold bounce setup`);
    }
  }

  // ── Strategy 3: Breakout Squeeze ──
  const bbBW = safeGet(bb.bandwidth, 0.1);
  const bwSlice = bb.bandwidth.filter(v => !isNaN(v));
  const bwAvg = bwSlice.length >= 50 ? bwSlice.slice(-50).reduce((a, b) => a + b, 0) / 50 : 0.1;
  if (conviction < 50 && bbBW < bwAvg * 0.7 && currentPrice > safeGet(bb.upper, currentPrice)) {
    conviction = Math.max(conviction, 58);
    strategy = "breakout";
    reasons.push("Bollinger squeeze breakout");
  }

  // ── [NEW] Strategy 4: Momentum Pullback ──
  if (conviction < 50 && currentPrice > s200 && currentPrice > s50) {
    const priceTo20EMA = Math.abs(currentPrice - e20) / e20;
    if (priceTo20EMA < 0.015 && rsiVal >= 40 && rsiVal <= 55 && e12 > e26 && adxVal > 20) {
      conviction = Math.max(conviction, 62);
      strategy = "momentum_pullback";
      reasons.push(`Momentum pullback to 20 EMA (RSI=${rsiVal.toFixed(0)})`);
    }
  }

  // ── [FIX #1] Volume Confirmation (penalties direct, bonuses pooled) ──
  if (conviction > 0) {
    if (strategy === "breakout" && volumeRatio < 1.0) {
      conviction -= 12;                              // direct penalty
      reasons.push("⚠ Low volume breakout");
    } else if (strategy === "trend" && volumeRatio > 1.3) {
      bonusPool += 5;                                // pooled bonus
      reasons.push("Volume confirms trend");
    } else if (volumeRatio < 0.6) {
      conviction -= 5;                               // direct penalty
      reasons.push("Below-avg volume");
    }
    if (obvTrendUp && (strategy === "trend" || strategy === "momentum_pullback")) {
      bonusPool += 3;
      reasons.push("OBV trending up");
    }
  }

  // ── [FIX #2] Relative Strength vs SPY ──
  if (conviction > 0 && spyContext && spyContext.spyClose.length > 0) {
    const rs = calculateRelativeStrength(close, spyContext.spyClose, 20);
    if (rs > 2) {
      bonusPool += Math.min(rs * 1.5, 8);
      reasons.push(`Outperforming SPY by ${rs.toFixed(1)}%`);
    } else if (rs < -3) {
      conviction -= Math.min(Math.abs(rs), 6);       // direct penalty
      reasons.push(`Underperforming SPY by ${Math.abs(rs).toFixed(1)}%`);
    }
  }

  // ── [FIX #4] Multi-Timeframe Confluence ──
  if (conviction > 0 && n >= 6) {
    const last5 = close.slice(-5);
    const upCloses = last5.filter((c, i) => i === 0 ? c > close[n - 6] : c > last5[i - 1]).length;
    if (strategy !== "mean_reversion" && upCloses >= 4) {
      bonusPool += 4;
      reasons.push("Strong directional momentum (4+/5 up closes)");
    }
    const atr = calculateATR(high, low, close, 14);
    const currentATR = safeGet(atr, 0);
    const atrSlice = atr.filter(v => !isNaN(v));
    const atr20Avg = atrSlice.length >= 20 ? atrSlice.slice(-20).reduce((a, b) => a + b, 0) / 20 : currentATR;
    if (currentATR > atr20Avg * 1.15 && (strategy === "trend" || strategy === "breakout")) {
      bonusPool += 3;
      reasons.push("ATR expanding (trend accelerating)");
    }
  }

  // ── [FIX #6] Sector Rotation Awareness ──
  const sectorMod = getSectorConvictionModifier(ticker, sectorMomentum);
  if (sectorMod.bonus > 0) {
    bonusPool += sectorMod.bonus;
    if (sectorMod.label) reasons.push(sectorMod.label);
  } else if (sectorMod.bonus < 0) {
    conviction += sectorMod.bonus;                   // direct (negative)
    if (sectorMod.label) reasons.push(sectorMod.label);
  }

  // ── [FIX #9] RSI/MACD Divergence Detection ──
  const rsiDivergence = detectDivergence(close, rsi, 25);
  const macdDivergence = detectDivergence(close, macdData.histogram, 25);
  if (rsiDivergence.bullish) {
    bonusPool += 8;
    reasons.push("Bullish RSI divergence");
    if (strategy === "none" || strategy === "mean_reversion") strategy = "divergence";
  }
  if (macdDivergence.bullish) {
    bonusPool += 5;
    reasons.push("Bullish MACD divergence");
  }
  if (rsiDivergence.bearish && strategy === "trend") {
    conviction -= 6;                                 // direct penalty
    reasons.push("⚠ Bearish RSI divergence");
  }

  // Apply the pooled bonuses to whatever base conviction emerged.
  conviction = applyBonusPool(Math.max(0, conviction));

  return {
    conviction: Math.min(100, Math.max(0, Math.round(conviction))),
    regime,
    strategy,
    reasoning: reasons.join(". ") || "No clear signal",
    annualizedVol,
  };
}

// ============================================================================
// YAHOO FINANCE DATA FETCHER
// ============================================================================

async function fetchYahooData(ticker: string, range: string = "1y"): Promise<DataSet | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=1d`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.chart?.error) return null;
    const result = data.chart.result[0];
    const quotes = result.indicators.quote[0];
    const timestamps = result.timestamp.map((t: number) => {
      const d = new Date(t * 1000);
      return d.toISOString().split('T')[0];
    });
    const close: number[] = [], high: number[] = [], low: number[] = [], volume: number[] = [], dates: string[] = [], open: number[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.close[i] != null && quotes.high[i] != null && quotes.low[i] != null && quotes.open[i] != null) {
        close.push(quotes.close[i]);
        high.push(quotes.high[i]);
        low.push(quotes.low[i]);
        open.push(quotes.open[i]);
        volume.push(quotes.volume[i] || 0);
        dates.push(timestamps[i]);
      }
    }
    return { timestamps: dates, close, high, low, open, volume };
  } catch (e) {
    console.error(`Failed to fetch ${ticker}:`, e);
    return null;
  }
}

// ============================================================================
// SCANNING UNIVERSE
// ============================================================================

const SCAN_UNIVERSE: Record<string, string[]> = {
  "Technology": ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AVGO", "CRM", "AMD", "ADBE", "ORCL"],
  "Healthcare": ["UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT"],
  "Financials": ["JPM", "V", "MA", "BAC", "GS", "MS", "BLK", "AXP"],
  "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "TJX"],
  "Communication Services": ["NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS"],
  "Industrials": ["CAT", "HON", "UPS", "BA", "GE", "RTX", "DE"],
  "Consumer Staples": ["PG", "KO", "PEP", "COST", "WMT", "PM"],
  "Energy": ["XOM", "CVX", "COP", "SLB", "EOG"],
  "Utilities": ["NEE", "DUK", "SO", "AEP"],
  "Real Estate": ["PLD", "AMT", "CCI", "SPG"],
  "Materials": ["LIN", "APD", "SHW", "FCX"],
};

const HARDCODED_TICKERS = Object.values(SCAN_UNIVERSE).flat();

// ============================================================================
// DYNAMIC TICKER DISCOVERY
// ============================================================================

const SCREENER_IDS = [
  "most_actives",
  "day_gainers",
  "undervalued_growth_stocks",
  "aggressive_small_caps",
  "growth_technology_stocks",
];

interface ScreenerQuote {
  symbol: string;
  marketCap?: number;
  averageDailyVolume3Month?: number;
  regularMarketVolume?: number;
  quoteType?: string;
  shortName?: string;
}

async function fetchScreenerTickers(screenerId: string): Promise<ScreenerQuote[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${screenerId}&count=50`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      console.warn(`Screener ${screenerId} returned ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    return quotes.map((q: any) => ({
      symbol: q.symbol,
      marketCap: q.marketCap,
      averageDailyVolume3Month: q.averageDailyVolume3Month,
      regularMarketVolume: q.regularMarketVolume,
      quoteType: q.quoteType,
      shortName: q.shortName,
    }));
  } catch (e) {
    console.warn(`Screener ${screenerId} fetch failed:`, e);
    return [];
  }
}

const TICKER_REGEX = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

function preFilterQuotes(quotes: ScreenerQuote[]): string[] {
  const tickers: string[] = [];
  for (const q of quotes) {
    if (!q.symbol || !TICKER_REGEX.test(q.symbol)) continue;
    if (q.quoteType && q.quoteType !== "EQUITY") continue;
    if (q.marketCap != null && q.marketCap < 1_000_000_000) continue;
    const vol = q.averageDailyVolume3Month || q.regularMarketVolume || 0;
    if (vol < 500_000) continue;
    tickers.push(q.symbol);
  }
  return tickers;
}

async function discoverTickers(): Promise<string[]> {
  console.log("Discovering tickers from Yahoo screeners...");
  const allQuotes: ScreenerQuote[] = [];
  const results = await Promise.all(SCREENER_IDS.map(id => fetchScreenerTickers(id)));
  for (const quotes of results) allQuotes.push(...quotes);

  const screenerTickers = preFilterQuotes(allQuotes);
  console.log(`Screeners returned ${allQuotes.length} raw quotes, pre-filtered to ${screenerTickers.length}`);

  const merged = new Set([...HARDCODED_TICKERS, ...screenerTickers]);
  const finalList = Array.from(merged);
  console.log(`Final scan universe: ${finalList.length} tickers (${HARDCODED_TICKERS.length} hardcoded + ${screenerTickers.length} dynamic)`);
  return finalList;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const startTime = Date.now();
    const body = await req.json().catch(() => ({}));
    const { batch = 0, batchSize = 25 } = body;

    // On first batch, discover full universe; subsequent batches receive tickerList
    let allTickers: string[];
    if (body.tickerList && Array.isArray(body.tickerList)) {
      allTickers = body.tickerList;
    } else if (batch === 0) {
      allTickers = await discoverTickers();
    } else {
      allTickers = HARDCODED_TICKERS;
    }

    // Determine which tickers to scan in this batch
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, allTickers.length);
    const tickersToScan = allTickers.slice(start, end);

    if (tickersToScan.length === 0) {
      return new Response(JSON.stringify({
        signals: [], batch,
        totalBatches: Math.ceil(allTickers.length / batchSize),
        tickerList: allTickers, totalTickers: allTickers.length, done: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Scanning batch ${batch}: ${tickersToScan.join(", ")}`);

    // [FIX #10] Fetch SPY once; pass context between batches
    let spyContext: SpyContext | null = null;
    let spyBearish = false;
    if (body.spyContext) {
      // Reuse SPY context from previous batch
      spyContext = body.spyContext;
      spyBearish = spyContext!.spyBearish;
    } else {
      const spyData = await fetchYahooData("SPY", "1y");
      if (spyData && spyData.close.length >= 200) {
        const spySMA200 = calculateSMA(spyData.close, 200);
        const lastSMA200 = safeGet(spySMA200, 0);
        spyBearish = spyData.close[spyData.close.length - 1] < lastSMA200;
        spyContext = { spyBearish, spyClose: spyData.close };
      }
    }

    // [FIX #6] Fetch sector momentum once; pass between batches
    let sectorMomentum: SectorMomentum = {};
    if (body.sectorMomentum) {
      sectorMomentum = body.sectorMomentum;
    } else if (batch === 0) {
      sectorMomentum = await fetchSectorMomentum();
      console.log("Sector momentum:", Object.entries(sectorMomentum).map(([k, v]) => `${k}:${(v as number).toFixed(1)}%`).join(", "));
    }

    // Fetch all tickers in parallel (batched to avoid rate limits)
    const FETCH_BATCH = 5;
    const allData: (DataSet | null)[] = [];
    for (let i = 0; i < tickersToScan.length; i += FETCH_BATCH) {
      const fetchBatch = tickersToScan.slice(i, i + FETCH_BATCH);
      const results = await Promise.all(fetchBatch.map(t => fetchYahooData(t, "1y")));
      allData.push(...results);
      if (i + FETCH_BATCH < tickersToScan.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const signals: {
      ticker: string;
      signal_type: "BUY" | "SELL";
      entry_price: number;
      confidence: number;
      regime: string;
      stock_profile: string;
      weekly_bias: string;
      target_allocation: number;
      reasoning: string;
      strategy: string;
      sector: string;
      qualityScore: number;
    }[] = [];

    for (let ti = 0; ti < tickersToScan.length; ti++) {
      const ticker = tickersToScan[ti];
      const data = allData[ti];
      if (!data || data.close.length < 200) continue;

      try {
        // 1. Classify stock
        const profile = classifyStockSimple(data.close, data.high, data.low, ticker);
        const weeklyParams = PROFILE_WEEKLY_PARAMS[profile];

        // 2. Build weekly data
        const weeklyData = aggregateToWeekly(data);
        const wIdx = weeklyData.close.length - 1;

        // 3. Compute weekly bias
        const weeklyATR = calculateATR(weeklyData.high, weeklyData.low, weeklyData.close, 14);
        let isLowVol = false;
        {
          let wAtrPctSum = 0, wAtrPctCount = 0;
          for (let wi = 14; wi < weeklyData.close.length; wi++) {
            if (!isNaN(weeklyATR[wi]) && weeklyData.close[wi] > 0) {
              wAtrPctSum += weeklyATR[wi] / weeklyData.close[wi]; wAtrPctCount++;
            }
          }
          isLowVol = wAtrPctCount > 0 && (wAtrPctSum / wAtrPctCount) < 0.02;
        }

        if (wIdx < Math.max(weeklyParams.slowMA, 40) + 10) continue;

        const weeklyBias = computeWeeklyBias(
          weeklyData.close, weeklyData.high, weeklyData.low, wIdx,
          weeklyParams, isLowVol,
        );

        if (weeklyBias.bias === "flat") continue;
        if (weeklyBias.bias === "short" && !spyBearish) continue;

        // 4. Check daily entry signal
        const lastIdx = data.close.length - 1;
        const hasEntry = hasDailyEntrySignal(data.close, data.high, data.low, data.volume, lastIdx, weeklyBias.bias);
        if (!hasEntry) continue;

        // 5. Compute conviction (enhanced)
        const { conviction, regime, strategy, reasoning, annualizedVol } = computeSignalConviction(
          data.close, data.high, data.low, data.volume,
          spyContext, sectorMomentum, ticker,
        );

        // [FIX #8] Raised conviction thresholds
        const minConviction = strategy === "mean_reversion" || strategy === "divergence" ? 60 : 65;
        if (conviction < minConviction) continue;

        // Find sector
        let sector = "Unknown";
        for (const [s, tickers] of Object.entries(SCAN_UNIVERSE)) {
          if (tickers.includes(ticker)) { sector = s; break; }
        }

        // [FIX #7] Risk-adjusted quality score
        const qualityScore = annualizedVol > 0 ? conviction / annualizedVol : conviction;

        signals.push({
          ticker,
          signal_type: weeklyBias.bias === "long" ? "BUY" : "SELL",
          entry_price: data.close[lastIdx],
          confidence: conviction,
          regime,
          stock_profile: profile,
          weekly_bias: weeklyBias.bias,
          target_allocation: Math.abs(weeklyBias.targetAllocation),
          reasoning,
          strategy,
          sector,
          qualityScore,
        });
      } catch (err) {
        console.error(`Error analyzing ${ticker}:`, err);
      }
    }

    // [FIX #7] Sort by risk-adjusted quality score instead of raw conviction
    signals.sort((a, b) => b.qualityScore - a.qualityScore);

    // Write signals to DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (signals.length > 0) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const rows = signals.map(s => ({
        ticker: s.ticker,
        signal_type: s.signal_type,
        entry_price: s.entry_price,
        confidence: s.confidence,
        regime: s.regime,
        stock_profile: s.stock_profile,
        weekly_bias: s.weekly_bias,
        target_allocation: s.target_allocation,
        reasoning: s.reasoning,
        strategy: s.strategy,
        expires_at: expiresAt,
      }));

      const { data: upserted, error } = await supabase
        .from("live_signals")
        .upsert(rows, { onConflict: "ticker" })
        .select("id, ticker");
      if (error) console.error("Failed to upsert signals:", error);

      // ─────────────────────────────────────────────────────────────────────
      // PHASE A — Outcome memory: log every emitted signal as an open outcome
      // so we can later measure realized win rate by conviction / regime / strategy.
      // We only insert if there isn't already an *open* outcome for this ticker
      // (avoids duplicates when scanner re-runs and emits the same signal).
      // ─────────────────────────────────────────────────────────────────────
      try {
        const idByTicker = new Map<string, string>();
        (upserted ?? []).forEach((r: any) => idByTicker.set(r.ticker, r.id));

        const tickers = signals.map(s => s.ticker);
        const { data: existingOpen } = await supabase
          .from("signal_outcomes")
          .select("ticker")
          .eq("status", "open")
          .in("ticker", tickers);
        const openSet = new Set((existingOpen ?? []).map((r: any) => r.ticker));

        const outcomeRows = signals
          .filter(s => !openSet.has(s.ticker))
          .map(s => ({
            signal_id: idByTicker.get(s.ticker) ?? null,
            ticker: s.ticker,
            signal_type: s.signal_type === "BUY" ? "long" : "short",
            regime: s.regime,
            stock_profile: s.stock_profile,
            weekly_bias: s.weekly_bias,
            conviction: s.confidence,
            strategy: s.strategy,
            entry_thesis: s.strategy, // strategy doubles as thesis tag for now
            contributing_rules: { reasoning: s.reasoning },
            entry_price: s.entry_price,
            spy_at_entry: spyContext?.spyClose?.[spyContext.spyClose.length - 1] ?? null,
            status: "open",
          }));

        if (outcomeRows.length > 0) {
          const { error: outErr } = await supabase.from("signal_outcomes").insert(outcomeRows);
          if (outErr) console.error("Failed to log signal outcomes:", outErr);
          else console.log(`Logged ${outcomeRows.length} new outcome rows`);
        }
      } catch (e) {
        console.error("Outcome logging error (non-fatal):", e);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Scan complete: ${signals.length} signals from ${tickersToScan.length} tickers in ${elapsed}ms`);

    return new Response(JSON.stringify({
      signals,
      batch,
      totalBatches: Math.ceil(allTickers.length / batchSize),
      tickerList: allTickers,
      totalTickers: allTickers.length,
      done: end >= allTickers.length,
      scanned: tickersToScan.length,
      elapsed,
      // [FIX #10] Pass cached context to next batch
      spyContext: spyContext ? { spyBearish: spyContext.spyBearish, spyClose: spyContext.spyClose.slice(-30) } : null,
      sectorMomentum,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Scanner error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Scanner failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
