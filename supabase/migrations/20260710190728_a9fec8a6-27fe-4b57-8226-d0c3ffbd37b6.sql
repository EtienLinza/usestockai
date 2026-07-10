ALTER TABLE public.autotrade_settings
  ADD COLUMN IF NOT EXISTS single_stock_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS single_stock_ticker text;

ALTER TABLE public.autotrade_settings
  DROP CONSTRAINT IF EXISTS autotrade_settings_single_stock_ticker_fmt;
ALTER TABLE public.autotrade_settings
  ADD CONSTRAINT autotrade_settings_single_stock_ticker_fmt
  CHECK (single_stock_ticker IS NULL OR single_stock_ticker ~ '^[A-Z]{1,10}(-[A-Z]{2,4})?$');