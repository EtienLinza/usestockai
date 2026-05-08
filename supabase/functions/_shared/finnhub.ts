// ============================================================================
// FINNHUB CLIENT — minimal, typed wrappers around the Finnhub REST API.
//
// Used as the PRIMARY source for:
//   • live quote (real-time price + previous close)
//   • company news (ticker-tagged, last 7 days)
//   • basic fundamentals (PE, market cap, beta, 52w range)
//
// Yahoo Finance remains the source for historical daily candles, sector ETFs,
// and as a fallback if Finnhub is rate-limited or returns empty.
//
// Free tier: 60 req/min. We use short timeouts and never block the caller —
// every helper returns null/empty on failure so callers can fall back.
// ============================================================================

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const DEFAULT_TIMEOUT_MS = 6000;

function getKey(): string | null {
  return Deno.env.get("FINNHUB_API_KEY") ?? null;
}

async function finnhubFetch(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown | null> {
  const key = getKey();
  if (!key) return null;
  const url = `${FINNHUB_BASE}${path}${path.includes("?") ? "&" : "?"}token=${key}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) {
      console.warn(`finnhub ${path} → HTTP ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    console.warn(`finnhub ${path} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Quote ────────────────────────────────────────────────────────────────────
export interface FinnhubQuote {
  current: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  changePct: number;
  timestamp: number; // unix seconds
}

export async function getQuote(ticker: string): Promise<FinnhubQuote | null> {
  const j = await finnhubFetch(`/quote?symbol=${encodeURIComponent(ticker)}`) as
    | { c?: number; pc?: number; o?: number; h?: number; l?: number; dp?: number; t?: number }
    | null;
  if (!j || typeof j.c !== "number" || j.c <= 0) return null;
  return {
    current: j.c,
    previousClose: typeof j.pc === "number" ? j.pc : 0,
    open: typeof j.o === "number" ? j.o : 0,
    high: typeof j.h === "number" ? j.h : 0,
    low: typeof j.l === "number" ? j.l : 0,
    changePct: typeof j.dp === "number" ? j.dp : 0,
    timestamp: typeof j.t === "number" ? j.t : Math.floor(Date.now() / 1000),
  };
}

// ── Company News ─────────────────────────────────────────────────────────────
export interface FinnhubNewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string; // ISO
  summary?: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getCompanyNews(ticker: string, daysBack = 7): Promise<FinnhubNewsItem[]> {
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const path = `/company-news?symbol=${encodeURIComponent(ticker)}&from=${ymd(from)}&to=${ymd(to)}`;
  const j = await finnhubFetch(path) as
    | Array<{ headline?: string; source?: string; url?: string; datetime?: number; summary?: string }>
    | null;
  if (!Array.isArray(j)) return [];
  const seen = new Set<string>();
  const out: FinnhubNewsItem[] = [];
  // Newest first
  const sorted = [...j].sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0));
  for (const a of sorted) {
    if (!a.headline || !a.url || !a.datetime) continue;
    const key = a.headline.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: a.headline,
      source: a.source ?? "Finnhub",
      url: a.url,
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      summary: a.summary,
    });
    if (out.length >= 20) break;
  }
  return out;
}

// ── Fundamentals (free-tier "basic financials" + profile) ────────────────────
export interface FinnhubFundamentals {
  peRatio: number | null;
  marketCap: number | null;     // in USD
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  dividendYield: number | null; // pct
  industry: string | null;
  exchange: string | null;
}

export async function getFundamentals(ticker: string): Promise<FinnhubFundamentals | null> {
  const [metricRes, profileRes] = await Promise.all([
    finnhubFetch(`/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`),
    finnhubFetch(`/stock/profile2?symbol=${encodeURIComponent(ticker)}`),
  ]);

  const m = (metricRes as { metric?: Record<string, number | undefined> } | null)?.metric ?? {};
  const p = (profileRes as { marketCapitalization?: number; finnhubIndustry?: string; exchange?: string } | null) ?? {};

  // Bail if we got nothing useful
  if (!metricRes && !profileRes) return null;

  const num = (v: number | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  return {
    peRatio: num(m.peTTM) ?? num(m.peNormalizedAnnual),
    // profile2 returns market cap in MILLIONS of USD
    marketCap: typeof p.marketCapitalization === "number" ? p.marketCapitalization * 1_000_000 : null,
    beta: num(m.beta),
    week52High: num(m["52WeekHigh"]),
    week52Low: num(m["52WeekLow"]),
    dividendYield: num(m.dividendYieldIndicatedAnnual),
    industry: p.finnhubIndustry ?? null,
    exchange: p.exchange ?? null,
  };
}

export function isFinnhubConfigured(): boolean {
  return getKey() !== null;
}

// ── Universal live-quote with Yahoo fallback ─────────────────────────────────
// Single entry point for "give me the current price right now" across the
// entire backend. Tries Finnhub first; if it fails or is unconfigured, falls
// back to Yahoo's intraday meta endpoint. Returns null only if BOTH fail.
export interface LiveQuote {
  price: number;
  previousClose: number | null;
  changePct: number | null;
  marketState: string | null;
  source: "finnhub" | "yahoo";
}

const YAHOO_UA_FALLBACK = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function yahooIntradayQuote(ticker: string): Promise<LiveQuote | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`,
      { headers: { "User-Agent": YAHOO_UA_FALLBACK }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") return null;
    const prev = typeof meta.previousClose === "number"
      ? meta.previousClose
      : (typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null);
    return {
      price: meta.regularMarketPrice,
      previousClose: prev,
      changePct: prev && prev > 0 ? ((meta.regularMarketPrice - prev) / prev) * 100 : null,
      marketState: meta.marketState ?? null,
      source: "yahoo",
    };
  } catch {
    return null;
  }
}

export async function getQuoteWithFallback(ticker: string): Promise<LiveQuote | null> {
  // Try Finnhub first (fast, reliable, ticker-validated)
  const fh = await getQuote(ticker);
  if (fh && fh.current > 0) {
    // Finnhub doesn't return marketState; fetch it lazily only if needed by
    // callers — here we leave it null and let callers that need it call Yahoo.
    return {
      price: fh.current,
      previousClose: fh.previousClose || null,
      changePct: fh.changePct || null,
      marketState: null,
      source: "finnhub",
    };
  }
  // Fallback to Yahoo
  return await yahooIntradayQuote(ticker);
}

// ── Earnings Calendar (Phase 1 #4) ──────────────────────────────────────────
// Returns the next earnings date (YYYY-MM-DD) within the next 21 days for the
// given ticker, or null if none scheduled / API unavailable. Cached in-memory
// for 6 hours per ticker to stay well under Finnhub's 60 req/min free tier.
const earningsCache = new Map<string, { date: string | null; cachedAt: number }>();
const EARNINGS_TTL_MS = 6 * 60 * 60 * 1000;

export async function getNextEarningsDate(ticker: string): Promise<string | null> {
  const t = ticker.toUpperCase();
  const cached = earningsCache.get(t);
  if (cached && Date.now() - cached.cachedAt < EARNINGS_TTL_MS) return cached.date;

  const today = new Date();
  const horizon = new Date(today.getTime() + 21 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const j = await finnhubFetch(
    `/calendar/earnings?from=${fmt(today)}&to=${fmt(horizon)}&symbol=${encodeURIComponent(t)}`,
  ) as { earningsCalendar?: Array<{ date?: string; symbol?: string }> } | null;

  let next: string | null = null;
  if (j?.earningsCalendar?.length) {
    const dates = j.earningsCalendar
      .filter(e => (e.symbol ?? "").toUpperCase() === t && typeof e.date === "string")
      .map(e => e.date as string)
      .sort();
    next = dates[0] ?? null;
  }
  earningsCache.set(t, { date: next, cachedAt: Date.now() });
  return next;
}

// Returns trading-days-until-earnings (rounded), or null if none in horizon.
export async function getEarningsBlackoutDays(ticker: string): Promise<number | null> {
  const date = await getNextEarningsDate(ticker);
  if (!date) return null;
  const ms = new Date(date + "T00:00:00Z").getTime() - Date.now();
  if (ms < 0) return null;
  const calDays = Math.ceil(ms / 86400000);
  // Approximate trading days (5/7 of calendar)
  return Math.max(0, Math.round(calDays * (5 / 7)));
}

// ── Sector classification (Phase 3 #14) ──────────────────────────────────────
// Maps a ticker to a broad sector bucket (~GICS Level 1) using Finnhub's
// `finnhubIndustry` field. Cached in-memory for 24 h. Returns null only if
// Finnhub is unconfigured or both the cache and API miss.
const sectorCache = new Map<string, { sector: string | null; cachedAt: number }>();
const SECTOR_TTL_MS = 24 * 60 * 60 * 1000;

const INDUSTRY_TO_SECTOR: Record<string, string> = {
  // Technology
  "Technology": "Technology",
  "Semiconductors": "Technology",
  "Software": "Technology",
  "Hardware Equipment & Parts": "Technology",
  "Communications": "Technology",
  "Telecommunication": "Technology",
  // Financials
  "Banking": "Financials",
  "Finance": "Financials",
  "Insurance": "Financials",
  "Real Estate": "Real Estate",
  "Holding Companies": "Financials",
  // Healthcare
  "Health Care": "Healthcare",
  "Pharmaceuticals": "Healthcare",
  "Biotechnology": "Healthcare",
  "Medical Devices": "Healthcare",
  // Consumer
  "Retail": "Consumer Discretionary",
  "Consumer products": "Consumer Discretionary",
  "Automobiles": "Consumer Discretionary",
  "Hotels, Restaurants & Leisure": "Consumer Discretionary",
  "Textiles, Apparel & Luxury Goods": "Consumer Discretionary",
  "Beverages": "Consumer Staples",
  "Food Products": "Consumer Staples",
  "Tobacco": "Consumer Staples",
  // Energy / materials / industrial
  "Energy": "Energy",
  "Oil & Gas": "Energy",
  "Utilities": "Utilities",
  "Chemicals": "Materials",
  "Metals & Mining": "Materials",
  "Materials": "Materials",
  "Industrials": "Industrials",
  "Aerospace & Defense": "Industrials",
  "Transportation": "Industrials",
  "Logistics & Transportation": "Industrials",
  "Construction": "Industrials",
  "Machinery": "Industrials",
  // Misc / fallback
  "Media": "Communication Services",
  "Internet": "Communication Services",
};

function bucketIndustry(industry: string | null): string | null {
  if (!industry) return null;
  if (INDUSTRY_TO_SECTOR[industry]) return INDUSTRY_TO_SECTOR[industry];
  // Fuzzy contains-match
  const lower = industry.toLowerCase();
  for (const [k, v] of Object.entries(INDUSTRY_TO_SECTOR)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return "Other";
}

export async function getSector(ticker: string): Promise<string | null> {
  const t = ticker.toUpperCase();
  const cached = sectorCache.get(t);
  if (cached && Date.now() - cached.cachedAt < SECTOR_TTL_MS) return cached.sector;

  const profile = await finnhubFetch(
    `/stock/profile2?symbol=${encodeURIComponent(t)}`,
  ) as { finnhubIndustry?: string } | null;
  const sector = bucketIndustry(profile?.finnhubIndustry ?? null);
  sectorCache.set(t, { sector, cachedAt: Date.now() });
  return sector;
}
