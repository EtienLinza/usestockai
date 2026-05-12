ALTER TABLE public.live_signals
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live';

CREATE INDEX IF NOT EXISTS idx_live_signals_source ON public.live_signals(source);