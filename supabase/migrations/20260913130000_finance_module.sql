/*
# Finance module — the unified bank-account ledger from the Finance & Bank
# Account SOP (KRL/FIN/SOP/001/2026)

## Why one ledger table, not one table per money type
The SOP defines several money movements (Kivu's own revenue, fleet
collections, vehicle-owner settlements, payroll, supplier payments,
inter-bank transfers, expense claims) that all reduce to the same shape:
an amount, a direction, and which of the four accounts it hit. Modeling
them as one ledger (finance_transactions) means account balances are
never a stored, driftable number - they're always SUM(in) - SUM(out) +
opening_balance, computed live from the same rows Finance actually
approved. A transfer between two of Kivu's own accounts posts as two
linked rows (one 'out' of the source, one 'in' to the destination,
sharing transfer_group_id) so the balance math never needs a special
case, matching the SOP's "an internal transfer must never be recorded
as Kivu Ride revenue or expense" rule for free.

## No duplicate data entry for driver deposits
Fleet already tracks the weekly RWF 180,000 driver deposit
(driver_deposits, shipped 2026-09-12). Rather than asking Finance to
re-enter what Fleet already recorded, a trigger auto-posts a matching
fleet_collection row to Bank of Kigali the moment Fleet logs a deposit -
system_generated = true distinguishes these from rows Finance entered
by hand. Existing driver_deposits rows are backfilled once below so
history isn't lost. Driver fines are deliberately NOT auto-linked -
whether a fine is company-collected cash or a compliance record Mark
tracks separately isn't settled by either source document, so it stays
Fleet-only until that's clarified.

## Reference numbers
Section 23 of the SOP specifies REV-/DRV-/OWN-/SUP-/PAY-/TRF- style
references. finance_reference_counters gives an atomic, gap-free
per-type-per-month sequence (INSERT .. ON CONFLICT DO UPDATE .. RETURNING
under the row lock Postgres already takes for the upsert, so concurrent
inserts can't collide) instead of a COUNT(*)-based one, which would race
under concurrent inserts.

## Access
Finance data is scoped tighter than any other module: Finance
department + MD only, no broader read access (Fleet, by contrast, lets
Call Center read driver/vehicle data). Given how sensitive banking data
is, that's deliberate.
*/

CREATE TABLE IF NOT EXISTS finance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL CHECK (key IN ('equity', 'bank_of_kigali', 'im_bank', 'momo')),
  name text NOT NULL,
  bank_name text,
  purpose text NOT NULL,
  opening_balance numeric NOT NULL DEFAULT 0,
  opening_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

INSERT INTO finance_accounts (key, name, bank_name, purpose) VALUES
  ('equity', 'Revenue & Treasury Account', 'Equity Bank', 'Kivu Ride''s own business revenue and financial reserve'),
  ('bank_of_kigali', 'Fleet Collection Account', 'Bank of Kigali', 'Collection and temporary holding of fleet-related money'),
  ('im_bank', 'Payment & Operating Account', 'I&M Bank', 'Controlled disbursement and operating payments'),
  ('momo', 'Mobile Money Collection', 'Mobile Money', 'Official driver-payment channel, settled into Bank of Kigali')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_accounts_select" ON finance_accounts;
CREATE POLICY "finance_accounts_select" ON finance_accounts FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

-- ============================================================
-- REFERENCE NUMBER GENERATION
-- ============================================================
CREATE TABLE IF NOT EXISTS finance_reference_counters (
  type text NOT NULL,
  year_month text NOT NULL,
  next_seq integer NOT NULL DEFAULT 1,
  PRIMARY KEY (type, year_month)
);

ALTER TABLE finance_reference_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_reference_counters_select" ON finance_reference_counters;
CREATE POLICY "finance_reference_counters_select" ON finance_reference_counters FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

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
    ELSE 'OTH'
  END;
$$;

CREATE OR REPLACE FUNCTION generate_finance_reference(p_type text, p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ym text := to_char(p_date, 'YYYY-MM');
  v_seq integer;
BEGIN
  INSERT INTO finance_reference_counters (type, year_month, next_seq)
  VALUES (p_type, v_ym, 2)
  ON CONFLICT (type, year_month) DO UPDATE SET next_seq = finance_reference_counters.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;
  RETURN finance_type_prefix(p_type) || '-' || v_ym || '-' || lpad(v_seq::text, 3, '0');
END;
$$;

-- ============================================================
-- FINANCE TRANSACTIONS (the unified ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('revenue', 'fleet_collection', 'vehicle_owner_payment', 'payroll', 'supplier_payment', 'transfer', 'expense_claim', 'other')),
  account_id uuid NOT NULL REFERENCES finance_accounts(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount numeric NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL,
  description text,
  counterparty text,
  linked_vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  linked_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  transfer_group_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'checked', 'approved', 'posted', 'rejected')),
  prepared_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  checked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  checked_at timestamptz,
  approved_at timestamptz,
  supporting_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  system_generated boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_transactions_account_date_idx ON finance_transactions(account_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS finance_transactions_type_idx ON finance_transactions(type);
CREATE INDEX IF NOT EXISTS finance_transactions_transfer_group_idx ON finance_transactions(transfer_group_id);

ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_transactions_select" ON finance_transactions;
CREATE POLICY "finance_transactions_select" ON finance_transactions FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "finance_transactions_insert" ON finance_transactions;
CREATE POLICY "finance_transactions_insert" ON finance_transactions FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "finance_transactions_update" ON finance_transactions;
CREATE POLICY "finance_transactions_update" ON finance_transactions FOR UPDATE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "finance_transactions_delete" ON finance_transactions;
CREATE POLICY "finance_transactions_delete" ON finance_transactions FOR DELETE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

CREATE OR REPLACE FUNCTION set_finance_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := generate_finance_reference(NEW.type, NEW.transaction_date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_transactions_set_reference ON finance_transactions;
CREATE TRIGGER finance_transactions_set_reference
  BEFORE INSERT ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION set_finance_reference();

CREATE OR REPLACE FUNCTION log_finance_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fin_dept_id uuid;
BEGIN
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

DROP TRIGGER IF EXISTS finance_transactions_activity_log ON finance_transactions;
CREATE TRIGGER finance_transactions_activity_log
  AFTER INSERT OR UPDATE ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION log_finance_activity();

-- ============================================================
-- AUTO-POST DRIVER DEPOSITS INTO THE LEDGER (Fleet stays the entry point)
-- ============================================================
CREATE OR REPLACE FUNCTION post_driver_deposit_to_finance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bk_account_id uuid;
  v_driver_name text;
BEGIN
  SELECT id INTO v_bk_account_id FROM finance_accounts WHERE key = 'bank_of_kigali';
  SELECT full_name INTO v_driver_name FROM drivers WHERE id = NEW.driver_id;
  IF v_bk_account_id IS NOT NULL THEN
    INSERT INTO finance_transactions (
      type, account_id, direction, amount, transaction_date, description, counterparty,
      linked_driver_id, status, system_generated, created_by, created_at
    ) VALUES (
      'fleet_collection', v_bk_account_id, 'in', NEW.amount, NEW.paid_date,
      'Driver deposit — ' || COALESCE(v_driver_name, 'Unknown driver'), v_driver_name,
      NEW.driver_id, 'posted', true, NEW.created_by, NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_deposits_post_to_finance ON driver_deposits;
CREATE TRIGGER driver_deposits_post_to_finance
  AFTER INSERT ON driver_deposits
  FOR EACH ROW EXECUTE FUNCTION post_driver_deposit_to_finance();

-- Backfill deposits logged in Fleet before this migration existed.
DO $$
DECLARE
  v_bk_account_id uuid;
BEGIN
  SELECT id INTO v_bk_account_id FROM finance_accounts WHERE key = 'bank_of_kigali';
  IF v_bk_account_id IS NOT NULL THEN
    INSERT INTO finance_transactions (
      type, account_id, direction, amount, transaction_date, description, counterparty,
      linked_driver_id, status, system_generated, created_by, created_at
    )
    SELECT
      'fleet_collection', v_bk_account_id, 'in', dd.amount, dd.paid_date,
      'Driver deposit — ' || COALESCE(d.full_name, 'Unknown driver'), d.full_name,
      dd.driver_id, 'posted', true, dd.created_by, dd.created_at
    FROM driver_deposits dd
    LEFT JOIN drivers d ON d.id = dd.driver_id
    WHERE NOT EXISTS (
      SELECT 1 FROM finance_transactions ft
      WHERE ft.system_generated = true AND ft.linked_driver_id = dd.driver_id
        AND ft.transaction_date = dd.paid_date AND ft.amount = dd.amount
    );
  END IF;
END $$;

-- ============================================================
-- BANK RECONCILIATION
-- ============================================================
CREATE TABLE IF NOT EXISTS finance_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES finance_accounts(id),
  period text NOT NULL,
  statement_balance numeric NOT NULL,
  system_balance numeric NOT NULL,
  variance numeric GENERATED ALWAYS AS (statement_balance - system_balance) STORED,
  notes text,
  reconciled_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reconciled_at timestamptz DEFAULT now(),
  UNIQUE (account_id, period)
);

ALTER TABLE finance_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_reconciliations_select" ON finance_reconciliations;
CREATE POLICY "finance_reconciliations_select" ON finance_reconciliations FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "finance_reconciliations_insert" ON finance_reconciliations;
CREATE POLICY "finance_reconciliations_insert" ON finance_reconciliations FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "finance_reconciliations_update" ON finance_reconciliations;
CREATE POLICY "finance_reconciliations_update" ON finance_reconciliations FOR UPDATE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "finance_reconciliations_delete" ON finance_reconciliations;
CREATE POLICY "finance_reconciliations_delete" ON finance_reconciliations FOR DELETE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

CREATE OR REPLACE FUNCTION log_reconciliation_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fin_dept_id uuid;
  acc_name text;
BEGIN
  SELECT id INTO fin_dept_id FROM departments WHERE slug = 'finance';
  SELECT name INTO acc_name FROM finance_accounts WHERE id = NEW.account_id;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (COALESCE(NEW.reconciled_by, auth.uid()), fin_dept_id, 'reconciled ' || COALESCE(acc_name, 'an account') || ' for ' || NEW.period, 'finance_reconciliation', NEW.id, acc_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_reconciliations_activity_log ON finance_reconciliations;
CREATE TRIGGER finance_reconciliations_activity_log
  AFTER INSERT ON finance_reconciliations
  FOR EACH ROW EXECUTE FUNCTION log_reconciliation_activity();

-- ============================================================
-- PAYROLL
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'checked', 'approved', 'paid')),
  total_amount numeric NOT NULL DEFAULT 0,
  prepared_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  checked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  finance_transaction_id uuid REFERENCES finance_transactions(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gross_amount numeric NOT NULL DEFAULT 0,
  deductions numeric NOT NULL DEFAULT 0,
  net_amount numeric GENERATED ALWAYS AS (gross_amount - deductions) STORED,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_lines_run_idx ON payroll_lines(payroll_run_id);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_runs_select" ON payroll_runs;
CREATE POLICY "payroll_runs_select" ON payroll_runs FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_runs_insert" ON payroll_runs;
CREATE POLICY "payroll_runs_insert" ON payroll_runs FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_runs_update" ON payroll_runs;
CREATE POLICY "payroll_runs_update" ON payroll_runs FOR UPDATE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_runs_delete" ON payroll_runs;
CREATE POLICY "payroll_runs_delete" ON payroll_runs FOR DELETE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_lines_select" ON payroll_lines;
CREATE POLICY "payroll_lines_select" ON payroll_lines FOR SELECT TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_lines_insert" ON payroll_lines;
CREATE POLICY "payroll_lines_insert" ON payroll_lines FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_lines_update" ON payroll_lines;
CREATE POLICY "payroll_lines_update" ON payroll_lines FOR UPDATE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

DROP POLICY IF EXISTS "payroll_lines_delete" ON payroll_lines;
CREATE POLICY "payroll_lines_delete" ON payroll_lines FOR DELETE TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director());
