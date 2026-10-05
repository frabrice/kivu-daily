/*
# Non-Insider outreach campaign + Call analytics

Confirmed with the operator.

## Outreach
Call Center agents use quiet time to call Non-Insider drivers: explain
the app's new features, our device (120,000 RWF, one-time - more clients,
online more) and branding (20,000 RWF paid once by the driver, who then
becomes a priority driver). Every call is logged with an outcome;
interest goes straight to the Fleet Manager's Branding & Devices list
(by setting the car's survey answers, which the existing pipeline trigger
picks up). The pitch lives in the Script Book (section "Non-Insider
outreach") so the MD can edit it.

## Shift report numbers by type
Calls are now reported by type: incoming from passengers / our drivers /
Non-Insider drivers / owners & partners / other, outgoing to our drivers
/ Non-Insider drivers / passenger call-backs / other, plus missed calls
and WhatsApp/SMS. calls_received / calls_made stay as the totals.

## Call analytics
call_center_analytics(days) returns everything the analytics page
charts - calls per day by type, what calls are about, busiest hours,
per-agent performance (on time, hours, outgoing calls, logged contacts,
solved on the spot, outreach and conversions, satisfaction), quality and
the outreach funnel. MD and Finance only; agents' raw records stay
private to the Call Center.
*/

CREATE TABLE IF NOT EXISTS platform_outreach_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_driver_id uuid NOT NULL REFERENCES platform_drivers(id) ON DELETE CASCADE,
  car_id uuid REFERENCES platform_cars(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('interested_device', 'interested_branding', 'interested_both', 'callback', 'not_interested', 'no_answer', 'wrong_number', 'already_done')),
  callback_at timestamptz,
  online_status text CHECK (online_status IN ('online_daily', 'sometimes', 'rarely')),
  usual_area text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_outreach_calls_driver_idx ON platform_outreach_calls (platform_driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_outreach_calls_agent_idx ON platform_outreach_calls (agent_id, created_at DESC);
ALTER TABLE platform_outreach_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_outreach_calls_select" ON platform_outreach_calls;
CREATE POLICY "platform_outreach_calls_select" ON platform_outreach_calls FOR SELECT TO authenticated
  USING (current_department_slug() IN ('call_center', 'fleet') OR is_managing_director());

CREATE OR REPLACE FUNCTION log_outreach_call(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_driver uuid := NULLIF(p->>'platform_driver_id', '')::uuid;
  v_car uuid;
  v_outcome text := p->>'outcome';
BEGIN
  IF NOT (current_department_slug() = 'call_center' OR is_managing_director()) THEN
    RAISE EXCEPTION 'Only the Call Center logs outreach calls';
  END IF;
  SELECT car_id INTO v_car FROM platform_drivers WHERE id = v_driver;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_outcome = 'callback' AND NULLIF(p->>'callback_at', '') IS NULL THEN RAISE EXCEPTION 'Set when to call back'; END IF;

  INSERT INTO platform_outreach_calls (platform_driver_id, car_id, agent_id, outcome, callback_at, online_status, usual_area, note)
  VALUES (v_driver, v_car, auth.uid(), v_outcome, NULLIF(p->>'callback_at', '')::timestamptz,
          NULLIF(p->>'online_status', ''), NULLIF(trim(p->>'usual_area'), ''), NULLIF(trim(p->>'note'), ''))
  RETURNING id INTO v_id;

  -- Interest goes to the Fleet Manager through the car's survey answers
  -- (the Branding & Devices pipeline trigger takes it from there).
  IF v_car IS NOT NULL AND v_outcome IN ('interested_device', 'interested_branding', 'interested_both') THEN
    UPDATE platform_cars SET
      willing_to_buy_device = CASE WHEN v_outcome IN ('interested_device', 'interested_both') THEN true ELSE willing_to_buy_device END,
      allows_branding = CASE WHEN v_outcome IN ('interested_branding', 'interested_both') THEN true ELSE allows_branding END,
      notes = concat_ws(E'\n', NULLIF(notes, ''), to_char(now() AT TIME ZONE 'Africa/Kigali', 'DD Mon') || ' — outreach call: '
        || replace(v_outcome, '_', ' ') || COALESCE(' — ' || NULLIF(trim(p->>'note'), ''), '')
        || ' (' || COALESCE((SELECT full_name FROM profiles WHERE id = auth.uid()), 'Call Center') || ')'),
      updated_at = now()
    WHERE id = v_car;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION log_outreach_call(jsonb) TO authenticated;

-- Shift stats now count outreach too.
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
    'outreach_interested', (SELECT count(*) FROM platform_outreach_calls WHERE agent_id = s.agent_id AND created_at BETWEEN s.started_at AND v_to AND outcome LIKE 'interested_%'),
    'open_cases_at_end', (SELECT count(*) FROM call_tickets WHERE status IN ('open', 'in_progress', 'waiting_on_caller', 'resolved'))
  );
END;
$$;

-- Totals are computed from the by-type numbers if the form sent them.
CREATE OR REPLACE FUNCTION end_call_center_shift(p_shift_id uuid, p_report jsonb, p_handover_note text, p_items jsonb DEFAULT '[]'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s call_center_shifts%ROWTYPE;
  v_handover uuid;
  v_report jsonb := COALESCE(p_report, '{}'::jsonb);
  n int := 0;
BEGIN
  SELECT * INTO s FROM call_center_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'open' THEN RAISE EXCEPTION 'This shift is not open'; END IF;
  IF s.agent_id <> auth.uid() AND NOT is_managing_director() THEN RAISE EXCEPTION 'Only the agent can end their own shift'; END IF;

  IF v_report ? 'in_passengers' THEN
    v_report := v_report || jsonb_build_object(
      'calls_received', COALESCE((v_report->>'in_passengers')::int, 0) + COALESCE((v_report->>'in_drivers')::int, 0) + COALESCE((v_report->>'in_noninsider')::int, 0)
        + COALESCE((v_report->>'in_partners')::int, 0) + COALESCE((v_report->>'in_other')::int, 0),
      'calls_made', COALESCE((v_report->>'out_drivers')::int, 0) + COALESCE((v_report->>'out_noninsider')::int, 0)
        + COALESCE((v_report->>'out_callbacks')::int, 0) + COALESCE((v_report->>'out_other')::int, 0));
  END IF;
  IF (v_report->>'calls_received') IS NULL OR (v_report->>'calls_made') IS NULL THEN
    RAISE EXCEPTION 'Report how many calls you received and made';
  END IF;
  IF NULLIF(trim(v_report->>'worked_on'), '') IS NULL THEN RAISE EXCEPTION 'Say what you worked on this shift'; END IF;

  INSERT INTO shift_handovers (author_id, note, items)
  VALUES (s.agent_id, NULLIF(trim(p_handover_note), ''), COALESCE(p_items, '[]'::jsonb))
  RETURNING id INTO v_handover;

  UPDATE call_center_shifts SET ended_at = now(), status = 'closed', report = v_report, handover_id = v_handover WHERE id = p_shift_id;
  UPDATE call_center_shifts SET stats = shift_stats(p_shift_id) WHERE id = p_shift_id;

  INSERT INTO notification_events (rule_key, payload) VALUES ('shift_report', jsonb_build_object('shift_id', p_shift_id, 'actor_id', s.agent_id));
END;
$$;

-- ============================================================
-- Analytics (MD + Finance)
-- ============================================================
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
          (SELECT count(*) FROM platform_outreach_calls o WHERE o.agent_id = p.id AND o.created_at >= v_since AND o.outcome LIKE 'interested_%') AS outreach_interested,
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
    -- Outreach funnel (all time, so the campaign's progress shows).
    'outreach', jsonb_build_object(
      'drivers', (SELECT count(*) FROM platform_drivers),
      'called', (SELECT count(DISTINCT platform_driver_id) FROM platform_outreach_calls),
      'reached', (SELECT count(DISTINCT platform_driver_id) FROM platform_outreach_calls WHERE outcome NOT IN ('no_answer', 'wrong_number')),
      'interested', (SELECT count(DISTINCT platform_driver_id) FROM platform_outreach_calls WHERE outcome LIKE 'interested_%'),
      'branded', (SELECT count(*) FROM platform_cars WHERE branding_status = 'branded' OR is_branded),
      'device_installed', (SELECT count(*) FROM platform_cars WHERE device_status = 'installed'),
      'calls_in_period', (SELECT count(*) FROM platform_outreach_calls WHERE created_at >= v_since),
      'by_outcome', (SELECT COALESCE(jsonb_object_agg(outcome, n), '{}'::jsonb) FROM (SELECT outcome, count(*) n FROM platform_outreach_calls WHERE created_at >= v_since GROUP BY outcome) x)
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION call_center_analytics(int) TO authenticated;

-- ============================================================
-- The pitch, in the Script Book (MD edits it there)
-- ============================================================
INSERT INTO script_cards (section_key, section_title, section_order, card_order, situation, say, steps, collect, owner_duty, default_priority, is_quick)
SELECT * FROM (VALUES
  ('outreach', 'Non-Insider outreach', 12, 1, 'Opening the call',
   $$Hello [name], this is [your name] from Kivu Ride on 6023. Do you have two minutes? We've added new things to the Kivu Ride driver app that help drivers like you get more trips.$$,
   ARRAY[$$If they're busy or driving, offer a call-back time and set it.$$, $$Confirm you're speaking to the driver of [plate].$$],
   ARRAY[$$Are they online every day, sometimes or rarely?$$, $$Where do they usually work (area)?$$], NULL, 'normal', false),
  ('outreach', 'Non-Insider outreach', 12, 2, 'What''s new in the app',
   $$Let me tell you quickly what's new in the app this week.$$,
   ARRAY[$$Explain the features in IT's latest weekly note (it's posted every Friday).$$, $$Ask if they've updated the app; help them update if not.$$, $$Remind them: the more they stay online, the more trips they get.$$],
   '{}', NULL, 'normal', false),
  ('outreach', 'Non-Insider outreach', 12, 3, 'Our device — 120,000 RWF',
   $$Kivu Ride has a device for your car that helps you get more clients and stay online much more. It's a one-time payment of 120,000 RWF.$$,
   ARRAY[$$Explain: more clients and more time online means more income.$$, $$It's a one-time payment of 120,000 RWF — no monthly fee to mention.$$, $$If interested, mark "Interested in device" — the Fleet Manager calls them to arrange it.$$],
   '{}', 'fleet_manager', 'normal', false),
  ('outreach', 'Non-Insider outreach', 12, 4, 'Branding — 20,000 RWF, priority driver',
   $$If you allow us to brand your car, it costs 20,000 RWF once, and you become one of our priority drivers.$$,
   ARRAY[$$Explain: branded cars become priority drivers.$$, $$It's a one-time payment of 20,000 RWF, paid by the driver.$$, $$If interested, mark "Interested in branding" — the Fleet Manager arranges it.$$],
   '{}', 'fleet_manager', 'normal', false),
  ('outreach', 'Non-Insider outreach', 12, 5, 'Common objections',
   NULL,
   ARRAY[$$"It's expensive": it's one payment, and more trips pay it back. Never promise a number of trips.$$,
         $$"I'll think about it": offer a call-back date and set it.$$,
         $$"I'm with another app": many drivers use both — being online on Kivu Ride too means more trips.$$,
         $$Never pressure, never promise discounts or income figures.$$],
   '{}', NULL, 'normal', false),
  ('outreach', 'Non-Insider outreach', 12, 6, 'Closing the call',
   $$Thank you for your time. If you have any question, call us free on 6023. Have a good day on the road.$$,
   ARRAY[$$Log the outcome before you call the next driver.$$], '{}', NULL, 'normal', false)
) AS v(section_key, section_title, section_order, card_order, situation, say, steps, collect, owner_duty, default_priority, is_quick)
WHERE NOT EXISTS (SELECT 1 FROM script_cards WHERE section_key = 'outreach');

-- Standing duty: use quiet time for outreach.
INSERT INTO recurring_tasks (title, description, target_type, target_department_slug, frequency, due_time, sort_order, created_by)
SELECT 'Call 15 Non-Insider drivers from Non-Insider outreach', 'Explain what''s new in the app, our device (120,000 RWF) and branding (20,000 RWF, priority). Log every call.',
  'department', 'call_center', 'daily', NULL, 74, (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM recurring_tasks WHERE title LIKE 'Call 15 Non-Insider drivers%');
