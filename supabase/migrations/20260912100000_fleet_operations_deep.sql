/*
# Fleet operations: vehicle onboarding dates, RURA license, driver shifts & weekly deposits

Extends the existing Fleet module (vehicles + drivers) rather than adding a
new department - "Freight" turned out to just be Fleet's own operations
work, described in more depth than the original build covered.

## Vehicles
- given_date / operation_start_date: a car is usually handed over before
  it's cleared to actually start running, so these are two separate dates.
- RURA license (Rwanda Utilities Regulatory Authority, not "Lula" - a
  mishearing) starts 'pending' and flips to 'provided' once issued, with
  issued/expiry dates tracked (validity is normally 2 years, but the UI
  suggests rather than forces that).

## Drivers
- email/join_date/initial_deposit_paid capture what's known before a
  driver has anything assigned.
- shift ('day'/'night') only makes sense once vehicle_id is set - a
  CHECK constraint enforces that pairing, and a trigger enforces the real
  business rule: a vehicle carries at most 2 drivers, and if it has 2 they
  must be on different shifts. This is enforced in the database, not just
  hidden in a dropdown, same bar as every other rule in this app.

## driver_deposits
One row per weekly 180k payment. There is deliberately no "next due date"
column - it's always computed as (latest paid_date for that driver) + 7
days, the same way Call Center's queue computes urgency from data instead
of a field someone has to remember to update. `paid_date` is supplied by
the client (Kigali-local, via the app's own dateStr()/todayStr()), not a
server-side CURRENT_DATE default - Postgres's CURRENT_DATE is UTC-based,
and Kigali (UTC+2) already caused one real off-by-one-day bug this
project when a UTC date was trusted for a local calendar date.
*/

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS given_date date;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS operation_start_date date;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rura_license_status text NOT NULL DEFAULT 'pending' CHECK (rura_license_status IN ('pending', 'provided'));
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rura_license_issued_date date;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rura_license_expiry_date date;

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS join_date date;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS initial_deposit_paid boolean NOT NULL DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS shift text CHECK (shift IS NULL OR shift IN ('day', 'night'));

-- Backfill: any driver already assigned to a vehicle before this migration
-- (test data from earlier in the build) needs a shift before the CHECK
-- constraint below can be added.
UPDATE drivers SET shift = 'day' WHERE vehicle_id IS NOT NULL AND shift IS NULL;

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_shift_requires_vehicle;
ALTER TABLE drivers ADD CONSTRAINT drivers_shift_requires_vehicle CHECK (vehicle_id IS NULL OR shift IS NOT NULL);

CREATE OR REPLACE FUNCTION check_vehicle_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  same_shift_count integer;
  total_count integer;
BEGIN
  IF NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO same_shift_count
  FROM drivers
  WHERE vehicle_id = NEW.vehicle_id AND id <> NEW.id AND shift = NEW.shift;
  IF same_shift_count > 0 THEN
    RAISE EXCEPTION 'This vehicle already has a driver on the % shift', NEW.shift;
  END IF;

  SELECT count(*) INTO total_count
  FROM drivers
  WHERE vehicle_id = NEW.vehicle_id AND id <> NEW.id;
  IF total_count >= 2 THEN
    RAISE EXCEPTION 'This vehicle already has 2 drivers assigned';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_vehicle_assignment_check ON drivers;
CREATE TRIGGER drivers_vehicle_assignment_check
  BEFORE INSERT OR UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION check_vehicle_assignment();

-- ============================================================
-- DRIVER DEPOSITS
-- ============================================================
CREATE TABLE IF NOT EXISTS driver_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 180000,
  paid_date date NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_deposits_driver_idx ON driver_deposits(driver_id, paid_date DESC);

ALTER TABLE driver_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_deposits_select" ON driver_deposits;
CREATE POLICY "driver_deposits_select" ON driver_deposits FOR SELECT TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "driver_deposits_insert" ON driver_deposits;
CREATE POLICY "driver_deposits_insert" ON driver_deposits FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "driver_deposits_update" ON driver_deposits;
CREATE POLICY "driver_deposits_update" ON driver_deposits FOR UPDATE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "driver_deposits_delete" ON driver_deposits;
CREATE POLICY "driver_deposits_delete" ON driver_deposits FOR DELETE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director());

CREATE OR REPLACE FUNCTION log_deposit_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fleet_dept_id uuid;
  driver_name text;
BEGIN
  SELECT id INTO fleet_dept_id FROM departments WHERE slug = 'fleet';
  SELECT full_name INTO driver_name FROM drivers WHERE id = NEW.driver_id;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (COALESCE(NEW.created_by, auth.uid()), fleet_dept_id, 'logged a deposit for ' || COALESCE(driver_name, 'a driver'), 'driver_deposit', NEW.id, driver_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_deposits_activity_log ON driver_deposits;
CREATE TRIGGER driver_deposits_activity_log
  AFTER INSERT ON driver_deposits
  FOR EACH ROW EXECUTE FUNCTION log_deposit_activity();
