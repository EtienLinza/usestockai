
CREATE TABLE public.sell_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  reason text NOT NULL,
  current_price numeric NOT NULL,
  position_id uuid REFERENCES public.virtual_positions(id) ON DELETE CASCADE,
  is_dismissed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sell_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sell alerts" ON public.sell_alerts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own sell alerts" ON public.sell_alerts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sell alerts" ON public.sell_alerts FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.sell_alerts;
