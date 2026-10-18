/*
# Tasks from meetings, at once and with their origin (MD, 18 Oct 2026)

An action added in a meeting becomes the owner's task immediately (not
only when the meeting ends). The task remembers where it came from - the
meeting, its date and time, and who assigned it - so My Tasks can show
"From Fleet & drivers — money · Sun 18 Oct, 19:00 · assigned by Frabrice"
and open the meeting. The owner is notified.
*/
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meeting_occurrence_id uuid REFERENCES meeting_occurrences(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin jsonb;

CREATE OR REPLACE FUNCTION meeting_task_origin(p_occ uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('kind', 'meeting', 'id', o.id, 'title', o.title, 'day', o.day, 'start', to_char(o.scheduled_start, 'HH24:MI'),
    'by', auth.uid(), 'by_name', (SELECT trim(full_name) FROM profiles WHERE id = auth.uid()))
  FROM meeting_occurrences o WHERE o.id = p_occ;
$$;

CREATE OR REPLACE FUNCTION add_meeting_action(p_occ uuid, p_text text, p_owner uuid, p_due date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o meeting_occurrences%ROWTYPE; v uuid; t uuid; n int;
BEGIN
  IF NOT can_run_meeting(p_occ) THEN RAISE EXCEPTION 'Only the host or the note-taker adds actions'; END IF;
  IF NULLIF(trim(COALESCE(p_text, '')), '') IS NULL THEN RAISE EXCEPTION 'Say what has to be done'; END IF;
  SELECT * INTO o FROM meeting_occurrences WHERE id = p_occ;
  SELECT count(*) INTO n FROM meeting_items WHERE occurrence_id = p_occ;
  INSERT INTO meeting_items (occurrence_id, kind, text, owner_id, due_date, sort) VALUES (p_occ, 'action', trim(p_text), p_owner, p_due, n) RETURNING id INTO v;
  IF p_owner IS NOT NULL THEN
    INSERT INTO tasks (user_id, title, description, date, assigned_by, meeting_occurrence_id, origin)
    VALUES (p_owner, trim(p_text), 'From the meeting "' || o.title || '" on ' || to_char(o.day, 'DD Mon YYYY'), COALESCE(p_due, (now() AT TIME ZONE 'Africa/Kigali')::date + 1), auth.uid(), p_occ, meeting_task_origin(p_occ))
    RETURNING id INTO t;
    UPDATE meeting_items SET task_id = t WHERE id = v;
    INSERT INTO notification_events (rule_key, payload) VALUES ('meeting_action_assigned', jsonb_build_object('task_id', t, 'recipient_id', p_owner, 'actor_id', auth.uid()));
  END IF;
  RETURN v;
END $$;

-- Removing an action from the meeting removes its task too (if not done yet).
CREATE OR REPLACE FUNCTION remove_meeting_item(p_item uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i meeting_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM meeting_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT can_run_meeting(i.occurrence_id) THEN RAISE EXCEPTION 'Only the host or the note-taker removes items'; END IF;
  IF i.task_id IS NOT NULL THEN DELETE FROM tasks WHERE id = i.task_id AND NOT completed; END IF;
  DELETE FROM meeting_items WHERE id = p_item;
END $$;

-- end_meeting: tasks for actions still without one carry the origin too.
CREATE OR REPLACE FUNCTION end_meeting(p_id uuid, p_metrics jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o meeting_occurrences%ROWTYPE; it meeting_items%ROWTYPE; t uuid;
BEGIN
  IF NOT can_run_meeting(p_id) THEN RAISE EXCEPTION 'Only the host or the note-taker ends the meeting'; END IF;
  SELECT * INTO o FROM meeting_occurrences WHERE id = p_id FOR UPDATE;
  UPDATE meeting_occurrences SET status = 'done', started_at = COALESCE(started_at, now()), ended_at = now(), metrics = COALESCE(p_metrics, metrics) WHERE id = p_id;
  UPDATE meeting_attendance SET status = 'absent', marked_at = now() WHERE occurrence_id = p_id AND status = 'expected';
  FOR it IN SELECT * FROM meeting_items WHERE occurrence_id = p_id AND kind = 'action' AND owner_id IS NOT NULL AND task_id IS NULL LOOP
    INSERT INTO tasks (user_id, title, description, date, assigned_by, meeting_occurrence_id, origin)
    VALUES (it.owner_id, it.text, 'From the meeting "' || o.title || '" on ' || to_char(o.day, 'DD Mon YYYY'), COALESCE(it.due_date, (now() AT TIME ZONE 'Africa/Kigali')::date + 1), auth.uid(), p_id, meeting_task_origin(p_id))
    RETURNING id INTO t;
    UPDATE meeting_items SET task_id = t WHERE id = it.id;
  END LOOP;
  IF o.recap_sent_at IS NULL AND COALESCE((SELECT email_recap FROM meeting_series WHERE id = o.series_id), true) THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('meeting_recap', jsonb_build_object('occurrence_id', p_id, 'actor_id', NULL));
    UPDATE meeting_occurrences SET recap_sent_at = now() WHERE id = p_id;
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['meeting_task_origin(uuid)', 'add_meeting_action(uuid, text, uuid, date)', 'remove_meeting_item(uuid)', 'end_meeting(uuid, jsonb)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('meeting_action_assigned', 'Task from a meeting', 'Tells someone a task was assigned to them in a meeting, with the meeting it came from.', 'Instant', ARRAY['actor'], 3, 482, 'Meetings', true)
ON CONFLICT (key) DO NOTHING;
