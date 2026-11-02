/*
# Live numbers for kivuride.com (2 Nov 2026)

The public website reads one function, with the public (anon) key, to show
live numbers and the team. It returns totals only: no trip, rider, driver,
phone or plate ever leaves through it. The website decides which numbers are
big enough to show (thresholds in its src/config.ts).

- evs_active_30d / drivers_online_30d: cars and drivers that went online in
  the last 30 days (driver_online_log).
- trips_* / riders / km_total: completed app trips (platform_trips).
- months: completed trips and km per full calendar month, Kigali time.
- team: active Kivu Daily people with their position (responsibility label,
  else their department), MD first. Names as written in their profile.
*/

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
    'trips_total', (SELECT count(*) FROM done),
    'trips_30d', (SELECT count(*) FROM done WHERE completed_at > now() - interval '30 days'),
    'trips_prev_30d', (SELECT count(*) FROM done WHERE completed_at > now() - interval '60 days' AND completed_at <= now() - interval '30 days'),
    'riders', (SELECT count(DISTINCT rider_phone) FROM done),
    'km_total', (SELECT round(sum(km)) FROM done),
    'months', coalesce((SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'trips', trips, 'km', km) ORDER BY m) FROM months), '[]'::jsonb),
    'team', coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'position', position, 'department', department) ORDER BY rank, department, name) FROM team), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public_site_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_site_stats() TO anon, authenticated, service_role;
