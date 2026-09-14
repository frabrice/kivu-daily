/*
# Non-Insider Drivers

Drivers who are live on the passenger-facing platform but whose car isn't
part of Kivu Ride's managed fleet - onboarded early on to bulk up the
visible fleet size, before the vetting this app enforces existed. The
live platform ties a driver's login to the car they onboarded with, which
is the actual problem: a hired driver gets swapped out, or the car itself
changes, and the account keeps showing the original (possibly electric)
car to passengers with no way to tell.

Modelled as two separate tables rather than one row with car fields
bolted on, so a driver's car can be swapped - or removed entirely,
leaving them a driver with no car - without ever touching the driver
record or their login. Visible to both Fleet and Call Center, since both
departments work this list (verification calls, in-person surveys).

is_owner / is_branded / allows_branding start out NULL (not false) -
unknown until the survey visits that driver, not a claim that the answer
is "no".
*/

CREATE TABLE IF NOT EXISTS platform_cars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text NOT NULL UNIQUE,
  make text,
  model text,
  color text,
  is_branded boolean,
  allows_branding boolean,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  is_owner boolean,
  car_id uuid REFERENCES platform_cars(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_drivers_car_idx ON platform_drivers(car_id);

ALTER TABLE platform_cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_cars_select" ON platform_cars;
CREATE POLICY "platform_cars_select" ON platform_cars FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());

DROP POLICY IF EXISTS "platform_cars_write" ON platform_cars;
CREATE POLICY "platform_cars_write" ON platform_cars FOR ALL TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());

DROP POLICY IF EXISTS "platform_drivers_select" ON platform_drivers;
CREATE POLICY "platform_drivers_select" ON platform_drivers FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());

DROP POLICY IF EXISTS "platform_drivers_write" ON platform_drivers;
CREATE POLICY "platform_drivers_write" ON platform_drivers FOR ALL TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());

-- ============================================================
-- Activity log
-- ============================================================
CREATE OR REPLACE FUNCTION log_platform_driver_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_dept uuid;
  plate text;
BEGIN
  SELECT department_id INTO actor_dept FROM profiles WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), actor_dept, 'added a non-insider driver', 'platform_driver', NEW.id, NEW.full_name);
  ELSIF TG_OP = 'UPDATE' AND NEW.car_id IS DISTINCT FROM OLD.car_id THEN
    IF NEW.car_id IS NOT NULL THEN
      SELECT plate_number INTO plate FROM platform_cars WHERE id = NEW.car_id;
      INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
      VALUES (auth.uid(), actor_dept, 'assigned ' || NEW.full_name || ' to car ' || COALESCE(plate, ''), 'platform_driver', NEW.id, NEW.full_name);
    ELSE
      INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
      VALUES (auth.uid(), actor_dept, 'unassigned ' || NEW.full_name || ' from their car', 'platform_driver', NEW.id, NEW.full_name);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_drivers_activity_log ON platform_drivers;
CREATE TRIGGER platform_drivers_activity_log
  AFTER INSERT OR UPDATE ON platform_drivers
  FOR EACH ROW EXECUTE FUNCTION log_platform_driver_activity();

CREATE OR REPLACE FUNCTION log_platform_car_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_dept uuid;
BEGIN
  SELECT department_id INTO actor_dept FROM profiles WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), actor_dept, 'added a non-insider car', 'platform_car', NEW.id, NEW.plate_number);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_cars_activity_log ON platform_cars;
CREATE TRIGGER platform_cars_activity_log
  AFTER INSERT ON platform_cars
  FOR EACH ROW EXECUTE FUNCTION log_platform_car_activity();
