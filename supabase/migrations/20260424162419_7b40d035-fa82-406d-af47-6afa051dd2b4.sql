-- AutoTrader settings: feature toggle + thresholds
ALTER TABLE public.autotrade_settings
  ADD COLUMN IF NOT EXISTS auto_add_watchlist boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_watchlist_consideration_floor integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS auto_watchlist_stale_days integer NOT NULL DEFAULT 14;

-- Watchlist: provenance + freshness tracking
ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_signal_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_watchlist_user_source ON public.watchlist(user_id, source);
CREATE INDEX IF NOT EXISTS idx_watchlist_last_signal_at ON public.watchlist(last_signal_at);