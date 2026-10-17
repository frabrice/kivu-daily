/*
# Company plan, phase 2: money (MD, 17 Oct 2026) - full plan access only

- company_money_settings: monthly running costs (3,000,000 RWF to start,
  the MD's figure), commission % (9.5).
- company_cash_checks: Finance records the balance of each account on a
  date; "own" = Kivu Ride's money (the Fleet Collection account and Mobile
  Money hold owners' and drivers' money, so they don't count by default).
- company_funding (+ company_funding_uses): the funding pipeline - status,
  probability, expected date, whether the money reaches Kivu Ride's own
  accounts (asset finance paid to the supplier does not), and what it pays for.
- company_scenarios: saved what-if scenarios.
- company_money_live(): last-30-day facts for the runway (own income in the
  ledger, completed trips and fares, managed cars).
*/

CREATE TABLE IF NOT EXISTS company_money_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_costs numeric NOT NULL DEFAULT 3000000,
  commission_pct numeric NOT NULL DEFAULT 9.5,
  notes text,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO company_money_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS company_cash_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_on date NOT NULL,
  account_key text NOT NULL,                       -- finance_accounts.key, or 'other:<label>'
  label text NOT NULL,
  amount numeric NOT NULL,
  is_own boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_cash_checks_latest ON company_cash_checks (account_key, checked_on DESC, created_at DESC);

CREATE SEQUENCE IF NOT EXISTS company_funding_number;
CREATE TABLE IF NOT EXISTS company_funding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('company_funding_number') UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  kind text NOT NULL CHECK (kind IN ('asset_finance', 'equity', 'driver_scheme', 'loan', 'grant', 'partner', 'other')),
  counterparty text,
  amount numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('idea', 'pending', 'agreed', 'received', 'lost')),
  probability int CHECK (probability BETWEEN 0 AND 100),
  expected_date date,
  received_amount numeric NOT NULL DEFAULT 0,
  received_date date,
  cash_to_company boolean NOT NULL DEFAULT true,   -- does it land in Kivu Ride's own accounts?
  terms text,
  next_step text,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_funding_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_id uuid NOT NULL REFERENCES company_funding(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  budget_id uuid REFERENCES company_budgets(id) ON DELETE SET NULL,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS company_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  inputs jsonb NOT NULL,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Last 30 days, for the runway. Own income = what Finance records as Kivu
-- Ride's money (management margins, onboarding fees, other revenue).
CREATE OR REPLACE FUNCTION company_money_live() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT is_plan_admin() THEN NULL ELSE jsonb_build_object(
    'own_income_30d', (SELECT COALESCE(sum(amount), 0) FROM finance_transactions
                       WHERE direction = 'in' AND type IN ('management_margin', 'onboarding_fee', 'revenue') AND status <> 'rejected' AND transaction_date > current_date - 30),
    'own_income_by_type', (SELECT COALESCE(jsonb_object_agg(type, s), '{}') FROM (SELECT type, sum(amount) s FROM finance_transactions
                       WHERE direction = 'in' AND type IN ('management_margin', 'onboarding_fee', 'revenue') AND status <> 'rejected' AND transaction_date > current_date - 30 GROUP BY type) x),
    'completed_30d', (SELECT count(*) FROM platform_trips WHERE status = 'completed' AND COALESCE(requested_at, created_at) > now() - interval '30 days'),
    'fares_30d', (SELECT COALESCE(sum(total_fare), 0) FROM platform_trips WHERE status = 'completed' AND COALESCE(requested_at, created_at) > now() - interval '30 days'),
    'managed_cars', (SELECT count(*) FROM vehicles WHERE owner_id IS NOT NULL AND operation_start_date IS NOT NULL AND operation_start_date <= current_date),
    'ledger_since', (SELECT min(transaction_date) FROM finance_transactions)
  ) END;
$$;

-- ------------------------------------------------------------ access: full plan access only
ALTER TABLE company_money_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_cash_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_funding ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_funding_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_scenarios ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_money_settings', 'company_cash_checks', 'company_funding', 'company_funding_uses', 'company_scenarios'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (is_plan_admin()) WITH CHECK (is_plan_admin())', t || '_admin', t);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION company_money_live() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_money_live() TO authenticated;

-- ------------------------------------------------------------ the pipeline as the MD described it (17 Oct 2026)
DO $$
DECLARE md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1); f uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM company_funding) THEN RETURN; END IF;
  PERFORM setval('company_funding_number', 1, false);
  INSERT INTO company_funding (name, kind, amount, status, probability, expected_date, cash_to_company, terms, next_step, owner_id, sort, created_by)
  VALUES ('30 financed EVs (Geely EX2)', 'asset_finance', 90000000, 'agreed', 100, '2026-12-15', false,
    'Investor secured. Finances tranche one of 30 Geely EX2; the cars are expected by December 2026. The money goes to the cars, not into Kivu Ride''s accounts.',
    'Prepare drivers, branding, devices and charging for the arrival.', md, 1, md) RETURNING id INTO f;
  INSERT INTO company_funding_uses (funding_id, description, amount, sort) VALUES (f, '30 Geely EX2 (tranche one)', 90000000, 0);
  INSERT INTO company_funding (name, kind, amount, status, probability, expected_date, cash_to_company, terms, next_step, owner_id, sort, created_by)
  VALUES ('Vision Drivers Ltd: driver-owned EVs', 'driver_scheme', NULL, 'pending', NULL, NULL, true,
    'Each driver from Vision Drivers Ltd pays RWF 3,000,000. Kivu Ride pays the 5% deposit on more cars. The drivers operate them for 3 years paying 45,000 RWF per day, then own the car.',
    'Agree the number of drivers and cars, and the supplier terms per car.', md, 2, md);
  INSERT INTO company_funding (name, kind, amount, status, probability, cash_to_company, terms, owner_id, sort, created_by)
  VALUES ('Equity: 10% for RWF 30M', 'equity', 30000000, 'pending', NULL, true, '10% of Kivu Ride Ltd for RWF 30,000,000 (newly issued shares, cash into the company).', md, 3, md);
  INSERT INTO company_funding (name, kind, amount, status, probability, cash_to_company, terms, owner_id, sort, created_by)
  VALUES ('Charging stations & car wash investor', 'partner', NULL, 'pending', NULL, false, 'Interested in charging stations, a car wash and the drivers association - not the platform itself.', md, 4, md);
END $$;
