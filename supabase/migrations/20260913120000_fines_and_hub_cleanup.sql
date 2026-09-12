/*
# Driver fines, Product Hub cleanup, and flattening flagged issues

## Product Hub cleanup
- Removes the test "iOS App" product (cascades to its milestones/
  features/stories - nothing real depends on it).
- Clears out the flagged issues created so far (test data) - source =
  'flagged' rows only, never touching manually-authored user stories.

## Flagged issues are issues, not a product/milestone/feature to drill
into. The flag_to_it() RPC still needs a feature_id to satisfy the
existing FK (unchanged), so the seeded "Flagged Issues > Inbox >
Flagged from Call Center & Fleet" chain stays in the schema as the
technical home for these rows - the UI is what changes, filtering
user_stories by source = 'flagged' into one flat "Issues" list instead
of making anyone drill through Products > Milestones > Features to
find them.

## driver_fines
One row per fine: amount, date, which driver, which car. The car is
its own selection (not read off the driver's current vehicle_id)
because a fine is tied to whichever car was actually being driven
that day, which may not be the driver's ongoing assignment.
*/

DELETE FROM products WHERE lower(name) = 'ios app';

DELETE FROM user_stories WHERE source = 'flagged';

CREATE TABLE IF NOT EXISTS driver_fines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  fine_date date NOT NULL,
  reason text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_fines_driver_idx ON driver_fines(driver_id, fine_date DESC);

ALTER TABLE driver_fines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_fines_select" ON driver_fines;
CREATE POLICY "driver_fines_select" ON driver_fines FOR SELECT TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_insert" ON driver_fines;
CREATE POLICY "driver_fines_insert" ON driver_fines FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_update" ON driver_fines;
CREATE POLICY "driver_fines_update" ON driver_fines FOR UPDATE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "driver_fines_delete" ON driver_fines;
CREATE POLICY "driver_fines_delete" ON driver_fines FOR DELETE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director());

CREATE OR REPLACE FUNCTION log_fine_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fleet_dept_id uuid;
  driver_name text;
BEGIN
  SELECT id INTO fleet_dept_id FROM departments WHERE slug = 'fleet';
  SELECT full_name INTO driver_name FROM drivers WHERE id = NEW.driver_id;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (COALESCE(NEW.created_by, auth.uid()), fleet_dept_id, 'logged a fine for ' || COALESCE(driver_name, 'a driver'), 'driver_fine', NEW.id, driver_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_fines_activity_log ON driver_fines;
CREATE TRIGGER driver_fines_activity_log
  AFTER INSERT ON driver_fines
  FOR EACH ROW EXECUTE FUNCTION log_fine_activity();
