
-- =========================================================
-- MILESTONE 1: FOUNDATIONS
-- =========================================================

-- 1. Extend signal_outcomes with exit-quality + feature snapshot
ALTER TABLE public.signal_outcomes
  ADD COLUMN IF NOT EXISTS mfe_pct numeric,
  ADD COLUMN IF NOT EXISTS mae_pct numeric,
  ADD COLUMN IF NOT EXISTS exit_efficiency numeric,
  ADD COLUMN IF NOT EXISTS realized_rr numeric,
  ADD COLUMN IF NOT EXISTS feature_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS regime_probs jsonb,
  ADD COLUMN IF NOT EXISTS model_version_id uuid;

-- 2. rejected_signals: every candidate the scanner considered but filtered out
CREATE TABLE IF NOT EXISTS public.rejected_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id uuid,
  ticker text NOT NULL,
  strategy text,
  regime text,
  regime_probs jsonb,
  raw_conviction numeric,
  calibrated_conviction numeric,
  rejection_reason text NOT NULL,
  feature_snapshot jsonb NOT NULL,
  entry_price numeric,
  horizon_bars int,
  -- counterfactual outcome filled in later by the nightly labeler
  counterfactual_return_pct numeric,
  counterfactual_hit_target boolean,
  counterfactual_hit_stop boolean,
  labeled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rejected_signals_created ON public.rejected_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rejected_signals_ticker_created ON public.rejected_signals (ticker, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rejected_signals_unlabeled ON public.rejected_signals (created_at) WHERE labeled_at IS NULL;

GRANT SELECT ON public.rejected_signals TO authenticated;
GRANT ALL ON public.rejected_signals TO service_role;
ALTER TABLE public.rejected_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_rejected_signals" ON public.rejected_signals
  FOR SELECT TO authenticated USING (true);

-- 3. model_versions: reproducibility registry
CREATE TABLE IF NOT EXISTS public.model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_kind text NOT NULL, -- 'entry' | 'exit' | 'sizing' | 'calibrator' | 'regime' | 'ensemble'
  status text NOT NULL DEFAULT 'challenger', -- 'challenger' | 'shadow' | 'champion' | 'retired' | 'rolled_back'
  training_window_start timestamptz,
  training_window_end timestamptz,
  feature_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  hyperparams jsonb NOT NULL DEFAULT '{}'::jsonb,
  coefficients jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  shadow_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  stress_test_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_version_id uuid REFERENCES public.model_versions(id),
  deployed_at timestamptz,
  retired_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_model_versions_kind_status ON public.model_versions (model_kind, status);
CREATE INDEX IF NOT EXISTS idx_model_versions_created ON public.model_versions (created_at DESC);
-- Only one champion per model_kind at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_versions_one_champion
  ON public.model_versions (model_kind) WHERE status = 'champion';

GRANT SELECT ON public.model_versions TO authenticated;
GRANT ALL ON public.model_versions TO service_role;
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_model_versions" ON public.model_versions
  FOR SELECT TO authenticated USING (true);

-- 4. model_health_reports: nightly dashboard payload
CREATE TABLE IF NOT EXISTS public.model_health_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  calibration_error numeric,
  brier_score numeric,
  log_loss numeric,
  feature_drift jsonb NOT NULL DEFAULT '{}'::jsonb,
  concept_drift jsonb NOT NULL DEFAULT '{}'::jsonb,
  top_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  bottom_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  deployments jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollbacks jsonb NOT NULL DEFAULT '[]'::jsonb,
  retired_strategies jsonb NOT NULL DEFAULT '[]'::jsonb,
  training_time_ms int,
  anomalies_rejected int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_date)
);
CREATE INDEX IF NOT EXISTS idx_model_health_reports_date ON public.model_health_reports (report_date DESC);

GRANT SELECT ON public.model_health_reports TO authenticated;
GRANT ALL ON public.model_health_reports TO service_role;
ALTER TABLE public.model_health_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_model_health" ON public.model_health_reports
  FOR SELECT TO authenticated USING (true);

-- 5. market_memory: long-term feature/outcome/macro snapshots
CREATE TABLE IF NOT EXISTS public.market_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  ticker text NOT NULL,
  strategy text,
  regime_probs jsonb NOT NULL DEFAULT '{}'::jsonb,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  macro jsonb NOT NULL DEFAULT '{}'::jsonb, -- vix, rates, oil, earnings_season, election_year
  outcome_return_pct numeric,
  outcome_win boolean,
  horizon_bars int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_memory_date ON public.market_memory (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_market_memory_ticker_date ON public.market_memory (ticker, snapshot_date DESC);

GRANT SELECT ON public.market_memory TO authenticated;
GRANT ALL ON public.market_memory TO service_role;
ALTER TABLE public.market_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_market_memory" ON public.market_memory
  FOR SELECT TO authenticated USING (true);

-- 6. user_archetypes: cluster definitions for cold-start
CREATE TABLE IF NOT EXISTS public.user_archetypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  centroid jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_strategy_bias jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_regime_bias jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_feature_bias jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_sizing_scalar numeric NOT NULL DEFAULT 1.0,
  default_filter_threshold numeric NOT NULL DEFAULT 68,
  sample_size int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_archetypes TO authenticated;
GRANT ALL ON public.user_archetypes TO service_role;
ALTER TABLE public.user_archetypes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_archetypes" ON public.user_archetypes
  FOR SELECT TO authenticated USING (true);

-- 7. user_model_state: per-user personalisation with Bayesian shrinkage
CREATE TABLE IF NOT EXISTS public.user_model_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  archetype_key text REFERENCES public.user_archetypes(archetype_key),
  sizing_scalar numeric NOT NULL DEFAULT 1.0,
  filter_threshold numeric NOT NULL DEFAULT 68,
  strategy_bias jsonb NOT NULL DEFAULT '{}'::jsonb,
  regime_bias jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_bias jsonb NOT NULL DEFAULT '{}'::jsonb,
  beta_binomial_priors jsonb NOT NULL DEFAULT '{}'::jsonb, -- {strategy: {alpha, beta}}
  shrinkage_k numeric NOT NULL DEFAULT 30,
  sample_size int NOT NULL DEFAULT 0,
  consistency_score numeric,
  last_trained_at timestamptz,
  last_online_update_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.user_model_state TO authenticated;
GRANT ALL ON public.user_model_state TO service_role;
ALTER TABLE public.user_model_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_model_state" ON public.user_model_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_model_state_updated_at
  BEFORE UPDATE ON public.user_model_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. drift_detections: feature + concept drift events (extends the existing drift_events table with richer typing)
CREATE TABLE IF NOT EXISTS public.drift_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  drift_kind text NOT NULL, -- 'feature' | 'concept'
  metric text NOT NULL,     -- 'psi' | 'kl' | 'js'
  feature_name text,
  value numeric NOT NULL,
  threshold numeric NOT NULL,
  severity text NOT NULL DEFAULT 'info', -- 'info' | 'warn' | 'critical'
  window_days int,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_drift_detections_time ON public.drift_detections (detected_at DESC);

GRANT SELECT ON public.drift_detections TO authenticated;
GRANT ALL ON public.drift_detections TO service_role;
ALTER TABLE public.drift_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_drift" ON public.drift_detections
  FOR SELECT TO authenticated USING (true);

-- 9. Extend strategy_weights.notes convention (no schema change needed — notes is already text/jsonb)
-- We'll persist ensemble coefficients, calibrator params, feature weights (with CIs),
-- interaction weights, edge half-lives, and champion/challenger pointers inside notes.
