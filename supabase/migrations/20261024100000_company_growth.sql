/*
# Company plan, phase 3: expansion and the marketing plan (MD, 17 Oct 2026)

Expansion (all plan members read; the MD / full access edit):
- company_expansion_stages: the journey (Kigali -> 30 EVs -> one town per
  province by 31 Dec 2026 -> ...), each with places, status, target date and
  an expansion budget.
- company_expansion_gates: what must be true before a stage starts - live
  from trips/money, a number updated by hand, or a yes/no check.
- company_expansion_needs: what the stage needs (cars, drivers, charging,
  people, marketing, permits...), with quantity, cost and status.

Marketing plan (full access, plus heads of the departments on each activity):
- company_marketing_activities: grouped by the need they serve (drivers,
  riders, companies, launch in new towns, brand), with channel, months,
  planned cost, budget, expected vs actual result, and an optional CRM
  campaign (its won companies are counted live).
*/

CREATE SEQUENCE IF NOT EXISTS company_stage_number;
CREATE TABLE IF NOT EXISTS company_expansion_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('company_stage_number') UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  summary text,
  places text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'preparing', 'live', 'paused', 'dropped')),
  target_date date,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  budget_id uuid REFERENCES company_budgets(id) ON DELETE SET NULL,
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_expansion_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES company_expansion_stages(id) ON DELETE CASCADE,
  title text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'check', 'completed_per_day', 'requests_per_day', 'completion_pct', 'no_driver_pct', 'monthly_surplus', 'managed_cars')),
  comparator text NOT NULL DEFAULT '>=' CHECK (comparator IN ('>=', '<=')),
  target numeric,
  current_value numeric,
  done boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS company_expansion_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES company_expansion_stages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('cars', 'drivers', 'charging', 'people', 'office', 'marketing', 'money', 'legal', 'tech', 'other')),
  description text NOT NULL,
  quantity numeric,
  cost numeric,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  due_date date,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS company_marketing_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  need text NOT NULL CHECK (need IN ('drivers', 'riders', 'companies', 'launch', 'brand')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  channel text NOT NULL DEFAULT 'other',
  description text,
  start_month date NOT NULL,
  months int NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 24),
  planned_cost numeric NOT NULL DEFAULT 0,
  actual_cost numeric,
  budget_id uuid REFERENCES company_budgets(id) ON DELETE SET NULL,
  expected_value numeric,
  expected_unit text,
  actual_value numeric,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'done', 'stopped')),
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  departments text[] NOT NULL DEFAULT '{marketing_sales_bd}',
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES company_expansion_stages(id) ON DELETE SET NULL,
  notes text,
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Results of the B2B outreach campaigns, for the marketing plan.
CREATE OR REPLACE FUNCTION company_campaign_results() RETURNS TABLE (id uuid, name text, status text, contacts bigint, contacted bigint, negotiating bigint, won bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.status, count(k.id), count(k.id) FILTER (WHERE k.stage <> 'not_contacted'), count(k.id) FILTER (WHERE k.stage = 'negotiating'), count(k.id) FILTER (WHERE k.stage = 'won')
  FROM campaigns c LEFT JOIN contacts k ON k.campaign_id = c.id
  WHERE is_plan_member()
  GROUP BY c.id, c.name, c.status;
$$;

-- ------------------------------------------------------------ access
ALTER TABLE company_expansion_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_expansion_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_expansion_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_marketing_activities ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_expansion_stages', 'company_expansion_gates', 'company_expansion_needs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_plan_member())', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (is_plan_admin()) WITH CHECK (is_plan_admin())', t || '_write', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS cma_select ON company_marketing_activities; CREATE POLICY cma_select ON company_marketing_activities FOR SELECT TO authenticated USING (is_plan_admin() OR plan_head_dept() = ANY (departments));
DROP POLICY IF EXISTS cma_write ON company_marketing_activities; CREATE POLICY cma_write ON company_marketing_activities FOR ALL TO authenticated
  USING (is_plan_admin() OR plan_head_dept() = ANY (departments)) WITH CHECK (is_plan_admin() OR plan_head_dept() = ANY (departments));
REVOKE EXECUTE ON FUNCTION company_campaign_results() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_campaign_results() TO authenticated;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE company_expansion_stages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE company_marketing_activities; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------ first drafts (to edit together)
DO $$
DECLARE
  md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
  s1 uuid; s2 uuid; s3 uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM company_expansion_stages) THEN RETURN; END IF;
  PERFORM setval('company_stage_number', 1, false);

  INSERT INTO company_expansion_stages (name, summary, places, status, owner_id, sort, created_by) VALUES
    ('Kigali: win every request, cover our costs', 'Prove the model where we are: riders always find a car, and Kivu Ride earns more than it spends.', ARRAY['Kigali'], 'live', md, 1, md) RETURNING id INTO s1;
  INSERT INTO company_expansion_stages (name, summary, places, status, target_date, owner_id, sort, created_by) VALUES
    ('Kigali scale: the 30 financed EVs', 'The 30 financed Geely EX2 arrive by December: on the road from day one with two trained drivers each.', ARRAY['Kigali'], 'preparing', '2026-12-31', md, 2, md) RETURNING id INTO s2;
  INSERT INTO company_expansion_stages (name, summary, places, status, target_date, owner_id, sort, created_by) VALUES
    ('All Rwanda: one town in every province', 'Riders can get a Kivu Ride in the main town of each province. Start small in each town (a few cars, local drivers, a coordinator) and grow where the trips come.', ARRAY['Musanze', 'Rubavu', 'Huye', 'Rwamagana'], 'planned', '2026-12-31', md, 3, md) RETURNING id INTO s3;

  INSERT INTO company_expansion_gates (stage_id, title, source, comparator, target, current_value, sort) VALUES
    (s1, 'Requests completed (last 7 days)', 'completion_pct', '>=', 75, NULL, 1),
    (s1, 'Requests with no driver found', 'no_driver_pct', '<=', 10, NULL, 2),
    (s1, 'Own income covers running costs (monthly surplus)', 'monthly_surplus', '>=', 0, NULL, 3),
    (s2, 'Financed EVs on the road', 'manual', '>=', 30, 0, 1),
    (s2, 'Drivers trained for them', 'manual', '>=', 60, 0, 2),
    (s2, 'Charging plan for 30 more EVs agreed', 'check', '>=', NULL, NULL, 3),
    (s3, 'Kigali completes at least 70% of requests', 'completion_pct', '>=', 70, NULL, 1),
    (s3, 'Own income covers running costs', 'monthly_surplus', '>=', 0, NULL, 2),
    (s3, 'Launch budget approved', 'check', '>=', NULL, NULL, 3),
    (s3, 'Charging available in each town', 'check', '>=', NULL, NULL, 4),
    (s3, 'Drivers ready across the four towns (5 per town)', 'manual', '>=', 20, 0, 5);

  INSERT INTO company_expansion_needs (stage_id, kind, description, quantity, status, sort) VALUES
    (s1, 'drivers', 'More drivers online at the evening peak, when most riders find no driver', NULL, 'todo', 1),
    (s1, 'people', 'Call Center follows up every "no driver found" request', NULL, 'todo', 2),
    (s2, 'drivers', 'Recruit and train drivers for the 30 EVs (2 per car)', 60, 'todo', 1),
    (s2, 'cars', 'Branding for the 30 EVs', 30, 'todo', 2),
    (s2, 'tech', 'In-car terminals / GPS', 30, 'todo', 3),
    (s2, 'charging', 'Charging for 30 more EVs (where, when, cost)', NULL, 'todo', 4),
    (s2, 'money', 'Insurance and registration', 30, 'todo', 5),
    (s3, 'people', 'A local coordinator in each town', 4, 'todo', 1),
    (s3, 'drivers', 'Recruit and train local drivers (5 per town to start)', 20, 'todo', 2),
    (s3, 'cars', 'Cars for each town (moved from Kigali or new)', NULL, 'todo', 3),
    (s3, 'charging', 'Charging access in each town (Kigali–Rubavu is ~150 km)', 4, 'todo', 4),
    (s3, 'marketing', 'Launch marketing in each town', 4, 'todo', 5),
    (s3, 'legal', 'Check licences and permits needed to operate outside Kigali', NULL, 'todo', 6);

  INSERT INTO company_marketing_activities (need, title, channel, description, start_month, months, departments, stage_id, status, expected_unit, sort, created_by) VALUES
    ('drivers', 'Recruit 60 drivers for the 30 financed EVs', 'driver_recruitment', 'Driver referrals, the Drivers Association, radio and stands.', '2026-11-01', 2, ARRAY['fleet', 'marketing_sales_bd'], s2, 'planned', 'drivers', 1, md),
    ('drivers', 'Evening peak: more drivers online 18:00–21:00', 'incentives', 'A bonus or target for drivers online in the hours most riders find no driver.', '2026-11-01', 3, ARRAY['fleet'], s1, 'planned', 'drivers online at peak', 2, md),
    ('riders', 'First ride offer and referrals', 'promotions', 'A discount on the first ride and a reward for each friend who rides.', '2026-11-01', 3, ARRAY['marketing_sales_bd', 'social_media'], NULL, 'planned', 'new riders', 3, md),
    ('companies', 'Corporate accounts: B2B outreach', 'corporate_sales', 'Companies whose staff ride with Kivu Ride and pay by invoice (like CEVR).', '2026-11-01', 3, ARRAY['marketing_sales_bd'], NULL, 'planned', 'corporate accounts', 4, md),
    ('launch', 'Launch in Musanze, Rubavu, Huye and Rwamagana', 'local_launch', 'Local radio, stands at busy places, partner hotels and businesses, launch offer.', '2026-12-01', 1, ARRAY['marketing_sales_bd', 'social_media'], s3, 'planned', 'first-month trips', 5, md);
END $$;
