/*
# Finance references: stop the OTH clash (19 Nov 2026)

The 1 Nov migration (finance_adjustments) rewrote finance_type_prefix() to
add ADJ and dropped ONB (onboarding_fee) and MGN (management_margin) by
mistake, so both fell to "OTH" - the prefix driver_payroll already uses.
Each type keeps its own counter, so a new owner's onboarding fee and the
first November margin both tried OTH-2026-11-001, which driver payroll had
taken: "duplicate key value violates unique constraint
finance_transactions_reference_key". Creating a vehicle owner failed, and
sync_vehicle_obligations() (weekly margin, weekly owner payout, monthly fee)
rolled back whole on every run, so none of those were recorded for November.

1. ONB and MGN are back.
2. generate_finance_reference() never hands out a reference already in use:
   it moves the counter on until the reference is free. Two types sharing a
   prefix (driver_payroll, app_commission and other still share OTH) can no
   longer clash.
3. Numbers past 999 in a month are no longer cut to 3 digits.

The next time Finance opens, sync_vehicle_obligations() records the November
rows it missed (dated on their real due dates), as it was designed to.
*/

CREATE OR REPLACE FUNCTION finance_type_prefix(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'revenue' THEN 'REV'
    WHEN 'fleet_collection' THEN 'DRV'
    WHEN 'vehicle_owner_payment' THEN 'OWN'
    WHEN 'payroll' THEN 'PAY'
    WHEN 'supplier_payment' THEN 'SUP'
    WHEN 'transfer' THEN 'TRF'
    WHEN 'expense_claim' THEN 'EXP'
    WHEN 'onboarding_fee' THEN 'ONB'
    WHEN 'management_margin' THEN 'MGN'
    WHEN 'adjustment' THEN 'ADJ'
    ELSE 'OTH'
  END;
$$;

CREATE OR REPLACE FUNCTION generate_finance_reference(p_type text, p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ym text := to_char(p_date, 'YYYY-MM');
  v_seq integer;
  v_ref text;
BEGIN
  LOOP
    INSERT INTO finance_reference_counters (type, year_month, next_seq)
    VALUES (p_type, v_ym, 2)
    ON CONFLICT (type, year_month) DO UPDATE SET next_seq = finance_reference_counters.next_seq + 1
    RETURNING next_seq - 1 INTO v_seq;
    v_ref := finance_type_prefix(p_type) || '-' || v_ym || '-' || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0');
    -- A reference already used (another type with the same prefix, or one
    -- typed by hand) is skipped, never handed out twice.
    EXIT WHEN NOT EXISTS (SELECT 1 FROM finance_transactions WHERE reference = v_ref);
  END LOOP;
  RETURN v_ref;
END;
$$;
