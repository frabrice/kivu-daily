/*
# Notification engine: responsibilities, rules, events, outbox, scheduler

Confirmed with the operator: a full plan of email notifications by role,
built so every follow-up has a named owner. Until now no notification
email had ever been sent - the existing reminder functions were never
scheduled or called (email_logs only ever recorded account invites).

Design:
- responsibilities: named follow-up duties assigned to a person, not a
  department. Janviere (IT) owns driver-payment follow-up even though
  nothing about the IT department implies it; Rodrigue owns deposit
  confirmation. Reassigning a duty in the MD Panel moves its emails.
- notification_rules: one row per notification, with who receives it
  (audience tokens: 'md', 'dept:<slug>', 'resp:<key>', 'actor') and an
  on/off switch the MD controls.
- notification_events: instant triggers (new driver, contract ended,
  deposit rejected) written by database triggers/RPCs.
- notification_outbox: every email is written here first, then sent -
  retries on failure, a unique dedupe key so nothing goes out twice,
  and a full log of what was sent.
- notification_rule_runs: one row per scheduled rule per day, so a
  scheduled digest can never fire twice.
- pg_cron calls the notifications-run Edge Function every 5 minutes via
  pg_net, authenticated by a shared secret kept in Vault (created
  separately, never committed).

Phase 1 (this migration) is the driver weekly-payment cadence and
Finance's deposit-confirmation emails; later phases add rows here.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS responsibilities (
  key text PRIMARY KEY,
  label text NOT NULL,
  description text,
  profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE responsibilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "responsibilities_select" ON responsibilities;
CREATE POLICY "responsibilities_select" ON responsibilities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "responsibilities_md_update" ON responsibilities;
CREATE POLICY "responsibilities_md_update" ON responsibilities FOR UPDATE TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());

CREATE TABLE IF NOT EXISTS notification_rules (
  key text PRIMARY KEY,
  label text NOT NULL,
  description text,
  schedule_label text NOT NULL,
  audience text[] NOT NULL,
  phase int NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_rules_md_select" ON notification_rules;
CREATE POLICY "notification_rules_md_select" ON notification_rules FOR SELECT TO authenticated USING (is_managing_director());
DROP POLICY IF EXISTS "notification_rules_md_update" ON notification_rules;
CREATE POLICY "notification_rules_md_update" ON notification_rules FOR UPDATE TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());

CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_events_pending_idx ON notification_events (created_at) WHERE processed_at IS NULL;
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  recipient_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  text_body text NOT NULL,
  in_app_message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON notification_outbox (created_at) WHERE status <> 'sent';
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_outbox_md_select" ON notification_outbox;
CREATE POLICY "notification_outbox_md_select" ON notification_outbox FOR SELECT TO authenticated USING (is_managing_director());

CREATE TABLE IF NOT EXISTS notification_rule_runs (
  rule_key text NOT NULL,
  period_key text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_key, period_key)
);
ALTER TABLE notification_rule_runs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Responsibilities (named owners)
-- ============================================================
INSERT INTO responsibilities (key, label, description, profile_id) VALUES
  ('driver_payment_followup', 'Driver payment follow-up', 'Reminds drivers before Sunday, calls anyone unpaid, and logs their payments.',
    (SELECT id FROM profiles WHERE full_name ILIKE '%janviere%' AND is_active ORDER BY created_at LIMIT 1)),
  ('deposit_confirmation', 'Deposit confirmation', 'Confirms or rejects every driver deposit Fleet logs.',
    (SELECT p.id FROM profiles p JOIN departments d ON d.id = p.department_id WHERE d.slug = 'finance' AND p.is_active ORDER BY p.created_at LIMIT 1))
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Phase 1 rules
-- ============================================================
INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order) VALUES
  ('driver_call_list', 'Sunday call list', 'Every driver, phone and amount due by Sunday (including first-Sunday top-ups).', 'Saturday 09:00', ARRAY['resp:driver_payment_followup'], 1, 10),
  ('driver_still_unpaid', 'Still unpaid', 'Drivers who still haven''t paid for the coming week - call them before Monday.', 'Sunday 18:00', ARRAY['resp:driver_payment_followup'], 1, 20),
  ('driver_not_cleared_monday', 'Not cleared to drive', 'Drivers who can''t drive this week until they pay - keep those cars off the road. Call Center is copied as backup callers.', 'Monday 07:00', ARRAY['resp:driver_payment_followup', 'dept:fleet', 'dept:call_center'], 1, 30),
  ('driver_not_cleared_summary', 'Not cleared summary', 'Short summary of drivers not cleared to drive and what they owe.', 'Monday 07:00', ARRAY['resp:deposit_confirmation', 'md'], 1, 40),
  ('driver_not_cleared_daily', 'Still not cleared', 'Drivers still not cleared and days lost so far.', 'Tuesday–Sunday 07:00, only if anyone', ARRAY['resp:driver_payment_followup', 'dept:fleet'], 1, 50),
  ('driver_escalation', 'Escalation: days lost', 'Drivers who have lost 2 or more working days this week, with whether any payment has been logged.', 'Daily 07:00, only if anyone', ARRAY['md'], 1, 60),
  ('driver_new', 'New driver added', 'Start date, 180,000 due before the first shift, first-Sunday amount.', 'Instant', ARRAY['resp:driver_payment_followup', 'resp:deposit_confirmation'], 1, 70),
  ('driver_contract_ended', 'Driver contract ended', 'Stop reminders; final balance owed, if any.', 'Instant', ARRAY['resp:driver_payment_followup', 'resp:deposit_confirmation', 'md'], 1, 80),
  ('deposit_rejected', 'Deposit rejected', 'Tells whoever logged a deposit that Finance rejected it, and why.', 'Instant', ARRAY['actor'], 1, 90),
  ('deposits_to_confirm', 'Deposits waiting for confirmation', 'Every driver deposit still waiting for Finance to confirm.', 'Daily 17:00, only if any', ARRAY['resp:deposit_confirmation'], 1, 100)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Event triggers
-- ============================================================
CREATE OR REPLACE FUNCTION notify_driver_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notification_events (rule_key, payload) VALUES ('driver_new', jsonb_build_object('driver_id', NEW.id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_notify_created ON drivers;
CREATE TRIGGER drivers_notify_created AFTER INSERT ON drivers
  FOR EACH ROW EXECUTE FUNCTION notify_driver_created();

CREATE OR REPLACE FUNCTION notify_driver_contract_ended()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.event_type = 'ended' THEN
    INSERT INTO notification_events (rule_key, payload)
    VALUES ('driver_contract_ended', jsonb_build_object('driver_id', NEW.driver_id, 'event_date', NEW.event_date, 'reason', NEW.reason));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_contract_events_notify ON driver_contract_events;
CREATE TRIGGER driver_contract_events_notify AFTER INSERT ON driver_contract_events
  FOR EACH ROW EXECUTE FUNCTION notify_driver_contract_ended();

-- reject_driver_deposit now also tells whoever logged the deposit.
CREATE OR REPLACE FUNCTION reject_driver_deposit(p_deposit_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dep driver_deposits%ROWTYPE;
  v_driver_name text;
  v_finance_dept_id uuid;
BEGIN
  IF current_department_slug() <> 'finance' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Finance or the MD can reject a deposit';
  END IF;

  SELECT * INTO v_dep FROM driver_deposits WHERE id = p_deposit_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  SELECT full_name INTO v_driver_name FROM drivers WHERE id = v_dep.driver_id;
  SELECT id INTO v_finance_dept_id FROM departments WHERE slug = 'finance';

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (
    auth.uid(), v_finance_dept_id,
    'rejected and deleted a deposit for ' || COALESCE(v_driver_name, 'a driver') || COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
    'driver_deposit', p_deposit_id, v_driver_name
  );

  IF v_dep.created_by IS NOT NULL THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('deposit_rejected', jsonb_build_object(
      'recipient_id', v_dep.created_by,
      'driver_name', v_driver_name,
      'amount', v_dep.amount,
      'paid_date', v_dep.paid_date,
      'reason', NULLIF(trim(p_reason), ''),
      'rejected_by', (SELECT full_name FROM profiles WHERE id = auth.uid())
    ));
  END IF;

  DELETE FROM driver_deposits WHERE id = p_deposit_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_driver_deposit(uuid, text) TO authenticated;
