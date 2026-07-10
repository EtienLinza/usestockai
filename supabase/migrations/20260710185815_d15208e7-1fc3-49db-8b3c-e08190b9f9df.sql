
CREATE TABLE public.backtest_bars_cache (
  ticker TEXT NOT NULL,
  bars_version TEXT NOT NULL DEFAULT 'v1',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_date DATE NOT NULL,
  last_date DATE NOT NULL,
  bars JSONB NOT NULL,
  PRIMARY KEY (ticker, bars_version)
);
GRANT SELECT ON public.backtest_bars_cache TO authenticated;
GRANT ALL ON public.backtest_bars_cache TO service_role;
ALTER TABLE public.backtest_bars_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed can read bars cache" ON public.backtest_bars_cache
  FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_backtest_bars_cache_fetched ON public.backtest_bars_cache(fetched_at);

CREATE TYPE public.pb_status AS ENUM ('queued','fetching_bars','simulating','finalizing','done','failed','cancelled');
CREATE TYPE public.pb_stage AS ENUM ('fetch_bars','simulate','finalize');

CREATE TABLE public.backtest_portfolio_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  universe TEXT[] NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  starting_nav NUMERIC NOT NULL DEFAULT 100000,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.pb_status NOT NULL DEFAULT 'queued',
  stage public.pb_stage NOT NULL DEFAULT 'fetch_bars',
  progress_pct NUMERIC NOT NULL DEFAULT 0,
  current_step_note TEXT,
  cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  report JSONB,
  error TEXT,
  cpu_ms_spent BIGINT NOT NULL DEFAULT 0,
  last_tick_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_portfolio_jobs TO authenticated;
GRANT ALL ON public.backtest_portfolio_jobs TO service_role;
ALTER TABLE public.backtest_portfolio_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own pb jobs sel" ON public.backtest_portfolio_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users own pb jobs ins" ON public.backtest_portfolio_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users own pb jobs upd" ON public.backtest_portfolio_jobs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users own pb jobs del" ON public.backtest_portfolio_jobs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_pb_jobs_user_created ON public.backtest_portfolio_jobs(user_id, created_at DESC);
CREATE INDEX idx_pb_jobs_status ON public.backtest_portfolio_jobs(status) WHERE status IN ('queued','fetching_bars','simulating','finalizing');

CREATE TRIGGER pb_jobs_updated_at BEFORE UPDATE ON public.backtest_portfolio_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
