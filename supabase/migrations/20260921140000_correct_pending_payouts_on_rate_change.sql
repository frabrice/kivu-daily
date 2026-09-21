/*
# Correcting a car's payout rate must correct what's already on the books

Confirmed with the operator: the daily/weekly payout rate on a car is a
fixed fee for that car - if it turns out to be 270,000/week instead of
the 240,000 default, every week already sitting on the books for that
car should read 270,000 too, not just weeks generated after the
correction. Editing the rate on SetVehicleStartDateDrawer (or
OnboardVehicleOwnerDrawer) currently only updates the vehicle row -
sync_vehicle_obligations() only ever *inserts* new periods, it never
revisits ones already generated, so past weeks silently kept the old
number.

Fix: onboard_vehicle_owner() now also corrects existing rows for that
vehicle when the rate changes, split by what's safe to touch:
  - vehicle_owner_payment: only rows still 'pending' (not yet actually
    paid) get corrected. A row already 'posted' means Finance already
    sent that exact amount - that's real history, not editable.
  - management_margin: corrected regardless of status, since 'posted'
    here just means "recognized", not "money left the company" - it's
    pure bookkeeping on money already sitting in BK, so it's safe (and
    necessary, to keep the books internally consistent - margin +
    payout must still add up to the week's 360,000 collection target).
  - the monthly management fee (the 'revenue' row Finance sees): only
    'pending' rows get corrected, same reasoning as the weekly payout.
Every correction is scoped to system_generated = true so a manually
logged revenue/expense entry is never touched by accident.
*/

CREATE OR REPLACE FUNCTION onboard_vehicle_owner(
  p_vehicle_id uuid,
  p_owner_id uuid,
  p_operation_start_date date,
  p_weekly_owner_payout numeric DEFAULT NULL,
  p_monthly_management_fee numeric DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bk_id uuid;
  v_equity_id uuid;
  v_owner_name text;
  v_plate text;
  v_monthly_fee numeric := COALESCE(p_monthly_management_fee, 30000);
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can onboard a vehicle owner';
  END IF;

  SELECT id INTO v_bk_id FROM finance_accounts WHERE key = 'bank_of_kigali';
  SELECT id INTO v_equity_id FROM finance_accounts WHERE key = 'equity';
  SELECT full_name INTO v_owner_name FROM vehicle_owners WHERE id = p_owner_id;
  SELECT plate_number INTO v_plate FROM vehicles WHERE id = p_vehicle_id;

  UPDATE vehicles SET
    owner_id = p_owner_id,
    operation_start_date = p_operation_start_date,
    weekly_owner_payout_amount = p_weekly_owner_payout,
    monthly_management_fee_amount = p_monthly_management_fee,
    updated_at = now()
  WHERE id = p_vehicle_id;

  -- Correct what's already on the books for this vehicle to the new rate.
  IF p_weekly_owner_payout IS NOT NULL THEN
    UPDATE finance_transactions
    SET amount = p_weekly_owner_payout, updated_at = now()
    WHERE type = 'vehicle_owner_payment' AND linked_vehicle_id = p_vehicle_id
      AND status = 'pending' AND system_generated = true;

    UPDATE finance_transactions
    SET amount = GREATEST(360000 - p_weekly_owner_payout, 0), updated_at = now()
    WHERE type = 'management_margin' AND linked_vehicle_id = p_vehicle_id
      AND system_generated = true;
  END IF;

  IF p_monthly_management_fee IS NOT NULL THEN
    UPDATE finance_transactions
    SET amount = p_monthly_management_fee, updated_at = now()
    WHERE type = 'revenue' AND linked_vehicle_id = p_vehicle_id
      AND status = 'pending' AND system_generated = true
      AND description LIKE 'Monthly management fee%';
  END IF;

  IF v_bk_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finance_transactions WHERE type = 'onboarding_fee' AND linked_vehicle_id = p_vehicle_id
  ) THEN
    INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
    VALUES ('onboarding_fee', v_bk_id, 'in', 140000, p_operation_start_date, 'Onboarding fee — ' || v_plate, v_owner_name, p_vehicle_id, 'pending', true, now());
  END IF;

  IF v_equity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finance_transactions WHERE type = 'revenue' AND linked_vehicle_id = p_vehicle_id AND description LIKE 'Monthly management fee%'
  ) THEN
    INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
    VALUES ('revenue', v_equity_id, 'in', v_monthly_fee, p_operation_start_date, 'Monthly management fee — ' || v_plate, v_owner_name, p_vehicle_id, 'pending', true, now());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION onboard_vehicle_owner(uuid, uuid, date, numeric, numeric) TO authenticated;
