/*
# Recurring tasks

Confirmed with the operator: everyone gets standing duties that appear
on their task list automatically (daily, Monday-Saturday, on given
weekdays, or on a day of the month), tick them off like any task, and
are reminded and held accountable by email.

- recurring_tasks: the template. Targets a person, a department (every
  active member) or a duty (whoever holds it in MD Panel -> Who's in
  charge), so when a duty changes hands the tasks move with it.
- generate_recurring_tasks(date): creates that day's tasks; idempotent
  (one task per template per person per day). notifications-run calls it
  once a day from 05:00 Kigali time.
- tasks.recurring_task_id / due_time: the task remembers where it came
  from and when it should be done by.

Templates are seeded from what each person is in charge of; the MD edits
them in MD Panel -> Recurring tasks. Generation starts tomorrow morning so
the MD can review them first.
*/

CREATE TABLE IF NOT EXISTS recurring_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  target_type text NOT NULL CHECK (target_type IN ('person', 'department', 'duty')),
  target_profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  target_department_slug text,
  target_duty text,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'mon_sat', 'weekdays', 'weekly', 'monthly')),
  weekdays int[] NOT NULL DEFAULT '{}',
  month_day int CHECK (month_day BETWEEN 1 AND 28),
  due_time text CHECK (due_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (target_type = 'person' AND target_profile_id IS NOT NULL)
    OR (target_type = 'department' AND target_department_slug IS NOT NULL)
    OR (target_type = 'duty' AND target_duty IS NOT NULL)
  )
);
ALTER TABLE recurring_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recurring_tasks_select" ON recurring_tasks;
CREATE POLICY "recurring_tasks_select" ON recurring_tasks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "recurring_tasks_md_write" ON recurring_tasks;
CREATE POLICY "recurring_tasks_md_write" ON recurring_tasks FOR ALL TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_task_id uuid REFERENCES recurring_tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time text;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurring_once_per_day ON tasks (recurring_task_id, user_id, date) WHERE recurring_task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION recurring_task_applies(r recurring_tasks, p_date date)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r.frequency
    WHEN 'daily' THEN true
    WHEN 'mon_sat' THEN extract(isodow FROM p_date) <> 7
    WHEN 'weekdays' THEN extract(isodow FROM p_date) BETWEEN 1 AND 5
    WHEN 'weekly' THEN extract(isodow FROM p_date)::int = ANY (r.weekdays)
    WHEN 'monthly' THEN extract(day FROM p_date)::int = r.month_day
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION recurring_task_people(r recurring_tasks)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id FROM profiles p
  WHERE p.is_active AND (
    (r.target_type = 'person' AND p.id = r.target_profile_id)
    OR (r.target_type = 'department' AND p.department_id = (SELECT id FROM departments WHERE slug = r.target_department_slug))
    OR (r.target_type = 'duty' AND p.id = (SELECT profile_id FROM responsibilities WHERE key = r.target_duty))
  );
$$;

CREATE OR REPLACE FUNCTION generate_recurring_tasks(p_date date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the MD can generate recurring tasks by hand';
  END IF;
  WITH due AS (
    SELECT r.*, person FROM recurring_tasks r, LATERAL recurring_task_people(r) AS person
    WHERE r.is_active AND recurring_task_applies(r, p_date)
  )
  INSERT INTO tasks (user_id, title, description, date, recurring_task_id, due_time, assigned_by)
  SELECT person, title, description, p_date, id, due_time, created_by FROM due
  ON CONFLICT (recurring_task_id, user_id, date) WHERE recurring_task_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION generate_recurring_tasks(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_recurring_tasks(date) TO authenticated, service_role;

-- ============================================================
-- Seed: standing duties from what each person is in charge of
-- ============================================================
DO $seed$
DECLARE v_md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
BEGIN
IF EXISTS (SELECT 1 FROM recurring_tasks) THEN RETURN; END IF;
INSERT INTO recurring_tasks (title, description, target_type, target_duty, target_department_slug, frequency, weekdays, month_day, due_time, sort_order, created_by) VALUES
-- Managing Director
('Read the morning briefing and Money & growth brief; approve or reject waiting payments', 'Everything waiting on you is at the top of the 07:30 briefing.', 'duty', 'route_md', NULL, 'mon_sat', '{}', NULL, '08:30', 10, v_md),
('Acknowledge emergencies and chase cases that missed the 2-hour response', 'From Call Center -> All tickets shows anything late.', 'duty', 'route_md', NULL, 'daily', '{}', NULL, '09:00', 11, v_md),
('Review the weekly report and set this week''s 3 priorities for the team', 'Send them to everyone (Announcements) so the week has a focus.', 'duty', 'route_md', NULL, 'weekly', '{1}', NULL, '10:00', 12, v_md),
-- Driver payments (Janviere)
('Log every driver payment received since yesterday', 'Check MoMo / bank and log each one on Deposits the same day, so Finance can confirm it.', 'duty', 'driver_payment_followup', NULL, 'daily', '{}', NULL, '09:00', 20, v_md),
('Call every driver on the Sunday call list', 'The 09:00 Saturday email lists who owes what. Note who promised to pay and when.', 'duty', 'driver_payment_followup', NULL, 'weekly', '{6}', NULL, '12:00', 21, v_md),
('Call every driver still unpaid for the coming week', 'Anyone unpaid by Monday morning is not cleared to drive.', 'duty', 'driver_payment_followup', NULL, 'weekly', '{7}', NULL, '19:00', 22, v_md),
('Call every driver not cleared to drive and tell Fleet who stays off the road', 'Use the 07:00 Monday email. Update Fleet before 09:00.', 'duty', 'driver_payment_followup', NULL, 'weekly', '{1}', NULL, '09:00', 23, v_md),
-- Finance (Rodrigue)
('Confirm or reject every pending driver deposit', 'Deposit Confirmations - only confirm money you have seen arrive.', 'duty', 'deposit_confirmation', NULL, 'daily', '{}', NULL, '17:00', 30, v_md),
('Record yesterday''s income and expenses, each with its receipt', 'Nothing paid or received should be missing from the books for more than a day.', 'duty', 'route_finance', NULL, 'mon_sat', '{}', NULL, '10:00', 31, v_md),
('Check waiting payments and send them to the MD for approval', 'Overdue items are listed in your 08:00 Finance email.', 'duty', 'route_finance', NULL, 'mon_sat', '{}', NULL, '11:00', 32, v_md),
('Prepare next week''s owner payouts and check the Fleet Collection account covers them', 'Flag any shortfall to the MD today, not on payday.', 'duty', 'route_finance', NULL, 'weekly', '{5}', NULL, '12:00', 33, v_md),
('Send the MD 3 money points from last week: what went well, what leaked, what to fix', 'Use the Monday weekly report and the Money & growth brief.', 'duty', 'route_finance', NULL, 'weekly', '{1}', NULL, '12:00', 34, v_md),
('Reconcile every bank account for last month', 'Reconciliation page - compare each account with its bank statement.', 'duty', 'route_finance', NULL, 'monthly', '{}', 1, '12:00', 35, v_md),
('Prepare this month''s payroll run for MD approval', 'Payday is the 28th.', 'duty', 'route_finance', NULL, 'monthly', '{}', 25, '12:00', 36, v_md),
-- Operations (Henry)
('Check every car is on the road with a cleared driver; act on idle cars', 'Idle car = lost income for us and the owner. Swap or recruit a driver.', 'duty', 'route_operations', NULL, 'mon_sat', '{}', NULL, '08:00', 40, v_md),
('Respond to Call Center cases about driver conduct and operations', 'Respond within 2 hours of assignment (From Call Center).', 'duty', 'route_operations', NULL, 'daily', '{}', NULL, '16:00', 41, v_md),
('Review the Onboarding queue and schedule applicants into empty driver slots', 'Aim for two drivers per car (day and night).', 'duty', 'route_operations', NULL, 'weekly', '{1}', NULL, '11:00', 42, v_md),
-- Fleet Manager (Ndekwe)
('Follow up Branding & Devices: call every owner waiting', 'Move each car to its next step and note what was agreed.', 'duty', 'fleet_manager', NULL, 'mon_sat', '{}', NULL, '10:00', 50, v_md),
('Confirm every car''s status (on the road / idle / in repair) and log breakdowns', 'Anything idle or broken goes to Operations today.', 'duty', 'fleet_manager', NULL, 'daily', '{}', NULL, '18:00', 51, v_md),
('Fleet housekeeping: missing driver documents, unpaid fines, RURA renewals due', 'Monday''s Fleet email lists everything open.', 'duty', 'fleet_manager', NULL, 'weekly', '{1}', NULL, '12:00', 52, v_md),
-- IT (Baptiste)
('Check flagged issues and Call Center cases assigned to IT; respond within 2 hours', 'Product Hub -> Issues, and From Call Center.', 'duty', 'route_it', NULL, 'mon_sat', '{}', NULL, '09:30', 60, v_md),
('Test the driver and passenger apps: login, booking, payment', 'Log anything broken as an issue straight away.', 'duty', 'route_it', NULL, 'mon_sat', '{}', NULL, '11:00', 61, v_md),
('Send the team a short note on what changed in the apps this week', 'So the Call Center can explain new features to drivers and passengers.', 'duty', 'route_it', NULL, 'weekly', '{5}', NULL, '15:00', 62, v_md),
-- Call Center (every agent, every day - shifts run 24/7)
('Call at least 10 drivers: remind them to go online and explain this week''s features', 'Use the Call Queue (Check-ins). Log every call.', 'department', NULL, 'call_center', 'daily', '{}', NULL, NULL, 70, v_md),
('Work the Payment backup and Follow-ups groups in the Call Queue', 'Log each call with its outcome.', 'department', NULL, 'call_center', 'daily', '{}', NULL, NULL, 71, v_md),
('Call back every caller in the Call back tab and close their cases', 'Record how the caller felt before closing.', 'department', NULL, 'call_center', 'daily', '{}', NULL, NULL, 72, v_md),
('End your shift with a complete shift report', 'Calls received and made, cases worked, what''s still open, feedback heard.', 'department', NULL, 'call_center', 'daily', '{}', NULL, NULL, 73, v_md);
END $seed$;

-- Generation starts tomorrow: mark today as already done so the MD can
-- review the templates first.
INSERT INTO notification_rule_runs (rule_key, period_key)
VALUES ('recurring_tasks', to_char(now() AT TIME ZONE 'Africa/Kigali', 'YYYY-MM-DD'))
ON CONFLICT DO NOTHING;
