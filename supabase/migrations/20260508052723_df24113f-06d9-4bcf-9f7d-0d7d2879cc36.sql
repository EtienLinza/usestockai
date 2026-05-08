ALTER TABLE public.strategy_weights
ADD COLUMN IF NOT EXISTS exit_calibration jsonb NOT NULL DEFAULT '{}'::jsonb;