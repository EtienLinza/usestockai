-- Outcome memory table: substrate for adaptive learning
CREATE TABLE public.signal_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Signal context (captured at entry)
  signal_id UUID,
  ticker TEXT NOT NULL,
  signal_type TEXT NOT NULL,                  -- 'long' or 'short'
  regime TEXT,                                -- 'bullish', 'bearish', 'sideways', etc.
  stock_profile TEXT,                         -- 'momentum', 'value', 'index', 'volatile'
  weekly_bias TEXT,                           -- 'long', 'short', 'neutral'
  conviction NUMERIC NOT NULL,                -- 0-100 score at entry
  strategy TEXT,                              -- 'trend', 'mean_reversion', 'consensus', etc.
  entry_thesis TEXT,                          -- which thesis drove this entry
  contributing_rules JSONB,                   -- e.g. {"trend": true, "rsi_oversold": true, "volume_confirm": true}
  
  -- Entry data
  entry_price NUMERIC NOT NULL,
  entry_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  spy_at_entry NUMERIC,                       -- macro snapshot for later regime classification
  vix_at_entry NUMERIC,
  
  -- Outcome (filled when closed)
  status TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'closed'
  exit_price NUMERIC,
  exit_date TIMESTAMPTZ,
  exit_reason TEXT,                           -- 'stop_loss', 'take_profit', 'tp1_partial', 'breakeven_stop', 'weekly_reversal', 'time_exit', etc.
  bars_held INTEGER,
  realized_pnl_pct NUMERIC,                   -- final PnL as percentage
  max_favorable_excursion_pct NUMERIC,        -- best unrealized gain during life
  max_adverse_excursion_pct NUMERIC,          -- worst unrealized drawdown during life
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for nightly aggregation queries
CREATE INDEX idx_signal_outcomes_regime ON public.signal_outcomes(regime);
CREATE INDEX idx_signal_outcomes_profile ON public.signal_outcomes(stock_profile);
CREATE INDEX idx_signal_outcomes_strategy ON public.signal_outcomes(strategy);
CREATE INDEX idx_signal_outcomes_status ON public.signal_outcomes(status);
CREATE INDEX idx_signal_outcomes_entry_date ON public.signal_outcomes(entry_date DESC);
CREATE INDEX idx_signal_outcomes_signal_id ON public.signal_outcomes(signal_id);
CREATE INDEX idx_signal_outcomes_ticker_status ON public.signal_outcomes(ticker, status);

-- Enable RLS
ALTER TABLE public.signal_outcomes ENABLE ROW LEVEL SECURITY;

-- Public read access (this is learning data, like live_signals)
CREATE POLICY "Anyone can view signal outcomes (anon)"
ON public.signal_outcomes
FOR SELECT
TO anon
USING (true);

CREATE POLICY "Authenticated can view signal outcomes"
ON public.signal_outcomes
FOR SELECT
TO authenticated
USING (true);

-- No end-user writes — only service role (edge functions) can insert/update
-- (no INSERT/UPDATE/DELETE policies = blocked for anon/authenticated)

-- Auto-update updated_at
CREATE TRIGGER update_signal_outcomes_updated_at
BEFORE UPDATE ON public.signal_outcomes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();