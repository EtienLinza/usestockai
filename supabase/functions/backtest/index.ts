import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// TECHNICAL INDICATOR FUNCTIONS (duplicated from stock-predict for edge fn isolation)
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
  const signal = calculateEMA(macd.filter(v => !isNaN(v)), 9);
  // Pad signal to match macd length
  const padLen = macd.length - signal.length;
  const paddedSignal = new Array(Math.max(0, padLen)).fill(NaN).concat(signal);
  const histogram = macd.map((v, i) => v - (paddedSignal[i] || 0));
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
// SIGNAL CONSENSUS (simplified for backtesting)
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
  const vol = calculateVolatility(close, 20);
  const adx = calculateADX(high, low, close, 14);
  const stochK = calculateStochastic(close, high, low, 14);

  let bullish = 0, bearish = 0;

  // RSI
  const rsiVal = safeGet(rsi, 50);
  if (rsiVal < 30) bullish += 1.5;
  else if (rsiVal > 70) bearish += 1.5;
  else if (rsiVal > 50) bullish += 0.5;
  else bearish += 0.5;

  // MACD
  const macdH = safeGet(macd.histogram, 0);
  const prevMacdH = macd.histogram.length >= 2 ? macd.histogram[macd.histogram.length - 2] : 0;
  if (macdH > 0 && macdH > prevMacdH) bullish += 1.5;
  else if (macdH < 0 && macdH < prevMacdH) bearish += 1.5;
  else if (macdH > 0) bullish += 0.5;
  else bearish += 0.5;

  // EMA crossover
  const e12 = safeGet(ema12, currentPrice), e26 = safeGet(ema26, currentPrice);
  if (e12 > e26) bullish += 1; else bearish += 1;

  // SMA50
  const s50 = safeGet(sma50, currentPrice);
  if (currentPrice > s50) bullish += 1; else bearish += 1;

  // ADX
  const adxVal = safeGet(adx.adx, 0);
  const pdi = safeGet(adx.plusDI, 0), mdi = safeGet(adx.minusDI, 0);
  if (adxVal > 25) { if (pdi > mdi) bullish += 2; else bearish += 2; }

  // Stochastic
  const sk = safeGet(stochK, 50);
  if (sk < 20) bullish += 1.5;
  else if (sk > 80) bearish += 1.5;

  // Bollinger
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

  // Regime
  let regime = "neutral";
  if (adxVal > 40 && pdi > mdi && rsiVal > 60) regime = "strong_bullish";
  else if (adxVal > 40 && mdi > pdi && rsiVal < 40) regime = "strong_bearish";
  else if (adxVal > 25 && pdi > mdi) regime = "bullish";
  else if (adxVal > 25 && mdi > pdi) regime = "bearish";
  else if (rsiVal > 70) regime = "overbought";
  else if (rsiVal < 30) regime = "oversold";

  // Predicted return based on consensus (-5% to +5% range)
  const predictedReturn = (consensusScore / 100) * 5;

  // Confidence
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
    // Filter out null values while keeping arrays aligned
    const close: number[] = [], high: number[] = [], low: number[] = [], volume: number[] = [], dates: string[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.close[i] != null && quotes.high[i] != null && quotes.low[i] != null) {
        close.push(quotes.close[i]);
        high.push(quotes.high[i]);
        low.push(quotes.low[i]);
        volume.push(quotes.volume[i] || 0);
        dates.push(timestamps[i]);
      }
    }
    return { timestamps: dates, close, high, low, volume };
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
}

function applyTradingCosts(price: number, isBuy: boolean, config: TradeConfig): number {
  let adjusted = price;
  // Spread
  adjusted *= isBuy ? (1 + config.spreadPct / 100) : (1 - config.spreadPct / 100);
  // Slippage (random)
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
  buyThreshold: number;   // consensus score to trigger BUY (default 30)
  shortThreshold: number; // consensus score to trigger SHORT (default -30)
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
  regimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
  confidenceCalibration: { bucket: string; predictedConf: number; actualAccuracy: number; count: number }[];
  equityCurve: { date: string; value: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
  tradeLog: Trade[];
  monteCarlo: { percentile5: number; percentile25: number; median: number; percentile75: number; percentile95: number } | null;
  benchmarkReturn: number;
  annualizedReturn: number;
}

function runWalkForwardBacktest(
  allData: { timestamps: string[]; close: number[]; high: number[]; low: number[]; volume: number[] },
  ticker: string,
  config: BacktestConfig,
  tradeConfig: TradeConfig
): { trades: Trade[]; equityCurve: { date: string; value: number }[] } {
  const { close, high, low, volume, timestamps } = allData;
  const trades: Trade[] = [];
  let capital = config.initialCapital;
  const equityCurve: { date: string; value: number }[] = [{ date: timestamps[0], value: capital }];

  // Walk-forward: use 60-bar training window, step 5 bars at a time
  const TRAIN_WINDOW = 60;
  const STEP = 5; // test on 5 bars ahead

  for (let i = TRAIN_WINDOW; i < close.length - STEP; i += STEP) {
    // Training window
    const trainClose = close.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainHigh = high.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainLow = low.slice(Math.max(0, i - TRAIN_WINDOW), i);
    const trainVol = volume.slice(Math.max(0, i - TRAIN_WINDOW), i);

    if (trainClose.length < 30) continue;

    // Generate signal from training data
    const signal = computeSignal(trainClose, trainHigh, trainLow, trainVol);

    // Determine action
    let action: "BUY" | "SHORT" | "HOLD" = "HOLD";
    if (signal.consensusScore > config.buyThreshold) action = "BUY";
    else if (signal.consensusScore < config.shortThreshold) action = "SHORT";

    if (action === "HOLD") continue;

    // Test period: next STEP bars
    const entryPrice = applyTradingCosts(close[i], action === "BUY", tradeConfig);
    const testEnd = Math.min(i + STEP, close.length - 1);

    // Simulate with stop loss and take profit
    let exitPrice = close[testEnd];
    let exitDate = timestamps[testEnd];

    for (let j = i + 1; j <= testEnd; j++) {
      const priceChange = action === "BUY"
        ? (close[j] - entryPrice) / entryPrice
        : (entryPrice - close[j]) / entryPrice;

      // Stop loss
      if (priceChange <= -config.stopLossPct / 100) {
        exitPrice = action === "BUY"
          ? entryPrice * (1 - config.stopLossPct / 100)
          : entryPrice * (1 + config.stopLossPct / 100);
        exitDate = timestamps[j];
        break;
      }
      // Take profit
      if (priceChange >= config.takeProfitPct / 100) {
        exitPrice = action === "BUY"
          ? entryPrice * (1 + config.takeProfitPct / 100)
          : entryPrice * (1 - config.takeProfitPct / 100);
        exitDate = timestamps[j];
        break;
      }
    }

    exitPrice = applyTradingCosts(exitPrice, action !== "BUY", tradeConfig);

    // Calculate PnL
    const positionSize = capital * (config.positionSizePct / 100);
    const shares = positionSize / entryPrice;
    const commission = positionSize * (tradeConfig.commissionPct / 100) * 2; // entry + exit

    let pnl: number;
    if (action === "BUY") {
      pnl = (exitPrice - entryPrice) * shares - commission;
    } else {
      pnl = (entryPrice - exitPrice) * shares - commission;
    }

    const returnPct = (pnl / positionSize) * 100;
    const actualReturn = (close[testEnd] - close[i]) / close[i] * 100;

    capital += pnl;

    trades.push({
      date: timestamps[i],
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
    });

    equityCurve.push({ date: exitDate, value: capital });
  }

  return { trades, equityCurve };
}

// ============================================================================
// METRICS COMPUTATION
// ============================================================================
function computeMetrics(trades: Trade[], initialCapital: number, equityCurve: { date: string; value: number }[], years: number): Omit<BacktestReport, 'periods' | 'tradeLog' | 'equityCurve' | 'drawdownCurve' | 'monteCarlo' | 'benchmarkReturn'> {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winRate: 0, avgReturn: 0, totalReturn: 0, maxDrawdown: 0,
      sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, profitFactor: 0,
      directionalAccuracy: 0, mae: 0, rmse: 0,
      regimePerformance: [], confidenceCalibration: [], annualizedReturn: 0,
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

  // Max Drawdown
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = ((peak - point.value) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe Ratio (annualized, assume 252 trading days, risk-free ~4%)
  const riskFreeDaily = 0.04 / 252;
  const meanReturn = returns.reduce((a, b) => a + b / 100, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b / 100 - meanReturn, 2), 0) / returns.length);
  const sharpeRatio = stdReturn > 0 ? ((meanReturn - riskFreeDaily) / stdReturn) * Math.sqrt(252 / 5) : 0; // 5-day periods

  // Sortino Ratio (downside only)
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

  // Directional Accuracy
  const correctDir = trades.filter(t => {
    if (t.action === "BUY" && t.actualReturn > 0) return true;
    if (t.action === "SHORT" && t.actualReturn < 0) return true;
    return false;
  });
  const directionalAccuracy = (correctDir.length / trades.length) * 100;

  // MAE and RMSE (predicted return vs actual return)
  const errors = trades.map(t => t.predictedReturn - t.actualReturn);
  const mae = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length);

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

  return {
    totalTrades: trades.length,
    winRate: parseFloat(winRate.toFixed(1)),
    avgReturn: parseFloat(avgReturn.toFixed(2)),
    totalReturn: parseFloat(totalReturn.toFixed(2)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    sortinoRatio: parseFloat(sortinoRatio.toFixed(2)),
    calmarRatio: parseFloat(calmarRatio.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    directionalAccuracy: parseFloat(directionalAccuracy.toFixed(1)),
    mae: parseFloat(mae.toFixed(2)),
    rmse: parseFloat(rmse.toFixed(2)),
    regimePerformance,
    confidenceCalibration,
    annualizedReturn: parseFloat(annualizedReturn.toFixed(2)),
  };
}

// ============================================================================
// MONTE CARLO SIMULATION
// ============================================================================
function runMonteCarlo(trades: Trade[], initialCapital: number, simulations: number = 1000): BacktestReport['monteCarlo'] {
  if (trades.length < 5) return null;
  const tradeReturns = trades.map(t => t.returnPct / 100);
  const finalValues: number[] = [];

  for (let s = 0; s < simulations; s++) {
    let capital = initialCapital;
    // Shuffle trade order
    const shuffled = [...tradeReturns].sort(() => Math.random() - 0.5);
    for (const ret of shuffled) {
      capital *= (1 + ret * 0.1); // position size = 10%
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
function computePeriods(trades: Trade[], periodMonths: number = 12): BacktestReport['periods'] {
  if (trades.length === 0) return [];
  const periods: BacktestReport['periods'] = [];
  
  // Group trades by year
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

    // Fetch data for all tickers + SPY benchmark
    const startDate = Math.floor(new Date(`${startYear}-01-01`).getTime() / 1000);
    const endDate = Math.floor(new Date(`${endYear}-12-31`).getTime() / 1000);

    const fetchPromises = [...config.tickers, "SPY"].map(t => fetchYahooData(t, startDate, endDate));
    const allDataResults = await Promise.all(fetchPromises);

    const spyData = allDataResults[allDataResults.length - 1];
    const tickerData = allDataResults.slice(0, -1);

    // Run backtest for each ticker
    let allTrades: Trade[] = [];
    let combinedEquity: { date: string; value: number }[] = [];

    for (let idx = 0; idx < config.tickers.length; idx++) {
      const data = tickerData[idx];
      if (!data || data.close.length < 100) {
        console.warn(`Insufficient data for ${config.tickers[idx]}, skipping`);
        continue;
      }

      const { trades, equityCurve } = runWalkForwardBacktest(data, config.tickers[idx], config, tradeConfig);
      allTrades = allTrades.concat(trades);

      if (combinedEquity.length === 0) {
        combinedEquity = equityCurve;
      } else {
        // Merge equity curves (add PnL differences)
        for (const point of equityCurve) {
          const existing = combinedEquity.find(c => c.date === point.date);
          if (existing) {
            existing.value += (point.value - config.initialCapital);
          } else {
            combinedEquity.push(point);
          }
        }
      }
    }

    // Sort equity curve by date
    combinedEquity.sort((a, b) => a.date.localeCompare(b.date));

    // Compute years for annualization
    const years = endYear - startYear;

    // Compute all metrics
    const metrics = computeMetrics(allTrades, initialCapital, combinedEquity, years);
    const periods = computePeriods(allTrades);
    const drawdownCurve = computeDrawdownCurve(combinedEquity);

    // Monte Carlo
    let monteCarlo = null;
    if (includeMonteCarlo && allTrades.length >= 10) {
      monteCarlo = runMonteCarlo(allTrades, initialCapital, 1000);
    }

    // Benchmark return (SPY buy & hold)
    let benchmarkReturn = 0;
    if (spyData && spyData.close.length > 1) {
      benchmarkReturn = parseFloat((((spyData.close[spyData.close.length - 1] - spyData.close[0]) / spyData.close[0]) * 100).toFixed(2));
    }

    const report: BacktestReport = {
      ...metrics,
      periods,
      tradeLog: allTrades.slice(-200), // Last 200 trades to keep response size manageable
      equityCurve: combinedEquity,
      drawdownCurve,
      monteCarlo,
      benchmarkReturn,
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
