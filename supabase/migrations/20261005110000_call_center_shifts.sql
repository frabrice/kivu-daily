/*
# Call Center shifts

Confirmed with the operator: the Call Center runs three shifts a day in
teams of two, on two shared computers. An agent starts a shift when
they sign in, and must end it with a shift report before signing out -
so every shift's time and work is tracked.

- call_center_shifts: who, which computer, which slot (morning
  06:00-14:00, afternoon 14:00-22:00, night 22:00-06:00), partner, when
  it started and ended, minutes late, the agent's report (calls received,
  made and missed, messages handled, what was worked on, resolved,
  unresolved, problems, caller feedback, suggestions) and the system's
  own count of what was logged during the shift.
- shift_stats(): counts from the records themselves - calls/cases
  logged, solved on the spot, handed on, emergencies, bookings, cases
  closed after call-backs, notes, driver calls - so reported numbers can
  be checked against logged ones.
- end_call_center_shift(): closes the shift, saves the handover for the
  next shift, and emails the shift report to the MD.
- auto_close_stale_shifts(): a shift left open more than 10 hours is
  closed as "not closed properly" and the MD is told.
*/

CREATE TABLE IF NOT EXISTS call_center_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  station text NOT NULL,
  slot text NOT NULL CHECK (slot IN ('morning', 'afternoon', 'night')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'auto_closed')),
  late_minutes int NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  handover_id uuid REFERENCES shift_handovers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_center_shifts_agent_idx ON call_center_shifts (agent_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS call_center_shifts_one_open ON call_center_shifts (agent_id) WHERE status = 'open';
ALTER TABLE call_center_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "call_center_shifts_select" ON call_center_shifts;
CREATE POLICY "call_center_shifts_select" ON call_center_shifts FOR SELECT TO authenticated
  USING (current_department_slug() = 'call_center' OR is_managing_director());

-- Slot start in Kigali time; late = minutes after the nearest start.
CREATE OR REPLACE FUNCTION shift_late_minutes(p_slot text, p_at timestamptz)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_local timestamp := p_at AT TIME ZONE 'Africa/Kigali';
  v_start time := CASE p_slot WHEN 'morning' THEN '06:00' WHEN 'afternoon' THEN '14:00' ELSE '22:00' END;
  v_diff numeric := extract(epoch FROM (v_local - (v_local::date + v_start))) / 60;
BEGIN
  IF v_diff < -720 THEN v_diff := v_diff + 1440; ELSIF v_diff > 720 THEN v_diff := v_diff - 1440; END IF;
  RETURN GREATEST(0, round(v_diff))::int;
END;
$$;

CREATE OR REPLACE FUNCTION start_call_center_shift(p_station text, p_slot text, p_partner_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF current_department_slug() <> 'call_center' THEN RAISE EXCEPTION 'Only Call Center agents start shifts'; END IF;
  SELECT id INTO v_id FROM call_center_shifts WHERE agent_id = auth.uid() AND status = 'open';
  IF FOUND THEN RETURN v_id; END IF;
  INSERT INTO call_center_shifts (agent_id, partner_id, station, slot, late_minutes)
  VALUES (auth.uid(), NULLIF(p_partner_id, auth.uid()), COALESCE(NULLIF(trim(p_station), ''), 'Computer 1'), p_slot, shift_late_minutes(p_slot, now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION start_call_center_shift(text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION shift_stats(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s call_center_shifts%ROWTYPE;
  v_to timestamptz;
BEGIN
  SELECT * INTO s FROM call_center_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  IF auth.uid() IS NOT NULL AND NOT (is_managing_director() OR current_department_slug() = 'call_center') THEN
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
    'open_cases_at_end', (SELECT count(*) FROM call_tickets WHERE status IN ('open', 'in_progress', 'waiting_on_caller', 'resolved'))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION shift_stats(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION end_call_center_shift(p_shift_id uuid, p_report jsonb, p_handover_note text, p_items jsonb DEFAULT '[]'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s call_center_shifts%ROWTYPE;
  v_handover uuid;
BEGIN
  SELECT * INTO s FROM call_center_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'open' THEN RAISE EXCEPTION 'This shift is not open'; END IF;
  IF s.agent_id <> auth.uid() AND NOT is_managing_director() THEN RAISE EXCEPTION 'Only the agent can end their own shift'; END IF;
  IF (p_report->>'calls_received') IS NULL OR (p_report->>'calls_made') IS NULL THEN
    RAISE EXCEPTION 'Report how many calls you received and made';
  END IF;
  IF NULLIF(trim(p_report->>'worked_on'), '') IS NULL THEN RAISE EXCEPTION 'Say what you worked on this shift'; END IF;

  INSERT INTO shift_handovers (author_id, note, items)
  VALUES (s.agent_id, NULLIF(trim(p_handover_note), ''), COALESCE(p_items, '[]'::jsonb))
  RETURNING id INTO v_handover;

  UPDATE call_center_shifts SET ended_at = now(), status = 'closed', report = p_report, handover_id = v_handover
  WHERE id = p_shift_id;
  UPDATE call_center_shifts SET stats = shift_stats(p_shift_id) WHERE id = p_shift_id;

  INSERT INTO notification_events (rule_key, payload) VALUES ('shift_report', jsonb_build_object('shift_id', p_shift_id, 'actor_id', s.agent_id));
END;
$$;
GRANT EXECUTE ON FUNCTION end_call_center_shift(uuid, jsonb, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION auto_close_stale_shifts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN SELECT id FROM call_center_shifts WHERE status = 'open' AND started_at < now() - interval '10 hours' LOOP
    UPDATE call_center_shifts SET ended_at = now(), status = 'auto_closed' WHERE id = r.id;
    UPDATE call_center_shifts SET stats = shift_stats(r.id) WHERE id = r.id;
    INSERT INTO notification_events (rule_key, payload) VALUES ('shift_not_closed', jsonb_build_object('shift_id', r.id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION auto_close_stale_shifts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_close_stale_shifts() TO service_role;

-- shift_stats is also called by auto_close as the service role; allow that path.
REVOKE ALL ON FUNCTION shift_late_minutes(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shift_late_minutes(text, timestamptz) TO authenticated, service_role;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('shift_report', 'Call Center shift report', 'Sent when an agent ends a shift: time, calls received/made/missed, what was logged, what is still open, feedback and suggestions.', 'Instant', ARRAY['md'], 4, 640, 'Call Center tickets', true, NULL),
  ('shift_not_closed', 'Shift not closed', 'An agent left a shift open more than 10 hours - it was closed automatically.', 'When it happens', ARRAY['md'], 4, 645, 'Call Center tickets', true, NULL)
ON CONFLICT (key) DO NOTHING;
