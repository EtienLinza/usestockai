// ============================================================================
// NEWS SENTIMENT — fetches recent headlines for a ticker and scores them with
// a deterministic keyword-based classifier. No AI involvement.
//
// Scoring model:
//   - Each headline is tokenized and matched against weighted bullish/bearish
//     keyword lists (single words and short phrases).
//   - Per-headline raw score is clamped to [-1, +1], then weighted by source
//     credibility (Reuters/Bloomberg/WSJ count more than blogs).
//   - Final score is the source-weighted average of per-headline scores
//     mapped to [-100, +100].
//   - Confidence is driven by:
//       (a) volume of matched keywords (more matches → more confident)
//       (b) directional agreement (consistent bull/bear → more confident)
//       (c) coverage from credible sources
//   - When no keywords match, score is 0 with low confidence (NOT zero, so
//     downstream consumers can distinguish "neutral signal" from "no signal").
//
// Cached for 30 min per ticker — same shape as before so callers (NewsPanel)
// keep working without changes.
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
  source: "keyword" | "no_news" | "cache";
}

// ── NewsAPI fetch (unchanged) ─────────────────────────────────────────────
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
      // Skip pure price-summary noise (these are tautological, not informative)
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

// ── Deterministic keyword lexicon ─────────────────────────────────────────
//
// Weights are intentionally calibrated so that a single strong word doesn't
// dominate; you need agreement across the headline. Negation handling: if
// a negator appears within 4 tokens before a polarity word, the polarity
// is flipped. e.g. "not a beat" → bearish, "no fraud" → bullish.

interface LexEntry { weight: number; phrase: string }

// Bullish: positive surprise, growth, demand, upgrades, M&A in our favor.
const BULLISH: ReadonlyArray<LexEntry> = [
  // Strong (±0.8 .. ±1.0 raw contribution)
  { phrase: "beats estimates", weight: 1.0 },
  { phrase: "tops estimates", weight: 1.0 },
  { phrase: "raises guidance", weight: 1.0 },
  { phrase: "raises outlook", weight: 1.0 },
  { phrase: "record revenue", weight: 0.9 },
  { phrase: "record profit", weight: 0.9 },
  { phrase: "blowout quarter", weight: 1.0 },
  { phrase: "blowout earnings", weight: 1.0 },
  { phrase: "acquisition target", weight: 0.9 },
  { phrase: "buyout offer", weight: 0.9 },
  { phrase: "to acquire", weight: 0.7 },
  { phrase: "fda approval", weight: 1.0 },
  { phrase: "fda approves", weight: 1.0 },
  { phrase: "patent granted", weight: 0.6 },
  { phrase: "wins contract", weight: 0.7 },
  { phrase: "awarded contract", weight: 0.7 },
  { phrase: "expands partnership", weight: 0.5 },
  { phrase: "strategic partnership", weight: 0.5 },
  { phrase: "share buyback", weight: 0.7 },
  { phrase: "stock buyback", weight: 0.7 },
  { phrase: "increases dividend", weight: 0.6 },
  { phrase: "dividend hike", weight: 0.6 },
  // Medium (±0.3 .. ±0.5)
  { phrase: "upgrade", weight: 0.5 },
  { phrase: "upgraded", weight: 0.5 },
  { phrase: "outperform", weight: 0.4 },
  { phrase: "overweight", weight: 0.4 },
  { phrase: "buy rating", weight: 0.5 },
  { phrase: "price target raised", weight: 0.6 },
  { phrase: "raised price target", weight: 0.6 },
  { phrase: "strong demand", weight: 0.5 },
  { phrase: "robust growth", weight: 0.5 },
  { phrase: "accelerating", weight: 0.4 },
  { phrase: "expansion", weight: 0.3 },
  { phrase: "partnership", weight: 0.3 },
  { phrase: "launches", weight: 0.3 },
  { phrase: "innovative", weight: 0.2 },
  // Weak (±0.1 .. ±0.2)
  { phrase: "growth", weight: 0.2 },
  { phrase: "profit", weight: 0.2 },
  { phrase: "gains", weight: 0.15 },
  { phrase: "rally", weight: 0.15 },
  { phrase: "surge", weight: 0.2 },
  { phrase: "soars", weight: 0.25 },
  { phrase: "jumps", weight: 0.2 },
  { phrase: "bullish", weight: 0.4 },
  { phrase: "positive", weight: 0.15 },
  { phrase: "approval", weight: 0.3 },
  { phrase: "wins", weight: 0.25 },
  { phrase: "beat", weight: 0.4 },
  { phrase: "exceeds", weight: 0.4 },
  { phrase: "outpaces", weight: 0.3 },
];

// Bearish: misses, downgrades, regulatory trouble, dilution, fraud.
const BEARISH: ReadonlyArray<LexEntry> = [
  // Strong
  { phrase: "misses estimates", weight: 1.0 },
  { phrase: "lowers guidance", weight: 1.0 },
  { phrase: "cuts guidance", weight: 1.0 },
  { phrase: "slashes guidance", weight: 1.0 },
  { phrase: "guidance cut", weight: 1.0 },
  { phrase: "withdraws guidance", weight: 1.0 },
  { phrase: "profit warning", weight: 1.0 },
  { phrase: "earnings warning", weight: 1.0 },
  { phrase: "bankruptcy", weight: 1.0 },
  { phrase: "chapter 11", weight: 1.0 },
  { phrase: "going concern", weight: 0.9 },
  { phrase: "fraud", weight: 1.0 },
  { phrase: "accounting irregularities", weight: 1.0 },
  { phrase: "sec investigation", weight: 0.9 },
  { phrase: "doj investigation", weight: 0.9 },
  { phrase: "fbi investigation", weight: 0.9 },
  { phrase: "subpoena", weight: 0.7 },
  { phrase: "class action", weight: 0.6 },
  { phrase: "fda rejection", weight: 1.0 },
  { phrase: "fda rejects", weight: 1.0 },
  { phrase: "trial failed", weight: 0.9 },
  { phrase: "phase 3 failure", weight: 0.9 },
  { phrase: "recall", weight: 0.6 },
  { phrase: "data breach", weight: 0.7 },
  { phrase: "cyberattack", weight: 0.7 },
  { phrase: "ransomware", weight: 0.7 },
  { phrase: "layoffs", weight: 0.4 },
  { phrase: "layoff", weight: 0.4 },
  { phrase: "job cuts", weight: 0.4 },
  { phrase: "ceo resigns", weight: 0.5 },
  { phrase: "ceo steps down", weight: 0.5 },
  { phrase: "cfo resigns", weight: 0.5 },
  { phrase: "dilution", weight: 0.6 },
  { phrase: "secondary offering", weight: 0.5 },
  { phrase: "stock offering", weight: 0.4 },
  // Medium
  { phrase: "downgrade", weight: 0.5 },
  { phrase: "downgraded", weight: 0.5 },
  { phrase: "underperform", weight: 0.4 },
  { phrase: "underweight", weight: 0.4 },
  { phrase: "sell rating", weight: 0.5 },
  { phrase: "price target cut", weight: 0.6 },
  { phrase: "cut price target", weight: 0.6 },
  { phrase: "lowered price target", weight: 0.6 },
  { phrase: "weak demand", weight: 0.5 },
  { phrase: "slowing growth", weight: 0.4 },
  { phrase: "decelerating", weight: 0.4 },
  { phrase: "headwinds", weight: 0.3 },
  { phrase: "margin pressure", weight: 0.4 },
  { phrase: "shrinking", weight: 0.3 },
  { phrase: "lawsuit", weight: 0.3 },
  { phrase: "antitrust", weight: 0.4 },
  { phrase: "investigation", weight: 0.3 },
  { phrase: "fine", weight: 0.2 },
  { phrase: "penalty", weight: 0.3 },
  // Weak
  { phrase: "loss", weight: 0.2 },
  { phrase: "losses", weight: 0.2 },
  { phrase: "decline", weight: 0.2 },
  { phrase: "declining", weight: 0.2 },
  { phrase: "drops", weight: 0.15 },
  { phrase: "plunges", weight: 0.3 },
  { phrase: "tumbles", weight: 0.25 },
  { phrase: "slumps", weight: 0.25 },
  { phrase: "bearish", weight: 0.4 },
  { phrase: "negative", weight: 0.15 },
  { phrase: "concerns", weight: 0.2 },
  { phrase: "worries", weight: 0.2 },
  { phrase: "miss", weight: 0.4 },
  { phrase: "misses", weight: 0.4 },
  { phrase: "disappoints", weight: 0.5 },
];

// Words that flip polarity when they appear in the 4 tokens BEFORE a match.
const NEGATORS = new Set([
  "no", "not", "never", "without", "lacks", "lacking",
  "fails to", "failed to", "unable to", "won't", "wont", "cannot",
  "denies", "denied", "rejects", "rejected",
]);

// Source credibility weights — affects how heavily a headline is counted.
function sourceWeight(source: string): number {
  const s = source.toLowerCase();
  if (s.includes("reuters") || s.includes("bloomberg") || s.includes("wall street journal") ||
      s.includes("wsj") || s.includes("financial times") || s.includes("ft.com") ||
      s.includes("cnbc") || s.includes("dow jones")) {
    return 1.0;
  }
  if (s.includes("seeking alpha") || s.includes("marketwatch") || s.includes("barron") ||
      s.includes("forbes") || s.includes("yahoo") || s.includes("investor") ||
      s.includes("benzinga") || s.includes("the motley fool") || s.includes("motley fool")) {
    return 0.6;
  }
  if (s === "unknown" || !s) return 0.3;
  return 0.5;
}

// Tokenize a headline into lowercase words for negation lookback.
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

interface HeadlineScore {
  raw: number;          // [-1, +1] before source weighting
  weight: number;       // source credibility
  matches: number;      // how many lexicon hits fired
  bullishHits: number;
  bearishHits: number;
}

function scoreHeadline(h: Headline): HeadlineScore {
  const titleLower = h.title.toLowerCase();
  const tokens = tokenize(h.title);

  let bullSum = 0;
  let bearSum = 0;
  let bullishHits = 0;
  let bearishHits = 0;

  // Helper: does a negator sit within `lookback` tokens before `idx`?
  const negatedAt = (idx: number, lookback = 4): boolean => {
    const start = Math.max(0, idx - lookback);
    for (let i = start; i < idx; i++) {
      if (NEGATORS.has(tokens[i])) return true;
    }
    // Also catch 2-word negators by joining adjacent pairs
    for (let i = start; i < idx - 1; i++) {
      if (NEGATORS.has(`${tokens[i]} ${tokens[i + 1]}`)) return true;
    }
    return false;
  };

  // Find index of first token of `phrase` within `tokens`, or -1.
  const findPhraseTokenIdx = (phrase: string): number => {
    const phraseTokens = phrase.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (phraseTokens.length === 0) return -1;
    outer: for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
      for (let j = 0; j < phraseTokens.length; j++) {
        if (tokens[i + j] !== phraseTokens[j]) continue outer;
      }
      return i;
    }
    return -1;
  };

  for (const entry of BULLISH) {
    if (!titleLower.includes(entry.phrase)) continue;
    const idx = findPhraseTokenIdx(entry.phrase);
    if (idx === -1) continue;
    const negated = negatedAt(idx);
    if (negated) {
      bearSum += entry.weight;
      bearishHits++;
    } else {
      bullSum += entry.weight;
      bullishHits++;
    }
  }

  for (const entry of BEARISH) {
    if (!titleLower.includes(entry.phrase)) continue;
    const idx = findPhraseTokenIdx(entry.phrase);
    if (idx === -1) continue;
    const negated = negatedAt(idx);
    if (negated) {
      bullSum += entry.weight;
      bullishHits++;
    } else {
      bearSum += entry.weight;
      bearishHits++;
    }
  }

  const matches = bullishHits + bearishHits;
  // Net polarity, then squash to [-1, +1] with a soft saturation so a single
  // very strong phrase doesn't fully saturate without corroboration.
  const net = bullSum - bearSum;
  const raw = Math.tanh(net / 1.5); // tanh keeps it bounded and continuous
  return {
    raw,
    weight: sourceWeight(h.source),
    matches,
    bullishHits,
    bearishHits,
  };
}

// Aggregate per-headline scores into the final SentimentResult.
function aggregate(ticker: string, headlines: Headline[]): SentimentResult {
  if (headlines.length === 0) {
    return {
      ticker, score: 0, confidence: 0,
      headlines: [], reasoning: "No recent news",
      cached: false, source: "no_news",
    };
  }

  const scored = headlines.map(scoreHeadline);

  // Source-weighted mean of the per-headline raw scores.
  const totalWeight = scored.reduce((s, h) => s + h.weight, 0) || 1;
  const weightedRaw = scored.reduce((s, h) => s + h.raw * h.weight, 0) / totalWeight;
  const score = Math.round(weightedRaw * 100);

  // Confidence = blend of:
  //   (a) keyword density — more matches across more headlines → higher
  //   (b) directional agreement — proportion of headlines pointing the same way
  //   (c) credibility — weighted share of credible sources
  const totalMatches = scored.reduce((s, h) => s + h.matches, 0);
  const headlinesWithMatches = scored.filter(h => h.matches > 0).length;
  const matchedHeadlinesShare = headlinesWithMatches / headlines.length;
  // Volume sub-score: saturates around 8+ total matches
  const volumeScore = Math.min(1, totalMatches / 8);

  // Agreement: how lopsided are the bull vs bear hits across headlines?
  const totalBull = scored.reduce((s, h) => s + h.bullishHits, 0);
  const totalBear = scored.reduce((s, h) => s + h.bearishHits, 0);
  const totalDirHits = totalBull + totalBear;
  const agreement = totalDirHits === 0
    ? 0
    : Math.abs(totalBull - totalBear) / totalDirHits;

  // Credibility: share of weighted coverage from high-cred sources
  const credShare = totalWeight === 0
    ? 0
    : scored.filter(h => h.weight >= 0.8).reduce((s, h) => s + h.weight, 0) / totalWeight;

  const confidence = Math.max(
    0,
    Math.min(
      1,
      // Need both volume and agreement to get high confidence
      0.45 * volumeScore +
      0.35 * agreement +
      0.10 * credShare +
      0.10 * matchedHeadlinesShare,
    ),
  );

  // Build a short, deterministic reasoning string.
  let reasoning: string;
  if (totalMatches === 0) {
    reasoning = `${headlines.length} headlines, no scored keywords — neutral`;
  } else {
    const dir = score > 5 ? "bullish" : score < -5 ? "bearish" : "mixed";
    reasoning =
      `${headlinesWithMatches}/${headlines.length} headlines scored ` +
      `(${totalBull} bullish, ${totalBear} bearish hits) → ${dir}`;
  }

  return {
    ticker,
    score: Math.max(-100, Math.min(100, score)),
    confidence: Number(confidence.toFixed(2)),
    headlines,
    reasoning,
    cached: false,
    source: "keyword",
  };
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

    // 3. Score deterministically (works fine with empty headlines too)
    const result = aggregate(ticker, headlines);
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
  supabase: any,
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
