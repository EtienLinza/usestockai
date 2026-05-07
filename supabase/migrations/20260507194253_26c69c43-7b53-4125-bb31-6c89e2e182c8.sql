
CREATE OR REPLACE FUNCTION public.sync_cron_secret_to_vault(p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'CRON_SECRET';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(p_secret, 'CRON_SECRET', 'Shared secret for protecting cron-only edge functions');
  ELSE
    PERFORM vault.update_secret(existing_id, p_secret);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_cron_secret_to_vault(text) FROM anon, authenticated, public;
