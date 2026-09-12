/*
# Phase 2.1b - Fleet vehicles & accessories

Vehicles are modelled as their own table, not fields bolted onto `drivers`,
because a vehicle can be shared by two drivers across shifts (the real
operating model per the KR-02 contract) and can exist before any driver is
assigned to it (newly onboarded car, not yet matched). `drivers.vehicle_id`
is the link - nullable, and more than one driver row can point at the same
vehicle for shift-sharing.

`documents` is a free-text jsonb array (e.g. "Logbook", "Insurance
Certificate") rather than real file uploads or a fixed enum - this is a
handover checklist of what was physically given with the car, not a
document management feature, and the set of document types varies enough
that hardcoding a list would just mean a migration every time one changes.
*/

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text NOT NULL UNIQUE,
  make text,
  model text,
  color text,
  device_label text,
  documents jsonb NOT NULL DEFAULT '[]',
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS drivers_vehicle_idx ON drivers(vehicle_id);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_insert" ON vehicles;
CREATE POLICY "vehicles_insert" ON vehicles FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_update" ON vehicles;
CREATE POLICY "vehicles_update" ON vehicles FOR UPDATE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_delete" ON vehicles;
CREATE POLICY "vehicles_delete" ON vehicles FOR DELETE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director());

CREATE OR REPLACE FUNCTION log_vehicle_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fleet_dept_id uuid;
BEGIN
  SELECT id INTO fleet_dept_id FROM departments WHERE slug = 'fleet';
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), fleet_dept_id, 'added a vehicle', 'vehicle', NEW.id, NEW.plate_number);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_activity_log ON vehicles;
CREATE TRIGGER vehicles_activity_log
  AFTER INSERT ON vehicles
  FOR EACH ROW EXECUTE FUNCTION log_vehicle_activity();

CREATE OR REPLACE FUNCTION log_driver_vehicle_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fleet_dept_id uuid;
  plate text;
BEGIN
  IF NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id THEN
    RETURN NEW;
  END IF;
  SELECT id INTO fleet_dept_id FROM departments WHERE slug = 'fleet';
  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT plate_number INTO plate FROM vehicles WHERE id = NEW.vehicle_id;
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), fleet_dept_id, 'assigned ' || NEW.full_name || ' to vehicle ' || COALESCE(plate, ''), 'driver', NEW.id, NEW.full_name);
  ELSE
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), fleet_dept_id, 'unassigned ' || NEW.full_name || ' from their vehicle', 'driver', NEW.id, NEW.full_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_vehicle_assignment_log ON drivers;
CREATE TRIGGER drivers_vehicle_assignment_log
  AFTER UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION log_driver_vehicle_assignment();
