// ============================================================================
// YAHOO-HISTORY — single source of truth for daily OHLCV history.
//
// Finnhub's free tier does NOT include /stock/candle, so historical bars must
// continue to come from Yahoo. Centralizing here means a future paid-tier
// upgrade to Finnhub candles is a one-file change.
// ============================================================================

export interface DataSet {
  timestamps: string[]; // ISO yyyy-mm-dd
  close: number[];
  high: number[];
  low: number[];
  open: number[];
  volume: number[];
}

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Fetch daily OHLCV bars from Yahoo Finance.
 * @param ticker  e.g. "AAPL", "^VIX", "BTC-USD"
 * @param range   Yahoo range string ("1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max")
 */
export async function fetchDailyHistory(
  ticker: string,
  range: string = "1y",
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DataSet | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    const r = await fetch(url, {
      headers: { "User-Agent": YAHOO_UA },
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
        ds.close.push(q.close[i]);
        ds.high.push(q.high[i]);
        ds.low.push(q.low[i]);
        ds.open.push(q.open[i]);
        ds.volume.push(q.volume[i] || 0);
      }
    }
    return ds;
  } catch (e) {
    console.warn(`fetchDailyHistory(${ticker}) failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Convenience: fetch only the close array for a ticker. Returns [] on failure.
 */
export async function fetchDailyCloses(ticker: string, range: string = "3mo"): Promise<number[]> {
  const ds = await fetchDailyHistory(ticker, range);
  return ds?.close ?? [];
}
