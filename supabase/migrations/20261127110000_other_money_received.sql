/*
# Other money received (MD, 27 Nov 2026)

Money received from someone who is not (yet) in Kivu Daily as a driver on
a car - not registered, no car yet, not started, paid for someone else.
Recorded from the Deposits page ("Record other money") or while making the
PDF report, and kept: every Deposits report counts it on the day it was
received.

Who: the MD, Fleet, IT, Finance and the driver payment follow-up record
and see it. Fix or remove: the person who recorded it within a day, or
the MD.
*/

CREATE TABLE IF NOT EXISTS other_money_received (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_name text NOT NULL CHECK (length(trim(payer_name)) > 0),
  amount numeric NOT NULL CHECK (amount > 0),
  received_on date NOT NULL,
  reason text,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS other_money_received_day ON other_money_received (received_on DESC);

-- New tables aren't exposed to the API on their own in this project: grant explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON other_money_received TO authenticated;
GRANT ALL ON other_money_received TO service_role;

ALTER TABLE other_money_received ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS omr_select ON other_money_received;
CREATE POLICY omr_select ON other_money_received FOR SELECT TO authenticated USING (
  is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance') OR is_driver_payment_followup());
DROP POLICY IF EXISTS omr_insert ON other_money_received;
CREATE POLICY omr_insert ON other_money_received FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid() AND (
    is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance') OR is_driver_payment_followup()));
DROP POLICY IF EXISTS omr_update ON other_money_received;
CREATE POLICY omr_update ON other_money_received FOR UPDATE TO authenticated
  USING (is_managing_director() OR (created_by = auth.uid() AND created_at > now() - interval '1 day'))
  WITH CHECK (is_managing_director() OR created_by = auth.uid());
DROP POLICY IF EXISTS omr_delete ON other_money_received;
CREATE POLICY omr_delete ON other_money_received FOR DELETE TO authenticated
  USING (is_managing_director() OR (created_by = auth.uid() AND created_at > now() - interval '1 day'));

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE other_money_received; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
