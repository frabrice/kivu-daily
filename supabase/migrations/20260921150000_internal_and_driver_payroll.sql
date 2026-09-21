/*
# Internal Payroll rework + new Driver Payroll

Confirmed with the operator:

1. Internal Payroll's employees are now standalone payroll records, not
   tied to an app login - Finance creates them directly with position,
   start date, monthly salary and an uploaded ID, independent of
   whether that person ever uses Kivu Daily. There's one shared payment
   date for all internal staff, tracked as a day-of-month setting so
   the UI can show a live countdown ("N days until payment").
   payroll_runs/payroll_lines (the existing month-by-month batch +
   approve-and-pay mechanism) are kept as-is - only what a line's
   employee_id points to changes, and a new run's lines now pre-fill
   from each active employee's current salary (still editable per the
   operator's choice - salary is a smart default, not a hard rule).

2. A brand new Driver Payroll: every driver who's paid their initial
   deposit earns a flat 150,000/month, counted from their own personal
   anchor date (their initial deposit date - the "official start
   date"), not the shared internal date. Each driver's payment is its
   own individual pending transaction (they don't all fall due
   together, since each driver's anchor date differs). A driver whose
   contract ends simply stops generating new months - no partial/
   prorated final payment - which happens for free just by scoping the
   generator to contract_status = 'active'.

Real data note: payroll_lines already has 8 real rows across two
periods (Aug 2026 paid, Sep 2026 draft) pointing at real profiles. This
migration backfills a payroll_employees row for each one (salary taken
from their most recent line, name copied over, linked_profile_id kept
for traceability) and repoints payroll_lines at the new table, so none
of that history is lost - Finance fills in position/start date/ID
afterward for anyone missing it.
*/

-- ============================================================
-- 1. Standalone payroll employee registry
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  position text,
  start_date date,
  monthly_salary numeric NOT NULL DEFAULT 0,
  id_document_url text,
  id_document_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  end_date date,
  linked_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_employees_select" ON payroll_employees;
CREATE POLICY "payroll_employees_select" ON payroll_employees FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_employees_insert" ON payroll_employees;
CREATE POLICY "payroll_employees_insert" ON payroll_employees FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_employees_update" ON payroll_employees;
CREATE POLICY "payroll_employees_update" ON payroll_employees FOR UPDATE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_employees_delete" ON payroll_employees;
CREATE POLICY "payroll_employees_delete" ON payroll_employees FOR DELETE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

-- Backfill one record per distinct profile already referenced in
-- payroll_lines, salary from their most recent line.
INSERT INTO payroll_employees (full_name, monthly_salary, linked_profile_id, status)
SELECT DISTINCT ON (p.id) p.full_name, l.gross_amount, p.id, 'active'
FROM payroll_lines l
JOIN profiles p ON p.id = l.employee_id
ORDER BY p.id, l.created_at DESC;

-- Repoint payroll_lines at payroll_employees instead of profiles.
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS payroll_employee_id uuid;
UPDATE payroll_lines l
SET payroll_employee_id = pe.id
FROM payroll_employees pe
WHERE pe.linked_profile_id = l.employee_id AND l.payroll_employee_id IS NULL;

ALTER TABLE payroll_lines ALTER COLUMN payroll_employee_id SET NOT NULL;
ALTER TABLE payroll_lines DROP CONSTRAINT IF EXISTS payroll_lines_employee_id_fkey;
ALTER TABLE payroll_lines DROP COLUMN employee_id;
ALTER TABLE payroll_lines RENAME COLUMN payroll_employee_id TO employee_id;
ALTER TABLE payroll_lines ADD CONSTRAINT payroll_lines_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES payroll_employees(id) ON DELETE CASCADE;

-- ============================================================
-- 2. One shared internal-payroll payment date
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  internal_payment_day int NOT NULL DEFAULT 28 CHECK (internal_payment_day BETWEEN 1 AND 28),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payroll_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_settings_select" ON payroll_settings;
CREATE POLICY "payroll_settings_select" ON payroll_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "payroll_settings_update" ON payroll_settings;
CREATE POLICY "payroll_settings_update" ON payroll_settings FOR UPDATE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

-- ============================================================
-- 3. Driver Payroll: a new transaction type + its generator
-- ============================================================
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check
  CHECK (type IN ('revenue', 'fleet_collection', 'vehicle_owner_payment', 'payroll', 'supplier_payment', 'transfer', 'expense_claim', 'other', 'onboarding_fee', 'management_margin', 'driver_payroll'));

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

  -- Only drivers who've actually started (paid their initial deposit)
  -- and whose contract hasn't ended - an ended driver simply stops
  -- generating new months from here on, no partial final payment.
  FOR v_driver IN
    SELECT * FROM drivers
    WHERE initial_deposit_paid = true AND initial_deposit_date IS NOT NULL AND contract_status = 'active'
  LOOP
    v_months_elapsed := GREATEST((EXTRACT(YEAR FROM age(CURRENT_DATE, v_driver.initial_deposit_date)) * 12
      + EXTRACT(MONTH FROM age(CURRENT_DATE, v_driver.initial_deposit_date)))::int, 0);
    SELECT count(*) INTO v_existing_count FROM finance_transactions
      WHERE type = 'driver_payroll' AND linked_driver_id = v_driver.id AND system_generated = true;
    IF v_months_elapsed > v_existing_count THEN
      FOR i IN v_existing_count..(v_months_elapsed - 1) LOOP
        INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, linked_driver_id, status, system_generated, created_at)
        VALUES ('driver_payroll', v_im_id, 'out', 150000, (v_driver.initial_deposit_date + ((i + 1) || ' months')::interval)::date,
                'Driver payroll — ' || v_driver.full_name, v_driver.full_name, v_driver.id, 'pending', true, now());
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_driver_payroll() TO authenticated;

CREATE OR REPLACE FUNCTION mark_driver_payroll_paid(p_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can mark a driver payroll payment as paid';
  END IF;

  UPDATE finance_transactions
  SET status = 'posted', checked_by = auth.uid(), checked_at = now(), updated_at = now()
  WHERE id = p_transaction_id AND type = 'driver_payroll' AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION mark_driver_payroll_paid(uuid) TO authenticated;
