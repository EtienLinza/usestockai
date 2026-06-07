-- C-1: store the FULL ticker list (not just a sample) so the discovery cache
-- can actually be reused. The existing sample_tickers column stays as-is for
-- backwards compatibility (it's only used for human inspection).
ALTER TABLE public.scan_universe_log
  ADD COLUMN IF NOT EXISTS all_tickers jsonb;

-- C-2: persist signal cooldown state so cron-invoked edge functions retain
-- cooldown across cold starts. One row per ticker (latest-wins).
CREATE TABLE IF NOT EXISTS public.signal_cooldown (
  ticker text PRIMARY KEY,
  cooldown_bars_remaining integer NOT NULL DEFAULT 0,
  last_decision text,
  last_strategy text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.signal_cooldown TO authenticated;
GRANT ALL ON public.signal_cooldown TO service_role;

ALTER TABLE public.signal_cooldown ENABLE ROW LEVEL SECURITY;

-- Read-only to clients (cooldown is operational metadata, not private).
CREATE POLICY "signal_cooldown_select_all"
  ON public.signal_cooldown FOR SELECT
  USING (true);