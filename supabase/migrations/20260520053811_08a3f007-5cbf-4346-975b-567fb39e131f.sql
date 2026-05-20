DROP POLICY IF EXISTS "No client access to danelfin_scores" ON public.danelfin_scores;

CREATE POLICY "Anyone can read danelfin_scores"
  ON public.danelfin_scores
  FOR SELECT
  TO anon, authenticated
  USING (true);