-- Driver performance (MD, 28 Nov 2026): every offer the Kivu Ride app sent
-- for a trip - to which driver, when, how far, and what they did with it.
-- The app's trip list doesn't carry the offers; one trip's detail
-- (/admin/trips/{id}) does. trips-sync reads each finished trip's detail once
-- (offers_read_at) and saves its offers here; older trips are filled in a few
-- dozen per run.
--
-- status (from the app): accepted, rejected (refused, with a reason), expired
-- (no answer in time - or, when responded_at is set, closed because another
-- driver took it first), cancelled (accepted, then dropped, with a reason).

CREATE TABLE IF NOT EXISTS platform_trip_offers (
  trip_id bigint NOT NULL,
  platform_driver_id int NOT NULL,
  offered_at timestamptz NOT NULL,
  responded_at timestamptz,
  status text NOT NULL,
  rejection_reason text,
  distance_km numeric,
  wave_index int,
  offer_sequence int,
  vehicle_type text,
  plate text,
  driver_name text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, platform_driver_id, offered_at)
);
CREATE INDEX IF NOT EXISTS platform_trip_offers_driver ON platform_trip_offers (platform_driver_id, offered_at DESC);
CREATE INDEX IF NOT EXISTS platform_trip_offers_at ON platform_trip_offers (offered_at DESC);

ALTER TABLE platform_trips ADD COLUMN IF NOT EXISTS offers_read_at timestamptz;
CREATE INDEX IF NOT EXISTS platform_trips_offers_unread ON platform_trips (created_at DESC) WHERE offers_read_at IS NULL;

ALTER TABLE platform_trip_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_trip_offers_select ON platform_trip_offers;
CREATE POLICY platform_trip_offers_select ON platform_trip_offers FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('call_center', 'fleet', 'finance', 'it'));
-- Written by trips-sync only (service role).
GRANT SELECT ON platform_trip_offers TO authenticated;
GRANT ALL ON platform_trip_offers TO service_role;
