/*
# Phase 2.2 - Call Center

Daily driver-outreach workflow: a generated call queue + a selection-only
call log (pick driver, pick reason, pick outcome - no free typing for
either, per the user's explicit brief). Reasons/outcomes are MD-editable
lookup tables, not hardcoded enums, so the list can change without a
migration. Scripts are tagged by reason so the right one surfaces
contextually when logging a call. Reuses the Fleet `drivers` table
(already RLS-ready for Call Center's read-only access from Phase 2.1).
*/

CREATE TABLE IF NOT EXISTS call_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  needs_followup boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason_id uuid REFERENCES call_reasons(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason_id uuid NOT NULL REFERENCES call_reasons(id),
  outcome_id uuid NOT NULL REFERENCES call_outcomes(id),
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_driver_idx ON call_logs(driver_id, created_at DESC);

INSERT INTO call_reasons (label, sort_order) VALUES
  ('Reminder to go online', 1),
  ('App walkthrough', 2),
  ('Onboarding help', 3),
  ('Document follow-up', 4),
  ('Complaint follow-up', 5),
  ('General check-in', 6)
ON CONFLICT (label) DO NOTHING;

INSERT INTO call_outcomes (label, needs_followup, sort_order) VALUES
  ('Understood & going online', false, 1),
  ('Resolved', false, 2),
  ('Needs follow-up', true, 3),
  ('Unreachable', true, 4),
  ('Technical issue reported', true, 5),
  ('Not interested', false, 6)
ON CONFLICT (label) DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE call_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_reasons_select" ON call_reasons;
CREATE POLICY "call_reasons_select" ON call_reasons FOR SELECT TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director());

DROP POLICY IF EXISTS "call_reasons_write" ON call_reasons;
CREATE POLICY "call_reasons_write" ON call_reasons FOR ALL TO authenticated
  USING (is_managing_director())
  WITH CHECK (is_managing_director());

DROP POLICY IF EXISTS "call_outcomes_select" ON call_outcomes;
CREATE POLICY "call_outcomes_select" ON call_outcomes FOR SELECT TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director());

DROP POLICY IF EXISTS "call_outcomes_write" ON call_outcomes;
CREATE POLICY "call_outcomes_write" ON call_outcomes FOR ALL TO authenticated
  USING (is_managing_director())
  WITH CHECK (is_managing_director());

DROP POLICY IF EXISTS "call_scripts_select" ON call_scripts;
CREATE POLICY "call_scripts_select" ON call_scripts FOR SELECT TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director());

DROP POLICY IF EXISTS "call_scripts_write" ON call_scripts;
CREATE POLICY "call_scripts_write" ON call_scripts FOR ALL TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'call_center' OR is_managing_director());

DROP POLICY IF EXISTS "call_logs_select" ON call_logs;
CREATE POLICY "call_logs_select" ON call_logs FOR SELECT TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director());

DROP POLICY IF EXISTS "call_logs_write" ON call_logs;
CREATE POLICY "call_logs_write" ON call_logs FOR ALL TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'call_center' OR is_managing_director());

-- ============================================================
-- Activity log
-- ============================================================
CREATE OR REPLACE FUNCTION log_call_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cc_dept_id uuid;
  driver_name text;
  outcome_label text;
BEGIN
  SELECT id INTO cc_dept_id FROM departments WHERE slug = 'call_center';
  SELECT full_name INTO driver_name FROM drivers WHERE id = NEW.driver_id;
  SELECT label INTO outcome_label FROM call_outcomes WHERE id = NEW.outcome_id;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.caller_id, cc_dept_id, 'logged a call with ' || driver_name || ' (' || outcome_label || ')', 'call_log', NEW.id, driver_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_logs_activity_log ON call_logs;
CREATE TRIGGER call_logs_activity_log
  AFTER INSERT ON call_logs
  FOR EACH ROW EXECUTE FUNCTION log_call_activity();
