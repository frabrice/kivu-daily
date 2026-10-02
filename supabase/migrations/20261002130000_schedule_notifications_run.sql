/*
# Schedule the notification engine

pg_cron calls the notifications-run Edge Function every 5 minutes. The
function decides itself what's due (in Kigali time), so the schedule
here never needs to change when rules are added.

The shared secret is read from Vault at call time - it was created once,
outside of migrations (vault.create_secret(..., 'notifications_cron_secret'))
and set as the function's NOTIFICATIONS_CRON_SECRET, so it is never in git.
*/

SELECT cron.unschedule('notifications-run')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications-run');

SELECT cron.schedule(
  'notifications-run',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nwpsfsxuiugtgpgjffnt.supabase.co/functions/v1/notifications-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
