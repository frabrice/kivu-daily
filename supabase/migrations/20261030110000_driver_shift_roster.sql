/*
# Ours On Shift: the list of who should be driving (MD, 22 Oct 2026)

driver_shift_roster: worked out every 2 minutes by driver-status-sync from
the drivers' cars, shifts, rest days, approved pauses, freelancers covering
a seat, and whether each driver is cleared to drive (paid) - one row per
person per shift (the shift running now, or the next one). Holds only
what the page needs (name, phone, car, shift, cleared or not), so the Call
Center sees who should be online without seeing drivers' payments.
*/

CREATE TABLE IF NOT EXISTS driver_shift_roster (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('driver', 'freelancer')),
  driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
  freelancer_id uuid REFERENCES freelance_drivers(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  plate text,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  shift text NOT NULL CHECK (shift IN ('day', 'night')),
  day date NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  blocked text,                      -- not cleared to drive: kept off the road on purpose
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE driver_shift_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_shift_roster_select ON driver_shift_roster;
CREATE POLICY driver_shift_roster_select ON driver_shift_roster FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('call_center', 'fleet', 'finance', 'it'));
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE driver_shift_roster;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
