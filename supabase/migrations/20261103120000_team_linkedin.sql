/*
# LinkedIn on the team (MD, 3 Nov 2026)

kivuride.com shows the team without photos; each person gets a LinkedIn
icon that opens their profile.

- profiles.linkedin_url: the person's public profile, stored one way only
  (https://www.linkedin.com/in/<name>); the page cleans what is typed.
  Each person sets their own in Settings; the MD can set anyone's in
  MD Panel -> Edit.
- public_site_stats(): each team member now carries `linkedin` when set.
  Nothing else changes.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_linkedin_url_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_linkedin_url_check
  CHECK (linkedin_url IS NULL OR linkedin_url ~ '^https://www\.linkedin\.com/in/[A-Za-z0-9_%-]+$');

CREATE OR REPLACE FUNCTION public_site_stats()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH done AS (
    SELECT completed_at, rider_phone, coalesce(actual_distance_km, estimated_distance_km, 0) AS km
    FROM platform_trips
    WHERE status = 'completed' AND completed_at IS NOT NULL
  ),
  online AS (
    SELECT l.platform_driver_id, pd.car_id
    FROM driver_online_log l
    LEFT JOIN platform_drivers pd ON pd.external_id = l.platform_driver_id
    WHERE l.is_online AND l.at > now() - interval '30 days'
  ),
  months AS (
    SELECT date_trunc('month', completed_at AT TIME ZONE 'Africa/Kigali') AS m, count(*) AS trips, round(sum(km)) AS km
    FROM done
    WHERE completed_at AT TIME ZONE 'Africa/Kigali' < date_trunc('month', now() AT TIME ZONE 'Africa/Kigali')
    GROUP BY 1
  ),
  team AS (
    SELECT trim(regexp_replace(p.full_name, '\s*\(.*?\)\s*', ' ', 'g')) AS name,
           coalesce(nullif(trim(p.responsibility_label), ''),
                    CASE WHEN p.role = 'managing_director' THEN 'Managing Director'
                         WHEN d.slug = 'call_center' THEN 'Call Center Agent'
                         ELSE d.name END) AS position,
           coalesce(d.name, 'Leadership') AS department,
           p.linkedin_url AS linkedin,
           CASE WHEN p.role = 'managing_director' THEN 0 ELSE 1 END AS rank
    FROM profiles p
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.is_active
  )
  SELECT jsonb_build_object(
    'updated_at', now(),
    'evs_active_30d', (SELECT count(DISTINCT car_id) FROM online),
    'drivers_online_30d', (SELECT count(DISTINCT platform_driver_id) FROM online),
    'drivers_registered', (SELECT count(*) FROM platform_drivers),
    'drivers_app', coalesce((SELECT platform_total FROM platform_sync_state WHERE key = 'drivers'), (SELECT count(*) FROM platform_driver_status)),
    'vehicles_app', coalesce((SELECT platform_total FROM platform_sync_state WHERE key = 'vehicles'), (SELECT count(DISTINCT nullif(upper(trim(vehicle_plate)), '')) FROM platform_driver_status WHERE NOT coalesce(is_rejected, false))),
    'trips_total', (SELECT count(*) FROM done),
    'trips_30d', (SELECT count(*) FROM done WHERE completed_at > now() - interval '30 days'),
    'trips_prev_30d', (SELECT count(*) FROM done WHERE completed_at > now() - interval '60 days' AND completed_at <= now() - interval '30 days'),
    'riders', (SELECT count(DISTINCT rider_phone) FROM done),
    'km_total', (SELECT round(sum(km)) FROM done),
    'months', coalesce((SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'trips', trips, 'km', km) ORDER BY m) FROM months), '[]'::jsonb),
    'team', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', name, 'position', position, 'department', department, 'linkedin', linkedin)) ORDER BY rank, department, name) FROM team), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public_site_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_site_stats() TO anon, authenticated, service_role;
