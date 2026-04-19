-- Phase B: Adaptive weights table for nightly recalibration
-- Single-row "active" config the scanner reads on every run.

CREATE TABLE IF NOT EXISTS public.strategy_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_days INTEGER NOT NULL DEFAULT 90,
  sample_size INTEGER NOT NULL DEFAULT 0,

  -- Conviction calibration: maps raw conviction → calibrated conviction.
  -- Stored as { "60-69": {actualWinRate, adjust}, ... } so a raw score
  -- can be shifted toward its empirical win rate.
  calibration_curve JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Per-strategy multiplier (e.g. {"trend": 1.05, "mean_reversion": 0.92}).
  -- Applied to base conviction when that strategy fires.
  strategy_tilts JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Per-regime conviction floor override (e.g. {"bullish": 65, "bearish": 75}).
  -- Scanner uses regime-specific floor instead of static 65.
  regime_floors JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Free-text notes / diagnostics for the Calibration UI.
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active row at a time.
CREATE UNIQUE INDEX IF NOT EXISTS strategy_weights_one_active
  ON public.strategy_weights (is_active) WHERE is_active = true;

ALTER TABLE public.strategy_weights ENABLE ROW LEVEL SECURITY;

-- Public read so the scanner (service role bypasses anyway) and the
-- Calibration UI can both display it without auth.
CREATE POLICY "Anyone can view strategy weights (anon)"
ON public.strategy_weights FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated can view strategy weights"
ON public.strategy_weights FOR SELECT TO authenticated USING (true);

-- Helpful index for history queries
CREATE INDEX IF NOT EXISTS strategy_weights_computed_at_idx
  ON public.strategy_weights (computed_at DESC);