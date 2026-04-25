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
