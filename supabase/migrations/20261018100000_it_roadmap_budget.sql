/*
# IT & Product, phase 2: objectives, initiatives with budgets, roadmap (MD, 18 Oct 2026)

- it_objectives (+ it_key_results): where we want to be each quarter and
  how it's measured (start -> target, current value updated by IT leads).
- it_initiatives: the big projects (e.g. AI testing, performance, design
  upgrade). Each has a problem, an expected outcome, an objective, an
  owner, dates and a budget. Proposed by the head of IT, approved or
  declined by the MD (approval records the approved budget; a budget
  that grows past it needs approving again).
- it_budget_lines: planned money per initiative, by category (people,
  tools, cloud, AI, devices, contractors, other), one-off or monthly.
- Spending is recorded through Finance: finance_transactions.it_initiative_id
  links an expense to an initiative ("spent" = those transactions).
- it_milestones.initiative_id links delivery to the initiative.
*/

-- ------------------------------------------------------------ objectives
CREATE TABLE IF NOT EXISTS it_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  why text,
  period text NOT NULL,                           -- e.g. 2026-Q4
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'achieved', 'missed', 'dropped')),
  sort int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS it_key_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES it_objectives(id) ON DELETE CASCADE,
  title text NOT NULL,
  unit text,                                      -- %, trips, RWF, seconds…
  start_value numeric NOT NULL DEFAULT 0,
  target_value numeric NOT NULL,
  current_value numeric NOT NULL DEFAULT 0,
  lower_is_better boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ initiatives
CREATE SEQUENCE IF NOT EXISTS it_initiative_number;
CREATE TABLE IF NOT EXISTS it_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('it_initiative_number') UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  problem text,
  outcome text,
  objective_id uuid REFERENCES it_objectives(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  areas text[] NOT NULL DEFAULT '{}',
  priority text NOT NULL DEFAULT 'p2' CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
  start_date date,
  target_date date,
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'proposed', 'approved', 'in_progress', 'on_hold', 'done', 'declined', 'cancelled')),
  horizon text NOT NULL DEFAULT 'later' CHECK (horizon IN ('now', 'next', 'later')),
  approved_budget numeric,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  decision_note text,
  proposed_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_date IS NULL OR start_date IS NULL OR target_date >= start_date)
);

CREATE TABLE IF NOT EXISTS it_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES it_initiatives(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('people', 'tools', 'cloud', 'ai', 'devices', 'contractors', 'other')),
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),       -- per month when monthly
  recurrence text NOT NULL DEFAULT 'one_off' CHECK (recurrence IN ('one_off', 'monthly')),
  months int NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 60),
  committed boolean NOT NULL DEFAULT false,          -- signed / ordered, not yet paid
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE it_milestones DROP CONSTRAINT IF EXISTS it_milestones_initiative_fk;
ALTER TABLE it_milestones ADD CONSTRAINT it_milestones_initiative_fk FOREIGN KEY (initiative_id) REFERENCES it_initiatives(id) ON DELETE SET NULL;
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS it_initiative_id uuid REFERENCES it_initiatives(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS finance_transactions_it_initiative ON finance_transactions (it_initiative_id) WHERE it_initiative_id IS NOT NULL;

-- The planned total of an initiative (monthly lines x months).
CREATE OR REPLACE FUNCTION it_initiative_planned(p_id uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(amount * CASE WHEN recurrence = 'monthly' THEN months ELSE 1 END), 0) FROM it_budget_lines WHERE initiative_id = p_id;
$$;

-- ------------------------------------------------------------ rules
-- Status changes that are decisions go through decide/propose below; the
-- approval fields can't be set by editing the row.
CREATE OR REPLACE FUNCTION it_initiative_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('kivu.it_decision', true) = '1' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    IF NEW.status NOT IN ('idea', 'proposed') THEN NEW.status := 'idea'; END IF;
    NEW.approved_budget := NULL; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.decision_note := NULL;
    IF NEW.status = 'proposed' THEN NEW.proposed_at := now(); END IF;
    RETURN NEW;
  END IF;
  NEW.approved_budget := OLD.approved_budget; NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
  NEW.decision_note := OLD.decision_note; NEW.created_by := OLD.created_by; NEW.proposed_at := OLD.proposed_at;
  -- Approval is the MD's: an initiative can't be moved to approved/declined by editing it,
  -- and can only start (in progress) once approved.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('approved', 'declined', 'proposed') THEN RAISE EXCEPTION 'Use Propose / Approve / Decline for that'; END IF;
    IF NEW.status IN ('in_progress', 'done', 'on_hold') AND OLD.approved_at IS NULL THEN
      RAISE EXCEPTION 'This project needs the MD''s approval before it can start';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS it_initiatives_guard ON it_initiatives;
CREATE TRIGGER it_initiatives_guard BEFORE INSERT OR UPDATE ON it_initiatives FOR EACH ROW EXECUTE FUNCTION it_initiative_guard();

-- Head of IT (or the MD) asks for approval of the project and its budget.
CREATE OR REPLACE FUNCTION propose_it_initiative(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v it_initiatives%ROWTYPE;
BEGIN
  IF NOT is_it_lead() THEN RAISE EXCEPTION 'Only the head of IT or the MD can propose a project'; END IF;
  SELECT * INTO v FROM it_initiatives WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF v.problem IS NULL OR v.outcome IS NULL THEN RAISE EXCEPTION 'Describe the problem and the expected outcome before proposing it'; END IF;
  IF v.start_date IS NULL OR v.target_date IS NULL THEN RAISE EXCEPTION 'Set the start and target dates before proposing it'; END IF;
  PERFORM set_config('kivu.it_decision', '1', true);
  UPDATE it_initiatives SET status = 'proposed', proposed_at = now(), updated_at = now() WHERE id = p_id;
  PERFORM set_config('kivu.it_decision', '', true);
  INSERT INTO notification_events (rule_key, payload) VALUES ('it_initiative_proposed', jsonb_build_object('initiative_id', p_id, 'actor_id', auth.uid()));
END $$;

-- The MD approves (the budget planned now becomes the approved budget) or declines.
CREATE OR REPLACE FUNCTION decide_it_initiative(p_id uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v it_initiatives%ROWTYPE;
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD approves IT projects and budgets'; END IF;
  SELECT * INTO v FROM it_initiatives WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF NOT p_approve AND NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it is declined'; END IF;
  PERFORM set_config('kivu.it_decision', '1', true);
  UPDATE it_initiatives SET
    status = CASE WHEN p_approve THEN (CASE WHEN v.status IN ('in_progress', 'on_hold', 'done') THEN v.status ELSE 'approved' END) ELSE 'declined' END,
    approved_budget = CASE WHEN p_approve THEN it_initiative_planned(p_id) ELSE v.approved_budget END,
    approved_by = auth.uid(), approved_at = CASE WHEN p_approve THEN now() ELSE v.approved_at END,
    decision_note = NULLIF(trim(p_note), ''), updated_at = now()
  WHERE id = p_id;
  PERFORM set_config('kivu.it_decision', '', true);
  INSERT INTO notification_events (rule_key, payload)
  VALUES ('it_initiative_decided', jsonb_build_object('initiative_id', p_id, 'approved', p_approve, 'recipient_id', COALESCE(v.owner_id, v.created_by), 'actor_id', auth.uid()));
END $$;

-- ------------------------------------------------------------ access
ALTER TABLE it_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_key_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_budget_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ito_select ON it_objectives;  CREATE POLICY ito_select ON it_objectives FOR SELECT TO authenticated USING (is_it_member() OR current_department_slug() = 'finance');
DROP POLICY IF EXISTS ito_write ON it_objectives;   CREATE POLICY ito_write ON it_objectives FOR ALL TO authenticated USING (is_it_lead()) WITH CHECK (is_it_lead());
DROP POLICY IF EXISTS itkr_select ON it_key_results; CREATE POLICY itkr_select ON it_key_results FOR SELECT TO authenticated USING (is_it_member() OR current_department_slug() = 'finance');
DROP POLICY IF EXISTS itkr_write ON it_key_results;  CREATE POLICY itkr_write ON it_key_results FOR ALL TO authenticated USING (is_it_lead()) WITH CHECK (is_it_lead());
-- Finance sees the projects (to record spending against them) and their budgets.
DROP POLICY IF EXISTS itin2_select ON it_initiatives; CREATE POLICY itin2_select ON it_initiatives FOR SELECT TO authenticated USING (is_it_member() OR current_department_slug() = 'finance');
DROP POLICY IF EXISTS itin2_insert ON it_initiatives; CREATE POLICY itin2_insert ON it_initiatives FOR INSERT TO authenticated WITH CHECK (is_it_lead());
DROP POLICY IF EXISTS itin2_update ON it_initiatives; CREATE POLICY itin2_update ON it_initiatives FOR UPDATE TO authenticated USING (is_it_lead()) WITH CHECK (is_it_lead());
DROP POLICY IF EXISTS itin2_delete ON it_initiatives; CREATE POLICY itin2_delete ON it_initiatives FOR DELETE TO authenticated USING (is_managing_director());
DROP POLICY IF EXISTS itbl_select ON it_budget_lines; CREATE POLICY itbl_select ON it_budget_lines FOR SELECT TO authenticated USING (is_it_member() OR current_department_slug() = 'finance');
DROP POLICY IF EXISTS itbl_write ON it_budget_lines;  CREATE POLICY itbl_write ON it_budget_lines FOR ALL TO authenticated USING (is_it_lead()) WITH CHECK (is_it_lead());

-- IT leads read the spending linked to their projects (the rest of the ledger stays Finance's).
CREATE OR REPLACE FUNCTION it_initiative_spending() RETURNS TABLE (id uuid, it_initiative_id uuid, amount numeric, transaction_date date, status text, type text, description text, counterparty text, reference text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.it_initiative_id, t.amount, t.transaction_date, t.status, t.type, t.description, t.counterparty, t.reference
  FROM finance_transactions t
  WHERE t.it_initiative_id IS NOT NULL AND t.direction = 'out' AND t.status <> 'rejected'
    AND (is_it_member() OR current_department_slug() = 'finance');
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['it_initiative_planned(uuid)', 'propose_it_initiative(uuid)', 'decide_it_initiative(uuid, boolean, text)', 'it_initiative_guard()', 'it_initiative_spending()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('it_initiative_proposed', 'IT project to approve', 'The head of IT proposed a project and its budget for your approval.', 'Instant', ARRAY['md'], 3, 453, 'IT & product', true),
  ('it_initiative_decided', 'IT project decided', 'Tells the project owner the MD approved or declined it.', 'Instant', ARRAY['actor'], 3, 454, 'IT & product', true)
ON CONFLICT (key) DO NOTHING;

-- The first project: what is already planned (Partner Promo & EV Reporting) becomes initiative I1, owning milestone M1.
DO $$
DECLARE v_i uuid; v_head uuid := (SELECT profile_id FROM it_members WHERE role = 'head' LIMIT 1);
BEGIN
  IF EXISTS (SELECT 1 FROM it_initiatives) THEN RETURN; END IF;
  INSERT INTO it_initiatives (name, problem, outcome, owner_id, areas, priority, start_date, target_date, status, horizon)
  VALUES ('Partner Promo & EV Reporting',
          'Institutional partners and promo codes are managed by hand, partner trips aren''t attributed, and partners get no reporting on mobility or EV impact.',
          'Partners have codes and discounts that apply automatically, every partner trip is attributed, and each partner receives a monthly report including EV impact.',
          v_head, ARRAY['backend', 'dashboard', 'data_ai', 'app_rider'], 'p1', '2026-10-19', '2026-12-31', 'idea', 'now')
  RETURNING id INTO v_i;
  UPDATE it_milestones SET initiative_id = v_i WHERE name = 'Partner Promo & EV Reporting' AND initiative_id IS NULL;
END $$;
