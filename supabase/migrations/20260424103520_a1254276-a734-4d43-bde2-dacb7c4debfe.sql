-- News sentiment cache (server-only writes via service role)
CREATE TABLE IF NOT EXISTS public.news_sentiment_cache (
  ticker text PRIMARY KEY,
  score integer NOT NULL,
  confidence numeric NOT NULL,
  headlines jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasoning text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.news_sentiment_cache ENABLE ROW LEVEL SECURITY;

-- No public RLS policies — only service role reads/writes this table.
-- Without any SELECT policy, anon/authenticated cannot see anything.

CREATE INDEX IF NOT EXISTS news_sentiment_cache_fetched_at_idx
  ON public.news_sentiment_cache (fetched_at DESC);

-- Audit columns on autotrade log
ALTER TABLE public.autotrade_log
  ADD COLUMN IF NOT EXISTS sentiment_score integer,
  ADD COLUMN IF NOT EXISTS sentiment_confidence numeric,
  ADD COLUMN IF NOT EXISTS sentiment_headlines jsonb;

-- User toggle (defaults ON)
ALTER TABLE public.autotrade_settings
  ADD COLUMN IF NOT EXISTS use_news_sentiment boolean NOT NULL DEFAULT true;