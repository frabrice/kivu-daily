/*
# Phase 2.6 - Flag to IT connector

Call Center and Fleet employees hit product friction directly (a driver
confused by a screen, a repeated complaint) but have no route into IT's
backlog other than word of mouth. This gives them one button that drops a
draft user story into a fixed "flag inbox" feature, so support friction
becomes visible product input instead of dying with whoever heard it.

The inbox feature is seeded once and marked with is_flag_inbox so the RPC
never has to guess where flagged stories belong, and Call Center/Fleet
never need write access to products/milestones/features - only IT/MD do,
same as before.
*/

ALTER TABLE features ADD COLUMN IF NOT EXISTS is_flag_inbox boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  v_product_id uuid;
  v_milestone_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM features WHERE is_flag_inbox = true) THEN
    INSERT INTO products (name, description)
    VALUES ('Flagged Issues', 'Friction and bugs flagged in from other departments')
    RETURNING id INTO v_product_id;

    INSERT INTO milestones (product_id, name, status)
    VALUES (v_product_id, 'Inbox', 'in_progress')
    RETURNING id INTO v_milestone_id;

    INSERT INTO features (milestone_id, name, description, is_flag_inbox)
    VALUES (v_milestone_id, 'Flagged from Call Center & Fleet', 'Auto-created drafts from the Flag to IT action - triage and move into a real feature.', true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION flag_to_it(
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text,
  p_persona text,
  p_need text,
  p_details text
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

  INSERT INTO user_stories (feature_id, persona, need, benefit, details, status, priority, source, created_by)
  VALUES (
    v_feature_id,
    p_persona,
    p_need,
    'the underlying issue gets fixed for everyone',
    COALESCE(p_entity_label, '') || CASE WHEN p_entity_label IS NOT NULL AND p_details IS NOT NULL THEN E'\n\n' ELSE '' END || COALESCE(p_details, ''),
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

GRANT EXECUTE ON FUNCTION flag_to_it(text, uuid, text, text, text, text) TO authenticated;
