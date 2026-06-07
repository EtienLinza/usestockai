CREATE TABLE public.eps_revisions (
  ticker text NOT NULL,
  as_of date NOT NULL,
  current_estimate numeric,
  estimate_30d_ago numeric,
  estimate_90d_ago numeric,
  revision_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, as_of)
);

GRANT SELECT ON public.eps_revisions TO anon;
GRANT SELECT ON public.eps_revisions TO authenticated;
GRANT ALL ON public.eps_revisions TO service_role;

ALTER TABLE public.eps_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eps_revisions public read" ON public.eps_revisions
  FOR SELECT USING (true);

ALTER TABLE public.live_signals ADD COLUMN IF NOT EXISTS explanation text;
ALTER TABLE public.signal_outcomes ADD COLUMN IF NOT EXISTS explanation text;