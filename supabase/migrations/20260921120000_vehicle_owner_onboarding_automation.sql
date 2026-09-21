/*
# Vehicle owner onboarding automation

Confirmed with the operator: onboarding a vehicle owner should be one
action that automatically posts the 140,000 onboarding fee and the
first month's 30,000 management fee as PENDING - Finance or the MD
confirms each one, nothing posts itself silently. Once the onboarding
fee is confirmed, the three costs that fund it (90k device, 15k
branding, 15k uniforms) generate automatically too, also pending,
needing approval. The recurring monthly management fee (month 2
onward, via sync_vehicle_obligations) now follows the same rule -
every month needs confirming, not just the first. Only the weekly
management margin stays auto-posted, since it's not an external
payment to confirm, just recognition of money already in the accounts.

This also fixes a real gap found while building this: vehicles_update
RLS only allows fleet/call_center/it/MD, not finance - so a Finance
(non-MD) user calling AssignVehicleOwnerDrawer's direct `.update()` on
vehicles would have been silently rejected by RLS. Rather than widen
vehicles_update to finance (which would let Finance edit Fleet's
operational fields - plate, make, RURA license, etc.), the new
onboarding flow goes through a SECURITY DEFINER RPC scoped to only the
owner-relationship fields, with its own finance-or-MD check.
*/

-- ============================================================
-- ONBOARDING: link an owner to a car, post the two pending fees
-- ============================================================
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

-- ============================================================
-- Confirming the onboarding fee cascades the three costs it funds
-- ============================================================
CREATE OR REPLACE FUNCTION confirm_onboarding_fee(p_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tx finance_transactions%ROWTYPE;
  v_bk_id uuid;
  v_plate text;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can confirm an onboarding fee';
  END IF;

  SELECT * INTO v_tx FROM finance_transactions WHERE id = p_transaction_id AND type = 'onboarding_fee' AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE finance_transactions
  SET status = 'posted', checked_by = auth.uid(), checked_at = now(), updated_at = now()
  WHERE id = p_transaction_id;

  SELECT id INTO v_bk_id FROM finance_accounts WHERE key = 'bank_of_kigali';
  SELECT plate_number INTO v_plate FROM vehicles WHERE id = v_tx.linked_vehicle_id;

  IF v_bk_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finance_transactions WHERE type = 'supplier_payment' AND linked_vehicle_id = v_tx.linked_vehicle_id AND description LIKE 'Device cost%'
  ) THEN
    INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at) VALUES
      ('supplier_payment', v_bk_id, 'out', 90000, v_tx.transaction_date, 'Device cost — ' || v_plate, v_tx.counterparty, v_tx.linked_vehicle_id, 'pending', true, now()),
      ('supplier_payment', v_bk_id, 'out', 15000, v_tx.transaction_date, 'Branding cost — ' || v_plate, v_tx.counterparty, v_tx.linked_vehicle_id, 'pending', true, now()),
      ('supplier_payment', v_bk_id, 'out', 15000, v_tx.transaction_date, 'Uniforms (2 drivers) — ' || v_plate, v_tx.counterparty, v_tx.linked_vehicle_id, 'pending', true, now());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_onboarding_fee(uuid) TO authenticated;

-- ============================================================
-- Generic one-click approval for a pending transaction (the onboarding
-- costs, and the recurring monthly management fee) - same shape as
-- confirm_driver_deposit / mark_vehicle_owner_payment_paid, just
-- without any further cascade.
-- ============================================================
CREATE OR REPLACE FUNCTION approve_pending_transaction(p_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can approve a transaction';
  END IF;

  UPDATE finance_transactions
  SET status = 'posted', checked_by = auth.uid(), checked_at = now(), updated_at = now()
  WHERE id = p_transaction_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION approve_pending_transaction(uuid) TO authenticated;

-- ============================================================
-- The recurring monthly management fee now posts as 'pending' too,
-- matching the owner payout's existing behaviour, instead of posting
-- itself immediately with no review.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_vehicle_obligations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle record;
  v_equity_id uuid;
  v_im_id uuid;
  v_owner_name text;
  v_weeks_elapsed int;
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
    v_weeks_elapsed := GREATEST(floor((CURRENT_DATE - v_vehicle.operation_start_date) / 7)::int, 0);

    -- Weekly management margin (recognized immediately - it's already sitting in BK, not an external payment)
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'management_margin' AND linked_vehicle_id = v_vehicle.id AND system_generated = true;
    IF v_weeks_elapsed > v_existing_count AND v_margin_amount > 0 THEN
      FOR i IN v_existing_count..(v_weeks_elapsed - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('management_margin', v_equity_id, 'in', v_margin_amount, v_vehicle.operation_start_date + (i * 7),
                'Weekly management margin — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'posted', true, now());
      END LOOP;
    END IF;

    -- Weekly owner payout (a real transfer - stays pending until Finance actually pays it)
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'vehicle_owner_payment' AND linked_vehicle_id = v_vehicle.id AND system_generated = true;
    IF v_weeks_elapsed > v_existing_count THEN
      FOR i IN v_existing_count..(v_weeks_elapsed - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_vehicle_id, status, system_generated, created_at)
        VALUES ('vehicle_owner_payment', v_im_id, 'out', v_payout_amount, v_vehicle.operation_start_date + (i * 7),
                'Weekly owner payout — ' || v_vehicle.plate_number, v_owner_name, v_vehicle.id, 'pending', true, now());
      END LOOP;
    END IF;

    -- Monthly management fee - a real payment owed by the owner, so it
    -- now stays pending until confirmed, same as the payout above.
    -- Month 0 is created directly by onboard_vehicle_owner(), so this
    -- picks up from month 1 the first time it finds one already there.
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
