
CREATE TABLE public.scan_universe_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  total_tickers integer NOT NULL DEFAULT 0,
  index_count integer NOT NULL DEFAULT 0,
  screener_count integer NOT NULL DEFAULT 0,
  overlap_count integer NOT NULL DEFAULT 0,
  fallback_used boolean NOT NULL DEFAULT false,
  source_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_tickers jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_scan_universe_log_created_at ON public.scan_universe_log (created_at DESC);

ALTER TABLE public.scan_universe_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view scan universe log (anon)"
ON public.scan_universe_log FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated can view scan universe log"
ON public.scan_universe_log FOR SELECT TO authenticated USING (true);
