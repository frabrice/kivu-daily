/*
# Driver Adjust: the MD confirms every driver's money (MD, 19 Nov 2026)

"I will myself make sure that I record driver payments and also their
fines ... others can too. Only that this time only me confirms anything I
haven't entered myself." A driver can be behind (the week not paid yet) but
must never owe us (days already driven and not paid).

1. Only the MD confirms driver money. Payments (driver_deposits), fines and
   other money owed (driver_fines) and fine payments now all carry a status:
   - entered by the MD: confirmed at once;
   - entered by anyone else: pending until the MD confirms or rejects it.
   Nobody but the MD can change or remove an entry once it is confirmed.
   Finance no longer confirms driver payments (the MD does).
   Existing fines and fine payments the MD did not enter start as pending,
   so the Driver Adjust review goes through them. Existing payments were
   already confirmed under the old rule and stay so.
2. driver_fines.kind: a fine, damage, an advance, or other money a driver
   owes - all recorded, paid and shown the same way as fines. The car is
   optional for anything that is not a traffic fine.
3. Adjust (adjust_driver_balance): an entry made by someone other than the
   MD is pending until the MD confirms it too.
4. driver_money_reviews: the MD's confirmation of one driver's money on a
   day - start date, start deposit, last payment, paid until, what we owe
   them, whether the driver agrees - with the numbers before and after.
   confirm_driver_review() records it in one step: it corrects the start
   date and start deposit when they were wrong, and when the paid-until date
   the MD confirms differs from what the payments add up to, records the
   difference as one credit or charge (not money received). Nothing is
   overwritten or deleted.
*/

-- ================================================================ 2. kinds
ALTER TABLE driver_fines ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'fine';
ALTER TABLE driver_fines DROP CONSTRAINT IF EXISTS driver_fines_kind_check;
ALTER TABLE driver_fines ADD CONSTRAINT driver_fines_kind_check CHECK (kind IN ('fine', 'damage', 'advance', 'other'));

-- ================================================================ 1. status
ALTER TABLE driver_fines ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE driver_fines ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE driver_fines ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE driver_fines DROP CONSTRAINT IF EXISTS driver_fines_status_check;
ALTER TABLE driver_fines ADD CONSTRAINT driver_fines_status_check CHECK (status IN ('pending', 'confirmed'));

ALTER TABLE driver_fine_payments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE driver_fine_payments ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE driver_fine_payments ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE driver_fine_payments DROP CONSTRAINT IF EXISTS driver_fine_payments_status_check;
ALTER TABLE driver_fine_payments ADD CONSTRAINT driver_fine_payments_status_check CHECK (status IN ('pending', 'confirmed'));

-- What the MD entered is confirmed already; the rest waits for the review.
UPDATE driver_fines f SET status = 'confirmed', confirmed_by = f.created_by, confirmed_at = f.created_at
FROM profiles p WHERE p.id = f.created_by AND p.role = 'managing_director' AND f.status = 'pending';
UPDATE driver_fine_payments f SET status = 'confirmed', confirmed_by = f.created_by, confirmed_at = f.created_at
FROM profiles p WHERE p.id = f.created_by AND p.role = 'managing_director' AND f.status = 'pending';

-- The rule, on every write. A write with no signed-in person (the system
-- itself) is left as it is.
CREATE OR REPLACE FUNCTION driver_money_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_md boolean := is_managing_director();
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_md THEN
      NEW.status := 'confirmed'; NEW.confirmed_by := auth.uid(); NEW.confirmed_at := now();
    ELSE
      NEW.status := 'pending'; NEW.confirmed_by := NULL; NEW.confirmed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF v_md THEN RETURN COALESCE(NEW, OLD); END IF;
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'The MD has confirmed this entry: only the MD can change or remove it';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by) THEN
    RAISE EXCEPTION 'Only the MD confirms driver money';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS driver_deposits_money_guard ON driver_deposits;
CREATE TRIGGER driver_deposits_money_guard BEFORE INSERT OR UPDATE OR DELETE ON driver_deposits FOR EACH ROW EXECUTE FUNCTION driver_money_guard();
DROP TRIGGER IF EXISTS driver_fines_money_guard ON driver_fines;
CREATE TRIGGER driver_fines_money_guard BEFORE INSERT OR UPDATE OR DELETE ON driver_fines FOR EACH ROW EXECUTE FUNCTION driver_money_guard();
DROP TRIGGER IF EXISTS driver_fine_payments_money_guard ON driver_fine_payments;
CREATE TRIGGER driver_fine_payments_money_guard BEFORE INSERT OR UPDATE OR DELETE ON driver_fine_payments FOR EACH ROW EXECUTE FUNCTION driver_money_guard();

-- Payments: the MD confirms and rejects (it was Finance or the MD).
CREATE OR REPLACE FUNCTION confirm_driver_deposit(p_deposit_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD confirms driver payments'; END IF;
  UPDATE driver_deposits SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
  WHERE id = p_deposit_id AND status = 'pending';
END $$;

CREATE OR REPLACE FUNCTION reject_driver_deposit(p_deposit_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dep driver_deposits%ROWTYPE;
  v_driver_name text;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD rejects driver payments'; END IF;
  SELECT * INTO v_dep FROM driver_deposits WHERE id = p_deposit_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;
  SELECT full_name INTO v_driver_name FROM drivers WHERE id = v_dep.driver_id;

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (auth.uid(), (SELECT id FROM departments WHERE slug = 'fleet'),
    'rejected and deleted a payment for ' || COALESCE(v_driver_name, 'a driver') || COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
    'driver_deposit', p_deposit_id, v_driver_name);

  IF v_dep.created_by IS NOT NULL AND v_dep.created_by <> auth.uid() THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('deposit_rejected', jsonb_build_object(
      'recipient_id', v_dep.created_by, 'driver_name', v_driver_name, 'amount', v_dep.amount, 'paid_date', v_dep.paid_date,
      'reason', NULLIF(trim(p_reason), ''), 'rejected_by', (SELECT full_name FROM profiles WHERE id = auth.uid())));
  END IF;

  DELETE FROM driver_deposits WHERE id = p_deposit_id AND status = 'pending';
END $$;

-- ================================================================ 3. Adjust entries
CREATE OR REPLACE FUNCTION adjust_driver_balance(p_driver uuid, p_amount numeric, p_until date, p_reason text, p_before jsonb, p_after jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_name text;
  v_entries jsonb := '[]'::jsonb;
  v_driver text;
  v_status jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT can_adjust_balances() THEN
    RAISE EXCEPTION 'Only the MD, Finance, Fleet and people the MD allowed can adjust a driver''s numbers';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Write the reason for this adjustment'; END IF;
  IF coalesce(p_amount, 0) = 0 AND p_until IS NULL THEN RAISE EXCEPTION 'Nothing to adjust'; END IF;
  IF abs(coalesce(p_amount, 0)) > 10000000 THEN RAISE EXCEPTION 'That amount is too large'; END IF;
  IF p_until IS NOT NULL AND (p_until < v_today OR p_until > v_today + 60) THEN RAISE EXCEPTION 'The payment date must be between today and 60 days from now'; END IF;
  SELECT full_name INTO v_driver FROM drivers WHERE id = p_driver;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  SELECT trim(full_name) INTO v_name FROM profiles WHERE id = auth.uid();
  -- The MD's own entry is confirmed; anyone else's waits for the MD.
  v_status := CASE WHEN is_managing_director()
    THEN jsonb_build_object('status', 'confirmed', 'confirmed_by', auth.uid(), 'confirmed_at', now())
    ELSE jsonb_build_object('status', 'pending') END;

  IF coalesce(p_amount, 0) <> 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'amount', 'date', v_today, 'amount', p_amount,
      'reason', trim(p_reason), 'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p_before, 'after', p_after) || v_status);
  END IF;
  IF p_until IS NOT NULL THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'grace', 'date', v_today, 'until', p_until,
      'reason', trim(p_reason), 'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p_before, 'after', p_after) || v_status);
  END IF;

  PERFORM set_config('kivu.adjusting', 'on', true);
  UPDATE drivers SET balance_adjustments = balance_adjustments || v_entries, updated_at = now() WHERE id = p_driver;
  PERFORM set_config('kivu.adjusting', 'off', true);

  INSERT INTO finance_adjustments (target, driver_id, label, from_amount, to_amount, note, reason, effective_date, created_by, by_name)
  VALUES ('driver', p_driver, trim(v_driver),
    coalesce((p_before->>'owes')::numeric, 0), coalesce((p_after->>'owes')::numeric, 0),
    concat_ws(' · ',
      CASE WHEN coalesce(p_amount, 0) > 0 THEN format('credit of %s RWF', to_char(p_amount, 'FM999,999,990'))
           WHEN coalesce(p_amount, 0) < 0 THEN format('charge of %s RWF', to_char(-p_amount, 'FM999,999,990')) END,
      CASE WHEN p_until IS NOT NULL THEN format('may drive until %s', to_char(p_until, 'FMDD Mon YYYY')) END),
    trim(p_reason), v_today, auth.uid(), v_name);

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'driver_balance_adjusted', 'driver', p_driver, v_driver,
    jsonb_build_object('amount', p_amount, 'until', p_until, 'reason', trim(p_reason), 'before', p_before, 'after', p_after));
  RETURN v_entries;
END;
$$;

-- ================================================================ confirm / reject (MD)
-- One way to confirm or reject anything someone else recorded:
-- p_kind 'deposit' | 'fine' | 'fine_payment' | 'adjustment' (p_driver needed).
CREATE OR REPLACE FUNCTION md_confirm_driver_money(p_kind text, p_id uuid, p_driver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_driver uuid := p_driver; v_name text;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD confirms driver money'; END IF;
  IF p_kind = 'deposit' THEN
    UPDATE driver_deposits SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() WHERE id = p_id AND status = 'pending' RETURNING driver_id INTO v_driver;
  ELSIF p_kind = 'fine' THEN
    UPDATE driver_fines SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() WHERE id = p_id AND status = 'pending' RETURNING driver_id INTO v_driver;
  ELSIF p_kind = 'fine_payment' THEN
    UPDATE driver_fine_payments SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() WHERE id = p_id AND status = 'pending';
    SELECT f.driver_id INTO v_driver FROM driver_fine_payments p JOIN driver_fines f ON f.id = p.fine_id WHERE p.id = p_id;
  ELSIF p_kind = 'adjustment' THEN
    PERFORM set_config('kivu.adjusting', 'on', true);
    UPDATE drivers SET balance_adjustments = (
      SELECT COALESCE(jsonb_agg(CASE WHEN e->>'id' = p_id::text AND COALESCE(e->>'status', 'confirmed') = 'pending'
        THEN e || jsonb_build_object('status', 'confirmed', 'confirmed_by', auth.uid(), 'confirmed_at', now()) ELSE e END ORDER BY o), '[]'::jsonb)
      FROM jsonb_array_elements(balance_adjustments) WITH ORDINALITY AS x(e, o)), updated_at = now()
    WHERE id = p_driver;
    PERFORM set_config('kivu.adjusting', 'off', true);
  ELSE
    RAISE EXCEPTION 'Unknown entry';
  END IF;
  SELECT full_name INTO v_name FROM drivers WHERE id = v_driver;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'confirmed driver money', 'driver', v_driver, v_name,
    jsonb_build_object('kind', p_kind, 'id', p_id));
END $$;

CREATE OR REPLACE FUNCTION md_reject_driver_money(p_kind text, p_id uuid, p_driver uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_driver uuid := p_driver; v_name text; v_what jsonb;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD rejects driver money'; END IF;
  IF p_kind = 'deposit' THEN
    PERFORM reject_driver_deposit(p_id, p_reason);
    RETURN;
  ELSIF p_kind = 'fine' THEN
    DELETE FROM driver_fines WHERE id = p_id AND status = 'pending' RETURNING driver_id, to_jsonb(driver_fines.*) INTO v_driver, v_what;
  ELSIF p_kind = 'fine_payment' THEN
    SELECT f.driver_id INTO v_driver FROM driver_fine_payments p JOIN driver_fines f ON f.id = p.fine_id WHERE p.id = p_id;
    DELETE FROM driver_fine_payments WHERE id = p_id AND status = 'pending' RETURNING to_jsonb(driver_fine_payments.*) INTO v_what;
  ELSIF p_kind = 'adjustment' THEN
    SELECT e INTO v_what FROM drivers, jsonb_array_elements(balance_adjustments) e WHERE id = p_driver AND e->>'id' = p_id::text AND e->>'status' = 'pending';
    PERFORM set_config('kivu.adjusting', 'on', true);
    UPDATE drivers SET balance_adjustments = (
      SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(balance_adjustments) WITH ORDINALITY AS x(e, o)
      WHERE NOT (e->>'id' = p_id::text AND e->>'status' = 'pending')), updated_at = now()
    WHERE id = p_driver;
    PERFORM set_config('kivu.adjusting', 'off', true);
  ELSE
    RAISE EXCEPTION 'Unknown entry';
  END IF;
  IF v_what IS NULL THEN RETURN; END IF;
  SELECT full_name INTO v_name FROM drivers WHERE id = v_driver;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'rejected driver money', 'driver', v_driver, v_name,
    jsonb_build_object('kind', p_kind, 'entry', v_what, 'reason', NULLIF(trim(p_reason), '')));
END $$;

REVOKE ALL ON FUNCTION md_confirm_driver_money(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION md_confirm_driver_money(text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION md_reject_driver_money(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION md_reject_driver_money(text, uuid, uuid, text) TO authenticated;

-- ================================================================ 4. reviews
CREATE TABLE IF NOT EXISTS driver_money_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  reviewed_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Kigali')::date),
  start_date date,
  deposit_amount numeric NOT NULL DEFAULT 0,
  deposit_date date,
  last_payment_date date,
  paid_until date,
  model text,
  daily_rate numeric,
  rest_day text,
  -- The credit (+) or charge (-) recorded to make "paid until" right (0: none needed).
  adjustment numeric NOT NULL DEFAULT 0,
  -- Money we owe the driver, beyond what Finance already has (salary is read from Finance).
  we_owe_amount numeric NOT NULL DEFAULT 0 CHECK (we_owe_amount >= 0),
  we_owe_note text,
  driver_agrees boolean NOT NULL DEFAULT false,
  notes text,
  before jsonb,
  after jsonb,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_money_reviews_driver_idx ON driver_money_reviews (driver_id, created_at DESC);

ALTER TABLE driver_money_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dmr_select ON driver_money_reviews;
CREATE POLICY dmr_select ON driver_money_reviews FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance'));
GRANT SELECT ON driver_money_reviews TO authenticated;
-- Written only by confirm_driver_review().

CREATE OR REPLACE FUNCTION confirm_driver_review(p_driver uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d drivers%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_start date := NULLIF(p->>'start_date', '')::date;
  v_dep numeric := COALESCE(NULLIF(p->>'deposit_amount', '')::numeric, 0);
  v_dep_date date := NULLIF(p->>'deposit_date', '')::date;
  v_adj numeric := COALESCE(NULLIF(p->>'adjustment', '')::numeric, 0);
  v_until date := NULLIF(p->>'paid_until', '')::date;
  v_owe numeric := COALESCE(NULLIF(p->>'we_owe_amount', '')::numeric, 0);
  v_name text;
  v_id uuid;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD confirms a driver''s money'; END IF;
  SELECT * INTO d FROM drivers WHERE id = p_driver FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF d.contract_status = 'ended' THEN RAISE EXCEPTION '% has no contract running', d.full_name; END IF;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Enter the start date'; END IF;
  IF v_start > v_today THEN RAISE EXCEPTION 'The start date can''t be in the future'; END IF;
  IF v_dep < 0 OR v_owe < 0 THEN RAISE EXCEPTION 'Amounts can''t be negative'; END IF;
  IF v_dep > 0 AND v_dep_date IS NULL THEN RAISE EXCEPTION 'Enter the date the deposit was paid'; END IF;
  IF v_dep_date > v_today THEN RAISE EXCEPTION 'The deposit date can''t be in the future'; END IF;
  IF abs(v_adj) > 10000000 THEN RAISE EXCEPTION 'That correction is too large'; END IF;
  SELECT trim(full_name) INTO v_name FROM profiles WHERE id = auth.uid();

  -- Start date and start deposit, only when they were wrong.
  IF d.start_date IS DISTINCT FROM v_start THEN
    UPDATE drivers SET start_date = v_start, updated_at = now() WHERE id = p_driver;
  END IF;
  IF COALESCE(d.initial_deposit_amount, 0) <> v_dep OR (v_dep > 0 AND d.initial_deposit_date IS DISTINCT FROM v_dep_date) THEN
    UPDATE drivers SET initial_deposit_paid = v_dep > 0,
      initial_deposit_amount = NULLIF(v_dep, 0), initial_deposit_date = CASE WHEN v_dep > 0 THEN v_dep_date END, updated_at = now()
    WHERE id = p_driver;
    -- Finance's copy of the start deposit follows (it is posted from these fields).
    IF v_dep > 0 THEN
      UPDATE finance_transactions SET amount = v_dep, transaction_date = v_dep_date, updated_at = now()
      WHERE type = 'fleet_collection' AND system_generated AND linked_driver_id = p_driver AND description LIKE 'Initial deposit%';
    ELSE
      DELETE FROM finance_transactions
      WHERE type = 'fleet_collection' AND system_generated AND linked_driver_id = p_driver AND description LIKE 'Initial deposit%';
    END IF;
  END IF;

  -- "Paid until" as confirmed: the difference from the payments is one credit or charge.
  IF v_adj <> 0 THEN
    PERFORM set_config('kivu.adjusting', 'on', true);
    UPDATE drivers SET balance_adjustments = balance_adjustments || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'kind', 'amount', 'date', v_today, 'amount', v_adj,
      'reason', concat_ws(' · ', 'Driver Adjust: paid until ' || to_char(v_until, 'FMDD Mon YYYY') || ' confirmed by the MD', NULLIF(trim(p->>'notes'), '')),
      'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p->'before', 'after', p->'after',
      'status', 'confirmed', 'confirmed_by', auth.uid(), 'confirmed_at', now())), updated_at = now()
    WHERE id = p_driver;
    PERFORM set_config('kivu.adjusting', 'off', true);
    INSERT INTO finance_adjustments (target, driver_id, label, from_amount, to_amount, note, reason, effective_date, created_by, by_name)
    VALUES ('driver', p_driver, trim(d.full_name),
      coalesce((p->'before'->>'owes')::numeric, 0), coalesce((p->'after'->>'owes')::numeric, 0),
      CASE WHEN v_adj > 0 THEN format('credit of %s RWF', to_char(v_adj, 'FM999,999,990')) ELSE format('charge of %s RWF', to_char(-v_adj, 'FM999,999,990')) END,
      'Driver Adjust: paid until ' || to_char(v_until, 'FMDD Mon YYYY') || ' confirmed by the MD', v_today, auth.uid(), v_name);
  END IF;

  INSERT INTO driver_money_reviews (driver_id, reviewed_on, start_date, deposit_amount, deposit_date, last_payment_date, paid_until,
    model, daily_rate, rest_day, adjustment, we_owe_amount, we_owe_note, driver_agrees, notes, before, after, created_by)
  VALUES (p_driver, v_today, v_start, v_dep, CASE WHEN v_dep > 0 THEN v_dep_date END, NULLIF(p->>'last_payment_date', '')::date, v_until,
    d.model, NULLIF(p->>'daily_rate', '')::numeric, d.rest_day, v_adj, v_owe, NULLIF(trim(p->>'we_owe_note'), ''),
    COALESCE((p->>'driver_agrees')::boolean, false), NULLIF(trim(p->>'notes'), ''), p->'before', p->'after', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'confirmed a driver''s money', 'driver', p_driver, d.full_name,
    jsonb_build_object('review', v_id, 'paid_until', v_until, 'adjustment', v_adj));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION confirm_driver_review(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_driver_review(uuid, jsonb) TO authenticated;
