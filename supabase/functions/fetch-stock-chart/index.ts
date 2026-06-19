// ============================================================================
// FETCH-STOCK-CHART — server-side chart data + overview for the stock detail
// page. Yahoo for candles (free, no key), Finnhub for company name/fundamentals
// /news. CORS-safe so the browser can call it directly.
//
// Body: { ticker: string; range?: "1D"|"5D"|"1M"|"6M"|"1Y"|"5Y"; overview?: boolean }
// Default range = "1M". When overview=true (default), includes quote +
// fundamentals + name + recent news.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getQuoteWithFallback, getFundamentals, getCompanyNews } from "../_shared/finnhub.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

type Range = "1D" | "5D" | "1M" | "6M" | "1Y" | "5Y";
const RANGE_MAP: Record<Range, { interval: string; range: string }> = {
  "1D": { interval: "5m",  range: "1d"  },
  "5D": { interval: "15m", range: "5d"  },
  "1M": { interval: "1d",  range: "1mo" },
  "6M": { interval: "1d",  range: "6mo" },
  "1Y": { interval: "1d",  range: "1y"  },
  "5Y": { interval: "1wk", range: "5y"  },
};

async function fetchCandles(ticker: string, range: Range) {
  const { interval, range: r } = RANGE_MAP[range];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${r}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const closes: (number | null)[] = q.close ?? [];
    const opens:  (number | null)[] = q.open  ?? [];
    const highs:  (number | null)[] = q.high  ?? [];
    const lows:   (number | null)[] = q.low   ?? [];
    const vols:   (number | null)[] = q.volume ?? [];
    const out: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      out.push({
        t: ts[i] * 1000,
        o: opens[i] ?? c,
        h: highs[i] ?? c,
        l: lows[i] ?? c,
        c,
        v: vols[i] ?? 0,
      });
    }
    return out;
  } catch (e) {
    clearTimeout(t);
    console.warn(`chart candles ${ticker} ${range} failed:`, e);
    return [];
  }
}

async function fetchYahooName(ticker: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
      { headers: { "User-Agent": YAHOO_UA }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    return meta?.longName ?? meta?.shortName ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker ?? "").trim().toUpperCase();
    const range = (String(body?.range ?? "1M").toUpperCase() as Range);
    const wantOverview = body?.overview !== false;

    if (!ticker || !/^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(ticker)) {
      return new Response(
        JSON.stringify({ error: "Invalid ticker" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!(range in RANGE_MAP)) {
      return new Response(
        JSON.stringify({ error: "Invalid range" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tasks: Promise<unknown>[] = [fetchCandles(ticker, range)];
    if (wantOverview) {
      tasks.push(
        getQuoteWithFallback(ticker),
        getFundamentals(ticker).catch(() => null),
        getCompanyNews(ticker, 7).catch(() => []),
        fetchYahooName(ticker),
      );
    }
    const [candles, quote, fundamentals, news, name] = await Promise.all(tasks) as any;

    return new Response(
      JSON.stringify({
        ticker,
        range,
        candles,
        ...(wantOverview ? {
          name: name ?? null,
          quote: quote ?? null,
          fundamentals: fundamentals ?? null,
          news: Array.isArray(news) ? news.slice(0, 10) : [],
        } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fetch-stock-chart error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
