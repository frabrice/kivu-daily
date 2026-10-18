/*
# Commission follow-up (MD, 18 Oct 2026)

The commissions drivers owe are in the Kivu Ride dashboard. Every morning
the Call Center takes yesterday's unpaid commissions from it, calls each
driver and records the outcome here: paid, promised (for when), no answer,
refused, wrong number. Kivu Daily then shows who to call again (promises
due), who keeps not paying (escalated to the MD) and what was collected.
*/

CREATE TABLE IF NOT EXISTS commission_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Kigali')::date),
  driver_name text NOT NULL CHECK (length(trim(driver_name)) > 0),
  driver_phone text,
  platform_driver_id uuid REFERENCES platform_drivers(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  amount_owed numeric NOT NULL DEFAULT 0 CHECK (amount_owed >= 0),
  outcome text NOT NULL CHECK (outcome IN ('paid', 'promised', 'no_answer', 'refused', 'wrong_number')),
  promised_date date,
  amount_paid numeric CHECK (amount_paid >= 0),
  note text,
  agent_id uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_followups_day ON commission_followups (day DESC);
CREATE INDEX IF NOT EXISTS commission_followups_driver ON commission_followups (lower(driver_name), day DESC);

ALTER TABLE commission_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cf_select ON commission_followups; CREATE POLICY cf_select ON commission_followups FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('call_center', 'finance') OR is_plan_admin());
DROP POLICY IF EXISTS cf_insert ON commission_followups; CREATE POLICY cf_insert ON commission_followups FOR INSERT TO authenticated
  WITH CHECK ((is_managing_director() OR current_department_slug() = 'call_center') AND agent_id = auth.uid());
DROP POLICY IF EXISTS cf_update ON commission_followups; CREATE POLICY cf_update ON commission_followups FOR UPDATE TO authenticated
  USING (is_managing_director() OR agent_id = auth.uid()) WITH CHECK (is_managing_director() OR agent_id = auth.uid());
DROP POLICY IF EXISTS cf_delete ON commission_followups; CREATE POLICY cf_delete ON commission_followups FOR DELETE TO authenticated USING (is_managing_director() OR (agent_id = auth.uid() AND day = (now() AT TIME ZONE 'Africa/Kigali')::date));
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE commission_followups; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
