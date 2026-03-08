ALTER PUBLICATION supabase_realtime ADD TABLE public.virtual_positions;

ALTER TABLE public.virtual_portfolio_log ADD CONSTRAINT virtual_portfolio_log_user_date_unique UNIQUE (user_id, date);