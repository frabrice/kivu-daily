/*
# Call Center shift = the time it starts, not a choice (MD, 31 Oct 2026)

Shifts: morning 07:00-15:00, afternoon 15:00-23:00, night 23:00-07:00.
Agents picked the shift by hand and often picked the wrong one (a 14:33
start marked "night", 15:08-23:23 marked "morning"), so their work landed
in the wrong shift in Reports. Now the server sets it from the Kigali
start time: from 2 hours before a shift's start it is that shift (early),
after that it is the running shift (late). p_slot is ignored.
Every past shift is re-filed the same way and its lateness recomputed.
*/

CREATE OR REPLACE FUNCTION shift_slot_at(p_at timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN m >= 300 AND m < 780 THEN 'morning'     -- 05:00-12:59
    WHEN m >= 780 AND m < 1260 THEN 'afternoon'  -- 13:00-20:59
    ELSE 'night'                                  -- 21:00-04:59
  END
  FROM (SELECT extract(hour FROM p_at AT TIME ZONE 'Africa/Kigali')::int * 60 + extract(minute FROM p_at AT TIME ZONE 'Africa/Kigali')::int AS m) x;
$$;
REVOKE ALL ON FUNCTION shift_slot_at(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION shift_slot_at(timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION start_call_center_shift(p_station text, p_slot text, p_partner_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_day date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_slot text := shift_slot_at(now());
BEGIN
  IF current_department_slug() <> 'call_center' THEN RAISE EXCEPTION 'Only Call Center agents start shifts'; END IF;
  SELECT id INTO v_id FROM call_center_shifts WHERE agent_id = auth.uid() AND status = 'open';
  IF FOUND THEN RETURN v_id; END IF;
  INSERT INTO call_center_shifts (agent_id, partner_id, station, slot, late_minutes)
  VALUES (auth.uid(), NULLIF(p_partner_id, auth.uid()), COALESCE(NULLIF(trim(p_station), ''), 'Computer 1'), v_slot, shift_late_minutes(v_slot, now()))
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

-- Re-file every past shift by its start time.
UPDATE call_center_shifts
SET slot = shift_slot_at(started_at), late_minutes = shift_late_minutes(shift_slot_at(started_at), started_at)
WHERE slot IS DISTINCT FROM shift_slot_at(started_at) OR late_minutes IS DISTINCT FROM shift_late_minutes(shift_slot_at(started_at), started_at);
