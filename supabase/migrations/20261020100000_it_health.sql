/*
# IT & Product, phase 4: product health (MD, 17 Oct 2026)

- Trips health from the synced platform trips (it_trip_health): requests,
  completed, no driver found, cancelled after a driver accepted, time to
  accept, pickup time - per day and per hour of the day.
- Sentry (errors, crash-free sessions) and GitHub (commits, pull requests)
  are read every hour by the it-health function once their tokens are set
  as function secrets (SENTRY_AUTH_TOKEN, GITHUB_TOKEN). Names that are not
  secret (Sentry organisation/projects, GitHub repositories, who is who on
  GitHub, the thresholds) live in it_health_settings / it_members.
- it_commits: every commit; a commit message mentioning KR-123 shows up in
  that issue's activity.
- Daily 08:00 health alert to the head of IT and the MD when something is
  below its threshold.

Default thresholds come from the last 8 weeks of real trips (completed
~60%, no driver ~20-28%, median accept ~20 s, pickup ~8 min); IT leads
change them on the Health page.
*/

CREATE TABLE IF NOT EXISTS it_health_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sentry_base_url text NOT NULL DEFAULT 'https://sentry.io',
  sentry_org text,
  sentry_projects text[] NOT NULL DEFAULT '{}',
  github_repos text[] NOT NULL DEFAULT '{}',          -- owner/repo
  min_completion_pct numeric NOT NULL DEFAULT 60,
  max_no_driver_pct numeric NOT NULL DEFAULT 20,
  max_accept_seconds numeric NOT NULL DEFAULT 60,     -- median, app dispatch
  max_pickup_minutes numeric NOT NULL DEFAULT 10,
  min_crash_free_pct numeric NOT NULL DEFAULT 99,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO it_health_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE it_members ADD COLUMN IF NOT EXISTS github_login text;

CREATE TABLE IF NOT EXISTS it_health_snapshots (
  id bigserial PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('sentry', 'github')),
  taken_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  error text,
  data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS it_health_snapshots_latest ON it_health_snapshots (source, taken_at DESC);

CREATE TABLE IF NOT EXISTS it_commits (
  repo text NOT NULL,
  sha text NOT NULL,
  author_login text,
  author_name text,
  profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  message text,
  committed_at timestamptz NOT NULL,
  url text,
  issue_ids bigint[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (repo, sha)
);
CREATE INDEX IF NOT EXISTS it_commits_when ON it_commits (committed_at DESC);

-- ------------------------------------------------------------ trips health
CREATE OR REPLACE FUNCTION it_trip_health(p_from date, p_to date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT (COALESCE(requested_at, created_at) AT TIME ZONE 'Africa/Kigali') AS at_k, status, accepted_at, started_at, requested_at, dispatch_method,
           rejected_driver_count, total_fare
    FROM platform_trips
    WHERE (auth.uid() IS NULL OR is_it_member())   -- NULL = the server (daily alert)
      AND COALESCE(requested_at, created_at) >= (p_from::timestamp AT TIME ZONE 'Africa/Kigali')
      AND COALESCE(requested_at, created_at) < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Kigali')
  )
  SELECT jsonb_build_object(
    'days', COALESCE((SELECT jsonb_agg(d ORDER BY d->>'day') FROM (
      SELECT jsonb_build_object(
        'day', at_k::date,
        'requested', count(*),
        'completed', count(*) FILTER (WHERE status = 'completed'),
        'no_driver', count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NULL),
        'cancelled_after_accept', count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NOT NULL),
        'accept_median_s', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM accepted_at - requested_at)) FILTER (WHERE dispatch_method = 'app' AND accepted_at IS NOT NULL AND requested_at IS NOT NULL))::numeric),
        'pickup_avg_min', round((avg(extract(epoch FROM started_at - accepted_at) / 60) FILTER (WHERE started_at IS NOT NULL AND accepted_at IS NOT NULL))::numeric, 1),
        'rejections', COALESCE(sum(rejected_driver_count), 0),
        'fares', COALESCE(sum(total_fare) FILTER (WHERE status = 'completed'), 0)
      ) d FROM t GROUP BY at_k::date) x), '[]'::jsonb),
    'hours', COALESCE((SELECT jsonb_agg(h ORDER BY (h->>'hour')::int) FROM (
      SELECT jsonb_build_object('hour', extract(hour FROM at_k)::int, 'requested', count(*),
        'completed', count(*) FILTER (WHERE status = 'completed'),
        'no_driver', count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NULL)) h
      FROM t GROUP BY extract(hour FROM at_k)) y), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
        'requested', count(*), 'completed', count(*) FILTER (WHERE status = 'completed'),
        'no_driver', count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NULL),
        'cancelled_after_accept', count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NOT NULL),
        'accept_median_s', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM accepted_at - requested_at)) FILTER (WHERE dispatch_method = 'app' AND accepted_at IS NOT NULL AND requested_at IS NOT NULL))::numeric),
        'pickup_avg_min', round((avg(extract(epoch FROM started_at - accepted_at) / 60) FILTER (WHERE started_at IS NOT NULL AND accepted_at IS NOT NULL))::numeric, 1)
      ) FROM t)
  );
$$;
REVOKE EXECUTE ON FUNCTION it_trip_health(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION it_trip_health(date, date) TO authenticated;

-- ------------------------------------------------------------ access
ALTER TABLE it_health_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_commits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ithset_select ON it_health_settings; CREATE POLICY ithset_select ON it_health_settings FOR SELECT TO authenticated USING (is_it_member());
DROP POLICY IF EXISTS ithset_update ON it_health_settings; CREATE POLICY ithset_update ON it_health_settings FOR UPDATE TO authenticated USING (is_it_lead()) WITH CHECK (is_it_lead());
DROP POLICY IF EXISTS ithsnap_select ON it_health_snapshots; CREATE POLICY ithsnap_select ON it_health_snapshots FOR SELECT TO authenticated USING (is_it_member());
DROP POLICY IF EXISTS itcommit_select ON it_commits; CREATE POLICY itcommit_select ON it_commits FOR SELECT TO authenticated USING (is_it_member());
-- Snapshots and commits are written by the it-health function (service role).

-- ------------------------------------------------------------ schedule
DO $$ BEGIN PERFORM cron.unschedule('it-health'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('it-health', '7 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://nwpsfsxuiugtgpgjffnt.supabase.co/functions/v1/it-health',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
-- Keep two weeks of hourly snapshots.
DO $$ BEGIN PERFORM cron.unschedule('it-health-cleanup'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('it-health-cleanup', '30 3 * * *', $cron$ DELETE FROM it_health_snapshots WHERE taken_at < now() - interval '14 days'; $cron$);

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('it_health_daily', 'Product health alert', 'Yesterday''s trips, app errors and crash-free rate against the thresholds on the Health page - sent only when something is off.', 'Daily 08:00', ARRAY['md'], 3, 457, 'IT & product', true)
ON CONFLICT (key) DO NOTHING;
