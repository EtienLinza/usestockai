-- Re-schedule autotrader-scan cron (was running, then stopped on 2026-05-15).
-- This keeps `last_scan_at` / `next_scan_at` on autotrade_settings fresh so the
-- Settings UI's "Last scan" / "Next scan" widgets actually update.

DO $$
DECLARE
  v_secret text;
  v_url text;
  r RECORD;
BEGIN
  -- Pull CRON_SECRET from Supabase Vault (used by all our cron jobs).
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name IN ('CRON_SECRET','cron_secret')
  ORDER BY (name = 'CRON_SECRET') DESC
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'CRON_SECRET not in vault — autotrader-scan cron NOT scheduled.';
    RETURN;
  END IF;

  v_url := 'https://mgudiiwaadvmpznpfmsg.supabase.co/functions/v1/autotrader-scan';

  -- Unschedule any prior autotrader-scan jobs so we don't double-fire.
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE command ILIKE '%autotrader-scan%' OR jobname ILIKE '%autotrader%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'autotrader-scan-every-5min',
    '*/5 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, v_url, v_secret)
  );
END $$;
