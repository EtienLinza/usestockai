
## What we're building

A news sentiment layer that runs **only on tickers that already passed the technical conviction gate**. Gemini reads the last 24h of headlines, returns a signed score, and the autotrader either:

- nudges the conviction up/down by ≤10 points,
- blocks the entry on extreme negative news, or
- proceeds normally if nothing material was found.

Sentiment is **never** used for exits in v1.

---

## How it plugs into the scan flow

```text
runEntryDecision(ticker)
  ├─ daily-loss / max-positions / NAV gates           ← unchanged
  ├─ evaluateSignal() → conviction = X
  ├─ if X < min_conviction → HOLD (no Gemini call)    ← keeps cost down
  ├─ getNewsSentiment(ticker)                         ← NEW
  │     ├─ hit news_sentiment_cache (TTL 30 min)
  │     └─ miss → invoke `news-sentiment` edge fn
  │           ├─ NewsAPI: last 24h headlines
  │           └─ Gemini tool-call → {score, confidence, key_headlines, reasoning}
  ├─ if score ≤ −60 AND confidence ≥ 0.7 → BLOCKED (logged with headlines)
  ├─ adjusted = X + clamp(score × 0.1 × confidence, −10, +10)
  │     (positive sentiment caps at +5 to avoid chasing hype)
  └─ if adjusted ≥ min_conviction → ENTER, else HOLD
```

---

## Database

**New table** `news_sentiment_cache`:

```text
ticker text PK
score int (-100..+100)
confidence numeric (0..1)
headlines jsonb        -- [{title, source, url, publishedAt}]
reasoning text         -- Gemini's 1-line rationale
fetched_at timestamptz default now()
```

- No RLS needed (server-only writes via service role; reads also server-only).
- Lookup rule: row valid if `now() - fetched_at < 30 minutes`.

**Extend `autotrade_log`** — add nullable columns:
- `sentiment_score int`
- `sentiment_confidence numeric`
- `sentiment_headlines jsonb`

So every `ENTRY` / `BLOCKED` / `HOLD` row carries the news context that influenced it. Audit-grade.

---

## New edge function: `news-sentiment`

Single-purpose, callable from `autotrader-scan`. Takes `{ticker}`, returns the cached or freshly-computed sentiment object.

```text
1. Check news_sentiment_cache → return if fresh (<30 min)
2. NewsAPI: GET /everything?q={ticker}&from=24h&language=en&sortBy=publishedAt
3. Filter to top 10 headlines (drop duplicates, drop pure price-summary articles)
4. If 0 headlines → return {score: 0, confidence: 0, headlines: [], reasoning: "no news"}
5. Call Lovable AI Gateway:
     model: google/gemini-3-flash-preview
     tool-call schema returns {score, confidence, reasoning, key_headlines}
     system prompt: blind to technicals, asked only "what would these headlines do to the stock in the next 24h?"
6. Upsert into news_sentiment_cache, return result
```

Config: `verify_jwt = false` (called server-to-server from autotrader-scan via service role).

---

## Settings UI

Add one row to `Settings.tsx` AutoTrader card, under the Advanced toggle but visible in **both** modes (it's a safety feature, not a tuning knob):

```text
🗞  Use news sentiment        [ON]
    Gemini reads recent headlines before every entry. Blocks
    trades on extreme negative news; nudges conviction otherwise.
```

Stored as `use_news_sentiment boolean default true` on `autotrade_settings`. Default ON for autopilot users.

---

## Files touched

**Migration (new):**
- adds `news_sentiment_cache` table
- adds `sentiment_score`, `sentiment_confidence`, `sentiment_headlines` to `autotrade_log`
- adds `use_news_sentiment` to `autotrade_settings`

**Edge functions:**
- `supabase/functions/news-sentiment/index.ts` — new, full implementation as above
- `supabase/functions/autotrader-scan/index.ts`
  - import sentiment helper
  - inside `runEntryDecision`, after the conviction gate passes, call sentiment
  - apply adjustment / veto, attach sentiment fields to the action
- `supabase/config.toml` — add `[functions.news-sentiment] verify_jwt = false`

**Frontend:**
- `src/pages/Settings.tsx` — add `use_news_sentiment` switch, include in upsert payload
- `src/pages/AutotraderLog.tsx` — show a small badge on rows with sentiment data ("📰 −72") and expandable headlines on click
- `src/integrations/supabase/types.ts` — auto-regenerated

---

## Cost & latency math

- Gemini call only fires when **technicals already passed** → ~10–20% of watchlist tickers per scan, not 100%.
- Cache key is the ticker (not user-specific) → 5 users watching NVDA = 1 Gemini call, not 5.
- 30-min TTL → at most 2 Gemini calls/ticker/hour during market hours.
- Estimated: ~50 Gemini calls/day across all users at current scale. Negligible.
- Added latency per entry decision: ~1.5s on cache miss, ~5ms on cache hit. Scan budget is 60s, well within.

---

## What stays the same

- All exit logic (peak detection, stops, time stops) — sentiment is **entry-only** in v1.
- `evaluateSignal()` — untouched, sentiment is a wrapper not a rewrite.
- Cron schedule — still `*/5 13-21 * * 1-5`.
- Paper mode — still default-on.

---

## Failure modes & safety

- **NewsAPI down** → return `{score: 0, confidence: 0}`, scan proceeds on pure technicals. Logged.
- **Gemini 429/402** → same fallback, logged with the error code so we can surface it in the UI later.
- **Gemini returns malformed JSON** → tool-calling enforces schema, but if it fails, fall back to neutral.
- **Cache table grows unbounded** → add a one-line cleanup in the scan: `DELETE FROM news_sentiment_cache WHERE fetched_at < now() - interval '24 hours'`. Runs once per scan invocation.

---

## Why this is the right shape

- Sentiment **can only hurt a trade, never force one** — adjustments are bounded ±10 conv, hard veto requires both extreme score AND high confidence.
- Gemini is **blind to the technical signal** — it can't rationalize "well the chart looks good so the lawsuit isn't that bad." Pure news read.
- **Cache by ticker, not user** — economically scales to thousands of users without scaling Gemini bills.
- Every adjustment is **logged with the headlines that caused it** — when the user asks "why didn't I get into NVDA today?" the answer is one click away.
