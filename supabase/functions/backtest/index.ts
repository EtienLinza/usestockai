import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// TECHNICAL INDICATOR FUNCTIONS
// ============================================================================

function calculateEMA(prices: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  if (prices.length < period) {
    ema[0] = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
    }
    return ema;
  }
  const smaSum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  ema[0] = smaSum / period;
  for (let i = 0; i < period - 1; i++) ema[i] = NaN;
  ema[period - 1] = smaSum / period;
  for (let i = period; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  return ema;
}

function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { sma[i] = NaN; }
    else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma[i] = sum / period;
    }
  }
  return sma;
}

function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i <= period; i++) rsi[i] = NaN;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period; avgLoss /= period;
  rsi[period] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.0001))));
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    rsi[i] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.0001))));
  }
  return rsi;
}

function calculateMACD(prices: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);

  // Track which indices have valid (non-NaN) MACD values
  const validIndices: number[] = [];
  const validMacd: number[] = [];
  for (let i = 0; i < macd.length; i++) {
    if (!isNaN(macd[i])) {
      validIndices.push(i);
      validMacd.push(macd[i]);
    }
  }

  // Compute signal EMA only on valid MACD values
  const signalRaw = calculateEMA(validMacd, 9);

  // Map signal back to original indices
  const paddedSignal: number[] = new Array(macd.length).fill(NaN);
  for (let i = 0; i < signalRaw.length; i++) {
    paddedSignal[validIndices[i]] = signalRaw[i];
  }

  const histogram = macd.map((v, i) => {
    if (isNaN(v) || isNaN(paddedSignal[i])) return NaN;
    return v - paddedSignal[i];
  });
  return { macd, signal: paddedSignal, histogram };
}

function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2) {
  const sma = calculateSMA(prices, period);
  const upper: number[] = [], lower: number[] = [], bandwidth: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { upper[i] = NaN; lower[i] = NaN; bandwidth[i] = NaN; }
    else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = sma[i];
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const std = Math.sqrt(variance) * stdDev;
      upper[i] = mean + std; lower[i] = mean - std;
      bandwidth[i] = (upper[i] - lower[i]) / mean;
    }
  }
  return { upper, middle: sma, lower, bandwidth };
}

function calculateVolatility(prices: number[], period: number = 20): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  const volatility: number[] = [NaN];
  for (let i = 1; i < prices.length; i++) {
    if (i < period) { volatility[i] = NaN; }
    else {
      const slice = returns.slice(i - period, i);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      volatility[i] = Math.sqrt(variance);
    }
  }
  return volatility;
}

function calculateADX(high: number[], low: number[], close: number[], period: number = 14) {
  if (close.length < 2) return { adx: [], plusDI: [], minusDI: [] };
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const smoothedTR = calculateEMA(tr, period);
  const smoothedPlusDM = calculateEMA(plusDM, period);
  const smoothedMinusDM = calculateEMA(minusDM, period);
  const plusDI = smoothedPlusDM.map((v, i) => smoothedTR[i] === 0 ? 0 : (v / smoothedTR[i]) * 100);
  const minusDI = smoothedMinusDM.map((v, i) => smoothedTR[i] === 0 ? 0 : (v / smoothedTR[i]) * 100);
  const dx = plusDI.map((v, i) => { const sum = v + minusDI[i]; return sum === 0 ? 0 : (Math.abs(v - minusDI[i]) / sum) * 100; });
  const adxRaw = calculateEMA(dx.filter(v => !isNaN(v)), period);
  const padLen = close.length - adxRaw.length;
  return { adx: new Array(Math.max(0, padLen)).fill(NaN).concat(adxRaw), plusDI: new Array(1).fill(NaN).concat(plusDI), minusDI: new Array(1).fill(NaN).concat(minusDI) };
}

function calculateStochastic(close: number[], high: number[], low: number[], kPeriod: number = 14) {
  const k: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i < kPeriod - 1) { k.push(NaN); continue; }
    const hSlice = high.slice(i - kPeriod + 1, i + 1);
    const lSlice = low.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...hSlice), ll = Math.min(...lSlice), range = hh - ll;
    k.push(range === 0 ? 50 : ((close[i] - ll) / range) * 100);
  }
  return k;
}

function safeGet(arr: number[], defaultVal: number): number {
  if (!arr || arr.length === 0) return defaultVal;
  const v = arr[arr.length - 1];
  return (v == null || isNaN(v)) ? defaultVal : v;
}

// ============================================================================
// SIGNAL CONSENSUS
// ============================================================================
function computeSignal(close: number[], high: number[], low: number[], volume: number[]): {
  consensusScore: number;
  regime: string;
  predictedReturn: number;
  confidence: number;
} {
  const currentPrice = close[close.length - 1];
  const ema12 = calculateEMA(close, 12);
  const ema26 = calculateEMA(close, 26);
  const sma50 = calculateSMA(close, 50);
  const rsi = calculateRSI(close, 14);
  const macd = calculateMACD(close);
  const bb = calculateBollingerBands(close, 20, 2);
  const adx = calculateADX(high, low, close, 14);
  const stochK = calculateStochastic(close, high, low, 14);

  let bullish = 0, bearish = 0;

  const rsiVal = safeGet(rsi, 50);
  if (rsiVal < 30) bullish += 1.5;
  else if (rsiVal > 70) bearish += 1.5;
  else if (rsiVal > 50) bullish += 0.5;
  else bearish += 0.5;

  const macdH = safeGet(macd.histogram, 0);
  const prevMacdH = macd.histogram.length >= 2 ? macd.histogram[macd.histogram.length - 2] : 0;
  if (macdH > 0 && macdH > prevMacdH) bullish += 1.5;
  else if (macdH < 0 && macdH < prevMacdH) bearish += 1.5;
  else if (macdH > 0) bullish += 0.5;
  else bearish += 0.5;

  const e12 = safeGet(ema12, currentPrice), e26 = safeGet(ema26, currentPrice);
  if (e12 > e26) bullish += 1; else bearish += 1;

  const s50 = safeGet(sma50, currentPrice);
  if (currentPrice > s50) bullish += 1; else bearish += 1;

  const adxVal = safeGet(adx.adx, 0);
  const pdi = safeGet(adx.plusDI, 0), mdi = safeGet(adx.minusDI, 0);
  if (adxVal > 25) { if (pdi > mdi) bullish += 2; else bearish += 2; }

  const sk = safeGet(stochK, 50);
  if (sk < 20) bullish += 1.5;
  else if (sk > 80) bearish += 1.5;

  const bbU = safeGet(bb.upper, currentPrice * 1.1);
  const bbL = safeGet(bb.lower, currentPrice * 0.9);
  const bbM = safeGet(bb.middle, currentPrice);
  if (currentPrice < bbL) bullish += 1.5;
  else if (currentPrice > bbU) bearish += 1.5;
  else if (currentPrice > bbM) bullish += 0.5;
  else bearish += 0.5;

  const total = bullish + bearish;
  const dirScore = total === 0 ? 0 : ((bullish - bearish) / total) * 100;
  const conviction = Math.min(1, total / (13.5 * 0.6));
  const consensusScore = dirScore * conviction;

  let regime = "neutral";
  if (adxVal > 40 && pdi > mdi && rsiVal > 60) regime = "strong_bullish";
  else if (adxVal > 40 && mdi > pdi && rsiVal < 40) regime = "strong_bearish";
  else if (adxVal > 25 && pdi > mdi) regime = "bullish";
  else if (adxVal > 25 && mdi > pdi) regime = "bearish";
  else if (rsiVal > 70) regime = "overbought";
  else if (rsiVal < 30) regime = "oversold";

  const predictedReturn = (consensusScore / 100) * 5;

  let confidence = 55 + Math.abs(consensusScore) * 0.25;
  if (regime.includes("strong")) confidence += 8;
  if (Math.abs(consensusScore) < 20) confidence -= 8;
  confidence = Math.max(35, Math.min(92, Math.round(confidence)));

  return { consensusScore, regime, predictedReturn, confidence };
}

// ============================================================================
// YAHOO FINANCE DATA FETCHER
// ============================================================================
async function fetchYahooData(ticker: string, startDate: number, endDate: number): Promise<{
  timestamps: string[];
  close: number[];
  high: number[];
  low: number[];
  open: number[];
  volume: number[];
} | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startDate}&period2=${endDate}&interval=1d`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.chart.error) return null;
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
// TRADING SIMULATION
// ============================================================================
interface TradeConfig {
  initialCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  commissionPct: number;
  spreadPct: number;
  slippagePct: number;
}

interface Trade {
  date: string;
  exitDate: string;
  ticker: string;
  action: "BUY" | "SHORT" | "HOLD";
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  pnl: number;
  regime: string;
  confidence: number;
  predictedReturn: number;
  actualReturn: number;
  duration: number; // bars held
  mae: number; // max adverse excursion %
  mfe: number; // max favorable excursion %
  volumeAtEntry: number;
}

function applyTradingCosts(price: number, isBuy: boolean, config: TradeConfig): number {
  let adjusted = price;
  adjusted *= isBuy ? (1 + config.spreadPct / 100) : (1 - config.spreadPct / 100);
  const slippage = 1 + (Math.random() - 0.5) * 2 * (config.slippagePct / 100);
  adjusted *= slippage;
  return adjusted;
}

// ============================================================================
// WALK-FORWARD BACKTESTING ENGINE
// ============================================================================
interface BacktestConfig {
  tickers: string[];
  startYear: number;
  endYear: number;
  initialCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxPositions: number;
  rebalanceFrequency: "weekly" | "monthly";
  includeMonteCarlo: boolean;
  buyThreshold: number;
  shortThreshold: number;
}

interface BacktestReport {
  periods: { start: string; end: string; accuracy: number; returnPct: number; trades: number }[];
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  directionalAccuracy: number;
  mae: number;
  rmse: number;
  mape: number;
  avgWin: number;
  avgLoss: number;
  winLossRatio: number;
  avgTradeDuration: number;
  medianTradeDuration: number;
  maxTradeDuration: number;
  avgMAE: number;
  avgMFE: number;
  valueAtRisk: number;
  conditionalVaR: number;
  ulcerIndex: number;
  marketExposure: number;
  longExposure: number;
  shortExposure: number;
  cagr: number;
  timeToDouble: number;
  alpha: number;
  beta: number;
  portfolioTurnover: number;
  stabilityScore: number;
  signalPrecision: number;
  signalRecall: number;
  signalF1: number;
  regimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
  confidenceCalibration: { bucket: string; predictedConf: number; actualAccuracy: number; count: number }[];
  equityCurve: { date: string; value: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
  tradeLog: Trade[];
  monteCarlo: { percentile5: number; percentile25: number; median: number; percentile75: number; percentile95: number } | null;
  benchmarkReturn: number;
  annualizedReturn: number;
  rollingSharpe: { index: number; value: number }[];
  rollingVolatility: { index: number; value: number }[];
  tradeDistribution: { bucket: string; count: number }[];
  monthlyReturns: { year: number; month: number; returnPct: number }[];
  // Robustness
  robustness: {
    noiseInjection: { baseReturn: number; noisyReturn: number; impact: number; passed: boolean } | null;
    delayedExecution: { baseReturn: number; delayedReturn: number; impact: number; passed: boolean } | null;
    parameterSensitivity: { param: string; value: number; returnPct: number; sharpe: number }[];
  };
  // Stress testing
  stressTests: { period: string; startDate: string; endDate: string; strategyReturn: number; benchmarkReturn: number; maxDrawdown: number }[];
  // Liquidity flags
  liquidityWarnings: number;
}

type DataSet = { timestamps: string[]; close: number[]; high: number[]; low: number[]; open: number[]; volume: number[] };

function runWalkForwardBacktest(
  allData: DataSet,
  ticker: string,
  config: BacktestConfig,
  tradeConfig: TradeConfig,
  executionDelay: number = 1, // bars delay for execution (1 = next bar, fixes lookahead bias)
): { trades: Trade[]; equityCurve: { date: string; value: number }[]; totalBars: number; barsInTrade: number } {
  const { close, high, low, open, volume, timestamps } = allData;
  const trades: Trade[] = [];
  let capital = config.initialCapital;
  const equityCurve: { date: string; value: number }[] = [{ date: timestamps[0], value: capital }];

  const TRAIN_WINDOW = 60;
  const STEP = 5;
  let totalBars = 0;
  let barsInTrade = 0;

  for (let i = TRAIN_WINDOW; i < close.length - STEP - executionDelay; i += STEP) {
    const trainClose = close.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainHigh = high.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainLow = low.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainVol = volume.slice(Math.max(0, i - TRAIN_WINDOW), i);

    if (trainClose.length < 30) continue;
    totalBars += STEP;

    const signal = computeSignal(trainClose, trainHigh, trainLow, trainVol);

    let action: "BUY" | "SHORT" | "HOLD" = "HOLD";
    if (signal.consensusScore > config.buyThreshold) action = "BUY";
    else if (signal.consensusScore < config.shortThreshold) action = "SHORT";

    if (action === "HOLD") continue;

    // LOOKAHEAD BIAS FIX: execute at next bar's open, not same bar's close
    const entryIdx = i + executionDelay;
    if (entryIdx >= close.length) continue;
    const rawEntryPrice = open[entryIdx]; // use open of next bar
    const entryPrice = applyTradingCosts(rawEntryPrice, action === "BUY", tradeConfig);
    const testEnd = Math.min(entryIdx + STEP, close.length - 1);

    // Track MAE/MFE during trade
    let maxAdverse = 0;
    let maxFavorable = 0;
    let exitPrice = close[testEnd];
    let exitDate = timestamps[testEnd];
    let exitIdx = testEnd;

    for (let j = entryIdx + 1; j <= testEnd; j++) {
      const priceChange = action === "BUY"
        ? (close[j] - entryPrice) / entryPrice
        : (entryPrice - close[j]) / entryPrice;

      // Track MAE/MFE
      if (priceChange < 0) maxAdverse = Math.min(maxAdverse, priceChange);
      if (priceChange > 0) maxFavorable = Math.max(maxFavorable, priceChange);

      if (priceChange <= -config.stopLossPct / 100) {
        exitPrice = action === "BUY"
          ? entryPrice * (1 - config.stopLossPct / 100)
          : entryPrice * (1 + config.stopLossPct / 100);
        exitDate = timestamps[j];
        exitIdx = j;
        break;
      }
      if (priceChange >= config.takeProfitPct / 100) {
        exitPrice = action === "BUY"
          ? entryPrice * (1 + config.takeProfitPct / 100)
          : entryPrice * (1 - config.takeProfitPct / 100);
        exitDate = timestamps[j];
        exitIdx = j;
        break;
      }
    }

    exitPrice = applyTradingCosts(exitPrice, action !== "BUY", tradeConfig);

    const positionSize = capital * (config.positionSizePct / 100);
    const shares = positionSize / entryPrice;
    const commission = positionSize * (tradeConfig.commissionPct / 100) * 2;

    let pnl: number;
    if (action === "BUY") {
      pnl = (exitPrice - entryPrice) * shares - commission;
    } else {
      pnl = (entryPrice - exitPrice) * shares - commission;
    }

    const returnPct = (pnl / positionSize) * 100;
    const actualReturn = (close[testEnd] - close[entryIdx]) / close[entryIdx] * 100;
    const duration = exitIdx - entryIdx;

    capital += pnl;
    barsInTrade += duration;

    trades.push({
      date: timestamps[entryIdx],
      exitDate,
      ticker,
      action,
      entryPrice,
      exitPrice,
      returnPct,
      pnl,
      regime: signal.regime,
      confidence: signal.confidence,
      predictedReturn: signal.predictedReturn,
      actualReturn,
      duration,
      mae: parseFloat((maxAdverse * 100).toFixed(2)),
      mfe: parseFloat((maxFavorable * 100).toFixed(2)),
      volumeAtEntry: volume[entryIdx] || 0,
    });

    equityCurve.push({ date: exitDate, value: capital });
  }

  return { trades, equityCurve, totalBars, barsInTrade };
}

// ============================================================================
// METRICS COMPUTATION
// ============================================================================
function computeMetrics(
  trades: Trade[],
  initialCapital: number,
  equityCurve: { date: string; value: number }[],
  years: number,
  totalBars: number,
  barsInTrade: number,
  benchmarkReturns: number[] // daily SPY returns for alpha/beta
): Partial<BacktestReport> {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winRate: 0, avgReturn: 0, totalReturn: 0, maxDrawdown: 0,
      sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, profitFactor: 0,
      directionalAccuracy: 0, mae: 0, rmse: 0, mape: 0,
      avgWin: 0, avgLoss: 0, winLossRatio: 0,
      avgTradeDuration: 0, medianTradeDuration: 0, maxTradeDuration: 0,
      avgMAE: 0, avgMFE: 0, valueAtRisk: 0, conditionalVaR: 0,
      ulcerIndex: 0, marketExposure: 0, longExposure: 0, shortExposure: 0,
      cagr: 0, timeToDouble: 0, alpha: 0, beta: 0,
      portfolioTurnover: 0, stabilityScore: 0,
      signalPrecision: 0, signalRecall: 0, signalF1: 0,
      regimePerformance: [], confidenceCalibration: [], annualizedReturn: 0,
      rollingSharpe: [], rollingVolatility: [], tradeDistribution: [], monthlyReturns: [],
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = (wins.length / trades.length) * 100;
  const returns = trades.map(t => t.returnPct);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const finalCapital = equityCurve[equityCurve.length - 1]?.value || initialCapital;
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;
  const annualizedReturn = years > 0 ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100 : totalReturn;

  // Avg Win / Avg Loss / Ratio
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.returnPct, 0) / losses.length : 0;
  const winLossRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 999 : 0;

  // Trade Duration
  const durations = trades.map(t => t.duration).sort((a, b) => a - b);
  const avgTradeDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const medianTradeDuration = durations[Math.floor(durations.length / 2)] || 0;
  const maxTradeDuration = durations[durations.length - 1] || 0;

  // MAE / MFE
  const avgMAE = trades.reduce((a, t) => a + t.mae, 0) / trades.length;
  const avgMFE = trades.reduce((a, t) => a + t.mfe, 0) / trades.length;

  // Max Drawdown + drawdown series for Ulcer Index
  let peak = initialCapital;
  let maxDrawdown = 0;
  const drawdowns: number[] = [];
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = ((peak - point.value) / peak) * 100;
    drawdowns.push(dd);
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Ulcer Index = RMS of drawdowns
  const ulcerIndex = Math.sqrt(drawdowns.reduce((a, b) => a + b * b, 0) / drawdowns.length);

  // Sharpe Ratio
  const riskFreeDaily = 0.04 / 252;
  const meanReturn = returns.reduce((a, b) => a + b / 100, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b / 100 - meanReturn, 2), 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? ((meanReturn - riskFreeDaily) / stdReturn) * Math.sqrt(252 / 5) : 0;

  // Sortino Ratio
  const downsideReturns = returns.filter(r => r < 0).map(r => r / 100);
  const downsideStd = downsideReturns.length > 0
    ? Math.sqrt(downsideReturns.reduce((a, b) => a + b * b, 0) / downsideReturns.length)
    : 0.001;
  const sortinoRatio = downsideStd > 0 ? ((meanReturn - riskFreeDaily) / downsideStd) * Math.sqrt(252 / 5) : 0;

  // Calmar Ratio
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // Profit Factor
  const totalProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;

  // VaR and CVaR (5th percentile)
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const varIdx = Math.floor(0.05 * sortedReturns.length);
  const valueAtRisk = sortedReturns[varIdx] || 0;
  const tailReturns = sortedReturns.slice(0, varIdx + 1);
  const conditionalVaR = tailReturns.length > 0 ? tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length : 0;

  // Exposure
  const marketExposure = totalBars > 0 ? (barsInTrade / totalBars) * 100 : 0;
  const longTrades = trades.filter(t => t.action === "BUY");
  const shortTrades = trades.filter(t => t.action === "SHORT");
  const longBars = longTrades.reduce((a, t) => a + t.duration, 0);
  const shortBars = shortTrades.reduce((a, t) => a + t.duration, 0);
  const longExposure = totalBars > 0 ? (longBars / totalBars) * 100 : 0;
  const shortExposure = totalBars > 0 ? (shortBars / totalBars) * 100 : 0;

  // CAGR & Time to Double
  const cagr = annualizedReturn;
  const timeToDouble = cagr > 0 ? 72 / cagr : 0; // Rule of 72

  // Portfolio Turnover
  const positionSize = initialCapital * (trades.length > 0 ? 0.1 : 0.1); // approximate per-trade allocation
  const totalTraded = trades.length * (initialCapital * (positionSizePctVal / 100));
  const portfolioTurnover = years > 0 ? totalTraded / initialCapital / years : 0;

  // Directional Accuracy
  const correctDir = trades.filter(t => {
    if (t.action === "BUY" && t.actualReturn > 0) return true;
    if (t.action === "SHORT" && t.actualReturn < 0) return true;
    return false;
  });
  const directionalAccuracy = (correctDir.length / trades.length) * 100;

  // Signal Quality: Precision, Recall, F1
  // Treating BUY as "positive" prediction, positive actual = price went up
  const truePositives = trades.filter(t => t.action === "BUY" && t.actualReturn > 0).length;
  const falsePositives = trades.filter(t => t.action === "BUY" && t.actualReturn <= 0).length;
  const falseNegatives = trades.filter(t => t.action === "SHORT" && t.actualReturn > 0).length;
  const signalPrecision = (truePositives + falsePositives) > 0 ? (truePositives / (truePositives + falsePositives)) * 100 : 0;
  const signalRecall = (truePositives + falseNegatives) > 0 ? (truePositives / (truePositives + falseNegatives)) * 100 : 0;
  const signalF1 = (signalPrecision + signalRecall) > 0 ? 2 * (signalPrecision * signalRecall) / (signalPrecision + signalRecall) : 0;

  // MAE, RMSE, MAPE
  const errors = trades.map(t => t.predictedReturn - t.actualReturn);
  const maeVal = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length);
  const mape = trades.reduce((a, t) => a + (t.actualReturn !== 0 ? Math.abs((t.predictedReturn - t.actualReturn) / t.actualReturn) : 0), 0) / trades.length * 100;

  // Alpha / Beta (vs benchmark)
  let alpha = 0, beta = 0;
  if (benchmarkReturns.length > 1 && returns.length > 1) {
    // Simple linear regression: strategy returns vs benchmark
    const n = Math.min(returns.length, benchmarkReturns.length);
    const stratRets = returns.slice(0, n).map(r => r / 100);
    const benchRets = benchmarkReturns.slice(0, n);
    const meanS = stratRets.reduce((a, b) => a + b, 0) / n;
    const meanB = benchRets.reduce((a, b) => a + b, 0) / n;
    let covSB = 0, varB = 0;
    for (let i = 0; i < n; i++) {
      covSB += (stratRets[i] - meanS) * (benchRets[i] - meanB);
      varB += (benchRets[i] - meanB) ** 2;
    }
    beta = varB > 0 ? covSB / varB : 0;
    alpha = (meanS - beta * meanB) * 252; // annualized
  }

  // Stability Score (std dev of period returns)
  // Computed later from periods

  // Rolling Sharpe (20-trade window)
  const rollingSharpe: { index: number; value: number }[] = [];
  const ROLLING_WINDOW = 20;
  for (let i = ROLLING_WINDOW; i <= returns.length; i++) {
    const window = returns.slice(i - ROLLING_WINDOW, i).map(r => r / 100);
    const wMean = window.reduce((a, b) => a + b, 0) / window.length;
    const wStd = Math.sqrt(window.reduce((a, b) => a + (b - wMean) ** 2, 0) / window.length);
    const rSharpe = wStd > 0 ? (wMean / wStd) * Math.sqrt(252 / 5) : 0;
    rollingSharpe.push({ index: i, value: parseFloat(rSharpe.toFixed(2)) });
  }

  // Rolling Volatility (20-trade window)
  const rollingVolatility: { index: number; value: number }[] = [];
  for (let i = ROLLING_WINDOW; i <= returns.length; i++) {
    const window = returns.slice(i - ROLLING_WINDOW, i).map(r => r / 100);
    const wMean = window.reduce((a, b) => a + b, 0) / window.length;
    const wStd = Math.sqrt(window.reduce((a, b) => a + (b - wMean) ** 2, 0) / window.length);
    rollingVolatility.push({ index: i, value: parseFloat((wStd * Math.sqrt(252 / 5) * 100).toFixed(2)) });
  }

  // Trade Distribution (histogram -10% to +10% in 1% buckets)
  const tradeDistribution: { bucket: string; count: number }[] = [];
  for (let b = -10; b < 10; b++) {
    const count = returns.filter(r => r >= b && r < b + 1).length;
    tradeDistribution.push({ bucket: `${b}%`, count });
  }
  tradeDistribution.push({ bucket: "10%+", count: returns.filter(r => r >= 10).length });

  // Monthly Returns
  const monthlyMap = new Map<string, number[]>();
  for (const t of trades) {
    const key = t.date.substring(0, 7); // YYYY-MM
    if (!monthlyMap.has(key)) monthlyMap.set(key, []);
    monthlyMap.get(key)!.push(t.returnPct);
  }
  const monthlyReturns = Array.from(monthlyMap.entries()).map(([key, rets]) => ({
    year: parseInt(key.substring(0, 4)),
    month: parseInt(key.substring(5, 7)),
    returnPct: parseFloat(rets.reduce((a, b) => a + b, 0).toFixed(2)),
  }));

  // Regime Performance
  const regimeMap = new Map<string, { correct: number; total: number; returns: number[] }>();
  for (const t of trades) {
    if (!regimeMap.has(t.regime)) regimeMap.set(t.regime, { correct: 0, total: 0, returns: [] });
    const rm = regimeMap.get(t.regime)!;
    rm.total++;
    rm.returns.push(t.returnPct);
    if ((t.action === "BUY" && t.actualReturn > 0) || (t.action === "SHORT" && t.actualReturn < 0)) rm.correct++;
  }
  const regimePerformance = Array.from(regimeMap.entries()).map(([regime, data]) => ({
    regime,
    accuracy: parseFloat(((data.correct / data.total) * 100).toFixed(1)),
    avgReturn: parseFloat((data.returns.reduce((a, b) => a + b, 0) / data.returns.length).toFixed(2)),
    trades: data.total,
  }));

  // Confidence Calibration
  const confBuckets = [
    { bucket: "35-45%", min: 35, max: 45 },
    { bucket: "45-55%", min: 45, max: 55 },
    { bucket: "55-65%", min: 55, max: 65 },
    { bucket: "65-75%", min: 65, max: 75 },
    { bucket: "75-85%", min: 75, max: 85 },
    { bucket: "85-92%", min: 85, max: 92 },
  ];
  const confidenceCalibration = confBuckets.map(b => {
    const bucketTrades = trades.filter(t => t.confidence >= b.min && t.confidence < b.max);
    if (bucketTrades.length === 0) return { bucket: b.bucket, predictedConf: (b.min + b.max) / 2, actualAccuracy: 0, count: 0 };
    const correct = bucketTrades.filter(t => (t.action === "BUY" && t.actualReturn > 0) || (t.action === "SHORT" && t.actualReturn < 0));
    return {
      bucket: b.bucket,
      predictedConf: parseFloat(((b.min + b.max) / 2).toFixed(0)),
      actualAccuracy: parseFloat(((correct.length / bucketTrades.length) * 100).toFixed(1)),
      count: bucketTrades.length,
    };
  }).filter(b => b.count > 0);

  const p = (v: number) => parseFloat(v.toFixed(2));

  return {
    totalTrades: trades.length,
    winRate: p(winRate), avgReturn: p(avgReturn), totalReturn: p(totalReturn),
    maxDrawdown: p(maxDrawdown), sharpeRatio: p(sharpeRatio), sortinoRatio: p(sortinoRatio),
    calmarRatio: p(calmarRatio), profitFactor: p(profitFactor),
    directionalAccuracy: p(directionalAccuracy), mae: p(maeVal), rmse: p(rmse), mape: p(mape),
    avgWin: p(avgWin), avgLoss: p(avgLoss), winLossRatio: p(winLossRatio),
    avgTradeDuration: p(avgTradeDuration), medianTradeDuration, maxTradeDuration,
    avgMAE: p(avgMAE), avgMFE: p(avgMFE),
    valueAtRisk: p(valueAtRisk), conditionalVaR: p(conditionalVaR),
    ulcerIndex: p(ulcerIndex),
    marketExposure: p(marketExposure), longExposure: p(longExposure), shortExposure: p(shortExposure),
    cagr: p(cagr), timeToDouble: p(timeToDouble),
    alpha: p(alpha * 100), beta: p(beta),
    portfolioTurnover: p(portfolioTurnover),
    stabilityScore: 0, // computed from periods later
    signalPrecision: p(signalPrecision), signalRecall: p(signalRecall), signalF1: p(signalF1),
    regimePerformance, confidenceCalibration, annualizedReturn: p(annualizedReturn),
    rollingSharpe, rollingVolatility, tradeDistribution, monthlyReturns,
  };
}

// ============================================================================
// MONTE CARLO SIMULATION
// ============================================================================
function runMonteCarlo(trades: Trade[], initialCapital: number, simulations: number = 1000, positionSizePct: number = 10): BacktestReport['monteCarlo'] {
  if (trades.length < 5) return null;
  const tradeReturns = trades.map(t => t.returnPct / 100);
  const positionSizeFrac = positionSizePct / 100;
  const finalValues: number[] = [];

  for (let s = 0; s < simulations; s++) {
    let capital = initialCapital;
    const shuffled = [...tradeReturns].sort(() => Math.random() - 0.5);
    for (const ret of shuffled) {
      capital *= (1 + ret * positionSizeFrac);
    }
    finalValues.push(((capital - initialCapital) / initialCapital) * 100);
  }

  finalValues.sort((a, b) => a - b);
  const percentile = (p: number) => finalValues[Math.floor(p * finalValues.length / 100)] || 0;

  return {
    percentile5: parseFloat(percentile(5).toFixed(2)),
    percentile25: parseFloat(percentile(25).toFixed(2)),
    median: parseFloat(percentile(50).toFixed(2)),
    percentile75: parseFloat(percentile(75).toFixed(2)),
    percentile95: parseFloat(percentile(95).toFixed(2)),
  };
}

// ============================================================================
// WALK-FORWARD PERIOD BREAKDOWN
// ============================================================================
function computePeriods(trades: Trade[]): BacktestReport['periods'] {
  if (trades.length === 0) return [];
  const periods: BacktestReport['periods'] = [];
  const yearMap = new Map<string, Trade[]>();
  for (const t of trades) {
    const year = t.date.substring(0, 4);
    if (!yearMap.has(year)) yearMap.set(year, []);
    yearMap.get(year)!.push(t);
  }

  for (const [year, yearTrades] of yearMap) {
    const correct = yearTrades.filter(t =>
      (t.action === "BUY" && t.actualReturn > 0) || (t.action === "SHORT" && t.actualReturn < 0)
    );
    const totalRet = yearTrades.reduce((a, t) => a + t.returnPct, 0);
    periods.push({
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      accuracy: parseFloat(((correct.length / yearTrades.length) * 100).toFixed(1)),
      returnPct: parseFloat((totalRet / yearTrades.length).toFixed(2)),
      trades: yearTrades.length,
    });
  }
  return periods;
}

// ============================================================================
// DRAWDOWN CURVE
// ============================================================================
function computeDrawdownCurve(equityCurve: { date: string; value: number }[]): { date: string; drawdown: number }[] {
  let peak = equityCurve[0]?.value || 0;
  return equityCurve.map(p => {
    if (p.value > peak) peak = p.value;
    return { date: p.date, drawdown: parseFloat((((peak - p.value) / peak) * -100).toFixed(2)) };
  });
}

// ============================================================================
// STRESS TESTING - detect crisis periods
// ============================================================================
function detectStressPeriods(
  spyData: DataSet | null,
  allTrades: Trade[],
): BacktestReport['stressTests'] {
  if (!spyData || spyData.close.length < 60) return [];

  const stressTests: BacktestReport['stressTests'] = [];
  const { close, timestamps } = spyData;

  // Scan for drawdown > 15% over 60-bar windows
  for (let i = 60; i < close.length; i += 30) {
    const windowClose = close.slice(i - 60, i);
    const windowPeak = Math.max(...windowClose);
    const peakIdx = windowClose.indexOf(windowPeak);
    const afterPeak = windowClose.slice(peakIdx + 1);
    if (afterPeak.length === 0) continue;
    const windowTrough = Math.min(...afterPeak);
    const dd = ((windowPeak - windowTrough) / windowPeak) * 100;

    if (dd > 15) {
      const startDate = timestamps[i - 60];
      const endDate = timestamps[i];
      const benchReturn = ((close[i] - close[i - 60]) / close[i - 60]) * 100;

      // Find strategy trades during this window
      const windowTrades = allTrades.filter(t => t.date >= startDate && t.date <= endDate);
      if (windowTrades.length === 0) continue;

      const stratReturn = windowTrades.reduce((a, t) => a + t.returnPct, 0);
      const stratPeak = Math.max(...windowTrades.map(t => t.returnPct));
      const stratTrough = Math.min(...windowTrades.map(t => t.returnPct));

      // Determine period label
      let label = "Market Stress";
      if (startDate >= "2020-02" && startDate <= "2020-04") label = "COVID Crash";
      else if (startDate >= "2022-01" && startDate <= "2022-10") label = "2022 Bear Market";
      else if (startDate >= "2008-09" && startDate <= "2009-03") label = "2008 Financial Crisis";
      else if (startDate >= "2018-10" && startDate <= "2019-01") label = "Q4 2018 Selloff";

      // Avoid duplicate labels
      if (!stressTests.find(s => s.period === label)) {
        stressTests.push({
          period: label,
          startDate,
          endDate,
          strategyReturn: parseFloat(stratReturn.toFixed(2)),
          benchmarkReturn: parseFloat(benchReturn.toFixed(2)),
          maxDrawdown: parseFloat(dd.toFixed(2)),
        });
      }
    }
  }

  return stressTests.slice(0, 5); // Max 5 stress periods
}

// ============================================================================
// ROBUSTNESS TESTS
// ============================================================================
function runRobustnessTests(
  data: DataSet,
  ticker: string,
  config: BacktestConfig,
  tradeConfig: TradeConfig,
  baseReturn: number,
): BacktestReport['robustness'] {
  // 1. Noise Injection: add ±0.5% random noise to prices
  const noisyData: DataSet = {
    ...data,
    close: data.close.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
    high: data.high.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
    low: data.low.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
    open: data.open.map(p => p * (1 + (Math.random() - 0.5) * 0.01)),
  };
  const noisyResult = runWalkForwardBacktest(noisyData, ticker, config, tradeConfig);
  const noisyFinal = noisyResult.equityCurve[noisyResult.equityCurve.length - 1]?.value || config.initialCapital;
  const noisyReturn = ((noisyFinal - config.initialCapital) / config.initialCapital) * 100;
  const noiseImpact = Math.abs(baseReturn - noisyReturn);

  // 2. Delayed Execution: t+2 instead of t+1
  const delayedResult = runWalkForwardBacktest(data, ticker, config, tradeConfig, 2);
  const delayedFinal = delayedResult.equityCurve[delayedResult.equityCurve.length - 1]?.value || config.initialCapital;
  const delayedReturn = ((delayedFinal - config.initialCapital) / config.initialCapital) * 100;
  const delayImpact = Math.abs(baseReturn - delayedReturn);

  // 3. Parameter Sensitivity: vary buy/short thresholds
  const paramResults: BacktestReport['robustness']['parameterSensitivity'] = [];
  const thresholdVariations = [20, 25, 30, 35, 40];
  for (const thresh of thresholdVariations) {
    const modConfig = { ...config, buyThreshold: thresh, shortThreshold: -thresh };
    const result = runWalkForwardBacktest(data, ticker, modConfig, tradeConfig);
    const final = result.equityCurve[result.equityCurve.length - 1]?.value || config.initialCapital;
    const ret = ((final - config.initialCapital) / config.initialCapital) * 100;
    const rets = result.trades.map(t => t.returnPct / 100);
    const mean = rets.length > 0 ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const std = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) : 0.001;
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252 / 5) : 0;
    paramResults.push({
      param: `Threshold ±${thresh}`,
      value: thresh,
      returnPct: parseFloat(ret.toFixed(2)),
      sharpe: parseFloat(sharpe.toFixed(2)),
    });
  }

  return {
    noiseInjection: {
      baseReturn: parseFloat(baseReturn.toFixed(2)),
      noisyReturn: parseFloat(noisyReturn.toFixed(2)),
      impact: parseFloat(noiseImpact.toFixed(2)),
      passed: noiseImpact < Math.abs(baseReturn) * 0.5, // passes if impact < 50% of base return
    },
    delayedExecution: {
      baseReturn: parseFloat(baseReturn.toFixed(2)),
      delayedReturn: parseFloat(delayedReturn.toFixed(2)),
      impact: parseFloat(delayImpact.toFixed(2)),
      passed: delayImpact < Math.abs(baseReturn) * 0.5,
    },
    parameterSensitivity: paramResults,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      tickers = ["AAPL"],
      startYear = 2020,
      endYear = 2025,
      initialCapital = 10000,
      positionSizePct = 10,
      stopLossPct = 5,
      takeProfitPct = 10,
      maxPositions = 5,
      rebalanceFrequency = "weekly",
      includeMonteCarlo = true,
      buyThreshold = 30,
      shortThreshold = -30,
    } = body;

    console.log(`Backtest request: ${tickers.join(",")} from ${startYear} to ${endYear}`);

    const config: BacktestConfig = {
      tickers: tickers.slice(0, 5),
      startYear, endYear, initialCapital, positionSizePct,
      stopLossPct, takeProfitPct, maxPositions,
      rebalanceFrequency, includeMonteCarlo,
      buyThreshold, shortThreshold,
    };

    const tradeConfig: TradeConfig = {
      initialCapital,
      positionSizePct,
      stopLossPct,
      takeProfitPct,
      commissionPct: 0.1,
      spreadPct: 0.05,
      slippagePct: 0.1,
    };

    const startDate = Math.floor(new Date(`${startYear}-01-01`).getTime() / 1000);
    const endDate = Math.floor(new Date(`${endYear}-12-31`).getTime() / 1000);

    const fetchPromises = [...config.tickers, "SPY"].map(t => fetchYahooData(t, startDate, endDate));
    const allDataResults = await Promise.all(fetchPromises);

    const spyData = allDataResults[allDataResults.length - 1];
    const tickerData = allDataResults.slice(0, -1);

    // SPY daily returns for alpha/beta
    const benchmarkReturns: number[] = [];
    if (spyData) {
      for (let i = 1; i < spyData.close.length; i++) {
        benchmarkReturns.push((spyData.close[i] - spyData.close[i - 1]) / spyData.close[i - 1]);
      }
    }

    let allTrades: Trade[] = [];
    let combinedEquity: { date: string; value: number }[] = [];
    let totalBarsAll = 0, barsInTradeAll = 0;
    let firstTickerData: DataSet | null = null;

    for (let idx = 0; idx < config.tickers.length; idx++) {
      const data = tickerData[idx];
      if (!data || data.close.length < 100) {
        console.warn(`Insufficient data for ${config.tickers[idx]}, skipping`);
        continue;
      }

      if (!firstTickerData) firstTickerData = data;

      const { trades, equityCurve, totalBars, barsInTrade } = runWalkForwardBacktest(data, config.tickers[idx], config, tradeConfig);
      allTrades = allTrades.concat(trades);
      totalBarsAll += totalBars;
      barsInTradeAll += barsInTrade;

    // When combining multiple tickers, each ticker's equity is relative to its share of capital
    const numTickers = config.tickers.filter((_, ti) => tickerData[ti] && tickerData[ti]!.close.length >= 100).length;
    const capitalPerTicker = config.initialCapital / Math.max(numTickers, 1);

    if (combinedEquity.length === 0) {
        // Scale first ticker's equity to its proportional share
        combinedEquity = equityCurve.map(p => ({
          date: p.date,
          value: capitalPerTicker + (p.value - config.initialCapital) * (capitalPerTicker / config.initialCapital),
        }));
      } else {
        for (const point of equityCurve) {
          const pnl = (point.value - config.initialCapital) * (capitalPerTicker / config.initialCapital);
          const existing = combinedEquity.find(c => c.date === point.date);
          if (existing) {
            existing.value += pnl;
          } else {
            combinedEquity.push({ date: point.date, value: capitalPerTicker + pnl });
          }
        }
      }
    }

    combinedEquity.sort((a, b) => a.date.localeCompare(b.date));
    const years = endYear - startYear;

    // Compute metrics
    const metrics = computeMetrics(allTrades, initialCapital, combinedEquity, years, totalBarsAll, barsInTradeAll, benchmarkReturns);
    const periods = computePeriods(allTrades);
    const drawdownCurve = computeDrawdownCurve(combinedEquity);

    // Stability score from periods
    if (periods.length > 1) {
      const periodReturns = periods.map(p => p.returnPct);
      const mean = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
      const std = Math.sqrt(periodReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / periodReturns.length);
      metrics.stabilityScore = parseFloat(std.toFixed(2));
    }

    // Monte Carlo
    let monteCarlo = null;
    if (includeMonteCarlo && allTrades.length >= 10) {
      monteCarlo = runMonteCarlo(allTrades, initialCapital, 1000, positionSizePct);
    }

    // Benchmark return
    let benchmarkReturn = 0;
    if (spyData && spyData.close.length > 1) {
      benchmarkReturn = parseFloat((((spyData.close[spyData.close.length - 1] - spyData.close[0]) / spyData.close[0]) * 100).toFixed(2));
    }

    // Stress testing
    const stressTests = detectStressPeriods(spyData, allTrades);

    // Robustness tests (only on first ticker to save time)
    let robustness: BacktestReport['robustness'] = {
      noiseInjection: null,
      delayedExecution: null,
      parameterSensitivity: [],
    };
    if (firstTickerData && firstTickerData.close.length >= 100) {
      const baseReturn = metrics.totalReturn || 0;
      robustness = runRobustnessTests(firstTickerData, config.tickers[0], config, tradeConfig, baseReturn);
    }

    // Liquidity warnings: flag trades where position > 2% daily volume
    const liquidityWarnings = allTrades.filter(t => {
      if (t.volumeAtEntry <= 0) return false;
      const positionValue = initialCapital * (positionSizePct / 100);
      const sharesTraded = positionValue / t.entryPrice;
      return sharesTraded > t.volumeAtEntry * 0.02;
    }).length;

    const report: BacktestReport = {
      ...metrics as any,
      periods,
      tradeLog: allTrades.slice(-200),
      equityCurve: combinedEquity,
      drawdownCurve,
      monteCarlo,
      benchmarkReturn,
      robustness,
      stressTests,
      liquidityWarnings,
    };

    console.log(`Backtest complete: ${allTrades.length} trades, Win Rate: ${metrics.winRate}%, Sharpe: ${metrics.sharpeRatio}`);

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Backtest error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Backtest failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
