DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname ILIKE '%danelfin%';
  END IF;
END $$;
COMMENT ON TABLE public.danelfin_scores IS 'DEPRECATED: Danelfin removed; drop once live app no longer references it';
REVOKE SELECT ON public.danelfin_scores FROM anon, authenticated;

DROP POLICY IF EXISTS "signal_cooldown_select_all" ON public.signal_cooldown;
REVOKE SELECT ON public.signal_cooldown FROM anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view signal outcomes (anon)" ON public.signal_outcomes;
DROP POLICY IF EXISTS "Authenticated can view signal outcomes" ON public.signal_outcomes;
REVOKE SELECT ON public.signal_outcomes FROM anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view scan runs (anon)" ON public.scan_runs;
DROP POLICY IF EXISTS "Authenticated can view scan runs" ON public.scan_runs;
REVOKE SELECT ON public.scan_runs FROM anon;
CREATE POLICY "Signed-in users can view scan runs" ON public.scan_runs
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);