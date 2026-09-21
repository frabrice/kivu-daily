/*
# Weekly owner payments are prepayments, not arrears

Confirmed with the operator: a car's weekly payout to the owner (and the
matching management margin) is paid at the START of the week it covers,
not at the end. Example: a car starting Wednesday 10 September has its
first week's payment due that same day (prepaying the week of Sep
10-16), its second week's payment due the following Wednesday 17
September (prepaying Sep 17-23), and so on - never waiting for a week
to finish before the payment that covers it is due.

sync_vehicle_obligations() had this backwards: it only counted FULLY
ELAPSED weeks (floor((today - start)/7)), so the payment for the week
currently in progress never appeared until that week was already over -
paying in arrears, one week late, exactly the opposite of the real
schedule. The fix: count the period as due the moment it starts, i.e.
floor((today - start)/7) + 1, guarded against a start date still in the
future. Applies to both the weekly owner payout and the weekly
management margin (same cycle, same cars) - the monthly management fee
and onboarding fee are untouched, this only affects the weekly ones.

This is a pure widen: existing_count-based idempotency means it only
inserts the newly-due periods that were missing, nothing is duplicated
or rewritten.
*/

CREATE OR REPLACE FUNCTION sync_vehicle_obligations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle record;
  v_equity_id uuid;
  v_im_id uuid;
  v_owner_name text;
  v_periods_due int;
  v_months_elapsed int;
  v_existing_count int;
  v_margin_amount numeric;
  v_payout_amount numeric;
  v_fee_amount numeric;
  i int;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can sync vehicle obligations';
  END IF;

  SELECT id INTO v_equity_id FROM finance_accounts WHERE key = 'equity';
  SELECT id INTO v_im_id FROM finance_accounts WHERE key = 'im_bank';
  IF v_equity_id IS NULL OR v_im_id IS NULL THEN RETURN; END IF;

  FOR v_vehicle IN SELECT * FROM vehicles WHERE owner_id IS NOT NULL AND operation_start_date IS NOT NULL LOOP
    SELECT full_name INTO v_owner_name FROM vehicle_owners WHERE id = v_vehicle.owner_id;
    v_payout_amount := COALESCE(v_vehicle.weekly_owner_payout_amount, 240000);
    v_margin_amount := 360000 - v_payout_amount;
    v_fee_amount := COALESCE(v_vehicle.monthly_management_fee_amount, 30000);

    -- Prepayment: the period starting today is already due today, not
    -- once it finishes - so it's +1 on top of the fully-elapsed count.
    IF CURRENT_DATE >= v_vehicle.operation_start_date THEN
      v_periods_due := floor((CURRENT_DATE - v_vehicle.operation_start_date) / 7)::int + 1;
    ELSE
      v_periods_due := 0;
    END IF;

    -- Weekly management margin (recognized immediately - it's already sitting in BK, not an external payment)
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'management_margin' AND linked_vehicle_id = v_vehicle.id AND system_generated = true;
    IF v_periods_due > v_existing_count AND v_margin_amount > 0 THEN
      FOR i IN v_existing_count..(v_periods_due - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('management_margin', v_equity_id, 'in', v_margin_amount, v_vehicle.operation_start_date + (i * 7),
                'Weekly management margin — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'posted', true, now());
      END LOOP;
    END IF;

    -- Weekly owner payout (a real transfer - stays pending until Finance actually pays it)
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'vehicle_owner_payment' AND linked_vehicle_id = v_vehicle.id AND system_generated = true;
    IF v_periods_due > v_existing_count THEN
      FOR i IN v_existing_count..(v_periods_due - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('vehicle_owner_payment', v_im_id, 'out', v_payout_amount, v_vehicle.operation_start_date + (i * 7),
                'Weekly owner payout — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'pending', true, now());
      END LOOP;
    END IF;

    -- Monthly management fee - unchanged: month 0 is created directly by
    -- onboard_vehicle_owner(), this picks up from month 1 once a full
    -- month has elapsed.
    v_months_elapsed := GREATEST((EXTRACT(YEAR FROM age(CURRENT_DATE, v_vehicle.operation_start_date)) * 12
      + EXTRACT(MONTH FROM age(CURRENT_DATE, v_vehicle.operation_start_date)))::int, 0);
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'revenue' AND linked_vehicle_id = v_vehicle.id AND system_generated = true
        AND description LIKE 'Monthly management fee%';
    IF v_months_elapsed > v_existing_count AND v_fee_amount > 0 THEN
      FOR i IN v_existing_count..(v_months_elapsed - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('revenue', v_equity_id, 'in', v_fee_amount, (v_vehicle.operation_start_date + (i || ' months')::interval)::date,
                'Monthly management fee — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'pending', true, now());
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
