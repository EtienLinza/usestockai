-- Create price_alerts table for watchlist notifications
CREATE TABLE public.price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  watchlist_item_id UUID REFERENCES public.watchlist(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  target_price NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  is_triggered BOOLEAN DEFAULT false,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for price_alerts
CREATE POLICY "Users can view their own price alerts"
ON public.price_alerts
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own price alerts"
ON public.price_alerts
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own price alerts"
ON public.price_alerts
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own price alerts"
ON public.price_alerts
FOR DELETE
USING (auth.uid() = user_id);