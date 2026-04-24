// ============================================================================
// NEWS SENTIMENT — fetches recent headlines for a ticker, asks Gemini to score
// them on a -100..+100 scale with a confidence rating, and caches the result
// for 30 minutes to keep cost & latency low.
//
// Called server-to-server from autotrader-scan via the Supabase service role.
// Returns the same shape on cache hit and cache miss.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MIN = 30;
const MAX_HEADLINES = 10;

interface Headline {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

interface SentimentResult {
  ticker: string;
  score: number;        // -100 .. +100
  confidence: number;   // 0 .. 1
  headlines: Headline[];
  reasoning: string;
  cached: boolean;
  source: "gemini" | "no_news" | "fallback" | "cache";
}

// ── NewsAPI fetch ──────────────────────────────────────────────────────────
async function fetchHeadlines(ticker: string, apiKey: string): Promise<Headline[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(ticker)}&from=${since}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) {
      console.warn(`NewsAPI ${ticker}: HTTP ${r.status}`);
      return [];
    }
    const j = await r.json();
    const articles = (j.articles ?? []) as Array<{
      title?: string;
      source?: { name?: string };
      url?: string;
      publishedAt?: string;
    }>;

    const seen = new Set<string>();
    const out: Headline[] = [];
    for (const a of articles) {
      if (!a.title || !a.url || !a.publishedAt) continue;
      // Skip pure price-summary noise
      if (/^.{0,40}(stock|shares|price)\s+(up|down|gains?|falls?|drops?|rises?|jumps?)/i.test(a.title)) continue;
      const key = a.title.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: a.title,
        source: a.source?.name ?? "unknown",
        url: a.url,
        publishedAt: a.publishedAt,
      });
      if (out.length >= MAX_HEADLINES) break;
    }
    return out;
  } catch (e) {
    clearTimeout(t);
    console.warn(`NewsAPI ${ticker} failed:`, e);
    return [];
  }
}

// ── Gemini classification via Lovable AI Gateway ──────────────────────────
async function classify(ticker: string, headlines: Headline[], lovableKey: string): Promise<{
  score: number; confidence: number; reasoning: string;
} | null> {
  const headlineBlock = headlines.map((h, i) =>
    `${i + 1}. [${h.source}] ${h.title}`,
  ).join("\n");

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      {
        role: "system",
        content:
          "You are a market news analyst. Read the headlines and judge how a typical institutional trader would react over the next 24 hours. " +
          "Be blind to chart patterns — judge the news on its own merit. " +
          "Score from -100 (catastrophic: bankruptcy, fraud, regulatory shutdown) to +100 (transformative: blowout earnings, M&A bid). " +
          "Most days the answer should be near zero with low confidence. Only assign extreme scores when the news genuinely warrants it.",
      },
      {
        role: "user",
        content: `Ticker: ${ticker}\n\nHeadlines (last 24h):\n${headlineBlock}\n\nRate the net sentiment.`,
      },
    ],
    tools: [{
      type: "function",
      function: {
        name: "rate_sentiment",
        description: "Return a numeric sentiment rating",
        parameters: {
          type: "object",
          properties: {
            score: {
              type: "integer",
              minimum: -100,
              maximum: 100,
              description: "Net sentiment from -100 (very negative) to +100 (very positive). Use 0 for neutral.",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "How confident you are in the score. Low confidence (<0.3) for vague or contradictory news.",
            },
            reasoning: {
              type: "string",
              description: "One sentence explaining the score, ≤140 chars.",
            },
          },
          required: ["score", "confidence", "reasoning"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "rate_sentiment" } },
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (r.status === 429) { console.warn("Gemini rate-limited"); return null; }
    if (r.status === 402) { console.warn("Gemini credits exhausted"); return null; }
    if (!r.ok) { console.warn(`Gemini HTTP ${r.status}`); return null; }

    const j = await r.json();
    const call = j.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) return null;
    const args = JSON.parse(call.function.arguments) as {
      score: number; confidence: number; reasoning: string;
    };
    return {
      score: Math.max(-100, Math.min(100, Math.round(args.score))),
      confidence: Math.max(0, Math.min(1, args.confidence)),
      reasoning: String(args.reasoning ?? "").slice(0, 200),
    };
  } catch (e) {
    clearTimeout(t);
    console.warn("Gemini call failed:", e);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { ticker: rawTicker } = await req.json().catch(() => ({}));
    const ticker = String(rawTicker ?? "").trim().toUpperCase();
    if (!ticker || !/^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(ticker)) {
      return json({ error: "Invalid ticker" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Cache hit?
    const { data: cached } = await supabase
      .from("news_sentiment_cache")
      .select("*")
      .eq("ticker", ticker)
      .maybeSingle();

    if (cached) {
      const ageMin = (Date.now() - new Date(cached.fetched_at as string).getTime()) / 60000;
      if (ageMin < CACHE_TTL_MIN) {
        return json({
          ticker,
          score: cached.score,
          confidence: Number(cached.confidence),
          headlines: cached.headlines ?? [],
          reasoning: cached.reasoning ?? "",
          cached: true,
          source: "cache",
        } satisfies SentimentResult);
      }
    }

    // 2. Fetch headlines
    const newsKey = Deno.env.get("NEWSAPI_KEY");
    const headlines = newsKey ? await fetchHeadlines(ticker, newsKey) : [];

    // 3. No news → neutral
    if (headlines.length === 0) {
      const result: SentimentResult = {
        ticker, score: 0, confidence: 0,
        headlines: [], reasoning: "No recent news",
        cached: false, source: "no_news",
      };
      await upsertCache(supabase, result);
      return json(result);
    }

    // 4. Classify with Gemini
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      const result: SentimentResult = {
        ticker, score: 0, confidence: 0,
        headlines, reasoning: "AI key missing — neutral fallback",
        cached: false, source: "fallback",
      };
      return json(result);
    }

    const verdict = await classify(ticker, headlines, lovableKey);
    if (!verdict) {
      // Fail open — neutral, cache briefly so we don't hammer on outage
      const result: SentimentResult = {
        ticker, score: 0, confidence: 0,
        headlines, reasoning: "Gemini unavailable — neutral fallback",
        cached: false, source: "fallback",
      };
      await upsertCache(supabase, result);
      return json(result);
    }

    const result: SentimentResult = {
      ticker,
      score: verdict.score,
      confidence: verdict.confidence,
      headlines,
      reasoning: verdict.reasoning,
      cached: false,
      source: "gemini",
    };

    await upsertCache(supabase, result);

    // Opportunistic cleanup — drop rows older than 24h
    void supabase.from("news_sentiment_cache")
      .delete()
      .lt("fetched_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    return json(result);
  } catch (err) {
    console.error("news-sentiment top-level error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

async function upsertCache(
  supabase: ReturnType<typeof createClient>,
  r: SentimentResult,
) {
  await supabase.from("news_sentiment_cache").upsert({
    ticker: r.ticker,
    score: r.score,
    confidence: r.confidence,
    headlines: r.headlines,
    reasoning: r.reasoning,
    fetched_at: new Date().toISOString(),
  }, { onConflict: "ticker" });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
