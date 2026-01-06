-- Add email preferences and dashboard layout to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS alert_email_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS dashboard_layout jsonb DEFAULT null;

-- Create sector performance cache table
CREATE TABLE IF NOT EXISTS public.sector_performance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sector text NOT NULL,
  etf_ticker text NOT NULL,
  daily_change numeric,
  weekly_change numeric,
  monthly_change numeric,
  updated_at timestamptz DEFAULT now()
);

-- Create market sentiment cache table
CREATE TABLE IF NOT EXISTS public.market_sentiment (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fear_greed_score integer,
  vix_value numeric,
  sp500_change numeric,
  nasdaq_change numeric,
  dow_change numeric,
  market_trend text,
  updated_at timestamptz DEFAULT now()
);

-- RLS for sector_performance (public read, no user write needed - cached data)
ALTER TABLE public.sector_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view sector performance"
ON public.sector_performance
FOR SELECT
USING (true);

-- RLS for market_sentiment (public read)
ALTER TABLE public.market_sentiment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view market sentiment"
ON public.market_sentiment
FOR SELECT
USING (true);