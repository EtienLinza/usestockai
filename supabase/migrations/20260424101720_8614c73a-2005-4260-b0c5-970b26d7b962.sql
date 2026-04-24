ALTER TABLE public.autotrade_settings
  ADD COLUMN IF NOT EXISTS advanced_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scan_interval_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS last_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_scan_at timestamptz;

ALTER TABLE public.autotrade_settings
  DROP CONSTRAINT IF EXISTS autotrade_settings_scan_interval_chk;

ALTER TABLE public.autotrade_settings
  ADD CONSTRAINT autotrade_settings_scan_interval_chk
  CHECK (scan_interval_minutes IN (5, 10, 15, 30, 60));