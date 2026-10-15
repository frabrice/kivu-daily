/*
# Legal documents, switching shifts mid-contract, both-shift salary (MD, 15 Oct 2026)

1. Salary: a driver on both shifts earns 300,000 a month (one shift: 150,000).
   sync_driver_payroll() now pays by the driver's rate at the start of each
   salary month, counts months from the CURRENT contract's start (a renewed
   contract no longer waits for the old contract's salary count), and
   includes renewed drivers whose only payment so far is carried credit.

2. Switching shifts mid-contract: drivers.rate_history keeps the daily rate
   from each date ([{from, daily}]), so a driver moving to both shifts pays
   60,000 a day only from the switch date - past days keep their old rate.
   change_driver_shift() does it in one step: seat check, rate history,
   a 'shift_changed' contract event with the agreed terms, and the
   prepayment recorded as a pending deposit for Finance to confirm.

3. Legal documents (contract_documents, private bucket 'legal-docs'):
   - driver_contract: signed AND stamped, required for every hired driver,
     for the current contract (period_start = drivers.start_date)
   - driver_contract_amendment: signed AND stamped, required when switching shifts
   - driver_termination_letter: required for every ended contract (one per 'ended' event)
   - owner_management_agreement: signed AND stamped, required for every vehicle owner
   Missing ones show red in the app and become tasks (see smartTasks.ts).
*/

-- ---------------------------------------------------------------- rate history
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rate_history jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN drivers.rate_history IS 'Daily rate from each date within the current contract: [{"from":"YYYY-MM-DD","daily":60000}]. Empty = rate from shift.';

CREATE OR REPLACE FUNCTION driver_daily_rate_on(p_driver drivers, p_day date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (e->>'daily')::numeric FROM jsonb_array_elements(p_driver.rate_history) e WHERE (e->>'from')::date <= p_day ORDER BY (e->>'from')::date DESC LIMIT 1),
    (SELECT (e->>'daily')::numeric FROM jsonb_array_elements(p_driver.rate_history) e ORDER BY (e->>'from')::date ASC LIMIT 1),
    CASE WHEN p_driver.shift = 'full' THEN 60000 ELSE 30000 END)
$$;
REVOKE EXECUTE ON FUNCTION driver_daily_rate_on(drivers, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION driver_daily_rate_on(drivers, date) TO authenticated, service_role;

ALTER TABLE driver_contract_events DROP CONSTRAINT IF EXISTS driver_contract_events_event_type_check;
ALTER TABLE driver_contract_events ADD CONSTRAINT driver_contract_events_event_type_check CHECK (event_type IN ('ended', 'reactivated', 'renewed', 'shift_changed'));

-- ---------------------------------------------------------------- salary
CREATE OR REPLACE FUNCTION sync_driver_payroll()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_im_id uuid;
  v_months_elapsed int;
  v_existing_count int;
  v_period_start date;
  v_amount numeric;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can sync driver payroll';
  END IF;

  SELECT id INTO v_im_id FROM finance_accounts WHERE key = 'im_bank';
  IF v_im_id IS NULL THEN RETURN; END IF;

  FOR v_driver IN
    SELECT * FROM drivers
    WHERE (initial_deposit_paid = true OR opening_credit > 0) AND start_date IS NOT NULL AND contract_status = 'active'
  LOOP
    v_months_elapsed := GREATEST((EXTRACT(YEAR FROM age(CURRENT_DATE, v_driver.start_date)) * 12
      + EXTRACT(MONTH FROM age(CURRENT_DATE, v_driver.start_date)))::int, 0);
    -- Only this contract's salaries (dated after its start) count.
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'driver_payroll' AND linked_driver_id = v_driver.id AND system_generated = true
        AND transaction_date > v_driver.start_date;
    IF v_months_elapsed > v_existing_count THEN
      FOR i IN v_existing_count..(v_months_elapsed - 1) LOOP
        v_period_start := (v_driver.start_date + (i || ' months')::interval)::date;
        -- Both shifts (60,000 a day) earns 300,000; one shift 150,000.
        v_amount := CASE WHEN driver_daily_rate_on(v_driver, v_period_start) >= 60000 THEN 300000 ELSE 150000 END;
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_driver_id, status, system_generated, created_at)
        VALUES ('driver_payroll', v_im_id, 'out', v_amount, (v_driver.start_date + ((i + 1) || ' months')::interval)::date,
                'Driver payroll — ' || v_driver.full_name || CASE WHEN v_amount = 300000 THEN ' (both shifts)' ELSE '' END,
                v_driver.full_name, v_driver.id, 'pending', true, now());
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------- legal documents
CREATE TABLE IF NOT EXISTS contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('driver_contract', 'driver_contract_amendment', 'driver_termination_letter', 'owner_management_agreement')),
  driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES vehicle_owners(id) ON DELETE CASCADE,
  contract_event_id uuid REFERENCES driver_contract_events(id) ON DELETE SET NULL,
  period_start date,
  document_date date NOT NULL,
  signed boolean NOT NULL DEFAULT false,
  stamped boolean NOT NULL DEFAULT false,
  delivered_how text,
  file_path text NOT NULL,
  file_name text NOT NULL,
  notes text,
  uploaded_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((driver_id IS NOT NULL) <> (owner_id IS NOT NULL)),
  CHECK ((kind = 'owner_management_agreement') = (owner_id IS NOT NULL)),
  -- Contracts, amendments and agreements only count when signed and stamped.
  CHECK (kind = 'driver_termination_letter' OR (signed AND stamped))
);
CREATE INDEX IF NOT EXISTS contract_documents_driver_idx ON contract_documents (driver_id, kind);
CREATE INDEX IF NOT EXISTS contract_documents_owner_idx ON contract_documents (owner_id);
ALTER TABLE contract_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_documents_select ON contract_documents;
CREATE POLICY contract_documents_select ON contract_documents FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance'));
DROP POLICY IF EXISTS contract_documents_insert ON contract_documents;
CREATE POLICY contract_documents_insert ON contract_documents FOR INSERT TO authenticated
  WITH CHECK (is_managing_director()
    OR (owner_id IS NULL AND current_department_slug() IN ('fleet', 'it'))
    OR (owner_id IS NOT NULL AND current_department_slug() = 'finance'));
DROP POLICY IF EXISTS contract_documents_delete ON contract_documents;
CREATE POLICY contract_documents_delete ON contract_documents FOR DELETE TO authenticated USING (is_managing_director());

INSERT INTO storage.buckets (id, name, public) VALUES ('legal-docs', 'legal-docs', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "legal_docs_select" ON storage.objects;
CREATE POLICY "legal_docs_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'legal-docs' AND (is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance')));
DROP POLICY IF EXISTS "legal_docs_insert" ON storage.objects;
CREATE POLICY "legal_docs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'legal-docs' AND (is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance')));

-- ---------------------------------------------------------------- contract actions now return the event id
DROP FUNCTION IF EXISTS end_driver_contract(jsonb);
CREATE FUNCTION end_driver_contract(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_event uuid;
BEGIN
  SELECT * INTO v_driver FROM drivers WHERE id = (p->>'driver_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.contract_status = 'ended' THEN RAISE EXCEPTION 'This contract has already ended'; END IF;
  INSERT INTO driver_contract_events (driver_id, event_type, reason, reason_key, details, event_date, meta, created_by)
  VALUES (v_driver.id, 'ended', p->>'reason', p->>'reason_key', NULLIF(p->>'details', ''), (p->>'event_date')::date,
          COALESCE(p->'meta', '{}'::jsonb) || jsonb_build_object('vehicle_id', v_driver.vehicle_id, 'shift', v_driver.shift, 'start_date', v_driver.start_date),
          auth.uid())
  RETURNING id INTO v_event;
  UPDATE drivers SET contract_status = 'ended', stage = 'inactive', vehicle_id = NULL, shift = NULL, updated_at = now() WHERE id = v_driver.id;
  RETURN v_event;
END $$;

DROP FUNCTION IF EXISTS renew_driver_contract(jsonb);
CREATE FUNCTION renew_driver_contract(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_last_end date;
  v_event uuid;
  v_first numeric := NULLIF(p->>'first_payment', '')::numeric;
  v_credit numeric := COALESCE(NULLIF(p->>'opening_credit', '')::numeric, 0);
  v_vehicle uuid := NULLIF(p->>'vehicle_id', '')::uuid;
  v_shift text := NULLIF(p->>'shift', '');
BEGIN
  SELECT * INTO v_driver FROM drivers WHERE id = (p->>'driver_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.contract_status <> 'ended' THEN RAISE EXCEPTION 'Only an ended contract can be renewed'; END IF;
  IF (p->>'start_date') IS NULL THEN RAISE EXCEPTION 'Pick the new start date'; END IF;
  IF v_vehicle IS NOT NULL AND v_shift IS NULL THEN RAISE EXCEPTION 'Pick a shift for the car'; END IF;
  SELECT max(event_date) INTO v_last_end FROM driver_contract_events WHERE driver_id = v_driver.id AND event_type = 'ended';

  INSERT INTO driver_contract_events (driver_id, event_type, reason, reason_key, details, event_date, meta, created_by)
  VALUES (v_driver.id, 'renewed', p->>'reason', p->>'reason_key', NULLIF(p->>'details', ''), (p->>'start_date')::date,
          jsonb_build_object(
            'previous_start', v_driver.start_date, 'previous_end', v_last_end,
            'first_payment', v_first, 'first_payment_date', p->>'first_payment_date', 'opening_credit', v_credit,
            'vehicle_id', v_vehicle, 'shift', v_shift, 'rest_day', p->>'rest_day',
            'changes', COALESCE(p->'changes', '[]'::jsonb), 'agreed_next_payment', p->>'agreed_next_payment'),
          auth.uid())
  RETURNING id INTO v_event;

  UPDATE drivers SET
    contract_status = 'active',
    stage = 'ready',
    start_date = (p->>'start_date')::date,
    payments_from = COALESCE(v_last_end + 1, (p->>'start_date')::date),
    opening_credit = v_credit,
    rate_history = '[]'::jsonb,
    initial_deposit_paid = v_first IS NOT NULL AND v_first > 0,
    initial_deposit_amount = CASE WHEN v_first IS NOT NULL AND v_first > 0 THEN v_first END,
    initial_deposit_date = CASE WHEN v_first IS NOT NULL AND v_first > 0 THEN COALESCE(NULLIF(p->>'first_payment_date', '')::date, (p->>'start_date')::date) END,
    vehicle_id = v_vehicle,
    shift = CASE WHEN v_vehicle IS NULL THEN NULL ELSE v_shift END,
    rest_day = COALESCE(NULLIF(p->>'rest_day', ''), v_driver.rest_day),
    updated_at = now()
  WHERE id = v_driver.id;
  RETURN v_event;
END $$;

-- Switch an active driver between one shift and both shifts from a date.
-- p: driver_id, effective_date, new_shift, rest_day?, prepayment {amount, paid_date, payment_method, bank_name}?,
--    agreed_pay_by?, terms (text[]), details
CREATE OR REPLACE FUNCTION change_driver_shift(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_driver drivers%ROWTYPE;
  v_eff date := (p->>'effective_date')::date;
  v_new text := p->>'new_shift';
  v_old_rate numeric;
  v_new_rate numeric;
  v_history jsonb;
  v_event uuid;
  v_pre jsonb := p->'prepayment';
BEGIN
  SELECT * INTO v_driver FROM drivers WHERE id = (p->>'driver_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.contract_status <> 'active' OR v_driver.vehicle_id IS NULL OR v_driver.start_date IS NULL THEN
    RAISE EXCEPTION 'Only a driver on a car with an active contract can change shifts';
  END IF;
  IF v_new NOT IN ('day', 'night', 'full') OR v_new = v_driver.shift THEN RAISE EXCEPTION 'Pick a different shift'; END IF;
  IF v_eff IS NULL OR v_eff < v_driver.start_date THEN RAISE EXCEPTION 'Pick the date the change starts'; END IF;

  v_old_rate := driver_daily_rate_on(v_driver, v_eff - 1);
  v_new_rate := CASE WHEN v_new = 'full' THEN 60000 ELSE 30000 END;
  v_history := CASE WHEN jsonb_array_length(v_driver.rate_history) = 0
    THEN jsonb_build_array(jsonb_build_object('from', v_driver.start_date, 'daily', v_old_rate))
    ELSE (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(v_driver.rate_history) e WHERE (e->>'from')::date < v_eff) END;
  v_history := v_history || jsonb_build_array(jsonb_build_object('from', v_eff, 'daily', v_new_rate));

  INSERT INTO driver_contract_events (driver_id, event_type, reason, reason_key, details, event_date, meta, created_by)
  VALUES (v_driver.id, 'shift_changed',
          CASE WHEN v_new = 'full' THEN 'Moved to both shifts' ELSE 'Moved to one shift' END, 'shift_' || v_new, NULLIF(p->>'details', ''), v_eff,
          jsonb_build_object('from_shift', v_driver.shift, 'to_shift', v_new, 'old_daily', v_old_rate, 'new_daily', v_new_rate,
            'weekly', v_new_rate * 6, 'salary', CASE WHEN v_new = 'full' THEN 300000 ELSE 150000 END,
            'prepayment', v_pre, 'agreed_pay_by', p->>'agreed_pay_by', 'terms', COALESCE(p->'terms', '[]'::jsonb),
            'rest_day', COALESCE(NULLIF(p->>'rest_day', ''), v_driver.rest_day)),
          auth.uid())
  RETURNING id INTO v_event;

  UPDATE drivers SET shift = v_new, rate_history = v_history,
    rest_day = COALESCE(NULLIF(p->>'rest_day', ''), v_driver.rest_day), updated_at = now()
  WHERE id = v_driver.id;

  IF v_pre IS NOT NULL AND COALESCE((v_pre->>'amount')::numeric, 0) > 0 THEN
    INSERT INTO driver_deposits (driver_id, amount, paid_date, payment_method, bank_name, created_by)
    VALUES (v_driver.id, (v_pre->>'amount')::numeric, (v_pre->>'paid_date')::date, COALESCE(v_pre->>'payment_method', 'momo'),
            NULLIF(v_pre->>'bank_name', ''), auth.uid());
  END IF;
  RETURN v_event;
END $$;

REVOKE EXECUTE ON FUNCTION end_driver_contract(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION renew_driver_contract(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION change_driver_shift(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION end_driver_contract(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION renew_driver_contract(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION change_driver_shift(jsonb) TO authenticated;
