CREATE TABLE public.market_regime (
  date date PRIMARY KEY,
  regime text NOT NULL,
  atr_pct numeric,
  sma_ratio numeric,
  spy_close numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_regime TO anon, authenticated;
GRANT ALL ON public.market_regime TO service_role;
ALTER TABLE public.market_regime ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read market regime" ON public.market_regime FOR SELECT USING (true);
CREATE POLICY "Service role manages regime" ON public.market_regime FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE public.meta_label_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coefficients jsonb NOT NULL,
  feature_names jsonb NOT NULL,
  intercept numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  auc numeric,
  trained_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meta_label_model TO authenticated;
GRANT ALL ON public.meta_label_model TO service_role;
ALTER TABLE public.meta_label_model ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read latest model" ON public.meta_label_model FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages model" ON public.meta_label_model FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.live_signals ADD COLUMN IF NOT EXISTS regime text;
ALTER TABLE public.live_signals ADD COLUMN IF NOT EXISTS meta_score numeric;
ALTER TABLE public.signal_outcomes ADD COLUMN IF NOT EXISTS meta_score numeric;
ALTER TABLE public.signal_outcomes ADD COLUMN IF NOT EXISTS regime text;