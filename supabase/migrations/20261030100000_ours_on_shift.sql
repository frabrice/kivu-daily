/*
# Ours On Shift: are our drivers online in the app during their shift? (MD, 22 Oct 2026)

- platform_driver_status: every platform driver's state in the Kivu Ride
  app (online, status, logged in, last seen, last location update - never
  the location itself), copied every 2 minutes by the driver-status-sync
  edge function, matched to our drivers (phone) and cars (plate).
- driver_online_log: each time a driver goes online or offline, so the
  page can say "offline for 25 min" and how long they were online during
  their shift.
- fleet_shift_hours: when the day and the night shift start and end
  (Fleet or the MD can change them on the page).
Read by Fleet, the Call Center, Finance, IT and the MD.
*/

CREATE TABLE IF NOT EXISTS platform_driver_status (
  platform_driver_id int PRIMARY KEY,
  full_name text,
  phone text,
  vehicle_plate text,
  is_online boolean NOT NULL DEFAULT false,
  driver_status text,
  logged_in boolean,
  last_seen_at timestamptz,
  last_location_at timestamptz,
  app_version text,
  kivu_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  freelancer_id uuid REFERENCES freelance_drivers(id) ON DELETE SET NULL,
  kivu_vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  status_since timestamptz NOT NULL DEFAULT now(),   -- online (or offline) since
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_driver_status_driver ON platform_driver_status (kivu_driver_id);

CREATE TABLE IF NOT EXISTS driver_online_log (
  id bigserial PRIMARY KEY,
  platform_driver_id int NOT NULL,
  kivu_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  freelancer_id uuid REFERENCES freelance_drivers(id) ON DELETE SET NULL,
  is_online boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_online_log_at ON driver_online_log (at DESC);
CREATE INDEX IF NOT EXISTS driver_online_log_driver ON driver_online_log (platform_driver_id, at DESC);

CREATE TABLE IF NOT EXISTS fleet_shift_hours (
  shift text PRIMARY KEY CHECK (shift IN ('day', 'night')),
  starts time NOT NULL,
  ends time NOT NULL,
  updated_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO fleet_shift_hours (shift, starts, ends, updated_by) VALUES ('day', '06:00', '18:00', NULL), ('night', '18:00', '06:00', NULL)
ON CONFLICT (shift) DO NOTHING;

ALTER TABLE platform_driver_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_online_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_shift_hours ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_driver_status', 'driver_online_log', 'fleet_shift_hours'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (is_managing_director() OR current_department_slug() IN ('call_center', 'fleet', 'finance', 'it'))$p$, t || '_select', t);
  END LOOP;
END $$;
-- The status and its log are written by the sync only (service role). Shift hours: Fleet or the MD.
DROP POLICY IF EXISTS fleet_shift_hours_update ON fleet_shift_hours;
CREATE POLICY fleet_shift_hours_update ON fleet_shift_hours FOR UPDATE TO authenticated
  USING (is_managing_director() OR current_department_slug() = 'fleet') WITH CHECK (is_managing_director() OR current_department_slug() = 'fleet');

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE platform_driver_status;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Every 2 minutes (same shared secret as trips-sync).
DO $$ BEGIN PERFORM cron.unschedule('driver-status-sync'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule(
  'driver-status-sync',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nwpsfsxuiugtgpgjffnt.supabase.co/functions/v1/driver-status-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Keep 60 days of online/offline history.
DO $$ BEGIN PERFORM cron.unschedule('driver-online-log-trim'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('driver-online-log-trim', '17 3 * * *', $$DELETE FROM driver_online_log WHERE at < now() - interval '60 days'$$);
