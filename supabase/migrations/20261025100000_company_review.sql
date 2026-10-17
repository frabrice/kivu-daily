/*
# Company plan, phase 4: the monthly partners' review and the decisions log (MD, 17 Oct 2026)

- company_monthly_reviews: one row per month (first day) - meeting notes,
  who attended, and a frozen copy of the numbers when it is marked as held.
- company_decisions: the company decisions log (D1, D2...): context, what was
  decided, options, consequences, linked to a priority / budget / funding
  source / expansion stage. Full access sees all; department heads see the
  decisions that involve their department.
- company_month_facts(from, to): the month's facts for the review, from
  every part of Kivu Daily (trips, ledger, budgets, IT delivery), for the MD
  and full plan access (and the server, for the monthly email).
- Email on the 1st of each month: last month at Kivu Ride.
*/

CREATE TABLE IF NOT EXISTS company_monthly_reviews (
  month date PRIMARY KEY CHECK (extract(day FROM month) = 1),
  highlights text,
  problems text,
  next_focus text,
  notes text,
  attendees uuid[] NOT NULL DEFAULT '{}',
  held_at timestamptz,
  held_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  snapshot jsonb,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS company_decision_number;
CREATE TABLE IF NOT EXISTS company_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('company_decision_number') UNIQUE,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  context text,
  decision text,
  options text,
  consequences text,
  departments text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'decided' CHECK (status IN ('proposed', 'decided', 'superseded', 'reversed')),
  decided_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at date,
  priority_id uuid REFERENCES company_priorities(id) ON DELETE SET NULL,
  budget_id uuid REFERENCES company_budgets(id) ON DELETE SET NULL,
  funding_id uuid REFERENCES company_funding(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES company_expansion_stages(id) ON DELETE SET NULL,
  superseded_by uuid REFERENCES company_decisions(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION company_month_facts(p_from date, p_to date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND NOT is_plan_admin() THEN NULL ELSE jsonb_build_object(
    'own_income_by_type', (SELECT COALESCE(jsonb_object_agg(type, s), '{}') FROM (SELECT type, sum(amount) s FROM finance_transactions
        WHERE direction = 'in' AND type IN ('management_margin', 'onboarding_fee', 'revenue') AND status <> 'rejected' AND transaction_date BETWEEN p_from AND p_to GROUP BY type) x),
    'spent_by_type', (SELECT COALESCE(jsonb_object_agg(type, s), '{}') FROM (SELECT type, sum(amount) s FROM finance_transactions
        WHERE direction = 'out' AND type <> 'transfer' AND status <> 'rejected' AND transaction_date BETWEEN p_from AND p_to GROUP BY type) x),
    'budget_spent', (SELECT COALESCE(sum(amount), 0) FROM finance_transactions WHERE company_budget_id IS NOT NULL AND direction = 'out' AND status <> 'rejected' AND transaction_date BETWEEN p_from AND p_to),
    'trips', (SELECT jsonb_build_object('requested', count(*), 'completed', count(*) FILTER (WHERE status = 'completed'),
        'no_driver', count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NULL), 'fares', COALESCE(sum(total_fare) FILTER (WHERE status = 'completed'), 0))
        FROM platform_trips WHERE (COALESCE(requested_at, created_at) AT TIME ZONE 'Africa/Kigali')::date BETWEEN p_from AND p_to),
    'managed_cars', (SELECT count(*) FROM vehicles WHERE owner_id IS NOT NULL AND operation_start_date IS NOT NULL AND operation_start_date <= p_to),
    'it', jsonb_build_object(
        'issues_done', (SELECT count(*) FROM it_issues WHERE status = 'done' AND (completed_at AT TIME ZONE 'Africa/Kigali')::date BETWEEN p_from AND p_to),
        'bugs_fixed', (SELECT count(*) FROM it_issues WHERE status = 'done' AND type = 'bug' AND (completed_at AT TIME ZONE 'Africa/Kigali')::date BETWEEN p_from AND p_to),
        'releases', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', CASE platform WHEN 'app' THEN 'Mobile app' WHEN 'dashboard' THEN 'Dashboard' WHEN 'backend' THEN 'Backend' WHEN 'admin' THEN 'Admin panel' ELSE 'Website' END || ' ' || version, 'status', status) ORDER BY released_at), '[]')
                     FROM it_releases WHERE released_at IS NOT NULL AND (released_at AT TIME ZONE 'Africa/Kigali')::date BETWEEN p_from AND p_to),
        'milestones_completed', (SELECT COALESCE(jsonb_agg('M' || number || ' ' || name ORDER BY end_date), '[]') FROM it_milestones WHERE status = 'completed' AND end_date BETWEEN p_from AND p_to),
        'milestones_active', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', 'M' || m.number || ' ' || m.name, 'end', m.end_date,
            'done', (SELECT count(*) FROM it_issues i WHERE i.milestone_id = m.id AND i.status = 'done'), 'total', (SELECT count(*) FROM it_issues i WHERE i.milestone_id = m.id AND i.status <> 'wont_do'))
            ORDER BY m.end_date), '[]') FROM it_milestones m WHERE m.status IN ('planned', 'active') AND m.start_date <= p_to AND m.end_date >= p_from)
    )
  ) END;
$$;

-- ------------------------------------------------------------ access
ALTER TABLE company_monthly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmr_admin ON company_monthly_reviews; CREATE POLICY cmr_admin ON company_monthly_reviews FOR ALL TO authenticated USING (is_plan_admin()) WITH CHECK (is_plan_admin());
DROP POLICY IF EXISTS cd_select ON company_decisions; CREATE POLICY cd_select ON company_decisions FOR SELECT TO authenticated USING (is_plan_admin() OR plan_head_dept() = ANY (departments));
DROP POLICY IF EXISTS cd_write ON company_decisions; CREATE POLICY cd_write ON company_decisions FOR ALL TO authenticated USING (is_plan_admin()) WITH CHECK (is_plan_admin());
REVOKE EXECUTE ON FUNCTION company_month_facts(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_month_facts(date, date) TO authenticated;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE company_monthly_reviews; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Decisions already taken (17 Oct 2026), so the log starts with them.
DO $$
DECLARE md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
BEGIN
  IF EXISTS (SELECT 1 FROM company_decisions) THEN RETURN; END IF;
  PERFORM setval('company_decision_number', 1, false);
  INSERT INTO company_decisions (title, context, decision, departments, status, decided_by, decided_at, created_by) VALUES
    ('Expand to all of Rwanda by the end of 2026', 'Kivu Ride operates only in Kigali.', 'Be present in every province by 31 December 2026 (see Expansion, stage S3).', ARRAY['fleet', 'marketing_sales_bd'], 'decided', md, '2026-10-17', md),
    ('Company plan access', 'The plan holds money, funding and priorities.', 'The MD and Rodrigue see everything; department heads see the direction and their own department''s priorities and budgets.', '{}', 'decided', md, '2026-10-17', md),
    ('Budgets are built one by one and approved by the MD', 'Spending needs a plan before it happens.', 'Each department builds its budgets (marketing, fleet, office...) with the guided questions; the MD approves; Finance records spending against them. A combined company budget follows from them.', ARRAY['finance'], 'decided', md, '2026-10-17', md);
END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('company_monthly_review', 'Last month at Kivu Ride', 'On the 1st: trips, income, spending, budgets, IT delivery and decisions of the month before, with the link to the review page - for the MD and full plan access.', '1st of the month 09:00', ARRAY['md'], 3, 472, 'Company plan', true)
ON CONFLICT (key) DO NOTHING;
