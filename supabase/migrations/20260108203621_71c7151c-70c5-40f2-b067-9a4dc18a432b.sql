-- Drop RLS policies first
DROP POLICY IF EXISTS "Users can view their own holdings" ON public.portfolio_holdings;
DROP POLICY IF EXISTS "Users can insert their own holdings" ON public.portfolio_holdings;
DROP POLICY IF EXISTS "Users can update their own holdings" ON public.portfolio_holdings;
DROP POLICY IF EXISTS "Users can delete their own holdings" ON public.portfolio_holdings;

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.portfolio_transactions;
DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.portfolio_transactions;
DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.portfolio_transactions;

-- Drop trigger
DROP TRIGGER IF EXISTS update_portfolio_holdings_updated_at ON public.portfolio_holdings;

-- Drop tables
DROP TABLE IF EXISTS public.portfolio_transactions;
DROP TABLE IF EXISTS public.portfolio_holdings;