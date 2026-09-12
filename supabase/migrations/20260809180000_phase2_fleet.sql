/*
# Phase 2.1 - Fleet/Driver Management

## Department slugs
Department names are free-text and MD-editable, so code shouldn't match
on them directly. Adds a stable `slug` for department-aware routing/RLS.

## Drivers
Fleet department's shared driver pipeline. Call Center gets read-only
access now (Phase 2.2 needs it for their call-log-focused lookup view),
Fleet gets full read/write, MD gets everything - matching the shared
work-object model established in Phase 1.
*/

ALTER TABLE departments ADD COLUMN IF NOT EXISTS slug text;

UPDATE departments SET slug = 'it' WHERE name = 'IT';
UPDATE departments SET slug = 'marketing_sales_bd' WHERE name = 'Marketing/Sales/BD';
UPDATE departments SET slug = 'call_center' WHERE name = 'Call Center';
UPDATE departments SET slug = 'social_media' WHERE name = 'Social Media';
UPDATE departments SET slug = 'finance' WHERE name = 'Finance';
UPDATE departments SET slug = 'fleet' WHERE name = 'Fleet';
UPDATE departments SET slug = 'admin' WHERE name = 'Admin';

ALTER TABLE departments ADD CONSTRAINT departments_slug_unique UNIQUE (slug);

CREATE OR REPLACE FUNCTION current_department_slug()
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT d.slug FROM profiles p JOIN departments d ON d.id = p.department_id WHERE p.id = auth.uid();
$$;

-- ============================================================
-- DRIVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL,
  stage text NOT NULL DEFAULT 'applying' CHECK (stage IN ('applying', 'training', 'active', 'waiting', 'flagged', 'inactive')),
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drivers_stage_idx ON drivers(stage);

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center') OR is_managing_director());

DROP POLICY IF EXISTS "drivers_insert" ON drivers;
CREATE POLICY "drivers_insert" ON drivers FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "drivers_update" ON drivers;
CREATE POLICY "drivers_update" ON drivers FOR UPDATE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'fleet' OR is_managing_director());

DROP POLICY IF EXISTS "drivers_delete" ON drivers;
CREATE POLICY "drivers_delete" ON drivers FOR DELETE TO authenticated
  USING (current_department_slug() = 'fleet' OR is_managing_director());

CREATE OR REPLACE FUNCTION log_driver_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fleet_dept_id uuid;
  actor uuid := COALESCE(NEW.created_by, auth.uid());
BEGIN
  SELECT id INTO fleet_dept_id FROM departments WHERE slug = 'fleet';
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (actor, fleet_dept_id, 'added a driver', 'driver', NEW.id, NEW.full_name);
  ELSIF TG_OP = 'UPDATE' AND NEW.stage <> OLD.stage THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), fleet_dept_id, 'moved ' || NEW.full_name || ' to ' || NEW.stage, 'driver', NEW.id, NEW.full_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_activity_log ON drivers;
CREATE TRIGGER drivers_activity_log
  AFTER INSERT OR UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION log_driver_activity();
