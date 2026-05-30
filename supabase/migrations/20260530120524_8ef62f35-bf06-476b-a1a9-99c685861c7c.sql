CREATE POLICY "No client updates on virtual_portfolio_log"
ON public.virtual_portfolio_log AS RESTRICTIVE
FOR UPDATE TO anon, authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes on virtual_portfolio_log"
ON public.virtual_portfolio_log AS RESTRICTIVE
FOR DELETE TO anon, authenticated
USING (false);