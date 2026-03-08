
-- Live signals table (shared across all users, written by scanner)
CREATE TABLE public.live_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('BUY', 'SELL')),
  entry_price numeric NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  regime text,
  stock_profile text,
  weekly_bias text,
  target_allocation numeric DEFAULT 0,
  reasoning text,
  strategy text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.live_signals ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read signals
CREATE POLICY "Authenticated users can view signals"
  ON public.live_signals FOR SELECT
  TO authenticated
  USING (true);

-- Virtual positions table (user-specific)
CREATE TABLE public.virtual_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  entry_price numeric NOT NULL,
  shares numeric NOT NULL,
  position_type text NOT NULL DEFAULT 'long' CHECK (position_type IN ('long', 'short')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  exit_price numeric,
  exit_date timestamp with time zone,
  exit_reason text,
  pnl numeric,
  signal_id uuid REFERENCES public.live_signals(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  closed_at timestamp with time zone
);

ALTER TABLE public.virtual_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own positions"
  ON public.virtual_positions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own positions"
  ON public.virtual_positions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own positions"
  ON public.virtual_positions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own positions"
  ON public.virtual_positions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Virtual portfolio log table (daily snapshots)
CREATE TABLE public.virtual_portfolio_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  total_value numeric NOT NULL DEFAULT 0,
  cash numeric NOT NULL DEFAULT 0,
  positions_value numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.virtual_portfolio_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own portfolio log"
  ON public.virtual_portfolio_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own portfolio log"
  ON public.virtual_portfolio_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for live_signals
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_signals;
