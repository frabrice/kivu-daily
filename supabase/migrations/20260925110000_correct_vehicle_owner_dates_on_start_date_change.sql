/*
# A vehicle's start date correction must correct dates already on the books too

Confirmed with the operator: onboarding fee, management fees and weekly
owner payouts/margin must always be dated by the car's real
operation_start_date, never by the day Finance happened to click
"onboard" or "confirm" - a car that started 10 September but only got
entered into the system on 25 September should show its onboarding fee
and first week's payout dated 10 September, not 25.

sync_vehicle_obligations()/onboard_vehicle_owner() already date new rows
correctly off operation_start_date. The gap: SetVehicleStartDateDrawer
lets Finance correct a vehicle's operation_start_date AFTER some periods
were already generated under the old (often today-defaulted) date -
20260921140000_correct_pending_payouts_on_rate_change.sql already
re-corrects the AMOUNT on existing rows when the rate changes, but never
touched the DATE. Real production data confirms the resulting drift:

  RAK 239 L / RAK 238 L: operation_start_date corrected to Sep 24, but
  onboarding fee, first month's fee and first week's payout/margin are
  all still dated Sep 25 (today, when they were first generated before
  the correction).
  RAK 676 J: first week's payout/margin dated Sep 11 instead of Sep 10.
  RAK 679 J: first TWO weeks dated Sep 7 / Sep 14 instead of Sep 10 / Sep 17
  (the anchor was corrected forward from Sep 7 to Sep 10 after those had
  already been generated).
  RAK 678 J: first week dated Sep 9 instead of Sep 10.

The pattern: existing_count-based idempotency in sync_vehicle_obligations()
only decides whether to generate the NEXT period - it never revisits a
period's date once written, so any period generated before a start-date
correction keeps the stale date forever, even though every period
generated AFTER the correction already self-corrects (since it's dated
off the current, corrected anchor).

Fix, mirroring the amount-correction's own reasoning: onboard_vehicle_owner()
now also re-dates every one of a vehicle's own onboarding/weekly/monthly
rows to line up with the (possibly just-corrected) operation_start_date -
each row's rank among that vehicle's own rows (oldest first) is its
week/month index, which is preserved; only which calendar date that index
maps to changes. Unlike the amount correction, this applies regardless of
status (including already-posted rows) - the user was explicit that these
must be dated by the start date "irrespective of the date of confirmation",
and transaction_date here has always meant "the period this obligation is
for", not "the day money physically moved" (there's no separate paid-date
column for these types the way driver_deposits has its own paid_date).
A one-time backfill below applies the same correction to what's already
on the books today.
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

  -- Correct amounts already on the books for this vehicle to the new rate.
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

  -- Correct dates already on the books too, regardless of status - see
  -- migration header. onboarding_fee is a single row, just re-anchor it
  -- directly; the weekly/monthly types are re-ranked by their own
  -- existing order (oldest first) so each keeps its week/month index,
  -- only the calendar date that index maps to moves.
  UPDATE finance_transactions
  SET transaction_date = p_operation_start_date, updated_at = now()
  WHERE type = 'onboarding_fee' AND linked_vehicle_id = p_vehicle_id
    AND system_generated = true AND transaction_date <> p_operation_start_date;

  WITH ranked AS (
    SELECT id, (row_number() OVER (ORDER BY transaction_date, created_at) - 1)::int AS idx
    FROM finance_transactions
    WHERE type = 'vehicle_owner_payment' AND linked_vehicle_id = p_vehicle_id AND system_generated = true
  )
  UPDATE finance_transactions ft
  SET transaction_date = p_operation_start_date + (ranked.idx * 7), updated_at = now()
  FROM ranked
  WHERE ft.id = ranked.id AND ft.transaction_date <> p_operation_start_date + (ranked.idx * 7);

  WITH ranked AS (
    SELECT id, (row_number() OVER (ORDER BY transaction_date, created_at) - 1)::int AS idx
    FROM finance_transactions
    WHERE type = 'management_margin' AND linked_vehicle_id = p_vehicle_id AND system_generated = true
  )
  UPDATE finance_transactions ft
  SET transaction_date = p_operation_start_date + (ranked.idx * 7), updated_at = now()
  FROM ranked
  WHERE ft.id = ranked.id AND ft.transaction_date <> p_operation_start_date + (ranked.idx * 7);

  WITH ranked AS (
    SELECT id, (row_number() OVER (ORDER BY transaction_date, created_at) - 1)::int AS idx
    FROM finance_transactions
    WHERE type = 'revenue' AND linked_vehicle_id = p_vehicle_id AND system_generated = true
      AND description LIKE 'Monthly management fee%'
  )
  UPDATE finance_transactions ft
  SET transaction_date = (p_operation_start_date + (ranked.idx || ' months')::interval)::date, updated_at = now()
  FROM ranked
  WHERE ft.id = ranked.id AND ft.transaction_date <> (p_operation_start_date + (ranked.idx || ' months')::interval)::date;

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

-- ============================================================
-- One-time backfill: apply the same re-ranking correction to every
-- vehicle already onboarded, fixing the drift already on the books
-- (found on RAK 239 L, RAK 238 L, RAK 676 J, RAK 679 J, RAK 678 J).
-- ============================================================
UPDATE finance_transactions ft
SET transaction_date = v.operation_start_date, updated_at = now()
FROM vehicles v
WHERE ft.type = 'onboarding_fee' AND ft.linked_vehicle_id = v.id
  AND ft.system_generated = true AND v.operation_start_date IS NOT NULL
  AND ft.transaction_date <> v.operation_start_date;

WITH ranked AS (
  SELECT ft.id, v.operation_start_date AS anchor,
         (row_number() OVER (PARTITION BY ft.linked_vehicle_id ORDER BY ft.transaction_date, ft.created_at) - 1)::int AS idx
  FROM finance_transactions ft
  JOIN vehicles v ON v.id = ft.linked_vehicle_id
  WHERE ft.type = 'vehicle_owner_payment' AND ft.system_generated = true AND v.operation_start_date IS NOT NULL
)
UPDATE finance_transactions ft
SET transaction_date = ranked.anchor + (ranked.idx * 7), updated_at = now()
FROM ranked
WHERE ft.id = ranked.id AND ft.transaction_date <> ranked.anchor + (ranked.idx * 7);

WITH ranked AS (
  SELECT ft.id, v.operation_start_date AS anchor,
         (row_number() OVER (PARTITION BY ft.linked_vehicle_id ORDER BY ft.transaction_date, ft.created_at) - 1)::int AS idx
  FROM finance_transactions ft
  JOIN vehicles v ON v.id = ft.linked_vehicle_id
  WHERE ft.type = 'management_margin' AND ft.system_generated = true AND v.operation_start_date IS NOT NULL
)
UPDATE finance_transactions ft
SET transaction_date = ranked.anchor + (ranked.idx * 7), updated_at = now()
FROM ranked
WHERE ft.id = ranked.id AND ft.transaction_date <> ranked.anchor + (ranked.idx * 7);

WITH ranked AS (
  SELECT ft.id, v.operation_start_date AS anchor,
         (row_number() OVER (PARTITION BY ft.linked_vehicle_id ORDER BY ft.transaction_date, ft.created_at) - 1)::int AS idx
  FROM finance_transactions ft
  JOIN vehicles v ON v.id = ft.linked_vehicle_id
  WHERE ft.type = 'revenue' AND ft.system_generated = true AND ft.description LIKE 'Monthly management fee%'
    AND v.operation_start_date IS NOT NULL
)
UPDATE finance_transactions ft
SET transaction_date = (ranked.anchor + (ranked.idx || ' months')::interval)::date, updated_at = now()
FROM ranked
WHERE ft.id = ranked.id AND ft.transaction_date <> (ranked.anchor + (ranked.idx || ' months')::interval)::date;
