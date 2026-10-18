/*
# Regular meetings: warn before they collide (MD, 18 Oct 2026)

series_clashes(): before the MD saves a regular meeting, lists who would be
double-booked - by another regular meeting on the same day and time, or by
a meeting already scheduled / requested in the next 4 weeks.
*/

CREATE OR REPLACE FUNCTION series_clashes(p_series uuid, p_days int[], p_start time, p_minutes int, p_people uuid[])
RETURNS TABLE (person text, clash text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT is_managing_director() ok, (now() AT TIME ZONE 'Africa/Kigali')::date today),
  ppl AS (SELECT x id, trim(pr.full_name) nm FROM unnest(p_people) x JOIN profiles pr ON pr.id = x)
  SELECT p.nm, ms.name || ' (' || (SELECT string_agg(('{Mon,Tue,Wed,Thu,Fri,Sat,Sun}'::text[])[d], ' ') FROM unnest(ms.days) d WHERE d = ANY (p_days)) || ' ' || to_char(ms.start_time, 'HH24:MI') || ')'
  FROM ppl p, me, meeting_series ms
  WHERE me.ok AND ms.active AND ms.id IS DISTINCT FROM p_series AND ms.days && p_days
    AND (p.id = ANY (ms.expected) OR ms.host_id = p.id OR ms.with_profile = p.id)
    AND ms.start_time < p_start + make_interval(mins => p_minutes) AND ms.start_time + make_interval(mins => ms.duration_min) > p_start
  UNION ALL
  SELECT p.nm, o.title || ' (' || to_char(o.day, 'Dy DD Mon') || ' ' || to_char(o.scheduled_start, 'HH24:MI') || ')'
  FROM ppl p, me, meeting_occurrences o
  WHERE me.ok AND o.series_id IS NULL AND o.status = 'scheduled' AND o.day BETWEEN me.today AND me.today + 28
    AND extract(isodow FROM o.day)::int = ANY (p_days)
    AND (p.id = ANY (o.expected) OR o.host_id = p.id OR o.with_profile = p.id)
    AND NOT EXISTS (SELECT 1 FROM meeting_attendance a WHERE a.occurrence_id = o.id AND a.profile_id = p.id AND a.status = 'excused')
    AND o.scheduled_start < p_start + make_interval(mins => p_minutes) AND o.scheduled_start + make_interval(mins => o.duration_min) > p_start
  UNION ALL
  SELECT p.nm, t.name || ' request (' || to_char(b.starts_at AT TIME ZONE 'Africa/Kigali', 'Dy DD Mon HH24:MI') || ')'
  FROM ppl p, me, bookings b JOIN booking_types t ON t.id = b.type_id
  WHERE me.ok AND b.status = 'requested' AND (b.booked_by = p.id OR t.host_id = p.id)
    AND (b.starts_at AT TIME ZONE 'Africa/Kigali')::date BETWEEN me.today AND me.today + 28
    AND extract(isodow FROM b.starts_at AT TIME ZONE 'Africa/Kigali')::int = ANY (p_days)
    AND (b.starts_at AT TIME ZONE 'Africa/Kigali')::time < p_start + make_interval(mins => p_minutes)
    AND (b.starts_at AT TIME ZONE 'Africa/Kigali')::time + make_interval(mins => b.duration_min) > p_start;
$$;
REVOKE EXECUTE ON FUNCTION series_clashes(uuid, int[], time, int, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION series_clashes(uuid, int[], time, int, uuid[]) TO authenticated;
