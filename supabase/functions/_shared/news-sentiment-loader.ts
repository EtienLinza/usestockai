// ============================================================================
// NEWS SENTIMENT LOADER (WS4)
//
// Reads the shared `news_sentiment_cache` table (written by the
// `news-sentiment` edge function / NewsPanel) and exposes it to the trading
// path as a SUPPORTING conviction factor — never a gate.
//
// Design rules:
//   • Read-only from the trading path (no extra API spend during a scan).
//     Stale rows (> MAX_AGE_HOURS) are ignored → neutral.
//   • Missing / low-confidence news → delta 0. It can never block a trade.
//   • Delta is clamped to ±MAX_DELTA conviction points, and is scaled by the
//     classifier's own confidence so noisy coverage barely moves the needle.
//   • The score + confidence are stored in the entry feature snapshot so the
//     nightly ensemble trainer learns whether the factor actually pays. If it
//     doesn't, the model down-weights it on its own.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface NewsSentiment {
  /** -100 … +100 */
  score: number;
  /** 0 … 1 */
  confidence: number;
}

export type NewsSentimentMap = Map<string, NewsSentiment>;

const MAX_AGE_HOURS = 12;
const MIN_CONFIDENCE = 0.25;
/** Max conviction points this factor may add or remove. */
export const MAX_NEWS_DELTA = 5;

/** Load fresh cached sentiment for the given tickers. Never throws. */
export async function loadNewsSentiment(
  supabase: SupabaseClient,
  tickers: string[],
): Promise<NewsSentimentMap> {
  const out: NewsSentimentMap = new Map();
  if (!tickers || tickers.length === 0) return out;
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000).toISOString();
  const upper = [...new Set(tickers.map(t => t.toUpperCase()))];
  const CHUNK = 200;
  for (let i = 0; i < upper.length; i += CHUNK) {
    const slice = upper.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase
        .from("news_sentiment_cache")
        .select("ticker, score, confidence, fetched_at")
        .in("ticker", slice)
        .gte("fetched_at", cutoff);
      if (error) {
        console.warn("loadNewsSentiment:", error.message);
        continue;
      }
      for (const row of (data ?? []) as Array<{ ticker: string; score: number; confidence: number }>) {
        const score = Number(row.score);
        const confidence = Number(row.confidence);
        if (!Number.isFinite(score) || !Number.isFinite(confidence)) continue;
        out.set(String(row.ticker).toUpperCase(), {
          score: Math.max(-100, Math.min(100, score)),
          confidence: Math.max(0, Math.min(1, confidence)),
        });
      }
    } catch (e) {
      console.warn("loadNewsSentiment failed:", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/**
 * Conviction delta for a side. Positive news helps longs and hurts shorts.
 * Missing / stale / low-confidence → 0 (strictly neutral, never blocks).
 */
export function newsConvictionDelta(
  news: NewsSentiment | null | undefined,
  side: "long" | "short",
): number {
  if (!news) return 0;
  if (news.confidence < MIN_CONFIDENCE) return 0;
  const raw = (news.score / 100) * news.confidence * MAX_NEWS_DELTA;
  const clamped = Math.max(-MAX_NEWS_DELTA, Math.min(MAX_NEWS_DELTA, raw));
  const signed = side === "long" ? clamped : -clamped;
  return Math.round(signed * 10) / 10;
}
