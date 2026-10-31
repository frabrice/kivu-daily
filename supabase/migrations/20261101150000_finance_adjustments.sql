/*
# Finance adjustments (MD, 31 Oct 2026)

A hidden "Adjust" on the Finance overview sets the main numbers to what
they really are, with a reason. Nothing is overwritten: every change is an
entry, kept with the number before and after, who and when.

- A bank account's balance: a posted ledger row of type 'adjustment' (in
  or out by the difference), so the balance, the ledger, the account
  statement and the reconciliation all show it. It is not income or a
  cost: the Made / Spent / Net figures leave it out, like transfers.
- What Kivu owes an owner: unpaid weekly payouts + adjustments - payments
  logged by hand (owner_owed()). Nothing moves in a bank.
- What a driver owes: the driver Adjust (adjust_driver_balance, migration
  20261101130000), which now also writes here.

finance_adjustments is the one list of all of them (shown in the Ledger
and in the Adjust panel). Rows are written only by finance_adjust() and
adjust_driver_balance(); adjustment ledger rows can't be edited or removed.
*/

ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'revenue', 'fleet_collection', 'vehicle_owner_payment', 'payroll', 'supplier_payment', 'transfer', 'expense_claim', 'other',
  'onboarding_fee', 'management_margin', 'driver_payroll', 'app_commission', 'adjustment'));

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
    WHEN 'adjustment' THEN 'ADJ'
    ELSE 'OTH'
  END;
$$;

CREATE TABLE IF NOT EXISTS finance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text NOT NULL CHECK (target IN ('account', 'owner', 'driver')),
  account_id uuid REFERENCES finance_accounts(id),
  owner_id uuid REFERENCES vehicle_owners(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  label text NOT NULL,
  from_amount numeric NOT NULL,
  to_amount numeric NOT NULL,
  change numeric GENERATED ALWAYS AS (to_amount - from_amount) STORED,
  note text,
  reason text NOT NULL,
  effective_date date NOT NULL,
  transaction_id uuid REFERENCES finance_transactions(id),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_adjustments_created_idx ON finance_adjustments(created_at DESC);
CREATE INDEX IF NOT EXISTS finance_adjustments_owner_idx ON finance_adjustments(owner_id) WHERE owner_id IS NOT NULL;

ALTER TABLE finance_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance_adjustments_select" ON finance_adjustments;
CREATE POLICY "finance_adjustments_select" ON finance_adjustments FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director() OR can_adjust_balances());
-- No insert / update / delete policy: only the functions below write it.

-- Adjustment ledger rows: created by finance_adjust() only, never edited or removed.
CREATE OR REPLACE FUNCTION guard_adjustment_rows()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('kivu.adjusting', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.type = 'adjustment' THEN
    RAISE EXCEPTION 'Adjustments are recorded with Adjust on the Finance overview only';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.type = 'adjustment' THEN
    RAISE EXCEPTION 'An adjustment can''t be removed. Record a new adjustment instead';
  END IF;
  -- (Links such as "prepared by" may still be cleared when a profile is removed.)
  IF TG_OP = 'UPDATE' AND OLD.type = 'adjustment' AND (NEW.amount, NEW.direction, NEW.account_id, NEW.transaction_date, NEW.status, NEW.description, NEW.type)
     IS DISTINCT FROM (OLD.amount, OLD.direction, OLD.account_id, OLD.transaction_date, OLD.status, OLD.description, OLD.type) THEN
    RAISE EXCEPTION 'An adjustment can''t be changed. Record a new adjustment instead';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.type = 'adjustment' THEN
    RAISE EXCEPTION 'Adjustments are recorded with Adjust on the Finance overview only';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS finance_transactions_guard_adjustments ON finance_transactions;
CREATE TRIGGER finance_transactions_guard_adjustments BEFORE INSERT OR UPDATE OR DELETE ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_adjustment_rows();

-- The balance exactly as the app shows it (movedMoney in src/lib/finance.ts):
-- opening balance + money that really moved. Out counts once approved or
-- posted, in once checked or later; pending and rejected rows don't count,
-- so the balance can match the bank statement.
CREATE OR REPLACE FUNCTION finance_account_balance(p_account uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.opening_balance + coalesce((SELECT sum(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END)
    FROM finance_transactions t WHERE t.account_id = a.id
      AND (t.status IN ('approved', 'posted') OR (t.direction = 'in' AND t.status = 'checked'))), 0)
  FROM finance_accounts a WHERE a.id = p_account;
$$;

-- What Kivu owes an owner now: weekly payouts not paid yet, plus
-- adjustments, minus owner payments Finance logged by hand.
CREATE OR REPLACE FUNCTION owner_owed(p_owner uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT sum(t.amount) FROM finance_transactions t JOIN vehicles v ON v.id = t.linked_vehicle_id
      WHERE v.owner_id = p_owner AND t.type = 'vehicle_owner_payment' AND t.system_generated AND t.status IN ('pending', 'checked')), 0)
    + coalesce((SELECT sum(change) FROM finance_adjustments WHERE target = 'owner' AND owner_id = p_owner), 0)
    - coalesce((SELECT sum(t.amount) FROM finance_transactions t JOIN vehicles v ON v.id = t.linked_vehicle_id
      WHERE v.owner_id = p_owner AND t.type = 'vehicle_owner_payment' AND NOT t.system_generated AND t.status IN ('approved', 'posted')), 0);
$$;

REVOKE ALL ON FUNCTION finance_account_balance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION owner_owed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance_account_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION owner_owed(uuid) TO authenticated;

-- Set a bank balance or what we owe an owner to `p_to`. `p_from` is the
-- number the person saw: if it changed meanwhile, nothing is recorded.
CREATE OR REPLACE FUNCTION finance_adjust(p_target text, p_id uuid, p_from numeric, p_to numeric, p_reason text, p_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_date date := coalesce(p_date, (now() AT TIME ZONE 'Africa/Kigali')::date);
  v_now numeric;
  v_label text;
  v_name text;
  v_tx uuid;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (is_managing_director() OR current_department_slug() = 'finance' OR can_adjust_balances()) THEN
    RAISE EXCEPTION 'Only the MD, Finance and people the MD allowed can adjust Finance''s numbers';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Write the reason for this adjustment'; END IF;
  IF p_to IS NULL OR p_to < 0 OR p_to > 10000000000 THEN RAISE EXCEPTION 'Type the right number (0 or more)'; END IF;
  IF v_date > v_today OR v_date < v_today - 366 THEN RAISE EXCEPTION 'The date must be today or in the last year'; END IF;

  IF p_target = 'account' THEN
    SELECT name INTO v_label FROM finance_accounts WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
    v_now := finance_account_balance(p_id);
  ELSIF p_target = 'owner' THEN
    SELECT trim(full_name) INTO v_label FROM vehicle_owners WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Owner not found'; END IF;
    v_now := owner_owed(p_id);
  ELSE
    RAISE EXCEPTION 'Drivers are adjusted with their own Adjust';
  END IF;

  IF abs(v_now - coalesce(p_from, -1)) >= 1 THEN
    RAISE EXCEPTION 'This number changed to % RWF while you were typing. Close Adjust and open it again', round(v_now);
  END IF;
  IF round(p_to) = round(v_now) THEN RAISE EXCEPTION 'Nothing to adjust: the number is already %', round(v_now); END IF;
  SELECT trim(full_name) INTO v_name FROM profiles WHERE id = auth.uid();

  PERFORM set_config('kivu.adjusting', 'on', true);
  IF p_target = 'account' THEN
    INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, status, system_generated,
      prepared_by, approved_by, approved_at, created_by)
    VALUES ('adjustment', p_id, CASE WHEN p_to > v_now THEN 'in' ELSE 'out' END, abs(p_to - v_now), v_date,
      format('Adjustment: balance %s → %s RWF. %s', to_char(round(v_now), 'FM999,999,999,990'), to_char(round(p_to), 'FM999,999,999,990'), trim(p_reason)),
      'posted', false, auth.uid(), auth.uid(), now(), auth.uid())
    RETURNING id INTO v_tx;
  END IF;
  INSERT INTO finance_adjustments (target, account_id, owner_id, label, from_amount, to_amount, reason, effective_date, transaction_id, created_by, by_name)
  VALUES (p_target, CASE WHEN p_target = 'account' THEN p_id END, CASE WHEN p_target = 'owner' THEN p_id END, v_label,
    v_now, p_to, trim(p_reason), v_date, v_tx, auth.uid(), v_name)
  RETURNING id INTO v_id;
  PERFORM set_config('kivu.adjusting', 'off', true);

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT id FROM departments WHERE slug = 'finance'), 'finance_adjusted',
    CASE WHEN p_target = 'account' THEN 'finance_account' ELSE 'vehicle_owner' END, p_id, v_label,
    jsonb_build_object('target', p_target, 'from', v_now, 'to', p_to, 'reason', trim(p_reason), 'date', v_date, 'transaction_id', v_tx));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION finance_adjust(text, uuid, numeric, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance_adjust(text, uuid, numeric, numeric, text, date) TO authenticated;

-- One activity line per adjustment (finance_adjust writes its own, with the reason).
CREATE OR REPLACE FUNCTION log_finance_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fin_dept_id uuid;
BEGIN
  IF NEW.type = 'adjustment' THEN RETURN NEW; END IF;
  SELECT id INTO fin_dept_id FROM departments WHERE slug = 'finance';
  IF TG_OP = 'INSERT' AND NEW.system_generated = false THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), fin_dept_id, 'logged a ' || replace(NEW.type, '_', ' ') || ' transaction', 'finance_transaction', NEW.id, NEW.reference);
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NEW.status = 'approved' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), fin_dept_id, 'approved a ' || replace(NEW.type, '_', ' ') || ' transaction', 'finance_transaction', NEW.id, NEW.reference);
  END IF;
  RETURN NEW;
END;
$$;

-- The driver Adjust also goes into the one list of adjustments.
CREATE OR REPLACE FUNCTION adjust_driver_balance(p_driver uuid, p_amount numeric, p_until date, p_reason text, p_before jsonb, p_after jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_name text;
  v_entries jsonb := '[]'::jsonb;
  v_driver text;
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

  IF coalesce(p_amount, 0) <> 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'amount', 'date', v_today, 'amount', p_amount,
      'reason', trim(p_reason), 'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p_before, 'after', p_after));
  END IF;
  IF p_until IS NOT NULL THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'grace', 'date', v_today, 'until', p_until,
      'reason', trim(p_reason), 'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p_before, 'after', p_after));
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
REVOKE ALL ON FUNCTION adjust_driver_balance(uuid, numeric, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION adjust_driver_balance(uuid, numeric, date, text, jsonb, jsonb) TO authenticated;

-- Earlier driver adjustments (made before this list existed) go in it too.
INSERT INTO finance_adjustments (target, driver_id, label, from_amount, to_amount, note, reason, effective_date, created_by, by_name, created_at)
SELECT 'driver', d.id, trim(d.full_name),
  coalesce((e->'before'->>'owes')::numeric, 0), coalesce((e->'after'->>'owes')::numeric, 0),
  CASE WHEN e->>'kind' = 'grace' THEN format('may drive until %s', e->>'until')
       WHEN (e->>'amount')::numeric > 0 THEN format('credit of %s RWF', to_char((e->>'amount')::numeric, 'FM999,999,990'))
       ELSE format('charge of %s RWF', to_char(-(e->>'amount')::numeric, 'FM999,999,990')) END,
  e->>'reason', (e->>'date')::date, nullif(e->>'by', '')::uuid, e->>'by_name', (e->>'at')::timestamptz
FROM drivers d, jsonb_array_elements(d.balance_adjustments) e
WHERE NOT EXISTS (SELECT 1 FROM finance_adjustments f WHERE f.target = 'driver' AND f.driver_id = d.id AND f.created_at = (e->>'at')::timestamptz);
