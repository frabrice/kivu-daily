/*
# Driver "Join Date" becomes "Start Date" - the real scheduling anchor

Confirmed with the operator: join_date is renamed to start_date and
becomes the anchor for BOTH the weekly deposit cycle and the monthly
driver payroll cycle - previously both counted from initial_deposit_date
instead. initial_deposit_date stays exactly as it was, but narrows to
what it's actually for: confirming, for accounting/reconciliation, that
deposit money really arrived - it no longer drives any scheduling.

Real data checked before this migration: every real driver already has
start_date (formerly join_date) populated, several days to weeks before
their initial_deposit_date where that's set, and a few 'raw'-stage
drivers have a start_date but haven't paid a deposit at all yet - those
will now correctly start showing as overdue on their weekly deposit
from their actual start date, instead of showing no cycle at all until
they eventually pay. That's the intended effect of this change, not a
side effect to guard against.

sync_driver_payroll() keeps requiring initial_deposit_paid = true as
the payroll eligibility gate (unchanged, conservative choice - only the
date used to COUNT the monthly cycle changes) - the operator's message
was specifically about which date the schedule counts from, not about
removing the deposit-paid requirement for being on payroll at all.
*/

ALTER TABLE drivers RENAME COLUMN join_date TO start_date;

CREATE OR REPLACE FUNCTION sync_driver_payroll()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver record;
  v_im_id uuid;
  v_months_elapsed int;
  v_existing_count int;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can sync driver payroll';
  END IF;

  SELECT id INTO v_im_id FROM finance_accounts WHERE key = 'im_bank';
  IF v_im_id IS NULL THEN RETURN; END IF;

  FOR v_driver IN
    SELECT * FROM drivers
    WHERE initial_deposit_paid = true AND start_date IS NOT NULL AND contract_status = 'active'
  LOOP
    v_months_elapsed := GREATEST((EXTRACT(YEAR FROM age(CURRENT_DATE, v_driver.start_date)) * 12
      + EXTRACT(MONTH FROM age(CURRENT_DATE, v_driver.start_date)))::int, 0);
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'driver_payroll' AND linked_driver_id = v_driver.id AND system_generated = true;
    IF v_months_elapsed > v_existing_count THEN
      FOR i IN v_existing_count..(v_months_elapsed - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_driver_id, status, system_generated, created_at)
        VALUES ('driver_payroll', v_im_id, 'out', 150000, (v_driver.start_date + ((i + 1) || ' months')::interval)::date,
                'Driver payroll — ' || v_driver.full_name, v_driver.full_name, v_driver.id, 'pending', true, now());
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
