/*
# Stop the notifications-run kick loop

Found 8 Oct 2026: notifications-run was being called ~200 times a minute.
The instant-delivery trigger on notification_events is statement-level, and
statement triggers fire even when an INSERT ... SELECT inserts no rows. The
engine itself runs such inserts on every run (overdue responses, stale
shifts), so each run kicked the next one, forever. Emails were never
duplicated (the outbox de-duplicates), but the function ran nonstop.

Now the trigger looks at the rows actually inserted and only kicks the
engine when there is at least one.
*/

CREATE OR REPLACE FUNCTION kick_notifications_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM new_events) THEN
    RETURN NULL;
  END IF;
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
CREATE TRIGGER notification_events_kick
  AFTER INSERT ON notification_events
  REFERENCING NEW TABLE AS new_events
  FOR EACH STATEMENT EXECUTE FUNCTION kick_notifications_run();

REVOKE EXECUTE ON FUNCTION kick_notifications_run() FROM PUBLIC, anon;
