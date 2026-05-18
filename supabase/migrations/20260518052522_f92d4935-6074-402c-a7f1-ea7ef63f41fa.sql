-- Emergency mode: replaces kill_switch with three states
ALTER TABLE public.autotrade_settings
  ADD COLUMN IF NOT EXISTS emergency_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (emergency_mode IN ('off','freeze_entries','liquidate')),
  ADD COLUMN IF NOT EXISTS rotation_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotation_min_delta_conviction INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS rotation_max_per_day INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS rotation_count_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rotation_day DATE;

-- Backfill emergency_mode from existing kill_switch so behavior is preserved
UPDATE public.autotrade_settings
   SET emergency_mode = 'freeze_entries'
 WHERE kill_switch = true AND emergency_mode = 'off';

-- Track positions opened by capital rotation so we don't immediately rotate them out
ALTER TABLE public.virtual_positions
  ADD COLUMN IF NOT EXISTS opened_by_rotation BOOLEAN NOT NULL DEFAULT false;
