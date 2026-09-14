/*
# Acceptance criteria on Flag to IT

flag_to_it() only ever wrote persona/need/details, so every issue that
came in through the cross-department "Flag to IT" button started with
an empty acceptance_criteria array, even though the user_stories column
it lands in has supported it since Phase 2.4. IT then had to add
criteria themselves after the fact. Lets the flagging person capture
them up front instead.

Adding a parameter changes the function's identity (name + arg types),
so CREATE OR REPLACE can't just extend the old one in place - drop it
and recreate with the new signature, defaulted so nothing calling the
old 6-arg form breaks in the window before the frontend redeploys.
*/

DROP FUNCTION IF EXISTS flag_to_it(text, uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION flag_to_it(
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text,
  p_persona text,
  p_need text,
  p_details text,
  p_acceptance_criteria jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_feature_id uuid;
  v_story_id uuid;
  v_it_dept_id uuid;
  v_actor_name text;
BEGIN
  IF current_department_slug() NOT IN ('call_center', 'fleet') AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only Call Center, Fleet, or the MD can flag issues to IT';
  END IF;

  SELECT id INTO v_feature_id FROM features WHERE is_flag_inbox = true LIMIT 1;
  SELECT id INTO v_it_dept_id FROM departments WHERE slug = 'it';
  SELECT full_name INTO v_actor_name FROM profiles WHERE id = auth.uid();

  INSERT INTO user_stories (feature_id, persona, need, benefit, details, acceptance_criteria, status, priority, source, created_by)
  VALUES (
    v_feature_id,
    p_persona,
    p_need,
    'the underlying issue gets fixed for everyone',
    COALESCE(p_entity_label, '') || CASE WHEN p_entity_label IS NOT NULL AND p_details IS NOT NULL THEN E'\n\n' ELSE '' END || COALESCE(p_details, ''),
    COALESCE(p_acceptance_criteria, '[]'::jsonb),
    'backlog',
    'medium',
    'flagged',
    auth.uid()
  )
  RETURNING id INTO v_story_id;

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (auth.uid(), v_it_dept_id, 'flagged an issue to IT', 'user_story', v_story_id, p_need);

  INSERT INTO notifications (user_id, type, message, link)
  SELECT id, 'flag_to_it', COALESCE(v_actor_name, 'Someone') || ' flagged an issue to IT: "' || p_need || '"', 'it_hub'
  FROM profiles
  WHERE is_active = true AND (department_id = v_it_dept_id OR role = 'managing_director');

  RETURN v_story_id;
END;
$$;

GRANT EXECUTE ON FUNCTION flag_to_it(text, uuid, text, text, text, text, jsonb) TO authenticated;
