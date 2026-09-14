/*
# Fine payments

A fine isn't always settled in one go, so this tracks payments against
a fine the same way driver_deposits tracks deposit payments - one row
per payment, summed up in the app to get how much of a fine has been
paid and how much is still owed. Whether a fine reads as unpaid,
partially paid, or fully paid is derived from that sum, not stored.

Mirrors driver_fines' current RLS shape (fleet + call_center + it, or
the MD) since paying a fine is the same Fleet-operations action as
logging it in the first place.
*/

CREATE TABLE IF NOT EXISTS driver_fine_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_id uuid NOT NULL REFERENCES driver_fines(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  paid_date date NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_fine_payments_fine_idx ON driver_fine_payments(fine_id, paid_date DESC);

ALTER TABLE driver_fine_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_fine_payments_select" ON driver_fine_payments;
CREATE POLICY "driver_fine_payments_select" ON driver_fine_payments FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fine_payments_insert" ON driver_fine_payments;
CREATE POLICY "driver_fine_payments_insert" ON driver_fine_payments FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fine_payments_update" ON driver_fine_payments;
CREATE POLICY "driver_fine_payments_update" ON driver_fine_payments FOR UPDATE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_fine_payments_delete" ON driver_fine_payments;
CREATE POLICY "driver_fine_payments_delete" ON driver_fine_payments FOR DELETE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

CREATE OR REPLACE FUNCTION log_fine_payment_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fleet_dept_id uuid;
  driver_name text;
BEGIN
  SELECT id INTO fleet_dept_id FROM departments WHERE slug = 'fleet';
  SELECT d.full_name INTO driver_name FROM driver_fines f JOIN drivers d ON d.id = f.driver_id WHERE f.id = NEW.fine_id;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (COALESCE(NEW.created_by, auth.uid()), fleet_dept_id, 'logged a fine payment for ' || COALESCE(driver_name, 'a driver'), 'driver_fine_payment', NEW.id, driver_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_fine_payments_activity_log ON driver_fine_payments;
CREATE TRIGGER driver_fine_payments_activity_log
  AFTER INSERT ON driver_fine_payments
  FOR EACH ROW EXECUTE FUNCTION log_fine_payment_activity();
