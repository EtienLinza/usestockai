ALTER TABLE public.virtual_positions ADD COLUMN IF NOT EXISTS campaign_id uuid;
ALTER TABLE public.virtual_positions ADD COLUMN IF NOT EXISTS stop_slippage_pct numeric;
CREATE INDEX IF NOT EXISTS idx_virtual_positions_campaign ON public.virtual_positions(campaign_id);
UPDATE public.virtual_positions SET campaign_id = id
 WHERE campaign_id IS NULL AND COALESCE(exit_reason,'') NOT LIKE 'partial:%';
UPDATE public.virtual_positions p SET campaign_id = (
  SELECT q.id FROM public.virtual_positions q
  WHERE q.user_id = p.user_id AND q.ticker = p.ticker AND q.entry_price = p.entry_price
    AND q.id <> p.id AND COALESCE(q.exit_reason,'') NOT LIKE 'partial:%'
  ORDER BY q.created_at DESC LIMIT 1)
WHERE p.campaign_id IS NULL;
UPDATE public.virtual_positions SET campaign_id = id WHERE campaign_id IS NULL;