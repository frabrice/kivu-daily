/*
# Driver payment calls, promises and cars taken back (MD, 26 Nov 2026)

"Eric owes 95k, we called him and he said he will pay by 5pm today: record
that, every day, with the hour, and remind us by email."

Every call to a driver about money is one row: what happened (promised,
paid on the call, no answer, refused, wrong number), and for a promise the
amount and the date + hour. Taking the car back and giving it back are
recorded the same way (who, when, where the car is).

- A promise is KEPT once deposits logged after the call reach the promised
  amount; BROKEN when its time passes first.
- flag_payment_promises(), called by notifications-run every 5 minutes,
  raises the emails: "promise due" ~30 minutes before the time, "broke
  their promise" once it has passed unpaid. Taking a car raises one at once.
- Who: the MD, Fleet, IT, Finance and the driver payment follow-up record
  and see everything; the Call Center can record calls (not take cars) and
  sees only its own (no driver money shown to them - MD, 8 Oct 2026).
*/

CREATE TABLE IF NOT EXISTS driver_payment_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('promised', 'paid', 'no_answer', 'refused', 'wrong_number', 'car_taken', 'car_returned')),
  owed_at_call numeric CHECK (owed_at_call IS NULL OR owed_at_call >= 0),
  promised_amount numeric CHECK (promised_amount IS NULL OR promised_amount > 0),
  promised_at timestamptz,
  car_location text,
  note text,
  happened_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reminded_at timestamptz,
  broken_flagged_at timestamptz,
  CONSTRAINT driver_payment_calls_promise CHECK (outcome <> 'promised' OR promised_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS driver_payment_calls_driver ON driver_payment_calls (driver_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS driver_payment_calls_open_promises ON driver_payment_calls (promised_at) WHERE outcome = 'promised' AND broken_flagged_at IS NULL;

CREATE OR REPLACE FUNCTION is_driver_payment_followup()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM responsibilities WHERE key = 'driver_payment_followup' AND profile_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION is_driver_payment_followup() TO authenticated;

ALTER TABLE driver_payment_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dpc_select ON driver_payment_calls;
CREATE POLICY dpc_select ON driver_payment_calls FOR SELECT TO authenticated USING (
  is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance') OR is_driver_payment_followup()
  OR created_by = auth.uid());
DROP POLICY IF EXISTS dpc_insert ON driver_payment_calls;
CREATE POLICY dpc_insert ON driver_payment_calls FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid() AND (
    is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance') OR is_driver_payment_followup()
    OR (current_department_slug() = 'call_center' AND outcome NOT IN ('car_taken', 'car_returned'))));
-- Fix or remove: the person who recorded it, the same day, or the MD.
DROP POLICY IF EXISTS dpc_update ON driver_payment_calls;
CREATE POLICY dpc_update ON driver_payment_calls FOR UPDATE TO authenticated
  USING (is_managing_director() OR (created_by = auth.uid() AND created_at > now() - interval '1 day'))
  WITH CHECK (is_managing_director() OR created_by = auth.uid());
DROP POLICY IF EXISTS dpc_delete ON driver_payment_calls;
CREATE POLICY dpc_delete ON driver_payment_calls FOR DELETE TO authenticated
  USING (is_managing_director() OR (created_by = auth.uid() AND created_at > now() - interval '1 day'));
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE driver_payment_calls; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Money logged for a driver after a call (what keeps a promise).
CREATE OR REPLACE FUNCTION paid_since_call(p_driver uuid, p_since timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(amount), 0) FROM driver_deposits WHERE driver_id = p_driver AND created_at >= p_since;
$$;

-- Called by notifications-run every run: promise reminders and broken promises.
CREATE OR REPLACE FUNCTION flag_payment_promises()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  -- Due within 30 minutes and not kept yet: remind once.
  FOR c IN
    SELECT * FROM driver_payment_calls
    WHERE outcome = 'promised' AND reminded_at IS NULL AND broken_flagged_at IS NULL
      AND promised_at <= now() + interval '30 minutes' AND promised_at > now() - interval '5 minutes'
  LOOP
    UPDATE driver_payment_calls SET reminded_at = now() WHERE id = c.id;
    IF paid_since_call(c.driver_id, c.created_at) < COALESCE(c.promised_amount, 1) THEN
      INSERT INTO notification_events (rule_key, payload) VALUES ('driver_promise_due', jsonb_build_object('call_id', c.id));
    END IF;
  END LOOP;
  -- Time passed: broken unless the money came in (checked once, then closed either way).
  FOR c IN
    SELECT * FROM driver_payment_calls
    WHERE outcome = 'promised' AND broken_flagged_at IS NULL AND promised_at <= now()
  LOOP
    UPDATE driver_payment_calls SET broken_flagged_at = now(), reminded_at = COALESCE(reminded_at, now()) WHERE id = c.id;
    IF paid_since_call(c.driver_id, c.created_at) < COALESCE(c.promised_amount, 1) THEN
      INSERT INTO notification_events (rule_key, payload) VALUES ('driver_promise_broken', jsonb_build_object('call_id', c.id));
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION flag_payment_promises() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION paid_since_call(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION paid_since_call(uuid, timestamptz) TO authenticated;

-- Car taken back / given back: email at once.
CREATE OR REPLACE FUNCTION notify_driver_car_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.outcome IN ('car_taken', 'car_returned') THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('driver_car_taken', jsonb_build_object('call_id', NEW.id, 'actor_id', NEW.created_by));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS driver_payment_calls_notify ON driver_payment_calls;
CREATE TRIGGER driver_payment_calls_notify AFTER INSERT ON driver_payment_calls FOR EACH ROW EXECUTE FUNCTION notify_driver_car_change();

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('driver_promise_due', 'Driver payment promise due', 'A driver promised to pay by a time that is now 30 minutes away and the money is not in yet.', 'Instant, 30 min before', ARRAY['resp:driver_payment_followup', 'resp:fleet_manager'], 1, 85, 'Fleet & operations', true, NULL),
  ('driver_promise_broken', 'Driver broke a payment promise', 'The promised time passed and the money did not come in - decide about the car.', 'Instant', ARRAY['resp:driver_payment_followup', 'resp:fleet_manager', 'md'], 1, 86, 'Fleet & operations', true, NULL),
  ('driver_car_taken', 'Car taken back / given back', 'A driver''s car was taken back for not paying, or given back.', 'Instant', ARRAY['resp:driver_payment_followup', 'resp:fleet_manager', 'md'], 1, 87, 'Fleet & operations', true, NULL)
ON CONFLICT (key) DO NOTHING;
