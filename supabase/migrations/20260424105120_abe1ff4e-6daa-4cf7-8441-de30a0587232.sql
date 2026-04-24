-- 1. Add risk_profile + adaptive_mode to autotrade_settings
ALTER TABLE public.autotrade_settings
  ADD COLUMN IF NOT EXISTS risk_profile text NOT NULL DEFAULT 'balanced'
    CHECK (risk_profile IN ('conservative', 'balanced', 'aggressive')),
  ADD COLUMN IF NOT EXISTS adaptive_mode boolean NOT NULL DEFAULT true;

-- 2. Create autotrader_state table — caches live effective limits per user
CREATE TABLE IF NOT EXISTS public.autotrader_state (
  user_id uuid PRIMARY KEY,
  effective_min_conviction integer NOT NULL DEFAULT 70,
  effective_max_positions integer NOT NULL DEFAULT 8,
  effective_max_nav_exposure_pct numeric NOT NULL DEFAULT 80,
  effective_max_single_name_pct numeric NOT NULL DEFAULT 20,
  vix_value numeric,
  vix_regime text,
  spy_trend text,
  recent_pnl_pct numeric,
  recent_pnl_window_days integer DEFAULT 7,
  adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.autotrader_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own autotrader state"
  ON public.autotrader_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE TRIGGER update_autotrader_state_updated_at
  BEFORE UPDATE ON public.autotrader_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Enable realtime so Settings UI updates instantly after each scan
ALTER PUBLICATION supabase_realtime ADD TABLE public.autotrader_state;