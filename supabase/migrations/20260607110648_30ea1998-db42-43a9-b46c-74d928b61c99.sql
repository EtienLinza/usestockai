-- Short interest history
CREATE TABLE public.short_interest_history (
  ticker text NOT NULL,
  report_date date NOT NULL,
  si_pct_float numeric,
  days_to_cover numeric,
  velocity_30d numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, report_date)
);
GRANT SELECT ON public.short_interest_history TO anon, authenticated;
GRANT ALL ON public.short_interest_history TO service_role;
ALTER TABLE public.short_interest_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read short interest" ON public.short_interest_history FOR SELECT USING (true);

-- Portfolio CVaR snapshots (user-scoped)
CREATE TABLE public.portfolio_cvar_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  cvar_pct numeric NOT NULL,
  n_positions int NOT NULL DEFAULT 0,
  nav numeric
);
CREATE INDEX idx_cvar_snapshots_user_time ON public.portfolio_cvar_snapshots(user_id, taken_at DESC);
GRANT SELECT ON public.portfolio_cvar_snapshots TO authenticated;
GRANT ALL ON public.portfolio_cvar_snapshots TO service_role;
ALTER TABLE public.portfolio_cvar_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own cvar snapshots" ON public.portfolio_cvar_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Drift events
CREATE TABLE public.drift_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  detected_at timestamptz NOT NULL DEFAULT now(),
  window_size int NOT NULL,
  pre_mean numeric NOT NULL,
  post_mean numeric NOT NULL,
  severity text NOT NULL DEFAULT 'soft'
);
CREATE INDEX idx_drift_events_time ON public.drift_events(detected_at DESC);
GRANT SELECT ON public.drift_events TO anon, authenticated;
GRANT ALL ON public.drift_events TO service_role;
ALTER TABLE public.drift_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read drift events" ON public.drift_events FOR SELECT USING (true);

-- Augment signal tables with si_velocity + slippage_bps_est
ALTER TABLE public.live_signals
  ADD COLUMN IF NOT EXISTS si_velocity numeric,
  ADD COLUMN IF NOT EXISTS slippage_bps_est numeric;

ALTER TABLE public.signal_outcomes
  ADD COLUMN IF NOT EXISTS si_velocity numeric,
  ADD COLUMN IF NOT EXISTS slippage_bps_est numeric;

-- Autotrader log counter for CVaR blocks
ALTER TABLE public.autotrade_log
  ADD COLUMN IF NOT EXISTS cvar_block_count int;