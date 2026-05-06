
CREATE TABLE public.ticker_bars_cache (
  ticker text PRIMARY KEY,
  as_of date NOT NULL,
  bars jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticker_bars_cache_as_of ON public.ticker_bars_cache(as_of);
ALTER TABLE public.ticker_bars_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to ticker_bars_cache"
  ON public.ticker_bars_cache FOR SELECT
  TO anon, authenticated
  USING (false);

CREATE TABLE public.scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  phase text NOT NULL DEFAULT 'discovering',
  processed integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  signals_found integer NOT NULL DEFAULT 0,
  universe_size integer NOT NULL DEFAULT 0,
  survivors integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX idx_scan_runs_started_at ON public.scan_runs(started_at DESC);
ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view scan runs (anon)"
  ON public.scan_runs FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can view scan runs"
  ON public.scan_runs FOR SELECT TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_runs;
ALTER TABLE public.scan_runs REPLICA IDENTITY FULL;
