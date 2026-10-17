/*
# Company plan, phase 1 (MD, 17 Oct 2026)

The company's direction in Kivu Daily, for the MD and the owners:
- company_plan_members: who sees the plan. "full" = everything (the MD
  always; Rodrigue); "department" = a department head, who sees the
  vision and objectives plus their own department's priorities and budgets.
- company_vision: vision, 3-year ambition, the North Star (completed trips
  per day) with its target and break-even.
- company_objectives + company_key_results: quarterly objectives; key
  results can read live trip numbers.
- company_priorities: one ranked list of company bets (Now / Next / Later /
  Not doing), scored on impact, confidence, ease and urgency; IT projects
  link in.
- company_budgets + company_budget_lines: budgets built one by one (guided
  questions), submitted by their owner, approved by the MD / full access;
  spending recorded by Finance (finance_transactions.company_budget_id).
*/

CREATE TABLE IF NOT EXISTS company_plan_members (
  profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  access text NOT NULL CHECK (access IN ('full', 'department')),
  department_slug text,
  added_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  CHECK (access = 'full' OR department_slug IS NOT NULL)
);

CREATE OR REPLACE FUNCTION is_plan_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR EXISTS (SELECT 1 FROM company_plan_members WHERE profile_id = auth.uid() AND access = 'full');
$$;
CREATE OR REPLACE FUNCTION plan_head_dept() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_slug FROM company_plan_members WHERE profile_id = auth.uid() AND access = 'department';
$$;
CREATE OR REPLACE FUNCTION is_plan_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_plan_admin() OR EXISTS (SELECT 1 FROM company_plan_members WHERE profile_id = auth.uid());
$$;

CREATE TABLE IF NOT EXISTS company_vision (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vision text,
  mission text,
  ambition text,                                   -- where we are in 3 years
  north_star_name text NOT NULL DEFAULT 'Completed trips per day',
  north_star_target numeric,
  north_star_target_date date,
  break_even_per_day numeric NOT NULL DEFAULT 93,  -- 950 RWF/trip vs ~3M RWF/month running cost
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO company_vision (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS company_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL,                            -- 2026-Q4
  title text NOT NULL CHECK (length(trim(title)) > 0),
  why text,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  departments text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'achieved', 'missed', 'dropped')),
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_key_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES company_objectives(id) ON DELETE CASCADE,
  title text NOT NULL,
  unit text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'completed_per_day', 'requests_per_day', 'completion_pct', 'no_driver_pct')),
  start_value numeric NOT NULL DEFAULT 0,
  target_value numeric NOT NULL,
  current_value numeric NOT NULL DEFAULT 0,
  lower_is_better boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS company_priority_number;
CREATE TABLE IF NOT EXISTS company_priorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('company_priority_number') UNIQUE,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  problem text,                                    -- why it matters
  expected_impact text,                            -- what changes, ideally in North Star terms
  departments text[] NOT NULL DEFAULT '{}',
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  objective_id uuid REFERENCES company_objectives(id) ON DELETE SET NULL,
  horizon text NOT NULL DEFAULT 'next' CHECK (horizon IN ('now', 'next', 'later', 'not_doing')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'done', 'dropped')),
  impact_score int CHECK (impact_score BETWEEN 1 AND 5),
  confidence_score int CHECK (confidence_score BETWEEN 1 AND 5),
  ease_score int CHECK (ease_score BETWEEN 1 AND 5),
  urgency_score int CHECK (urgency_score BETWEEN 1 AND 5),
  start_date date,
  target_date date,
  it_initiative_id uuid REFERENCES it_initiatives(id) ON DELETE SET NULL,
  notes text,
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS company_budget_number;
CREATE TABLE IF NOT EXISTS company_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('company_budget_number') UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  kind text NOT NULL CHECK (kind IN ('marketing', 'operations', 'people', 'fleet', 'it', 'expansion', 'other')),
  department_slug text,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  start_month date NOT NULL,                       -- first day of the first month
  months int NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 36),
  goal text,                                       -- what it should achieve
  expected_result text,
  target_value numeric,
  target_unit text,                                -- e.g. new riders, corporate accounts
  priority_id uuid REFERENCES company_priorities(id) ON DELETE SET NULL,
  objective_id uuid REFERENCES company_objectives(id) ON DELETE SET NULL,
  answers jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'closed')),
  approved_amount numeric,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  decision_note text,
  submitted_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES company_budgets(id) ON DELETE CASCADE,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),     -- per month when monthly
  recurrence text NOT NULL DEFAULT 'one_off' CHECK (recurrence IN ('one_off', 'monthly')),
  months int NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 36),
  notes text,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS company_budget_id uuid REFERENCES company_budgets(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION company_budget_planned(p_id uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(amount * CASE WHEN recurrence = 'monthly' THEN months ELSE 1 END), 0) FROM company_budget_lines WHERE budget_id = p_id;
$$;

-- Who may work on a budget: plan admins, or the head of its department.
CREATE OR REPLACE FUNCTION can_edit_company_budget(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_plan_admin() OR EXISTS (SELECT 1 FROM company_budgets b WHERE b.id = p_id AND b.department_slug IS NOT NULL AND b.department_slug = plan_head_dept() AND b.status IN ('draft', 'rejected', 'approved'));
$$;

-- Approval fields only change through the RPCs below.
CREATE OR REPLACE FUNCTION company_budget_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.uid() IS NULL OR current_setting('kivu.plan_decision', true) = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft'; NEW.approved_amount := NULL; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.decision_note := NULL; NEW.submitted_at := NULL;
    RETURN NEW;
  END IF;
  NEW.approved_amount := OLD.approved_amount; NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
  NEW.decision_note := OLD.decision_note; NEW.submitted_at := OLD.submitted_at;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (is_plan_admin() AND NEW.status IN ('closed', 'draft')) THEN
    RAISE EXCEPTION 'Use Submit / Approve to change the status of a budget';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_budget_guard ON company_budgets;
CREATE TRIGGER company_budget_guard BEFORE INSERT OR UPDATE ON company_budgets FOR EACH ROW EXECUTE FUNCTION company_budget_guard();

CREATE OR REPLACE FUNCTION submit_company_budget(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v company_budgets%ROWTYPE;
BEGIN
  SELECT * INTO v FROM company_budgets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget not found'; END IF;
  IF NOT (is_plan_admin() OR (v.department_slug IS NOT NULL AND v.department_slug = plan_head_dept())) THEN RAISE EXCEPTION 'Only the head of this department or the MD can submit it'; END IF;
  IF v.status IN ('submitted', 'closed') THEN RAISE EXCEPTION 'This budget is already %', v.status; END IF;
  IF company_budget_planned(p_id) <= 0 THEN RAISE EXCEPTION 'Add at least one line with an amount first'; END IF;
  IF NULLIF(trim(COALESCE(v.goal, '')), '') IS NULL THEN RAISE EXCEPTION 'Say what the budget should achieve before submitting it'; END IF;
  PERFORM set_config('kivu.plan_decision', '1', true);
  UPDATE company_budgets SET status = 'submitted', submitted_at = now() WHERE id = p_id;
  PERFORM set_config('kivu.plan_decision', '', true);
  INSERT INTO notification_events (rule_key, payload) VALUES ('company_budget_submitted', jsonb_build_object('budget_id', p_id, 'actor_id', auth.uid()));
END $$;

-- Approve: the planned total becomes the approved amount. Decline: a budget
-- approved before keeps its old amount; a new one is rejected.
CREATE OR REPLACE FUNCTION decide_company_budget(p_id uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v company_budgets%ROWTYPE; v_keep boolean;
BEGIN
  IF NOT is_plan_admin() THEN RAISE EXCEPTION 'Only the MD (or full plan access) approves budgets'; END IF;
  SELECT * INTO v FROM company_budgets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget not found'; END IF;
  IF NOT p_approve AND NULLIF(trim(COALESCE(p_note, '')), '') IS NULL THEN RAISE EXCEPTION 'Say why it is not approved'; END IF;
  v_keep := NOT p_approve AND v.approved_amount IS NOT NULL;
  PERFORM set_config('kivu.plan_decision', '1', true);
  UPDATE company_budgets SET
    status = CASE WHEN p_approve OR v_keep THEN 'approved' ELSE 'rejected' END,
    approved_amount = CASE WHEN p_approve THEN company_budget_planned(p_id) ELSE v.approved_amount END,
    approved_by = auth.uid(), approved_at = CASE WHEN p_approve THEN now() ELSE v.approved_at END,
    decision_note = NULLIF(trim(COALESCE(p_note, '')), '')
  WHERE id = p_id;
  PERFORM set_config('kivu.plan_decision', '', true);
  INSERT INTO notification_events (rule_key, payload)
  VALUES ('company_budget_decided', jsonb_build_object('budget_id', p_id, 'approved', p_approve, 'kept', v_keep, 'recipient_id', COALESCE(v.owner_id, v.created_by), 'actor_id', auth.uid()));
END $$;

-- Spending linked to budgets (Finance records it in the ledger).
CREATE OR REPLACE FUNCTION company_budget_spending() RETURNS TABLE (id uuid, company_budget_id uuid, amount numeric, transaction_date date, status text, description text, counterparty text, reference text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.company_budget_id, t.amount, t.transaction_date, t.status, t.description, t.counterparty, t.reference
  FROM finance_transactions t JOIN company_budgets b ON b.id = t.company_budget_id
  WHERE t.direction = 'out' AND t.status <> 'rejected'
    AND (is_plan_admin() OR current_department_slug() = 'finance' OR (b.department_slug IS NOT NULL AND b.department_slug = plan_head_dept()));
$$;

-- The North Star and live key results, per Kigali day.
CREATE OR REPLACE FUNCTION company_trips_daily(p_from date, p_to date) RETURNS TABLE (day date, requested bigint, completed bigint, no_driver bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (COALESCE(requested_at, created_at) AT TIME ZONE 'Africa/Kigali')::date, count(*),
         count(*) FILTER (WHERE status = 'completed'), count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NULL)
  FROM platform_trips
  WHERE (auth.uid() IS NULL OR is_plan_member())
    AND COALESCE(requested_at, created_at) >= (p_from::timestamp AT TIME ZONE 'Africa/Kigali')
    AND COALESCE(requested_at, created_at) < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Kigali')
  GROUP BY 1 ORDER BY 1;
$$;

-- ------------------------------------------------------------ access
ALTER TABLE company_plan_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_vision ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_key_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_budget_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpm_select ON company_plan_members; CREATE POLICY cpm_select ON company_plan_members FOR SELECT TO authenticated USING (profile_id = auth.uid() OR is_plan_admin());
DROP POLICY IF EXISTS cpm_write ON company_plan_members;  CREATE POLICY cpm_write ON company_plan_members FOR ALL TO authenticated USING (is_managing_director()) WITH CHECK (is_managing_director());

DROP POLICY IF EXISTS cv_select ON company_vision; CREATE POLICY cv_select ON company_vision FOR SELECT TO authenticated USING (is_plan_member());
DROP POLICY IF EXISTS cv_update ON company_vision; CREATE POLICY cv_update ON company_vision FOR UPDATE TO authenticated USING (is_plan_admin()) WITH CHECK (is_plan_admin());

DROP POLICY IF EXISTS co_select ON company_objectives; CREATE POLICY co_select ON company_objectives FOR SELECT TO authenticated USING (is_plan_member());
DROP POLICY IF EXISTS co_write ON company_objectives;  CREATE POLICY co_write ON company_objectives FOR ALL TO authenticated USING (is_plan_admin()) WITH CHECK (is_plan_admin());
DROP POLICY IF EXISTS ckr_select ON company_key_results; CREATE POLICY ckr_select ON company_key_results FOR SELECT TO authenticated USING (is_plan_member());
DROP POLICY IF EXISTS ckr_write ON company_key_results;  CREATE POLICY ckr_write ON company_key_results FOR ALL TO authenticated USING (is_plan_admin()) WITH CHECK (is_plan_admin());

-- Heads see and propose priorities for their own department.
DROP POLICY IF EXISTS cp_select ON company_priorities; CREATE POLICY cp_select ON company_priorities FOR SELECT TO authenticated USING (is_plan_admin() OR plan_head_dept() = ANY (departments));
DROP POLICY IF EXISTS cp_insert ON company_priorities; CREATE POLICY cp_insert ON company_priorities FOR INSERT TO authenticated WITH CHECK (is_plan_admin() OR (status = 'proposed' AND plan_head_dept() = ANY (departments)));
DROP POLICY IF EXISTS cp_update ON company_priorities; CREATE POLICY cp_update ON company_priorities FOR UPDATE TO authenticated
  USING (is_plan_admin() OR (created_by = auth.uid() AND status = 'proposed')) WITH CHECK (is_plan_admin() OR (status = 'proposed' AND plan_head_dept() = ANY (departments)));
DROP POLICY IF EXISTS cp_delete ON company_priorities; CREATE POLICY cp_delete ON company_priorities FOR DELETE TO authenticated USING (is_plan_admin());

-- Budgets: admins all; heads their department; Finance reads all (to record spending).
DROP POLICY IF EXISTS cb_select ON company_budgets; CREATE POLICY cb_select ON company_budgets FOR SELECT TO authenticated
  USING (is_plan_admin() OR current_department_slug() = 'finance' OR (department_slug IS NOT NULL AND department_slug = plan_head_dept()));
DROP POLICY IF EXISTS cb_insert ON company_budgets; CREATE POLICY cb_insert ON company_budgets FOR INSERT TO authenticated
  WITH CHECK (is_plan_admin() OR (department_slug IS NOT NULL AND department_slug = plan_head_dept()));
DROP POLICY IF EXISTS cb_update ON company_budgets; CREATE POLICY cb_update ON company_budgets FOR UPDATE TO authenticated
  USING (can_edit_company_budget(id)) WITH CHECK (is_plan_admin() OR (department_slug IS NOT NULL AND department_slug = plan_head_dept()));
DROP POLICY IF EXISTS cb_delete ON company_budgets; CREATE POLICY cb_delete ON company_budgets FOR DELETE TO authenticated USING (is_plan_admin() OR (status = 'draft' AND created_by = auth.uid()));
DROP POLICY IF EXISTS cbl_select ON company_budget_lines; CREATE POLICY cbl_select ON company_budget_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM company_budgets b WHERE b.id = budget_id));
DROP POLICY IF EXISTS cbl_write ON company_budget_lines; CREATE POLICY cbl_write ON company_budget_lines FOR ALL TO authenticated
  USING (can_edit_company_budget(budget_id)) WITH CHECK (can_edit_company_budget(budget_id));

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['is_plan_admin()', 'plan_head_dept()', 'is_plan_member()', 'company_budget_planned(uuid)', 'can_edit_company_budget(uuid)', 'company_budget_guard()',
    'submit_company_budget(uuid)', 'decide_company_budget(uuid, boolean, text)', 'company_budget_spending()', 'company_trips_daily(date, date)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('company_budget_submitted', 'Budget to approve', 'A department submitted a budget for approval (to the MD and full plan access).', 'Instant', ARRAY['md'], 3, 470, 'Company plan', true),
  ('company_budget_decided', 'Budget decided', 'Tells the budget owner it was approved or not.', 'Instant', ARRAY['actor'], 3, 471, 'Company plan', true)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------ first content (drafts to discuss)
DO $$
DECLARE
  md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
  rod uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'MUGISHA Rodrigue%' LIMIT 1);
  cto uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'NIYOKWIZERWA Fabrice%' LIMIT 1);
  o1 uuid; o2 uuid; o3 uuid; o4 uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM company_objectives) THEN RETURN; END IF;
  PERFORM setval('company_priority_number', 1, false);
  IF NOT EXISTS (SELECT 1 FROM company_budgets) THEN PERFORM setval('company_budget_number', 1, false); END IF;
  IF rod IS NOT NULL THEN INSERT INTO company_plan_members (profile_id, access, added_by) VALUES (rod, 'full', md) ON CONFLICT DO NOTHING; END IF;
  IF cto IS NOT NULL THEN INSERT INTO company_plan_members (profile_id, access, department_slug, added_by) VALUES (cto, 'department', 'it', md) ON CONFLICT DO NOTHING; END IF;

  UPDATE company_vision SET north_star_target_date = '2026-12-31' WHERE id = 1;

  INSERT INTO company_objectives (period, title, why, owner_id, departments, status, sort, created_by) VALUES
    ('2026-Q4', 'Win every ride request in Kigali', 'About 4 in 10 requests are lost today (no driver found or cancelled). Every one was a rider ready to pay.', md, ARRAY['fleet', 'call_center', 'it'], 'draft', 1, md) RETURNING id INTO o1;
  INSERT INTO company_objectives (period, title, why, owner_id, departments, status, sort, created_by) VALUES
    ('2026-Q4', 'Grow completed trips toward break-even', 'About 6 completed trips a day in October; break-even is about 93.', md, ARRAY['marketing_sales_bd', 'social_media'], 'draft', 2, md) RETURNING id INTO o2;
  INSERT INTO company_objectives (period, title, why, owner_id, departments, status, sort, created_by) VALUES
    ('2026-Q4', 'Put the 30 financed EVs on the road', 'The investor is in; the cars are expected by December.', md, ARRAY['fleet', 'finance'], 'draft', 3, md) RETURNING id INTO o3;
  INSERT INTO company_objectives (period, title, why, owner_id, departments, status, sort, created_by) VALUES
    ('2026-Q4', 'Be present across Rwanda by 31 December', 'Today we are only in Kigali.', md, ARRAY['fleet', 'marketing_sales_bd'], 'draft', 4, md) RETURNING id INTO o4;

  INSERT INTO company_key_results (objective_id, title, unit, source, start_value, target_value, current_value, lower_is_better, sort) VALUES
    (o1, 'Requests completed', '%', 'completion_pct', 58, 75, 58, false, 1),
    (o1, 'Requests with no driver found', '%', 'no_driver_pct', 22, 10, 22, true, 2),
    (o2, 'Completed trips per day (7-day average)', 'trips', 'completed_per_day', 6, 25, 6, false, 1),
    (o2, 'Ride requests per day (7-day average)', 'requests', 'requests_per_day', 11, 40, 11, false, 2),
    (o3, 'Financed EVs on the road', 'cars', 'manual', 0, 30, 0, false, 1),
    (o3, 'Drivers trained for them (2 per car)', 'drivers', 'manual', 0, 60, 0, false, 2),
    (o4, 'Provinces where riders can get a ride', 'provinces', 'manual', 1, 5, 1, false, 1);

  INSERT INTO company_priorities (title, problem, expected_impact, departments, owner_id, objective_id, horizon, status, sort, created_by) VALUES
    ('Win every ride request in Kigali', '20–28% of requests find no driver and ~17% are cancelled after a driver accepted.', 'Each lost request won back is a completed trip with no marketing cost.', ARRAY['fleet', 'call_center', 'it'], md, o1, 'now', 'proposed', 1, md),
    ('Launch the 30 financed EVs (arriving by December)', 'Cars, drivers, branding, devices and charging must be ready the day they arrive.', '30 cars × 2 drivers on the road from day one.', ARRAY['fleet', 'finance'], md, o3, 'now', 'proposed', 2, md),
    ('Grow demand: corporate accounts, airport, partners', 'Riders are the constraint once supply is reliable.', 'Steady weekday demand from companies and the airport.', ARRAY['marketing_sales_bd'], md, o2, 'now', 'proposed', 3, md),
    ('Be present across Rwanda by 31 December', 'We are only in Kigali.', 'Riders can get a Kivu Ride in every province.', ARRAY['fleet', 'marketing_sales_bd'], md, o4, 'now', 'proposed', 4, md),
    ('Vision Drivers Ltd: drivers own their EV after 3 years', 'Drivers from Vision Drivers Ltd pay RWF 3M; Kivu Ride pays the 5% deposit on more cars; drivers pay 45,000/day for 3 years and then own the car.', 'More cars without Kivu Ride owning them; committed driver-owners.', ARRAY['finance', 'fleet'], md, NULL, 'next', 'proposed', 5, md);

  -- IT projects compete in the same list.
  INSERT INTO company_priorities (title, problem, expected_impact, departments, owner_id, horizon, status, sort, it_initiative_id, created_by)
  SELECT i.name, i.problem, i.outcome, ARRAY['it'], i.owner_id, i.horizon, 'proposed', 10 + i.number, i.id, md FROM it_initiatives i
  WHERE i.status NOT IN ('declined', 'cancelled', 'done') ORDER BY i.number;
END $$;
