CREATE TABLE public.adaptive_exit_params (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile text NOT NULL,
  market_regime text NOT NULL,
  status text NOT NULL DEFAULT 'shadow',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  train_expectancy numeric,
  valid_expectancy numeric,
  baseline_valid_expectancy numeric,
  improvement numeric,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  promoted_at timestamp with time zone,
  retired_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_adaptive_exit_params_active ON public.adaptive_exit_params (status, profile, market_regime);

GRANT SELECT ON public.adaptive_exit_params TO authenticated;
GRANT ALL ON public.adaptive_exit_params TO service_role;

ALTER TABLE public.adaptive_exit_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view adaptive exit params"
ON public.adaptive_exit_params FOR SELECT TO authenticated USING (true);