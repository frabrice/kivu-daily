/*
# Instant emails actually instant

Instant emails (a ticket assigned to you, a deposit rejected, a comment
reply...) were only picked up by the 5-minute scheduler, so they could
take up to 5 minutes - the MD's first Call Center ticket arrived 3
minutes after it was logged. Now every statement that adds
notification_events also calls notifications-run straight away through
pg_net (asynchronous, and only once the transaction commits, so a
rolled-back action never emails anyone). The 5-minute cron stays as the
safety net.

With two runs able to overlap, sending is made claim-based: a run
atomically marks the rows it will send as 'sending' (FOR UPDATE SKIP
LOCKED), so the same email can never go out twice. A row stuck in
'sending' for 10 minutes (a run that crashed mid-send) is picked up
again.
*/

ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed'));
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE OR REPLACE FUNCTION claim_notification_outbox(p_limit int DEFAULT 50, p_only uuid[] DEFAULT NULL)
RETURNS SETOF notification_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE notification_outbox o SET
    status = 'sending',
    claimed_at = now(),
    attempts = o.attempts + 1
  WHERE o.id IN (
    SELECT id FROM notification_outbox
    WHERE attempts < 3
      AND (status IN ('pending', 'failed') OR (status = 'sending' AND claimed_at < now() - interval '10 minutes'))
      AND (p_only IS NULL OR id = ANY (p_only))
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;

REVOKE ALL ON FUNCTION claim_notification_outbox(int, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_notification_outbox(int, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION kick_notifications_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://nwpsfsxuiugtgpgjffnt.supabase.co/functions/v1/notifications-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notification_events_kick ON notification_events;
CREATE TRIGGER notification_events_kick AFTER INSERT ON notification_events
  FOR EACH STATEMENT EXECUTE FUNCTION kick_notifications_run();
