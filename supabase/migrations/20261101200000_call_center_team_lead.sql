/*
# Call Center team lead: Joseph (MD, 31 Oct 2026)

A new duty, route_call_center, held by Nsengiyumva Joseph. Like the other
heads he sees his department in People > Team today and gets its 17:30
team-day message. The MD can move the duty in Notifications settings.
*/

INSERT INTO responsibilities (key, label, description, profile_id)
VALUES ('route_call_center', 'Call Center team lead', 'Leads the Call Center agents: sees their day in Team today and gets the 17:30 team-day message for the Call Center.',
  (SELECT p.id FROM profiles p JOIN departments d ON d.id = p.department_id
   WHERE p.full_name ILIKE 'Nsengiyumva Joseph%' AND p.is_active AND d.slug = 'call_center' LIMIT 1))
ON CONFLICT (key) DO UPDATE SET profile_id = EXCLUDED.profile_id, label = EXCLUDED.label, description = EXCLUDED.description, updated_at = now();

UPDATE profiles SET responsibility_label = 'Call Center team lead', updated_at = now()
WHERE id = (SELECT profile_id FROM responsibilities WHERE key = 'route_call_center') AND responsibility_label IS NULL;

CREATE OR REPLACE FUNCTION team_day_depts()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR is_managing_director() THEN NULL
    ELSE ARRAY(SELECT DISTINCT CASE r.key WHEN 'route_finance' THEN 'finance' WHEN 'route_operations' THEN 'fleet' WHEN 'route_it' THEN 'it' WHEN 'route_call_center' THEN 'call_center' END
      FROM responsibilities r WHERE r.profile_id = auth.uid() AND r.key IN ('route_finance', 'route_operations', 'route_it', 'route_call_center'))
  END;
$$;

UPDATE notification_rules SET audience = ARRAY['md', 'resp:route_finance', 'resp:route_operations', 'resp:route_it', 'resp:route_call_center'],
  description = 'Who is done, who is behind, and the tasks still late or open: the whole team for the MD, their own department for each head (Finance, Fleet, IT, Call Center).'
WHERE key = 'team_day_summary';
