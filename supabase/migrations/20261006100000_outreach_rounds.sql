/*
# Non-Insider outreach in rounds

Confirmed with the operator (6 Oct 2026). The Call Center calls every
Non-Insider driver, one by one, in rounds. On each call they record three
things:

1. The updated app - will the driver come to our office to get the updated
   version (IT installs it and shows the new features), do they already
   have it, and how actively they use the app.
2. Our device - 120,000 RWF, one-time: yes / thinking about it / no.
3. Branding - 20,000 RWF, one-time, paid by the driver, which makes them a
   priority driver: yes / thinking about it / no.

Round 1 ends when every driver has been reached. Then a new round starts
with fresh talking points (e.g. "this week we gave our drivers on average 3
passengers a day") and everyone who hasn't come to the office yet is
called again. When IT reports a driver came to the office, the Call Center
records it and the driver leaves the rounds.

Two agents never call the same driver: opening a driver claims them for
15 minutes, and "Call next driver" hands out the next unclaimed one.

platform_outreach_calls had no rows yet, so it is rebuilt with the new
answers. A driver's latest answers live in platform_outreach_status.
*/

-- ------------------------------------------------------------ rounds
CREATE TABLE IF NOT EXISTS outreach_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL UNIQUE,
  talking_points text,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  closed_at timestamptz
);
ALTER TABLE outreach_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outreach_rounds_select" ON outreach_rounds;
CREATE POLICY "outreach_rounds_select" ON outreach_rounds FOR SELECT TO authenticated
  USING (current_department_slug() IN ('call_center', 'fleet', 'it', 'finance') OR is_managing_director());

INSERT INTO outreach_rounds (number, talking_points, started_by)
SELECT 1, 'We have improved the Kivu Ride app and we now send clients to our drivers. Come to our office and IT will install the updated app on your phone and show you the new features.',
  (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM outreach_rounds);

CREATE OR REPLACE FUNCTION current_outreach_round()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT number FROM outreach_rounds WHERE closed_at IS NULL ORDER BY number DESC LIMIT 1), 1);
$$;

-- ------------------------------------------------------------ calls (rebuilt; it was empty)
DROP FUNCTION IF EXISTS log_outreach_call(jsonb);
DROP TABLE IF EXISTS platform_outreach_calls;
CREATE TABLE platform_outreach_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_driver_id uuid NOT NULL REFERENCES platform_drivers(id) ON DELETE CASCADE,
  car_id uuid REFERENCES platform_cars(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  round int NOT NULL,
  result text NOT NULL CHECK (result IN ('reached', 'no_answer', 'callback', 'wrong_number')),
  app_status text CHECK (app_status IN ('will_come', 'has_latest', 'not_interested')),
  app_usage text CHECK (app_usage IN ('daily', 'sometimes', 'rarely', 'not_using')),
  device_answer text CHECK (device_answer IN ('yes', 'thinking', 'no')),
  branding_answer text CHECK (branding_answer IN ('yes', 'thinking', 'no')),
  interested boolean GENERATED ALWAYS AS (COALESCE(device_answer = 'yes', false) OR COALESCE(branding_answer = 'yes', false) OR COALESCE(app_status = 'will_come', false)) STORED,
  callback_at timestamptz,
  usual_area text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_outreach_calls_driver_idx ON platform_outreach_calls (platform_driver_id, created_at DESC);
CREATE INDEX platform_outreach_calls_agent_idx ON platform_outreach_calls (agent_id, created_at DESC);
ALTER TABLE platform_outreach_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_outreach_calls_select" ON platform_outreach_calls FOR SELECT TO authenticated
  USING (current_department_slug() IN ('call_center', 'fleet', 'it') OR is_managing_director());

-- ------------------------------------------------------------ each driver's latest answers
CREATE TABLE IF NOT EXISTS platform_outreach_status (
  platform_driver_id uuid PRIMARY KEY REFERENCES platform_drivers(id) ON DELETE CASCADE,
  app_status text CHECK (app_status IN ('will_come', 'has_latest', 'not_interested')),
  app_usage text CHECK (app_usage IN ('daily', 'sometimes', 'rarely', 'not_using')),
  device_answer text CHECK (device_answer IN ('yes', 'thinking', 'no')),
  branding_answer text CHECK (branding_answer IN ('yes', 'thinking', 'no')),
  usual_area text,
  came_to_office_on date,
  came_recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  last_round int,
  last_result text,
  last_called_at timestamptz,
  last_agent_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ever_reached boolean NOT NULL DEFAULT false,
  callback_at timestamptz,
  claimed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_outreach_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_outreach_status_select" ON platform_outreach_status;
CREATE POLICY "platform_outreach_status_select" ON platform_outreach_status FOR SELECT TO authenticated
  USING (current_department_slug() IN ('call_center', 'fleet', 'it') OR is_managing_director());

INSERT INTO platform_outreach_status (platform_driver_id)
SELECT id FROM platform_drivers ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION add_platform_outreach_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO platform_outreach_status (platform_driver_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS platform_drivers_outreach_status ON platform_drivers;
CREATE TRIGGER platform_drivers_outreach_status AFTER INSERT ON platform_drivers
  FOR EACH ROW EXECUTE FUNCTION add_platform_outreach_status();

-- Live locks between the two computers.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'platform_outreach_status') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE platform_outreach_status;
  END IF;
END $$;

-- ------------------------------------------------------------ RPCs
CREATE OR REPLACE FUNCTION outreach_can_work()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_department_slug() = 'call_center' OR is_managing_director();
$$;

-- Open a driver: claim them for 15 minutes. Returns NULL when the claim is
-- yours, or the name of the agent already calling them.
CREATE OR REPLACE FUNCTION claim_outreach_driver(p_driver uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s platform_outreach_status%ROWTYPE;
BEGIN
  IF NOT outreach_can_work() THEN RAISE EXCEPTION 'Only the Call Center works the outreach list'; END IF;
  SELECT * INTO s FROM platform_outreach_status WHERE platform_driver_id = p_driver FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF s.claimed_by IS NOT NULL AND s.claimed_by <> auth.uid() AND s.claimed_at > now() - interval '15 minutes' THEN
    RETURN COALESCE((SELECT trim(full_name) FROM profiles WHERE id = s.claimed_by), 'another agent');
  END IF;
  UPDATE platform_outreach_status SET claimed_by = NULL, claimed_at = NULL WHERE claimed_by = auth.uid() AND platform_driver_id <> p_driver;
  UPDATE platform_outreach_status SET claimed_by = auth.uid(), claimed_at = now() WHERE platform_driver_id = p_driver;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION release_outreach_claim(p_driver uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE platform_outreach_status SET claimed_by = NULL, claimed_at = NULL
  WHERE platform_driver_id = p_driver AND claimed_by = auth.uid();
$$;

-- Next driver to call in this round, claimed for you. Call-backs that are
-- due first, then drivers not tried yet this round, then no-answers from
-- more than two hours ago.
CREATE OR REPLACE FUNCTION next_outreach_driver()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_round int := current_outreach_round();
  v_id uuid;
BEGIN
  IF NOT outreach_can_work() THEN RAISE EXCEPTION 'Only the Call Center works the outreach list'; END IF;
  SELECT s.platform_driver_id INTO v_id
  FROM platform_outreach_status s
  WHERE s.came_to_office_on IS NULL
    AND s.last_result IS DISTINCT FROM 'wrong_number'
    AND NOT COALESCE(s.last_round = v_round AND s.last_result = 'reached', false)
    AND NOT COALESCE(s.last_result = 'callback' AND s.callback_at > now() + interval '15 minutes', false)
    AND NOT COALESCE(s.last_result = 'no_answer' AND s.last_round = v_round AND s.last_called_at > now() - interval '2 hours', false)
    AND (s.claimed_by IS NULL OR s.claimed_by = auth.uid() OR s.claimed_at < now() - interval '15 minutes')
  ORDER BY
    COALESCE(s.last_result = 'callback', false) DESC,
    (s.last_round IS NOT DISTINCT FROM v_round) ASC,
    s.ever_reached ASC,
    s.last_called_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE OF s SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE platform_outreach_status SET claimed_by = NULL, claimed_at = NULL WHERE claimed_by = auth.uid() AND platform_driver_id <> v_id;
  UPDATE platform_outreach_status SET claimed_by = auth.uid(), claimed_at = now() WHERE platform_driver_id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION log_outreach_call(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_driver uuid := NULLIF(p->>'platform_driver_id', '')::uuid;
  v_car uuid;
  v_result text := p->>'result';
  v_round int := current_outreach_round();
  v_reached boolean;
  v_app text; v_usage text; v_device text; v_brand text; v_area text; v_note text;
  v_callback timestamptz := NULLIF(p->>'callback_at', '')::timestamptz;
  v_summary text;
BEGIN
  IF NOT outreach_can_work() THEN RAISE EXCEPTION 'Only the Call Center logs outreach calls'; END IF;
  SELECT car_id INTO v_car FROM platform_drivers WHERE id = v_driver;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_result IS NULL OR v_result NOT IN ('reached', 'no_answer', 'callback', 'wrong_number') THEN RAISE EXCEPTION 'Say whether you reached the driver'; END IF;
  IF v_result = 'callback' AND v_callback IS NULL THEN RAISE EXCEPTION 'Set when to call back'; END IF;
  v_reached := v_result IN ('reached', 'callback');
  IF v_reached THEN
    v_app := NULLIF(p->>'app_status', ''); v_usage := NULLIF(p->>'app_usage', '');
    v_device := NULLIF(p->>'device_answer', ''); v_brand := NULLIF(p->>'branding_answer', '');
  END IF;
  IF v_result = 'reached' AND (v_app IS NULL OR v_device IS NULL OR v_brand IS NULL) THEN
    RAISE EXCEPTION 'Answer the three questions: updated app, device and branding';
  END IF;
  v_area := NULLIF(trim(p->>'usual_area'), '');
  v_note := NULLIF(trim(p->>'note'), '');

  INSERT INTO platform_outreach_calls (platform_driver_id, car_id, agent_id, round, result, app_status, app_usage, device_answer, branding_answer, callback_at, usual_area, note)
  VALUES (v_driver, v_car, auth.uid(), v_round, v_result, v_app, v_usage, v_device, v_brand, CASE WHEN v_result = 'callback' THEN v_callback END, v_area, v_note)
  RETURNING id INTO v_id;

  UPDATE platform_outreach_status SET
    app_status = COALESCE(v_app, app_status),
    app_usage = COALESCE(v_usage, app_usage),
    device_answer = COALESCE(v_device, device_answer),
    branding_answer = COALESCE(v_brand, branding_answer),
    usual_area = COALESCE(v_area, usual_area),
    last_round = v_round, last_result = v_result, last_called_at = now(), last_agent_id = auth.uid(),
    ever_reached = ever_reached OR v_reached,
    callback_at = CASE WHEN v_result = 'callback' THEN v_callback END,
    claimed_by = NULL, claimed_at = NULL, updated_at = now()
  WHERE platform_driver_id = v_driver;

  -- Device / branding answers reach the Fleet Manager through the car's
  -- survey answers (the Branding & Devices pipeline picks up a Yes).
  IF v_car IS NOT NULL AND (v_device IS NOT NULL OR v_brand IS NOT NULL) THEN
    v_summary := concat_ws(', ', 'device: ' || v_device, 'branding: ' || v_brand, 'updated app: ' || replace(v_app, '_', ' '));
    UPDATE platform_cars SET
      willing_to_buy_device = CASE WHEN v_device = 'yes' THEN true WHEN v_device = 'no' AND willing_to_buy_device IS NULL THEN false ELSE willing_to_buy_device END,
      allows_branding = CASE WHEN v_brand = 'yes' THEN true WHEN v_brand = 'no' AND allows_branding IS NULL THEN false ELSE allows_branding END,
      notes = concat_ws(E'\n', NULLIF(notes, ''), to_char(now() AT TIME ZONE 'Africa/Kigali', 'DD Mon') || ' — outreach round ' || v_round || ': ' || v_summary
        || COALESCE(' — ' || v_note, '') || ' (' || COALESCE((SELECT trim(full_name) FROM profiles WHERE id = auth.uid()), 'Call Center') || ')'),
      updated_at = now()
    WHERE id = v_car;
  END IF;
  RETURN v_id;
END;
$$;

-- IT tells the Call Center who came to the office; the Call Center records
-- it here (NULL undoes it).
CREATE OR REPLACE FUNCTION set_outreach_came_to_office(p_driver uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT outreach_can_work() THEN RAISE EXCEPTION 'Only the Call Center records office visits'; END IF;
  IF p_date > (now() AT TIME ZONE 'Africa/Kigali')::date THEN RAISE EXCEPTION 'That date is in the future'; END IF;
  UPDATE platform_outreach_status SET came_to_office_on = p_date, came_recorded_by = CASE WHEN p_date IS NULL THEN NULL ELSE auth.uid() END,
    claimed_by = NULL, claimed_at = NULL, updated_at = now()
  WHERE platform_driver_id = p_driver;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION start_outreach_round(p_talking_points text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next int;
BEGIN
  IF NOT outreach_can_work() THEN RAISE EXCEPTION 'Only the Call Center starts a round'; END IF;
  IF NULLIF(trim(p_talking_points), '') IS NULL THEN RAISE EXCEPTION 'Write what to tell drivers this round'; END IF;
  UPDATE outreach_rounds SET closed_at = now() WHERE closed_at IS NULL;
  v_next := COALESCE((SELECT max(number) FROM outreach_rounds), 0) + 1;
  INSERT INTO outreach_rounds (number, talking_points, started_by) VALUES (v_next, trim(p_talking_points), auth.uid());
  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION set_outreach_talking_points(p_talking_points text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT outreach_can_work() THEN RAISE EXCEPTION 'Only the Call Center edits the talking points'; END IF;
  UPDATE outreach_rounds SET talking_points = NULLIF(trim(p_talking_points), '') WHERE number = current_outreach_round();
END;
$$;

-- Shift stats: "interested" now means any yes (updated app, device or branding).
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
    'open_cases_at_end', (SELECT count(*) FROM call_tickets WHERE status IN ('open', 'in_progress', 'waiting_on_caller', 'resolved'))
  );
END;
$$;

-- Analytics: outreach section reads the rounds.
CREATE OR REPLACE FUNCTION call_center_analytics(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_since timestamptz := date_trunc('day', now() AT TIME ZONE 'Africa/Kigali') AT TIME ZONE 'Africa/Kigali' - make_interval(days => GREATEST(p_days, 1) - 1);
  v_cc uuid := (SELECT id FROM departments WHERE slug = 'call_center');
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'finance') THEN
    RAISE EXCEPTION 'Call analytics are for the MD and Finance';
  END IF;

  RETURN jsonb_build_object(
    'since', (v_since AT TIME ZONE 'Africa/Kigali')::date,
    -- Calls per day by type, from shift reports (attributed to the day the shift started).
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day), '[]'::jsonb) FROM (
        SELECT g.day,
          COALESCE(sum((r.report->>'in_passengers')::int), 0) AS in_passengers,
          COALESCE(sum((r.report->>'in_drivers')::int), 0) AS in_drivers,
          COALESCE(sum((r.report->>'in_noninsider')::int), 0) AS in_noninsider,
          COALESCE(sum((r.report->>'in_partners')::int), 0) AS in_partners,
          COALESCE(sum(CASE WHEN r.report ? 'in_passengers' THEN (r.report->>'in_other')::int ELSE (r.report->>'calls_received')::int END), 0) AS in_other,
          COALESCE(sum((r.report->>'out_drivers')::int), 0) AS out_drivers,
          COALESCE(sum((r.report->>'out_noninsider')::int), 0) AS out_noninsider,
          COALESCE(sum((r.report->>'out_callbacks')::int), 0) AS out_callbacks,
          COALESCE(sum(CASE WHEN r.report ? 'out_drivers' THEN (r.report->>'out_other')::int ELSE (r.report->>'calls_made')::int END), 0) AS out_other,
          COALESCE(sum((r.report->>'calls_missed')::int), 0) AS missed,
          COALESCE(sum((r.report->>'messages_handled')::int), 0) AS messages,
          (SELECT count(*) FROM call_tickets t WHERE (t.created_at AT TIME ZONE 'Africa/Kigali')::date = g.day) AS contacts_logged,
          (SELECT count(*) FROM platform_outreach_calls o WHERE (o.created_at AT TIME ZONE 'Africa/Kigali')::date = g.day) AS outreach_logged
        FROM generate_series((v_since AT TIME ZONE 'Africa/Kigali')::date, (now() AT TIME ZONE 'Africa/Kigali')::date, interval '1 day') AS g(day)
        LEFT JOIN call_center_shifts r ON (r.started_at AT TIME ZONE 'Africa/Kigali')::date = g.day AND r.status = 'closed'
        GROUP BY g.day
      ) d
    ),
    -- What logged contacts were about (Script Book sections).
    'by_category', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'n', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (SELECT category, count(*) n FROM call_tickets WHERE created_at >= v_since GROUP BY category) c
    ),
    'by_situation', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('situation', situation, 'n', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (SELECT situation, count(*) n FROM call_tickets WHERE created_at >= v_since AND situation IS NOT NULL GROUP BY situation ORDER BY n DESC LIMIT 10) c
    ),
    -- Busiest hours: logged contacts by weekday x hour (Kigali).
    'heatmap', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'n', n)), '[]'::jsonb) FROM (
        SELECT extract(isodow FROM created_at AT TIME ZONE 'Africa/Kigali')::int dow, extract(hour FROM created_at AT TIME ZONE 'Africa/Kigali')::int hr, count(*) n
        FROM call_tickets WHERE created_at >= v_since GROUP BY 1, 2
      ) h
    ),
    -- Per-agent performance.
    'agents', (
      SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.name), '[]'::jsonb) FROM (
        SELECT p.id, trim(p.full_name) AS name, p.is_active,
          (SELECT count(*) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since) AS shifts,
          (SELECT count(*) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since AND s.late_minutes <= 10) AS on_time,
          (SELECT round(avg(s.late_minutes)) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since) AS avg_late,
          (SELECT COALESCE(round(sum(extract(epoch FROM (COALESCE(s.ended_at, now()) - s.started_at)) / 60)), 0) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since) AS minutes,
          (SELECT count(*) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since AND s.status = 'auto_closed') AS not_ended,
          (SELECT COALESCE(sum((s.report->>'calls_received')::int), 0) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since) AS calls_in,
          (SELECT COALESCE(sum((s.report->>'calls_made')::int), 0) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since) AS calls_out,
          (SELECT COALESCE(sum((s.report->>'calls_missed')::int), 0) FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since) AS calls_missed,
          (SELECT count(*) FROM call_tickets t WHERE t.created_by = p.id AND t.created_at >= v_since) AS contacts_logged,
          (SELECT count(*) FROM call_tickets t WHERE t.created_by = p.id AND t.created_at >= v_since AND t.resolved_on_call AND t.outcome_kind IS NULL) AS solved_on_call,
          (SELECT count(*) FROM call_ticket_updates u WHERE u.author_id = p.id AND u.kind = 'closed' AND u.created_at >= v_since) AS cases_closed,
          (SELECT count(*) FROM call_logs l WHERE l.caller_id = p.id AND l.created_at >= v_since) AS driver_calls,
          (SELECT count(*) FROM platform_outreach_calls o WHERE o.agent_id = p.id AND o.created_at >= v_since) AS outreach_calls,
          (SELECT count(*) FROM platform_outreach_calls o WHERE o.agent_id = p.id AND o.created_at >= v_since AND o.interested) AS outreach_interested,
          (SELECT count(*) FROM call_tickets t WHERE t.closed_by = p.id AND t.closed_at >= v_since AND t.satisfaction = 'happy') AS happy,
          (SELECT count(*) FROM call_tickets t WHERE t.closed_by = p.id AND t.closed_at >= v_since AND t.satisfaction IS NOT NULL) AS rated
        FROM profiles p
        WHERE p.department_id = v_cc
          AND (p.is_active OR EXISTS (SELECT 1 FROM call_center_shifts s WHERE s.agent_id = p.id AND s.started_at >= v_since))
      ) a
    ),
    'quality', jsonb_build_object(
      'contacts', (SELECT count(*) FROM call_tickets WHERE created_at >= v_since AND (outcome_kind IS NULL OR outcome_kind = 'info_given')),
      'solved_on_call', (SELECT count(*) FROM call_tickets WHERE created_at >= v_since AND resolved_on_call AND outcome_kind IS NULL),
      'cases', (SELECT count(*) FROM call_tickets WHERE created_at >= v_since AND NOT resolved_on_call AND priority <> 'emergency'),
      'response_met', (SELECT count(*) FROM call_tickets WHERE created_at >= v_since AND NOT resolved_on_call AND priority <> 'emergency'
                         AND first_response_at IS NOT NULL AND first_response_at - COALESCE(assigned_at, created_at) <= interval '2 hours'),
      'happy', (SELECT count(*) FROM call_tickets WHERE closed_at >= v_since AND satisfaction = 'happy'),
      'neutral', (SELECT count(*) FROM call_tickets WHERE closed_at >= v_since AND satisfaction = 'neutral'),
      'unhappy', (SELECT count(*) FROM call_tickets WHERE closed_at >= v_since AND satisfaction = 'unhappy'),
      'emergencies', (SELECT count(*) FROM call_tickets WHERE created_at >= v_since AND priority = 'emergency')
    ),
    -- Outreach (all time, so the campaign's progress shows).
    'outreach', jsonb_build_object(
      'drivers', (SELECT count(*) FROM platform_outreach_status),
      'called', (SELECT count(*) FROM platform_outreach_status WHERE last_called_at IS NOT NULL),
      'reached', (SELECT count(*) FROM platform_outreach_status WHERE ever_reached),
      'accepted', (SELECT count(*) FROM platform_outreach_status WHERE app_status = 'will_come' OR device_answer = 'yes' OR branding_answer = 'yes'),
      'came', (SELECT count(*) FROM platform_outreach_status WHERE came_to_office_on IS NOT NULL),
      'device_yes', (SELECT count(*) FROM platform_outreach_status WHERE device_answer = 'yes'),
      'branding_yes', (SELECT count(*) FROM platform_outreach_status WHERE branding_answer = 'yes'),
      'has_latest', (SELECT count(*) FROM platform_outreach_status WHERE app_status = 'has_latest'),
      'branded', (SELECT count(*) FROM platform_cars WHERE branding_status = 'branded' OR is_branded),
      'device_installed', (SELECT count(*) FROM platform_cars WHERE device_status = 'installed'),
      'calls_in_period', (SELECT count(*) FROM platform_outreach_calls WHERE created_at >= v_since),
      'round', current_outreach_round(),
      'round_left', (SELECT count(*) FROM platform_outreach_status WHERE came_to_office_on IS NULL AND last_result IS DISTINCT FROM 'wrong_number'
                       AND NOT COALESCE(last_round = current_outreach_round() AND last_result = 'reached', false))
    )
  );
END;
$$;

-- ------------------------------------------------------------ the pitch
UPDATE script_cards SET
  say = $$Hello [name], this is [your name] from Kivu Ride on 6023. Do you have two minutes? We've improved the Kivu Ride app and we now send clients to our drivers.$$,
  steps = ARRAY[$$If they're busy or driving, offer a call-back time and log "Call back later".$$, $$Confirm you're speaking to the driver of [plate].$$],
  collect = ARRAY[$$Do they use the Kivu Ride app — every day, sometimes, rarely, or not at all?$$, $$Where do they usually work (area)?$$],
  updated_at = now()
WHERE section_key = 'outreach' AND situation = 'Opening the call';

UPDATE script_cards SET
  situation = 'The updated app — come to our office',
  say = $$We now give clients to our drivers. Come to our office and our IT team will install the updated app on your phone and show you the new features — it takes a few minutes.$$,
  steps = ARRAY[$$Explain the new features in IT's latest note (posted every Friday).$$, $$Ask: will they come to the office for the updated app, or do they already have it?$$, $$If they'll come, agree a day and give the office address and hours.$$],
  collect = '{}', card_order = 2, updated_at = now()
WHERE section_key = 'outreach' AND situation = 'What''s new in the app';

UPDATE script_cards SET card_order = 6 WHERE section_key = 'outreach' AND situation = 'Common objections';
UPDATE script_cards SET card_order = 7 WHERE section_key = 'outreach' AND situation = 'Closing the call';

INSERT INTO script_cards (section_key, section_title, section_order, card_order, situation, say, steps, collect, owner_duty, default_priority, is_quick)
SELECT 'outreach', 'Non-Insider outreach', 12, 5, 'Calling again (round 2 and later)',
  $$Hello [name], it's [your name] from Kivu Ride again. [Use "Tell them this round" at the top of the page — e.g. this week we gave our drivers on average 3 passengers a day.] Would you like to come for the updated app, and join our priority drivers with branding and our device?$$,
  ARRAY[$$Check their earlier answers on the screen before you call — don't ask what they already told us.$$, $$Use this round's numbers to show what they're missing.$$, $$If they said "thinking about it", ask what's stopping them.$$],
  '{}'::text[], NULL, 'normal', false
WHERE NOT EXISTS (SELECT 1 FROM script_cards WHERE section_key = 'outreach' AND situation LIKE 'Calling again%');

-- ------------------------------------------------------------ nobody signed out runs these
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('current_outreach_round', 'outreach_can_work', 'claim_outreach_driver', 'release_outreach_claim', 'next_outreach_driver',
      'log_outreach_call', 'set_outreach_came_to_office', 'start_outreach_round', 'set_outreach_talking_points', 'shift_stats', 'call_center_analytics', 'add_platform_outreach_status')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
  END LOOP;
END $$;
