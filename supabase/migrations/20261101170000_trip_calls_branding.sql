/*
# Calls after trips, branding sign-ups, and the Call Center's new daily work
(MD, 31 Oct 2026)

## Calls after trips
When a Non-Insider driver (independent: not ours, not a freelancer, not in
any fleet company in the app) completes a trip - booked in the app,
dispatched, or a walk-in trip they started themselves - the Call Center
calls them: how is the app, and the pitch: branded cars with our device
(meter) get more passengers (the app prioritises them) and fares are more
accurate. Branding 20,000 RWF, device 120,000 RWF.

When (queue_trip_calls, every 5 minutes):
- the first trip (or the first since we started calling) -> call;
- after that, call again after the next trip completed 7 days or more
  after the last call - or after the 4th trip since the last call, even
  the same day;
- never while a sign-up is open or once it's completed, nor when the car
  is already branded and has the device;
- after a clear "no", not for 30 days.
One open call per driver. 3 times no answer, a wrong number, or 2 days
without being called -> missed (the next trip can bring a new call).

## Sign-ups
"Yes" (both, or branding only, or device only) creates a branding sign-up
for Rodrigue (duty 'branding_signups'): Agreed -> Contacted -> Paid ->
Completed (branded and device installed). Paid records the money in the
Finance ledger (revenue, checked, so it goes to the MD for approval);
Completed updates the car in Branding & devices and stops the calls.
*/

-- ------------------------------------------------------------ settings
CREATE TABLE IF NOT EXISTS trip_call_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  branding_price numeric NOT NULL DEFAULT 20000,
  device_price numeric NOT NULL DEFAULT 120000,
  repeat_days int NOT NULL DEFAULT 7,
  repeat_trips int NOT NULL DEFAULT 4,
  no_pause_days int NOT NULL DEFAULT 30
);
INSERT INTO trip_call_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE trip_call_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tcs_select ON trip_call_settings;
CREATE POLICY tcs_select ON trip_call_settings FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------ sign-ups
CREATE TABLE IF NOT EXISTS branding_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_driver_id bigint NOT NULL,
  driver_name text NOT NULL,
  driver_phone text,
  vehicle_plate text,
  platform_car_id uuid REFERENCES platform_cars(id) ON DELETE SET NULL,
  wants_branding boolean NOT NULL DEFAULT false,
  wants_device boolean NOT NULL DEFAULT false,
  price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'agreed' CHECK (status IN ('agreed', 'contacted', 'paid', 'completed', 'cancelled')),
  appointment_date date,
  notes text,
  source_call_id uuid,
  agent_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  contacted_at timestamptz,
  paid_at timestamptz,
  paid_amount numeric,
  paid_account text,
  finance_transaction_id uuid REFERENCES finance_transactions(id) ON DELETE SET NULL,
  completed_at timestamptz,
  cancelled_reason text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (wants_branding OR wants_device)
);
CREATE INDEX IF NOT EXISTS branding_signups_driver ON branding_signups (platform_driver_id);
CREATE INDEX IF NOT EXISTS branding_signups_status ON branding_signups (status, created_at DESC);
ALTER TABLE branding_signups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bs_select ON branding_signups;
CREATE POLICY bs_select ON branding_signups FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('finance', 'fleet', 'call_center')
    OR EXISTS (SELECT 1 FROM responsibilities r WHERE r.key = 'branding_signups' AND r.profile_id = auth.uid()));
-- Written only by the functions below.

-- ------------------------------------------------------------ calls
CREATE TABLE IF NOT EXISTS trip_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_driver_id bigint NOT NULL,
  driver_name text,
  driver_phone text,
  vehicle_plate text,
  trip_id bigint,
  trip_completed_at timestamptz,
  trip_dispatch text,
  trip_fare numeric,
  reason text NOT NULL CHECK (reason IN ('first_trip', 'first_call', 'seven_days', 'four_trips')),
  trips_since int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'missed')),
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_attempt_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  outcome text CHECK (outcome IN ('reached', 'no_answer', 'wrong_number')),
  rating int CHECK (rating BETWEEN 1 AND 5),
  experience text,
  problems text,
  answer text CHECK (answer IN ('both', 'branding', 'device', 'thinking', 'no')),
  no_reason text,
  notes text,
  called_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  called_at timestamptz,
  signup_id uuid REFERENCES branding_signups(id) ON DELETE SET NULL,
  missed_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trip_calls_one_open ON trip_calls (platform_driver_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS trip_calls_driver ON trip_calls (platform_driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trip_calls_called ON trip_calls (called_at DESC);
ALTER TABLE trip_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tc_select ON trip_calls;
CREATE POLICY tc_select ON trip_calls FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('call_center', 'finance', 'fleet')
    OR EXISTS (SELECT 1 FROM responsibilities r WHERE r.key = 'branding_signups' AND r.profile_id = auth.uid()));

ALTER TABLE branding_signups DROP CONSTRAINT IF EXISTS branding_signups_source_call_id_fkey;
ALTER TABLE branding_signups ADD CONSTRAINT branding_signups_source_call_id_fkey FOREIGN KEY (source_call_id) REFERENCES trip_calls(id) ON DELETE SET NULL;

-- Rodrigue follows the sign-ups (the MD can move this duty in Notifications settings).
INSERT INTO responsibilities (key, label, description, profile_id)
VALUES ('branding_signups', 'Branding & device sign-ups', 'Non-Insider drivers who agreed to branding or our device after a Call Center call: contact, payment, installation.',
  (SELECT id FROM profiles WHERE full_name ILIKE 'MUGISHA Rodrigue%' AND is_active LIMIT 1))
ON CONFLICT (key) DO NOTHING;

-- An independent driver: not ours, not a freelancer, not in any fleet company in the app.
CREATE OR REPLACE FUNCTION is_independent_driver(p_platform_driver bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_platform_driver IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM platform_fleet_members m WHERE m.platform_driver_id = p_platform_driver)
    AND NOT EXISTS (SELECT 1 FROM platform_driver_status s WHERE s.platform_driver_id = p_platform_driver AND (s.kivu_driver_id IS NOT NULL OR s.freelancer_id IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM platform_trips t WHERE t.platform_driver_id = p_platform_driver AND t.kivu_driver_id IS NOT NULL);
$$;

-- ------------------------------------------------------------ the queue
CREATE OR REPLACE FUNCTION queue_trip_calls()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg trip_call_settings%ROWTYPE;
  d record;
  v_last trip_calls%ROWTYPE;
  t platform_trips%ROWTYPE;
  n int;
  v_reason text;
  v_made int := 0;
BEGIN
  SELECT * INTO cfg FROM trip_call_settings WHERE id;

  -- Not called in 2 days: missed (a later trip can bring a new call).
  UPDATE trip_calls SET status = 'missed', missed_reason = 'not called within 2 days'
  WHERE status = 'open' AND created_at < now() - interval '2 days';

  FOR d IN
    SELECT tr.platform_driver_id AS pid
    FROM platform_trips tr
    WHERE tr.status = 'completed' AND tr.kivu_driver_id IS NULL AND tr.platform_driver_id IS NOT NULL
      AND coalesce(tr.completed_at, tr.status_changed_at) >= cfg.started_at
    GROUP BY tr.platform_driver_id
  LOOP
    CONTINUE WHEN NOT is_independent_driver(d.pid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM trip_calls c WHERE c.platform_driver_id = d.pid AND c.status = 'open');
    CONTINUE WHEN EXISTS (SELECT 1 FROM branding_signups s WHERE s.platform_driver_id = d.pid AND s.status IN ('agreed', 'contacted', 'paid', 'completed'));
    -- Already branded and with our device: nothing to sell.
    CONTINUE WHEN EXISTS (SELECT 1 FROM platform_drivers pd JOIN platform_cars pc ON pc.id = pd.car_id
      WHERE pd.external_id = d.pid AND (pc.is_branded OR pc.branding_status = 'branded') AND pc.device_status = 'installed');

    SELECT * INTO v_last FROM trip_calls c WHERE c.platform_driver_id = d.pid ORDER BY c.created_at DESC LIMIT 1;
    IF v_last.id IS NOT NULL AND v_last.answer = 'no' AND v_last.called_at > now() - make_interval(days => cfg.no_pause_days) THEN CONTINUE; END IF;

    SELECT count(*) INTO n FROM platform_trips tr
    WHERE tr.platform_driver_id = d.pid AND tr.status = 'completed'
      AND coalesce(tr.completed_at, tr.status_changed_at) >= cfg.started_at
      AND coalesce(tr.completed_at, tr.status_changed_at) > coalesce(v_last.trip_completed_at, '-infinity'::timestamptz);
    CONTINUE WHEN n = 0;
    SELECT * INTO t FROM platform_trips tr
    WHERE tr.platform_driver_id = d.pid AND tr.status = 'completed'
    ORDER BY coalesce(tr.completed_at, tr.status_changed_at) DESC LIMIT 1;

    IF v_last.id IS NULL THEN
      v_reason := CASE WHEN (SELECT count(*) FROM platform_trips tr WHERE tr.platform_driver_id = d.pid AND tr.status = 'completed') = 1 THEN 'first_trip' ELSE 'first_call' END;
    ELSIF n >= cfg.repeat_trips THEN
      v_reason := 'four_trips';
    ELSIF coalesce(t.completed_at, t.status_changed_at) >= v_last.created_at + make_interval(days => cfg.repeat_days) THEN
      v_reason := 'seven_days';
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO trip_calls (platform_driver_id, driver_name, driver_phone, vehicle_plate, trip_id, trip_completed_at, trip_dispatch, trip_fare, reason, trips_since)
    VALUES (d.pid,
      coalesce((SELECT nullif(trim(s.full_name), '') FROM platform_driver_status s WHERE s.platform_driver_id = d.pid), nullif(trim(t.driver_name), '')),
      coalesce((SELECT nullif(trim(s.phone), '') FROM platform_driver_status s WHERE s.platform_driver_id = d.pid), t.driver_phone),
      coalesce(t.vehicle_plate, (SELECT s.vehicle_plate FROM platform_driver_status s WHERE s.platform_driver_id = d.pid)),
      t.id, coalesce(t.completed_at, t.status_changed_at), t.dispatch_method, t.total_fare, v_reason, n)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_made := v_made + 1; END IF;
  END LOOP;
  RETURN v_made;
END;
$$;
REVOKE ALL ON FUNCTION queue_trip_calls() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION is_independent_driver(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_independent_driver(bigint) TO authenticated;

DO $$ BEGIN PERFORM cron.unschedule('trip-calls-queue'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('trip-calls-queue', '*/5 * * * *', 'SELECT queue_trip_calls();');

-- ------------------------------------------------------------ logging a call
CREATE OR REPLACE FUNCTION log_trip_call(p_call uuid, p_outcome text, p_rating int, p_experience text, p_problems text, p_answer text, p_no_reason text, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c trip_calls%ROWTYPE;
  cfg trip_call_settings%ROWTYPE;
  v_signup uuid;
  v_car uuid;
  v_owner uuid;
  v_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT (is_managing_director() OR current_department_slug() = 'call_center') THEN
    RAISE EXCEPTION 'Only the Call Center records these calls';
  END IF;
  SELECT * INTO c FROM trip_calls WHERE id = p_call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call not found'; END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'This call is already recorded'; END IF;
  SELECT * INTO cfg FROM trip_call_settings WHERE id;

  IF p_outcome IN ('no_answer', 'wrong_number') THEN
    UPDATE trip_calls SET attempts = attempts + 1, last_attempt_at = now(), last_attempt_by = auth.uid(), outcome = p_outcome,
      notes = coalesce(nullif(trim(p_notes), ''), notes),
      status = CASE WHEN p_outcome = 'wrong_number' OR attempts + 1 >= 3 THEN 'missed' ELSE 'open' END,
      missed_reason = CASE WHEN p_outcome = 'wrong_number' THEN 'wrong number' WHEN attempts + 1 >= 3 THEN 'no answer 3 times' END
    WHERE id = p_call;
    RETURN NULL;
  END IF;

  IF p_outcome <> 'reached' THEN RAISE EXCEPTION 'Unknown outcome'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Give the driver''s rating of the app (1 to 5)'; END IF;
  IF p_answer IS NULL OR p_answer NOT IN ('both', 'branding', 'device', 'thinking', 'no') THEN RAISE EXCEPTION 'Record the driver''s answer about branding and the device'; END IF;
  IF p_answer = 'no' AND length(trim(coalesce(p_no_reason, ''))) < 3 THEN RAISE EXCEPTION 'Write why the driver said no'; END IF;

  IF p_answer IN ('both', 'branding', 'device') THEN
    SELECT pd.car_id INTO v_car FROM platform_drivers pd WHERE pd.external_id = c.platform_driver_id LIMIT 1;
    INSERT INTO branding_signups (platform_driver_id, driver_name, driver_phone, vehicle_plate, platform_car_id, wants_branding, wants_device, price, source_call_id, agent_id, notes, history)
    VALUES (c.platform_driver_id, coalesce(c.driver_name, 'Driver #' || c.platform_driver_id), c.driver_phone, c.vehicle_plate, v_car,
      p_answer IN ('both', 'branding'), p_answer IN ('both', 'device'),
      CASE WHEN p_answer IN ('both', 'branding') THEN cfg.branding_price ELSE 0 END + CASE WHEN p_answer IN ('both', 'device') THEN cfg.device_price ELSE 0 END,
      p_call, auth.uid(), nullif(trim(p_notes), ''),
      jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'by_name', (SELECT trim(full_name) FROM profiles WHERE id = auth.uid()), 'action', 'agreed', 'note', 'Agreed on the call after a trip')))
    RETURNING id INTO v_signup;

    SELECT profile_id INTO v_owner FROM responsibilities WHERE key = 'branding_signups';
    v_name := coalesce(c.driver_name, 'A driver');
    IF v_owner IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, message, link)
      VALUES (v_owner, 'branding_signup',
        format('%s (%s) agreed to %s: call them to agree payment and a date', v_name, coalesce(c.vehicle_plate, 'no plate'),
          CASE p_answer WHEN 'both' THEN 'branding and our device (140,000 RWF)' WHEN 'branding' THEN 'branding (20,000 RWF)' ELSE 'our device (120,000 RWF)' END),
        '/trips/branding?s=' || v_signup);
    END IF;
  END IF;

  UPDATE trip_calls SET status = 'done', outcome = 'reached', attempts = attempts + 1, last_attempt_at = now(), last_attempt_by = auth.uid(),
    rating = p_rating, experience = nullif(trim(p_experience), ''), problems = nullif(trim(p_problems), ''), answer = p_answer,
    no_reason = CASE WHEN p_answer = 'no' THEN trim(p_no_reason) END, notes = nullif(trim(p_notes), ''),
    called_by = auth.uid(), called_at = now(), signup_id = v_signup
  WHERE id = p_call;
  RETURN v_signup;
END;
$$;
REVOKE ALL ON FUNCTION log_trip_call(uuid, text, int, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION log_trip_call(uuid, text, int, text, text, text, text, text) TO authenticated;

-- ------------------------------------------------------------ moving a sign-up on
CREATE OR REPLACE FUNCTION update_branding_signup(p_id uuid, p_action text, p_note text DEFAULT NULL, p_appointment date DEFAULT NULL,
  p_amount numeric DEFAULT NULL, p_account text DEFAULT NULL, p_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s branding_signups%ROWTYPE;
  v_name text;
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_acc uuid;
  v_tx uuid;
  v_what text;
BEGIN
  IF auth.uid() IS NULL OR NOT (is_managing_director() OR current_department_slug() IN ('finance', 'fleet')
    OR EXISTS (SELECT 1 FROM responsibilities r WHERE r.key = 'branding_signups' AND r.profile_id = auth.uid())) THEN
    RAISE EXCEPTION 'Only Rodrigue, Finance, Fleet and the MD move sign-ups on';
  END IF;
  SELECT * INTO s FROM branding_signups WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sign-up not found'; END IF;
  SELECT trim(full_name) INTO v_name FROM profiles WHERE id = auth.uid();
  v_what := concat_ws(' + ', CASE WHEN s.wants_branding THEN 'branding' END, CASE WHEN s.wants_device THEN 'device' END);

  IF p_action = 'contacted' THEN
    IF s.status NOT IN ('agreed', 'contacted') THEN RAISE EXCEPTION 'Already paid or closed'; END IF;
    UPDATE branding_signups SET status = 'contacted', contacted_at = coalesce(contacted_at, now()), appointment_date = coalesce(p_appointment, appointment_date)
    WHERE id = p_id;
  ELSIF p_action = 'paid' OR (p_action = 'completed' AND s.status IN ('agreed', 'contacted')) THEN
    IF s.status IN ('paid', 'completed', 'cancelled') AND p_action = 'paid' THEN RAISE EXCEPTION 'Already paid or closed'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Type the amount the driver paid'; END IF;
    IF coalesce(p_date, v_today) > v_today THEN RAISE EXCEPTION 'The payment date can''t be in the future'; END IF;
    SELECT id INTO v_acc FROM finance_accounts WHERE key = coalesce(p_account, 'momo');
    IF v_acc IS NULL THEN RAISE EXCEPTION 'Pick the account the money came into'; END IF;
    INSERT INTO finance_transactions (type, account_id, direction, amount, transaction_date, description, counterparty, status, system_generated,
      prepared_by, checked_by, checked_at, created_by)
    VALUES ('revenue', v_acc, 'in', p_amount, coalesce(p_date, v_today),
      format('Non-Insider %s — %s (%s)', v_what, s.driver_name, coalesce(s.vehicle_plate, 'no plate')), s.driver_name, 'checked', false,
      auth.uid(), auth.uid(), now(), auth.uid())
    RETURNING id INTO v_tx;
    UPDATE branding_signups SET status = 'paid', paid_at = now(), paid_amount = p_amount, paid_account = coalesce(p_account, 'momo'), finance_transaction_id = v_tx,
      contacted_at = coalesce(contacted_at, now())
    WHERE id = p_id;
    s.status := 'paid';
  ELSIF p_action IN ('cancel') THEN
    IF s.status = 'completed' THEN RAISE EXCEPTION 'Already completed'; END IF;
    IF length(trim(coalesce(p_note, ''))) < 3 THEN RAISE EXCEPTION 'Write why it is not going ahead'; END IF;
    UPDATE branding_signups SET status = 'cancelled', cancelled_reason = trim(p_note) WHERE id = p_id;
  ELSIF p_action = 'note' THEN
    IF length(trim(coalesce(p_note, ''))) < 2 THEN RAISE EXCEPTION 'Write the note'; END IF;
    UPDATE branding_signups SET appointment_date = coalesce(p_appointment, appointment_date) WHERE id = p_id;
  ELSIF p_action <> 'completed' THEN
    RAISE EXCEPTION 'Unknown action';
  END IF;

  IF p_action = 'completed' THEN
    IF s.status <> 'paid' THEN RAISE EXCEPTION 'Record the payment first'; END IF;
    UPDATE branding_signups SET status = 'completed', completed_at = now() WHERE id = p_id;
    IF s.platform_car_id IS NOT NULL THEN
      UPDATE platform_cars SET
        is_branded = CASE WHEN s.wants_branding THEN true ELSE is_branded END,
        branding_status = CASE WHEN s.wants_branding THEN 'branded' ELSE branding_status END,
        branding_recorded_at = CASE WHEN s.wants_branding THEN now() ELSE branding_recorded_at END,
        branding_recorded_by = CASE WHEN s.wants_branding THEN auth.uid() ELSE branding_recorded_by END,
        device_status = CASE WHEN s.wants_device THEN 'installed' ELSE device_status END,
        device_recorded_at = CASE WHEN s.wants_device THEN now() ELSE device_recorded_at END,
        device_recorded_by = CASE WHEN s.wants_device THEN auth.uid() ELSE device_recorded_by END,
        updated_at = now()
      WHERE id = s.platform_car_id;
    END IF;
  END IF;

  UPDATE branding_signups SET updated_at = now(), history = history || jsonb_build_array(jsonb_build_object(
    'at', now(), 'by', auth.uid(), 'by_name', v_name, 'action', p_action, 'note', nullif(trim(coalesce(p_note, '')), ''),
    'appointment', p_appointment, 'amount', p_amount, 'account', p_account))
  WHERE id = p_id;

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'branding_signup_' || p_action, 'branding_signup', p_id, s.driver_name,
    jsonb_build_object('note', p_note, 'amount', p_amount, 'transaction_id', v_tx));
END;
$$;
REVOKE ALL ON FUNCTION update_branding_signup(uuid, text, text, date, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_branding_signup(uuid, text, text, date, numeric, text, date) TO authenticated;

-- ------------------------------------------------------------ the Call Center's daily tasks
-- Stop "Call at least 10 drivers a day" (drivers were irritated).
UPDATE recurring_tasks SET is_active = false, updated_at = now()
WHERE target_department_slug = 'call_center' AND title ILIKE 'Call at least 10 drivers%';

-- First thing every shift: put every driver online.
INSERT INTO recurring_tasks (title, description, target_type, target_department_slug, frequency, due_time, is_active, sort_order, created_by)
SELECT 'First thing: put every driver online in the Kivu Ride dashboard',
  'Kivu Ride dashboard → Drivers → Set Online for every approved driver, in your first 15 minutes. The app puts a driver offline after 1 hour without opening it: call those one by one (your "Call drivers offline" task and Ours On Shift).',
  'department', 'call_center', 'daily', NULL, true, 0, (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM recurring_tasks WHERE target_department_slug = 'call_center' AND title ILIKE 'First thing: put every driver online%');

-- Commission: the amounts are on the Kivu Ride dashboard's commission page; every call is logged and reported at the end of the shift.
UPDATE recurring_tasks SET
  title = 'Commission: call drivers who owe and log every call',
  description = 'The Kivu Ride dashboard''s commission page shows who owes. Call them and log each call in Commission follow-up (collected, promised, reminded, no answer). Your end-of-shift report shows what you collected and reminded.',
  updated_at = now()
WHERE target_department_slug = 'call_center' AND title ILIKE 'Call drivers who owe commission%';

-- ------------------------------------------------------------ shift numbers
CREATE OR REPLACE FUNCTION shift_stats(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s call_center_shifts%ROWTYPE;
  v_to timestamptz;
BEGIN
  SELECT * INTO s FROM call_center_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  IF auth.uid() IS NOT NULL AND NOT (is_managing_director() OR current_department_slug() IN ('call_center', 'finance')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  v_to := COALESCE(s.ended_at, now());
  RETURN jsonb_build_object(
    'minutes', round(extract(epoch FROM (v_to - s.started_at)) / 60),
    'contacts_logged', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to),
    'solved_on_call', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND resolved_on_call AND outcome_kind IS NULL),
    'handed_on', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND NOT resolved_on_call),
    'emergencies', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND priority = 'emergency'),
    'bookings', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome_kind LIKE 'booking_%'),
    'abusive', (SELECT count(*) FROM call_tickets WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome_kind = 'abusive_ended'),
    'cases_closed', (SELECT count(*) FROM call_ticket_updates WHERE author_id = s.agent_id AND kind = 'closed' AND created_at BETWEEN s.started_at AND v_to),
    'notes_added', (SELECT count(*) FROM call_ticket_updates WHERE author_id = s.agent_id AND kind = 'note' AND created_at BETWEEN s.started_at AND v_to),
    'driver_calls', (SELECT count(*) FROM call_logs WHERE caller_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to),
    'outreach_calls', (SELECT count(*) FROM platform_outreach_calls WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to),
    'outreach_interested', (SELECT count(*) FROM platform_outreach_calls WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND interested),
    'open_cases_at_end', (SELECT count(*) FROM call_tickets WHERE status IN ('open', 'in_progress', 'waiting_on_caller', 'resolved')),
    'dispatches', (SELECT count(*) FROM dispatches WHERE created_by = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND NOT sandbox AND status <> 'failed'),
    'trip_calls', (SELECT count(*) FROM trip_calls WHERE last_attempt_by = s.agent_id AND last_attempt_at BETWEEN s.started_at AND v_to),
    'trip_calls_reached', (SELECT count(*) FROM trip_calls WHERE called_by = s.agent_id AND called_at BETWEEN s.started_at AND v_to),
    'branding_yes', (SELECT count(*) FROM trip_calls WHERE called_by = s.agent_id AND called_at BETWEEN s.started_at AND v_to AND answer IN ('both', 'branding', 'device')),
    'commission_calls', (SELECT count(*) FROM commission_followups WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to),
    'commission_collected', (SELECT coalesce(sum(amount_paid), 0) FROM commission_followups WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome = 'paid'),
    'commission_promised', (SELECT count(*) FROM commission_followups WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome = 'promised'),
    'commission_reminded', (SELECT count(*) FROM commission_followups WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome IN ('promised', 'refused'))
  );
END;
$$;
