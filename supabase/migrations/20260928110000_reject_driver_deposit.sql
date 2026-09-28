/*
# Finance/MD can reject and delete a mistaken deposit

Confirmed with the operator: on the Deposit Confirmations page, Finance
and the MD need an option next to "Confirm" for a deposit that isn't
real - logged by mistake, a duplicate, or otherwise untrue - to reject
it and remove it outright, not just leave it sitting pending forever.

Scoped to still-pending deposits only, matching confirm_driver_deposit's
own scope - a deposit already confirmed represents money Finance has
already verified as received, which is a different, far more
consequential action than catching a mistake before it's confirmed.
Deleting the driver_deposits row correctly cascades to remove its
mirrored fleet_collection finance_transactions row too, via the
source_deposit_id link fixed in the previous migration - no orphaned
Finance record left behind. Logged to activity_log (with the optional
reason, if given) before the row disappears, so there's still a record
of what was rejected and why.
*/

CREATE OR REPLACE FUNCTION reject_driver_deposit(p_deposit_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver_id uuid;
  v_driver_name text;
  v_finance_dept_id uuid;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can reject a deposit';
  END IF;

  SELECT driver_id INTO v_driver_id FROM driver_deposits WHERE id = p_deposit_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  SELECT full_name INTO v_driver_name FROM drivers WHERE id = v_driver_id;
  SELECT id INTO v_finance_dept_id FROM departments WHERE slug = 'finance';

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (
    auth.uid(), v_finance_dept_id,
    'rejected and deleted a deposit for ' || COALESCE(v_driver_name, 'a driver') || COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
    'driver_deposit', p_deposit_id, v_driver_name
  );

  DELETE FROM driver_deposits WHERE id = p_deposit_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_driver_deposit(uuid, text) TO authenticated;
