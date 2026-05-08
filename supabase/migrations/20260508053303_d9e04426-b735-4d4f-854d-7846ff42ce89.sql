ALTER TABLE public.strategy_weights
ADD COLUMN IF NOT EXISTS ticker_calibration jsonb NOT NULL DEFAULT '{}'::jsonb;