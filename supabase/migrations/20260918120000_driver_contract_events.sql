/*
# Driver contract end / reactivation

A driver's stage already has 'inactive', but that alone doesn't say
WHY someone stopped driving for Kivu Ride or WHEN, and gives no way to
bring them back with a record of why. driver_contract_events is an
append-only log (mirrors driver_deposits/driver_fine_payments) - one
row per "Ended Contract" or "Reactivated" action, each with its own
reason, optional free-text detail, and an effective date the staff
member chooses (not necessarily today).

drivers.contract_status is the derived current state, kept in sync by
the app whenever it writes an event, so the Pipeline can filter/badge
on it without joining the event log every time. Ending a contract also
moves the driver's stage to 'inactive' and reactivating moves it back
to 'active', so the existing stage-based Kanban view stays consistent
with the richer contract history sitting behind it.
*/

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS contract_status text NOT NULL DEFAULT 'active'
  CHECK (contract_status IN ('active', 'ended'));

CREATE TABLE IF NOT EXISTS driver_contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('ended', 'reactivated')),
  reason text NOT NULL,
  details text,
  event_date date NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_contract_events_driver_idx ON driver_contract_events(driver_id, event_date DESC);

ALTER TABLE driver_contract_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_contract_events_select" ON driver_contract_events;
CREATE POLICY "driver_contract_events_select" ON driver_contract_events FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_contract_events_insert" ON driver_contract_events;
CREATE POLICY "driver_contract_events_insert" ON driver_contract_events FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_contract_events_update" ON driver_contract_events;
CREATE POLICY "driver_contract_events_update" ON driver_contract_events FOR UPDATE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_contract_events_delete" ON driver_contract_events;
CREATE POLICY "driver_contract_events_delete" ON driver_contract_events FOR DELETE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

CREATE OR REPLACE FUNCTION log_contract_event_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fleet_dept_id uuid;
  driver_name text;
  action_text text;
BEGIN
  SELECT id INTO fleet_dept_id FROM departments WHERE slug = 'fleet';
  SELECT full_name INTO driver_name FROM drivers WHERE id = NEW.driver_id;
  action_text := CASE WHEN NEW.event_type = 'ended' THEN 'ended the contract for ' ELSE 'reactivated ' END || COALESCE(driver_name, 'a driver');
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (COALESCE(NEW.created_by, auth.uid()), fleet_dept_id, action_text, 'driver_contract_event', NEW.id, driver_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_contract_events_activity_log ON driver_contract_events;
CREATE TRIGGER driver_contract_events_activity_log
  AFTER INSERT ON driver_contract_events
  FOR EACH ROW EXECUTE FUNCTION log_contract_event_activity();
