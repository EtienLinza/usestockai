CREATE TABLE public.calibration_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 90,
  closed_count INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  avg_return_pct NUMERIC NOT NULL DEFAULT 0,
  sharpe NUMERIC NOT NULL DEFAULT 0,
  trades_per_week NUMERIC NOT NULL DEFAULT 0,
  projected_daily_pct NUMERIC NOT NULL DEFAULT 0,
  projected_weekly_pct NUMERIC NOT NULL DEFAULT 0,
  projected_monthly_pct NUMERIC NOT NULL DEFAULT 0,
  projected_quarterly_pct NUMERIC NOT NULL DEFAULT 0,
  projected_yearly_pct NUMERIC NOT NULL DEFAULT 0,
  conviction_buckets JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT calibration_snapshots_date_unique UNIQUE (snapshot_date)
);

CREATE INDEX idx_calibration_snapshots_date ON public.calibration_snapshots (snapshot_date DESC);

ALTER TABLE public.calibration_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view calibration snapshots (anon)"
  ON public.calibration_snapshots FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated can view calibration snapshots"
  ON public.calibration_snapshots FOR SELECT TO authenticated USING (true);