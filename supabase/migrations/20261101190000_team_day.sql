/*
# People > Today: everyone's tasks for a day, and the 17:30 message
(MD, 31 Oct 2026)

team_day(day) returns, for the people the caller may see, their tasks of
that day, Call Center shifts, what IT is working on (check-ins) and when
they last did something in Kivu Daily.
- The MD (and the notification engine, no user) sees everyone.
- A head of department sees their own department: the holder of
  route_finance -> Finance, route_operations -> Fleet, route_it -> IT.
Tasks stay private otherwise (tasks RLS: own + MD).

team_day_summary: 17:30 every day - the MD gets the whole team, each head
their department: who is done, who is behind, what is late or still open.
*/

CREATE OR REPLACE FUNCTION team_day_depts()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR is_managing_director() THEN NULL
    ELSE ARRAY(SELECT DISTINCT CASE r.key WHEN 'route_finance' THEN 'finance' WHEN 'route_operations' THEN 'fleet' WHEN 'route_it' THEN 'it' END
      FROM responsibilities r WHERE r.profile_id = auth.uid() AND r.key IN ('route_finance', 'route_operations', 'route_it'))
  END;
$$;
REVOKE ALL ON FUNCTION team_day_depts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION team_day_depts() TO authenticated;

CREATE OR REPLACE FUNCTION team_day(p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_depts text[] := team_day_depts();
  v_all boolean := auth.uid() IS NULL OR is_managing_director();
  v_ids uuid[];
  v_from timestamptz := (p_day::timestamp AT TIME ZONE 'Africa/Kigali');
  v_to timestamptz := ((p_day + 1)::timestamp AT TIME ZONE 'Africa/Kigali');
BEGIN
  IF NOT v_all AND coalesce(array_length(v_depts, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Only the MD and heads of department see the team''s day';
  END IF;
  SELECT array_agg(p.id) INTO v_ids
  FROM profiles p LEFT JOIN departments d ON d.id = p.department_id
  WHERE p.is_active AND p.role <> 'managing_director' AND (v_all OR d.slug = ANY (v_depts));

  RETURN jsonb_build_object(
    'scope', CASE WHEN v_all THEN to_jsonb('all'::text) ELSE to_jsonb(v_depts) END,
    'people', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', trim(p.full_name), 'responsibility_label', p.responsibility_label,
        'dept', d.slug, 'dept_name', d.name) ORDER BY d.slug, p.full_name)
      FROM profiles p LEFT JOIN departments d ON d.id = p.department_id WHERE p.id = ANY (v_ids)), '[]'::jsonb),
    'tasks', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'title', t.title, 'completed', t.completed, 'completed_at', t.completed_at,
        'due_time', t.due_time, 'priority', t.priority, 'smart_key', t.smart_key, 'smart_total', t.smart_total, 'smart_done', t.smart_done,
        'recurring', t.recurring_task_id IS NOT NULL, 'assigned_by', t.assigned_by, 'review_status', t.review_status, 'carried', t.is_carried_over,
        'auto_completed', t.auto_completed, 'created_at', t.created_at, 'meeting', t.source_meeting_id IS NOT NULL OR t.meeting_occurrence_id IS NOT NULL) ORDER BY t.due_time NULLS LAST, t.created_at)
      FROM tasks t WHERE t.date = p_day AND t.user_id = ANY (v_ids)), '[]'::jsonb),
    'shifts', coalesce((SELECT jsonb_agg(jsonb_build_object('agent_id', s.agent_id, 'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status, 'slot', s.slot) ORDER BY s.started_at)
      FROM call_center_shifts s WHERE s.agent_id = ANY (v_ids) AND s.started_at < v_to AND coalesce(s.ended_at, now()) > v_from), '[]'::jsonb),
    'working_on', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT DISTINCT ON (c.profile_id) jsonb_build_object('profile_id', c.profile_id, 'issue_id', c.issue_id, 'title', i.title, 'at', coalesce(c.confirmed_at, c.asked_at)) x
        FROM it_checkins c JOIN it_issues i ON i.id = c.issue_id
        WHERE c.day = p_day AND c.profile_id = ANY (v_ids) AND c.issue_id IS NOT NULL
        ORDER BY c.profile_id, coalesce(c.confirmed_at, c.asked_at) DESC) q), '[]'::jsonb),
    'last_seen', coalesce((SELECT jsonb_agg(jsonb_build_object('actor_id', a.actor_id, 'at', a.at))
      FROM (SELECT actor_id, max(created_at) AS at FROM activity_log WHERE actor_id = ANY (v_ids) AND created_at >= v_from AND created_at < v_to GROUP BY actor_id) a), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION team_day(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION team_day(date) TO authenticated, service_role;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('team_day_summary', 'Team day at 17:30', 'Who is done, who is behind, and the tasks still late or open: the whole team for the MD, their own department for each head (Finance, Fleet, IT).',
   'Daily 17:30', ARRAY['md', 'resp:route_finance', 'resp:route_operations', 'resp:route_it'], 3, 120, 'Company', true)
ON CONFLICT (key) DO NOTHING;
