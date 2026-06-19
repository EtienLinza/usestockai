
DROP POLICY IF EXISTS "Users can insert their own predictions" ON public.prediction_runs;
CREATE POLICY "Users can insert their own predictions"
  ON public.prediction_runs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view anonymous predictions" ON public.prediction_runs;

CREATE POLICY "Block client inserts to cvar snapshots"
  ON public.portfolio_cvar_snapshots FOR INSERT TO authenticated, anon
  WITH CHECK (false);
CREATE POLICY "Block client updates to cvar snapshots"
  ON public.portfolio_cvar_snapshots FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY "Block client deletes to cvar snapshots"
  ON public.portfolio_cvar_snapshots FOR DELETE TO authenticated, anon
  USING (false);
