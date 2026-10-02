/*
# Notification engine, phases 2 and 3

Phase 2 - Finance and the MD:
- Finance's 08:00 to-do list (payments due, overdue, deposits to confirm)
- payroll reminders 3 days before payday and on payday
- month-start bank reconciliation reminder
- the MD's 07:30 company briefing and Monday weekly report
- payroll-removal hand-off: request -> MD, decision -> whoever asked
- Flag to IT: new issue -> IT, fixed -> whoever flagged it

Phase 3 - everyone else:
- Fleet's Monday housekeeping (idle cars, licences, fines, documents)
- contract ended / reactivated -> Fleet
- Call Center's 08:00 call queue
- each employee's own task reminders (08:00 add tasks, 17:30 unfinished)
  and comment replies - the old never-scheduled email functions'
  job, now run by the one engine

Also:
- notification_rules.area groups the MD's list; in_app = false where
  the app already raises its own in-app notification (flag_to_it does,
  and Comments has its own unread badge); preference_key ties personal
  emails to the person's own switch in Settings.
- email_preferences: the Settings page has always read and written
  this table, but it never existed, so those switches silently did
  nothing. Created for real; a missing row means "all on".
- Event payloads carry actor_id so nobody is emailed about their own
  action (e.g. Fleet ending a contract isn't told by email that they did).
*/

ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'Driver payments';
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS in_app boolean NOT NULL DEFAULT true;
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS preference_key text;

CREATE TABLE IF NOT EXISTS email_preferences (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  morning_reminder boolean NOT NULL DEFAULT true,
  end_day_report boolean NOT NULL DEFAULT true,
  comment_notifications boolean NOT NULL DEFAULT true,
  unfinished_task_reminders boolean NOT NULL DEFAULT true,
  performance_nudges boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_preferences_own_select" ON email_preferences;
CREATE POLICY "email_preferences_own_select" ON email_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "email_preferences_own_insert" ON email_preferences;
CREATE POLICY "email_preferences_own_insert" ON email_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "email_preferences_own_update" ON email_preferences;
CREATE POLICY "email_preferences_own_update" ON email_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('md_daily_digest', 'Morning briefing', 'What''s waiting on you, driver payments, Finance, the team''s tasks yesterday, idle cars and IT issues.', 'Daily 07:30', ARRAY['md'], 2, 200, 'Managing Director', true, NULL),
  ('md_weekly_report', 'Weekly report', 'Last week''s money, who paid on time, driver changes, team task completion and calls.', 'Monday 08:00', ARRAY['md'], 2, 210, 'Managing Director', true, NULL),
  ('payroll_removal_requested', 'Payroll removal to confirm', 'Finance asked to remove someone from payroll - nothing happens until you confirm.', 'Instant', ARRAY['md'], 2, 220, 'Managing Director', true, NULL),

  ('finance_daily_digest', 'Finance to-do list', 'Approved payments to make, items to check, anything overdue or due within 3 days, and deposits to confirm.', 'Daily 08:00, only if anything is due', ARRAY['dept:finance'], 2, 300, 'Finance', true, NULL),
  ('payroll_reminder', 'Payroll reminder', 'Where this month''s payroll run stands, and open driver payroll.', '3 days before payday and on payday, 08:00', ARRAY['dept:finance', 'md'], 2, 310, 'Finance', true, NULL),
  ('bank_reconciliation', 'Month-end reconciliation', 'Accounts not yet reconciled against the bank for the month just ended.', '1st of the month, 08:00', ARRAY['dept:finance', 'md'], 2, 320, 'Finance', true, NULL),
  ('payroll_removal_decided', 'Payroll removal decided', 'Tells whoever asked whether the MD confirmed or declined the removal.', 'Instant', ARRAY['actor'], 2, 330, 'Finance', true, NULL),

  ('fleet_weekly', 'Fleet weekly housekeeping', 'Cars without a driver, RURA licences expiring within 30 days, unpaid fines, drivers missing documents.', 'Monday 08:00, only if anything', ARRAY['dept:fleet'], 3, 400, 'Fleet & operations', true, NULL),
  ('driver_contract_fleet', 'Driver contract changes', 'A driver''s contract ended (collect the car) or a driver was reactivated.', 'Instant', ARRAY['dept:fleet'], 3, 410, 'Fleet & operations', true, NULL),
  ('callcenter_followups', 'Call queue', 'Drivers due a call: never called, needing a follow-up, or 7+ days since the last call.', 'Monday–Saturday 08:00, only if anyone', ARRAY['dept:call_center'], 3, 420, 'Fleet & operations', true, NULL),
  ('it_flag_created', 'Issue flagged to IT', 'Someone in Fleet or Call Center flagged an issue.', 'Instant', ARRAY['dept:it'], 2, 430, 'Fleet & operations', false, NULL),
  ('it_flag_resolved', 'Flagged issue fixed', 'Tells whoever flagged an issue that IT marked it done.', 'Instant', ARRAY['actor'], 2, 440, 'Fleet & operations', true, NULL),

  ('task_morning', 'Add today''s tasks', 'Only to people who haven''t added any tasks for today yet.', 'Monday–Saturday 08:00', ARRAY['employees'], 3, 500, 'Everyone''s workspace', true, 'morning_reminder'),
  ('task_unfinished', 'Unfinished tasks', 'Only to people with tasks still open today, listing them.', 'Monday–Saturday 17:30', ARRAY['employees'], 3, 510, 'Everyone''s workspace', true, 'unfinished_task_reminders'),
  ('comment_reply', 'Comments and replies', 'When someone leaves you a comment or replies to yours.', 'Instant', ARRAY['person'], 3, 520, 'Everyone''s workspace', false, 'comment_notifications')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Event triggers (existing ones now carry actor_id)
-- ============================================================
CREATE OR REPLACE FUNCTION notify_driver_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notification_events (rule_key, payload)
  VALUES ('driver_new', jsonb_build_object('driver_id', NEW.id, 'actor_id', COALESCE(NEW.created_by, auth.uid())));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_driver_contract_ended()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := COALESCE(NEW.created_by, auth.uid());
BEGIN
  IF NEW.event_type = 'ended' THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('driver_contract_ended', jsonb_build_object('driver_id', NEW.driver_id, 'event_date', NEW.event_date, 'reason', NEW.reason, 'actor_id', v_actor));
  END IF;
  INSERT INTO notification_events (rule_key, payload)
  VALUES ('driver_contract_fleet', jsonb_build_object('driver_id', NEW.driver_id, 'event_type', NEW.event_type, 'event_date', NEW.event_date, 'reason', NEW.reason, 'actor_id', v_actor));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_payroll_employee_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_name text := (SELECT full_name FROM profiles WHERE id = auth.uid());
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.pending_removal AND NOT OLD.pending_removal THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('payroll_removal_requested', jsonb_build_object(
      'employee_name', NEW.full_name, 'position', NEW.position, 'monthly_salary', NEW.monthly_salary,
      'requested_by_name', v_actor_name, 'actor_id', auth.uid()));
  ELSIF TG_OP = 'UPDATE' AND OLD.pending_removal AND NOT NEW.pending_removal
        AND OLD.removal_requested_by IS NOT NULL AND OLD.removal_requested_by IS DISTINCT FROM auth.uid() THEN
    -- Cancelled by someone other than the requester: the MD declined it.
    INSERT INTO notification_events (rule_key, payload) VALUES ('payroll_removal_decided', jsonb_build_object(
      'employee_name', NEW.full_name, 'decision', 'declined', 'decided_by_name', v_actor_name,
      'recipient_id', OLD.removal_requested_by, 'actor_id', auth.uid()));
  ELSIF TG_OP = 'DELETE' AND OLD.pending_removal AND OLD.removal_requested_by IS NOT NULL THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('payroll_removal_decided', jsonb_build_object(
      'employee_name', OLD.full_name, 'decision', 'confirmed', 'decided_by_name', v_actor_name,
      'recipient_id', OLD.removal_requested_by, 'actor_id', auth.uid()));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS payroll_employees_notify ON payroll_employees;
CREATE TRIGGER payroll_employees_notify AFTER UPDATE OR DELETE ON payroll_employees
  FOR EACH ROW EXECUTE FUNCTION notify_payroll_employee_change();

CREATE OR REPLACE FUNCTION notify_user_story_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source <> 'flagged' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('it_flag_created', jsonb_build_object('story_id', NEW.id, 'actor_id', COALESCE(NEW.created_by, auth.uid())));
  ELSIF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' AND NEW.created_by IS NOT NULL THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('it_flag_resolved', jsonb_build_object('story_id', NEW.id, 'recipient_id', NEW.created_by, 'actor_id', auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_stories_notify ON user_stories;
CREATE TRIGGER user_stories_notify AFTER INSERT OR UPDATE OF status ON user_stories
  FOR EACH ROW EXECUTE FUNCTION notify_user_story_flag();

CREATE OR REPLACE FUNCTION notify_comment_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.target_user_id IS NOT NULL AND NEW.target_user_id <> NEW.author_id THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('comment_reply', jsonb_build_object('comment_id', NEW.id, 'actor_id', NEW.author_id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_notify ON comments;
CREATE TRIGGER comments_notify AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION notify_comment_created();
