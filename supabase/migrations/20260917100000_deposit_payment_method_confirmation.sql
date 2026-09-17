/*
# Deposit payment method + Finance confirmation

Every logged deposit now records how it was actually paid - MoMo, or
bank (with which bank) - and starts life as 'pending' until Finance
reviews and confirms it. Fleet can still log deposits (they're the
ones collecting them), but only Finance or the MD can move a deposit
from pending to confirmed - enforced through a dedicated RPC rather
than widening the general UPDATE policy, so Fleet can't self-confirm.

driver_deposits is empty at the time of this migration (cleaned up
after a testing session left stray rows), so payment_method can be
added NOT NULL with no backfill needed.
*/

ALTER TABLE driver_deposits ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'momo'
  CHECK (payment_method IN ('momo', 'bank'));
ALTER TABLE driver_deposits ALTER COLUMN payment_method DROP DEFAULT;

ALTER TABLE driver_deposits ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE driver_deposits DROP CONSTRAINT IF EXISTS driver_deposits_bank_name_matches_method;
ALTER TABLE driver_deposits ADD CONSTRAINT driver_deposits_bank_name_matches_method
  CHECK (
    (payment_method = 'bank' AND bank_name IS NOT NULL AND bank_name <> '')
    OR (payment_method = 'momo' AND bank_name IS NULL)
  );

ALTER TABLE driver_deposits ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'confirmed'));
ALTER TABLE driver_deposits ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE driver_deposits ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Finance needs to see who a deposit belongs to and confirm it.
DROP POLICY IF EXISTS "driver_deposits_select" ON driver_deposits;
CREATE POLICY "driver_deposits_select" ON driver_deposits FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it', 'finance') OR is_managing_director());

DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it', 'finance') OR is_managing_director());

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it', 'finance') OR is_managing_director());

CREATE OR REPLACE FUNCTION confirm_driver_deposit(p_deposit_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can confirm a deposit';
  END IF;

  UPDATE driver_deposits
  SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
  WHERE id = p_deposit_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_driver_deposit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION log_deposit_confirmation_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  finance_dept_id uuid;
  driver_name text;
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    SELECT id INTO finance_dept_id FROM departments WHERE slug = 'finance';
    SELECT full_name INTO driver_name FROM drivers WHERE id = NEW.driver_id;
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.confirmed_by, auth.uid()), finance_dept_id, 'confirmed a deposit for ' || COALESCE(driver_name, 'a driver'), 'driver_deposit', NEW.id, driver_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_deposits_confirmation_log ON driver_deposits;
CREATE TRIGGER driver_deposits_confirmation_log
  AFTER UPDATE ON driver_deposits
  FOR EACH ROW EXECUTE FUNCTION log_deposit_confirmation_activity();
