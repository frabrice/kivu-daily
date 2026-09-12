/*
# Fix duplicate activity_log entries for flagged stories

flag_to_it() already writes its own "flagged an issue to IT" activity_log
row. The generic user_stories insert trigger fired too, logging a second
"wrote a user story" row for the same insert - two lines in the MD's feed
for one action. Skip the generic log on insert when source = 'flagged'.
*/

CREATE OR REPLACE FUNCTION log_user_story_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it_dept_id uuid;
  story_label text;
BEGIN
  SELECT id INTO it_dept_id FROM departments WHERE slug = 'it';
  story_label := 'As a ' || NEW.persona || ', ' || NEW.need;
  IF TG_OP = 'INSERT' AND NEW.source <> 'flagged' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), it_dept_id, 'wrote a user story', 'user_story', NEW.id, story_label);
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NEW.status = 'done' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), it_dept_id, 'shipped a user story', 'user_story', NEW.id, story_label);
  END IF;
  RETURN NEW;
END;
$$;
