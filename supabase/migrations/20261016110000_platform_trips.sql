/*
# KivuRide trips in Kivu Daily (MD, 16 Oct 2026)

Every trip on the KivuRide platform, copied here by the trips-sync edge
function (KIVURIDE_API_KEY, GET /admin/trips) every 2 minutes, so the
Trips page - and later dispatch, finance and driver features - read
them like any other table. The platform has no "changed since" filter:
each run re-reads the last 2 days plus any trip still in progress, and
only writes rows that actually changed (raw_hash).

- platform_trips: one row per platform trip id, the fields the app
  needs as columns + the platform's object (minus the trip code and the
  route polylines) in raw. Matched to our own drivers / cars by phone
  and plate (kivu_driver_id / kivu_vehicle_id).
- platform_trip_status_log: each status the sync saw, when it saw it.
- platform_sync_state: last run, last success, last error - shown on the page.

Read by Call Center, Fleet, Finance, IT and the MD; written only by the sync.
*/

CREATE TABLE IF NOT EXISTS platform_trips (
  id bigint PRIMARY KEY,
  status text NOT NULL,
  created_at timestamptz,
  requested_at timestamptz,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  is_scheduled boolean NOT NULL DEFAULT false,
  scheduled_pickup_time timestamptz,
  vehicle_type text,
  passenger_count int,
  pickup_address text, pickup_lat double precision, pickup_lng double precision,
  destination_address text, destination_lat double precision, destination_lng double precision,
  rider_kind text,                -- app (KivuRide account), guest (booked for someone), unknown
  rider_name text,
  rider_phone text,
  platform_driver_id bigint,
  driver_name text,
  driver_phone text,
  driver_rating numeric,
  vehicle_plate text,
  vehicle_label text,
  platform_vehicle_id bigint,
  kivu_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  kivu_vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  dispatch_method text,
  dispatched_by_admin_id bigint,
  preferred_driver_id bigint,
  rejected_driver_count int NOT NULL DEFAULT 0,
  estimated_distance_km numeric, actual_distance_km numeric,
  estimated_duration_minutes numeric, actual_duration_minutes numeric,
  base_fare numeric, distance_fare numeric, time_fare numeric, surge_multiplier numeric,
  waiting_minutes numeric, waiting_fee numeric, extras_total numeric,
  total_fare numeric,
  payment_method text,
  payment_status text,
  rider_rating numeric,           -- the rider's rating of the trip (platform user_rating)
  driver_rating_of_rider numeric, -- the driver's rating of the rider (platform driver_rating)
  rider_feedback text,
  driver_feedback text,
  fraud_flag boolean NOT NULL DEFAULT false,
  code_verified boolean NOT NULL DEFAULT false,
  distance_source text,
  telemetry_status text,
  raw jsonb NOT NULL,
  raw_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_trips_created ON platform_trips (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_trips_status ON platform_trips (status);
CREATE INDEX IF NOT EXISTS platform_trips_kivu_driver ON platform_trips (kivu_driver_id);
CREATE INDEX IF NOT EXISTS platform_trips_kivu_vehicle ON platform_trips (kivu_vehicle_id);

CREATE TABLE IF NOT EXISTS platform_trip_status_log (
  id bigserial PRIMARY KEY,
  trip_id bigint NOT NULL REFERENCES platform_trips(id) ON DELETE CASCADE,
  status text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_trip_status_log_trip ON platform_trip_status_log (trip_id, seen_at);

CREATE TABLE IF NOT EXISTS platform_sync_state (
  key text PRIMARY KEY,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_full_at timestamptz,
  last_error text,
  last_changed int,
  platform_total int
);

ALTER TABLE platform_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_trip_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sync_state ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_trips', 'platform_trip_status_log', 'platform_sync_state'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (is_managing_director() OR current_department_slug() IN ('call_center', 'fleet', 'finance', 'it'))$p$, t || '_select', t);
  END LOOP;
END $$;

-- Live updates on the Trips page.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE platform_trips;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Every 2 minutes (same shared secret as notifications-run).
DO $$ BEGIN PERFORM cron.unschedule('trips-sync'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'trips-sync',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nwpsfsxuiugtgpgjffnt.supabase.co/functions/v1/trips-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
