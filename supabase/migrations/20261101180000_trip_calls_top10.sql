/*
# Calls after trips: the first ten, and cars we manage (MD, 31 Oct 2026)

1. A driver whose car is one of ours in Kivu Daily is not a Non-Insider,
   even when the app lists them as independent (e.g. RAC 407 I, RAK239L).
2. One time, now: the 10 Non-Insider drivers with the most completed trips
   in the last 30 days go on Calls after trips (reason 'top_driver'), so
   the list starts with real work. They stay open 7 days (not 2). After
   that the usual rules apply.
3. trip_calls.context: what the agent should know before calling (e.g. the
   car already has our device: offer branding).
*/

ALTER TABLE trip_calls ADD COLUMN IF NOT EXISTS context text;
ALTER TABLE trip_calls DROP CONSTRAINT IF EXISTS trip_calls_reason_check;
ALTER TABLE trip_calls ADD CONSTRAINT trip_calls_reason_check CHECK (reason IN ('first_trip', 'first_call', 'seven_days', 'four_trips', 'top_driver'));

CREATE OR REPLACE FUNCTION plate_key(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

CREATE OR REPLACE FUNCTION is_independent_driver(p_platform_driver bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_platform_driver IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM platform_fleet_members m WHERE m.platform_driver_id = p_platform_driver)
    AND NOT EXISTS (SELECT 1 FROM platform_driver_status s WHERE s.platform_driver_id = p_platform_driver
      AND (s.kivu_driver_id IS NOT NULL OR s.freelancer_id IS NOT NULL OR s.kivu_vehicle_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM vehicles v WHERE plate_key(v.plate_number) = plate_key(s.vehicle_plate) AND plate_key(s.vehicle_plate) <> '')))
    AND NOT EXISTS (SELECT 1 FROM platform_trips t WHERE t.platform_driver_id = p_platform_driver AND (t.kivu_driver_id IS NOT NULL OR t.kivu_vehicle_id IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT plate_key(t.vehicle_plate) k FROM platform_trips t WHERE t.platform_driver_id = p_platform_driver) x
      JOIN vehicles v ON plate_key(v.plate_number) = x.k WHERE x.k <> '');
$$;

-- What the car already has, for the agent.
CREATE OR REPLACE FUNCTION trip_call_context(p_platform_driver bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN pc.device_status = 'installed' AND NOT (coalesce(pc.is_branded, false) OR pc.branding_status = 'branded') THEN 'Already has our device: offer branding (20,000 RWF)'
    WHEN (coalesce(pc.is_branded, false) OR pc.branding_status = 'branded') AND coalesce(pc.device_status, '') <> 'installed' THEN 'Already branded: offer our device (120,000 RWF)'
  END
  FROM platform_drivers pd JOIN platform_cars pc ON pc.id = pd.car_id
  WHERE pd.external_id = p_platform_driver LIMIT 1;
$$;
REVOKE ALL ON FUNCTION trip_call_context(bigint) FROM PUBLIC, anon;

-- The queue: same rules, plus the context, and a 7-day life for the top ten.
CREATE OR REPLACE FUNCTION queue_trip_calls()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg trip_call_settings%ROWTYPE;
  d record;
  v_last trip_calls%ROWTYPE;
  t platform_trips%ROWTYPE;
  n int;
  v_reason text;
  v_made int := 0;
BEGIN
  SELECT * INTO cfg FROM trip_call_settings WHERE id;

  UPDATE trip_calls SET status = 'missed', missed_reason = CASE WHEN reason = 'top_driver' THEN 'not called within 7 days' ELSE 'not called within 2 days' END
  WHERE status = 'open' AND created_at < now() - CASE WHEN reason = 'top_driver' THEN interval '7 days' ELSE interval '2 days' END;

  FOR d IN
    SELECT tr.platform_driver_id AS pid
    FROM platform_trips tr
    WHERE tr.status = 'completed' AND tr.kivu_driver_id IS NULL AND tr.platform_driver_id IS NOT NULL
      AND coalesce(tr.completed_at, tr.status_changed_at) >= cfg.started_at
    GROUP BY tr.platform_driver_id
  LOOP
    CONTINUE WHEN NOT is_independent_driver(d.pid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM trip_calls c WHERE c.platform_driver_id = d.pid AND c.status = 'open');
    CONTINUE WHEN EXISTS (SELECT 1 FROM branding_signups s WHERE s.platform_driver_id = d.pid AND s.status IN ('agreed', 'contacted', 'paid', 'completed'));
    CONTINUE WHEN EXISTS (SELECT 1 FROM platform_drivers pd JOIN platform_cars pc ON pc.id = pd.car_id
      WHERE pd.external_id = d.pid AND (pc.is_branded OR pc.branding_status = 'branded') AND pc.device_status = 'installed');

    SELECT * INTO v_last FROM trip_calls c WHERE c.platform_driver_id = d.pid ORDER BY c.created_at DESC LIMIT 1;
    IF v_last.id IS NOT NULL AND v_last.answer = 'no' AND v_last.called_at > now() - make_interval(days => cfg.no_pause_days) THEN CONTINUE; END IF;

    SELECT count(*) INTO n FROM platform_trips tr
    WHERE tr.platform_driver_id = d.pid AND tr.status = 'completed'
      AND coalesce(tr.completed_at, tr.status_changed_at) >= cfg.started_at
      AND coalesce(tr.completed_at, tr.status_changed_at) > coalesce(v_last.trip_completed_at, '-infinity'::timestamptz);
    CONTINUE WHEN n = 0;
    SELECT * INTO t FROM platform_trips tr
    WHERE tr.platform_driver_id = d.pid AND tr.status = 'completed'
    ORDER BY coalesce(tr.completed_at, tr.status_changed_at) DESC LIMIT 1;

    IF v_last.id IS NULL THEN
      v_reason := CASE WHEN (SELECT count(*) FROM platform_trips tr WHERE tr.platform_driver_id = d.pid AND tr.status = 'completed') = 1 THEN 'first_trip' ELSE 'first_call' END;
    ELSIF n >= cfg.repeat_trips THEN
      v_reason := 'four_trips';
    ELSIF coalesce(t.completed_at, t.status_changed_at) >= v_last.created_at + make_interval(days => cfg.repeat_days) THEN
      v_reason := 'seven_days';
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO trip_calls (platform_driver_id, driver_name, driver_phone, vehicle_plate, trip_id, trip_completed_at, trip_dispatch, trip_fare, reason, trips_since, context)
    VALUES (d.pid,
      coalesce((SELECT nullif(trim(s.full_name), '') FROM platform_driver_status s WHERE s.platform_driver_id = d.pid), nullif(trim(t.driver_name), '')),
      coalesce((SELECT nullif(trim(s.phone), '') FROM platform_driver_status s WHERE s.platform_driver_id = d.pid), t.driver_phone),
      coalesce(t.vehicle_plate, (SELECT s.vehicle_plate FROM platform_driver_status s WHERE s.platform_driver_id = d.pid)),
      t.id, coalesce(t.completed_at, t.status_changed_at), t.dispatch_method, t.total_fare, v_reason, n, trip_call_context(d.pid))
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_made := v_made + 1; END IF;
  END LOOP;
  RETURN v_made;
END;
$$;
REVOKE ALL ON FUNCTION queue_trip_calls() FROM PUBLIC, anon, authenticated;

-- Once: the ten Non-Insiders with the most completed trips in the last 30 days.
-- (Test accounts are left out: "Tahura Africa" / RAB 123 C.)
WITH ranked AS (
  SELECT tr.platform_driver_id AS pid, count(*) AS trips, max(coalesce(tr.completed_at, tr.status_changed_at)) AS last_at
  FROM platform_trips tr
  WHERE tr.status = 'completed' AND tr.kivu_driver_id IS NULL AND tr.platform_driver_id IS NOT NULL
    AND coalesce(tr.completed_at, tr.status_changed_at) > now() - interval '30 days'
    AND plate_key(tr.vehicle_plate) <> 'RAB123C' AND coalesce(tr.driver_name, '') NOT ILIKE '%tahura%'
  GROUP BY tr.platform_driver_id
), top10 AS (
  SELECT r.* FROM ranked r
  WHERE is_independent_driver(r.pid)
    AND NOT EXISTS (SELECT 1 FROM trip_calls c WHERE c.platform_driver_id = r.pid)
    AND NOT EXISTS (SELECT 1 FROM branding_signups s WHERE s.platform_driver_id = r.pid AND s.status <> 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM platform_drivers pd JOIN platform_cars pc ON pc.id = pd.car_id
      WHERE pd.external_id = r.pid AND (pc.is_branded OR pc.branding_status = 'branded') AND pc.device_status = 'installed')
  ORDER BY r.trips DESC, r.last_at DESC LIMIT 10
)
INSERT INTO trip_calls (platform_driver_id, driver_name, driver_phone, vehicle_plate, trip_id, trip_completed_at, trip_dispatch, trip_fare, reason, trips_since, context)
SELECT x.pid,
  coalesce((SELECT nullif(trim(s.full_name), '') FROM platform_driver_status s WHERE s.platform_driver_id = x.pid), nullif(trim(lt.driver_name), '')),
  coalesce((SELECT nullif(trim(s.phone), '') FROM platform_driver_status s WHERE s.platform_driver_id = x.pid), lt.driver_phone),
  coalesce(lt.vehicle_plate, (SELECT s.vehicle_plate FROM platform_driver_status s WHERE s.platform_driver_id = x.pid)),
  lt.id, coalesce(lt.completed_at, lt.status_changed_at), lt.dispatch_method, lt.total_fare, 'top_driver', x.trips,
  concat_ws(' · ', format('Top 10 Non-Insider: %s trips in the last 30 days', x.trips), trip_call_context(x.pid))
FROM top10 x
CROSS JOIN LATERAL (SELECT * FROM platform_trips tr WHERE tr.platform_driver_id = x.pid AND tr.status = 'completed'
  ORDER BY coalesce(tr.completed_at, tr.status_changed_at) DESC LIMIT 1) lt
ON CONFLICT DO NOTHING;
