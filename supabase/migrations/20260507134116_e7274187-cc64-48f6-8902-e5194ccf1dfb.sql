-- Drop calibration_snapshots (rolling calibration feature removed)
DROP TABLE IF EXISTS public.calibration_snapshots;

-- Unschedule cron jobs for removed edge functions (roll-calibration, check-sell-alerts).
-- Use a DO block to ignore errors if the jobs don't exist or have different names.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE command ILIKE '%roll-calibration%'
       OR command ILIKE '%check-sell-alerts%'
       OR jobname ILIKE '%roll-calibration%'
       OR jobname ILIKE '%check-sell-alerts%'
       OR jobname ILIKE '%calibration-snapshot%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not installed or no permissions; safe to ignore
  NULL;
END $$;