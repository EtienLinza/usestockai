DO $$
DECLARE
  v_secret text;
  v_base_url text;
  r record;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name IN ('CRON_SECRET','cron_secret')
  ORDER BY (name = 'CRON_SECRET') DESC
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'CRON_SECRET not in vault — scanner cron jobs were not changed.';
    RETURN;
  END IF;

  SELECT regexp_replace(command, '.*(https://[^'']+/functions/v1)/[^'']+.*', '\1') INTO v_base_url
  FROM cron.job
  WHERE command ILIKE '%/functions/v1/%'
  ORDER BY jobid
  LIMIT 1;

  IF v_base_url IS NULL OR v_base_url = '' THEN
    RAISE NOTICE 'Function base URL could not be inferred — scanner cron jobs were not changed.';
    RETURN;
  END IF;

  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE command ILIKE '%/functions/v1/autotrader-scan%'
       OR command ILIKE '%/functions/v1/market-scanner%'
       OR command ILIKE '%/functions/v1/scan-orchestrator%'
       OR jobname ILIKE '%autotrader%'
       OR jobname ILIKE '%market-scanner%'
       OR jobname ILIKE '%scan-orchestrator%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'autotrader-exits-every-5min',
    '*/5 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{"mode":"exits"}'::jsonb
      ) AS request_id;
    $cron$, v_base_url || '/autotrader-scan', v_secret)
  );

  PERFORM cron.schedule(
    'autotrader-entries-shard-0',
    '1,16,31,46 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{"mode":"entries","shard":0,"shards":3}'::jsonb
      ) AS request_id;
    $cron$, v_base_url || '/autotrader-scan', v_secret)
  );

  PERFORM cron.schedule(
    'autotrader-entries-shard-1',
    '6,21,36,51 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{"mode":"entries","shard":1,"shards":3}'::jsonb
      ) AS request_id;
    $cron$, v_base_url || '/autotrader-scan', v_secret)
  );

  PERFORM cron.schedule(
    'autotrader-entries-shard-2',
    '11,26,41,56 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{"mode":"entries","shard":2,"shards":3}'::jsonb
      ) AS request_id;
    $cron$, v_base_url || '/autotrader-scan', v_secret)
  );

  PERFORM cron.schedule(
    'market-scan-orchestrator-live',
    '*/15 13-21 * * 1-5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{"mode":"live"}'::jsonb
      ) AS request_id;
    $cron$, v_base_url || '/scan-orchestrator', v_secret)
  );

  PERFORM cron.schedule(
    'market-scan-orchestrator-premarket',
    '30,45,0,15 12-13 * * 1-5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{"mode":"premarket"}'::jsonb
      ) AS request_id;
    $cron$, v_base_url || '/scan-orchestrator', v_secret)
  );
END $$;

UPDATE public.autotrade_settings
SET next_scan_at = NULL
WHERE enabled = true;