/*
# Smart tasks and one morning email per person

Approved by the MD (10 Oct 2026). An audit of the last 7 days showed the MD
receiving ~10 emails a day from 13 rules, 38% of all email being three
reminders a day about the same task list, and standing duties mostly
ignored (Finance 0/16, IT 1/11, Operations 2/10) because they were generic
and appeared even when there was nothing to do.

1. Smart tasks. The engine (notifications-run, every 5 minutes) creates a
   task only when live data shows real work, names the specifics (drivers,
   amounts, callers), tracks progress, and completes it itself when the
   work is done. Columns: smart_key, smart_items, smart_total, smart_done,
   auto_completed, priority. One per person per day per smart_key.
2. Email delivery per rule:
   - instant: sent at once (emergencies, cases assigned to you, overdue
     replies, rejected deposits, comments...)
   - digest: listed in the next morning email under "Since yesterday"
     (in-app notification still immediate)
   - bundled: a scheduled report that becomes a section of the morning
     email instead of its own email
   - off: replaced by smart tasks or the morning email
3. "Your day" (07:00): one email per person - focus, what needs you today,
   since yesterday, then their reports. "Still open" (16:00): only if a
   high-priority task is still open.
4. Standing duties replaced by smart tasks are switched off; Call Center
   duties are created when an agent starts a shift (only on days they work).
*/

-- ------------------------------------------------------------ tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS smart_key text,
  ADD COLUMN IF NOT EXISTS smart_items jsonb,
  ADD COLUMN IF NOT EXISTS smart_total int,
  ADD COLUMN IF NOT EXISTS smart_done int,
  ADD COLUMN IF NOT EXISTS auto_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('low', 'normal', 'high'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_smart_unique ON tasks (user_id, date, smart_key) WHERE smart_key IS NOT NULL;

-- ------------------------------------------------------------ email delivery
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'instant';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_rules_delivery_check') THEN
    ALTER TABLE notification_rules ADD CONSTRAINT notification_rules_delivery_check CHECK (delivery IN ('instant', 'digest', 'bundled', 'off'));
  END IF;
END $$;

UPDATE notification_rules SET delivery = 'bundled'
WHERE key IN ('driver_payments_morning', 'md_daily_digest', 'money_daily', 'finance_daily_digest', 'outreach_interested_fleet');

UPDATE notification_rules SET delivery = 'off'
WHERE key IN ('task_morning', 'task_overdue', 'task_unfinished', 'ticket_open_digest', 'deposits_to_confirm', 'callcenter_followups');

UPDATE notification_rules SET delivery = 'digest'
WHERE key IN ('shift_report', 'shift_not_closed', 'driver_new', 'driver_contract_ended', 'driver_contract_fleet', 'car_interest_recorded', 'ticket_activity', 'ticket_resolved');

CREATE TABLE IF NOT EXISTS notification_digest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  line text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  included_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_digest_items_open ON notification_digest_items (recipient_id) WHERE included_at IS NULL;
ALTER TABLE notification_digest_items ENABLE ROW LEVEL SECURITY; -- engine only (service role)

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key, delivery) VALUES
  ('your_day', 'Your day',
   'One email per person: today''s focus, what needs you (smart tasks with names and amounts, plus your own tasks), what happened since yesterday, and the reports for your role. Only sent when there is something for you.',
   'Daily 07:00', ARRAY['employees', 'md'], 5, 500, 'Everyone''s workspace', true, NULL, 'instant'),
  ('urgent_nudge', 'Still open (urgent)',
   'Only when a high-priority task is still open at 16:00.',
   'Daily 16:00, only if needed', ARRAY['employees', 'md'], 5, 501, 'Everyone''s workspace', true, 'unfinished_task_reminders', 'instant')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, schedule_label = EXCLUDED.schedule_label;

-- ------------------------------------------------------------ standing duties replaced by smart tasks
UPDATE recurring_tasks SET is_active = false, updated_at = now()
WHERE is_active AND title IN (
  'Call back every caller in the Call back tab and close their cases',
  'Call 15 Non-Insider drivers from Non-Insider outreach',
  'End your shift with a complete shift report',
  'Confirm or reject every pending driver deposit',
  'Call every driver not cleared to drive and tell Fleet who stays off the road',
  'Follow up Branding & Devices: call every owner waiting',
  'Check waiting payments and send them to the MD for approval',
  'Check flagged issues and Call Center cases assigned to IT; respond within 2 hours',
  'Read the morning briefing and Money & growth brief; approve or reject waiting payments',
  'Acknowledge emergencies and chase cases that missed the 2-hour response',
  'Check every car is on the road with a cleared driver; act on idle cars',
  'Respond to Call Center cases about driver conduct and operations'
);

-- Today's still-open copies of those duties go too (smart tasks take over).
DELETE FROM tasks t USING recurring_tasks r
WHERE t.recurring_task_id = r.id AND NOT r.is_active AND NOT t.completed
  AND t.date = (now() AT TIME ZONE 'Africa/Kigali')::date;

-- ------------------------------------------------------------ Call Center duties only on shift days
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
      -- Call Center duties are created when an agent starts a shift.
      AND NOT (r.target_type = 'department' AND r.target_department_slug = 'call_center')
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

CREATE OR REPLACE FUNCTION start_call_center_shift(p_station text, p_slot text, p_partner_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_day date := (now() AT TIME ZONE 'Africa/Kigali')::date;
BEGIN
  IF current_department_slug() <> 'call_center' THEN RAISE EXCEPTION 'Only Call Center agents start shifts'; END IF;
  SELECT id INTO v_id FROM call_center_shifts WHERE agent_id = auth.uid() AND status = 'open';
  IF FOUND THEN RETURN v_id; END IF;
  INSERT INTO call_center_shifts (agent_id, partner_id, station, slot, late_minutes)
  VALUES (auth.uid(), NULLIF(p_partner_id, auth.uid()), COALESCE(NULLIF(trim(p_station), ''), 'Computer 1'), p_slot, shift_late_minutes(p_slot, now()))
  RETURNING id INTO v_id;

  -- The day's Call Center duties, for this agent, now that they're working.
  INSERT INTO tasks (user_id, title, description, date, recurring_task_id, due_time, assigned_by)
  SELECT auth.uid(), r.title, r.description, v_day, r.id, r.due_time, r.created_by
  FROM recurring_tasks r
  WHERE r.is_active AND r.target_type = 'department' AND r.target_department_slug = 'call_center' AND recurring_task_applies(r, v_day)
  ON CONFLICT (recurring_task_id, user_id, date) WHERE recurring_task_id IS NOT NULL DO NOTHING;

  -- Smart tasks for the shift appear within minutes (notifications-run).
  INSERT INTO notification_events (rule_key, payload) VALUES ('smart_tasks_refresh', jsonb_build_object('agent_id', auth.uid()));
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION start_call_center_shift(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION start_call_center_shift(text, text, uuid) TO authenticated, service_role;
