/*
# Issue title, direct product link, and task sync

Three changes to how Issues (user_stories where source = 'flagged') work,
distinct from the Products > Milestones > Features > Stories roadmap
hierarchy that "User Stories" still use unchanged:

1. title - a plain short title, since "As a driver, I need X" reads
   heavy for what's often a one-line bug report. Nullable so existing
   rows aren't broken; the app requires it going forward for new issues.

2. product_id + a nullable feature_id - an issue is minor, unplanned
   work under a specific product, not something that belongs in a
   milestone. feature_id was NOT NULL, forcing every issue through the
   seeded "Flagged Issues" inbox feature regardless of which real
   product it was about. Now an issue can point straight at a product
   with no feature/milestone at all; the inbox feature still exists for
   old rows and for flag_to_it() (Fleet/Call Center still have no
   product-picker UI), but is no longer the only path.

3. linked_task_id + two SECURITY DEFINER functions - an issue assigned
   to an IT person should show up as a real task on their own Today
   page, not just live inside Product Hub. A plain client-side insert
   into tasks would fail its own RLS the moment an IT staffer assigns
   an issue to a colleague rather than themselves (tasks_insert only
   allows creating a task for yourself, or for someone else if you're
   the MD) - these two functions do the sync themselves, gated on
   IT-or-MD instead, the same authority StoryDrawer's own canEdit
   already requires to touch an issue.
*/

ALTER TABLE user_stories ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE user_stories ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE user_stories ADD COLUMN IF NOT EXISTS linked_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE user_stories ALTER COLUMN feature_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION sync_issue_task(p_story_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_story user_stories%ROWTYPE;
  v_task_id uuid;
  v_title text;
BEGIN
  IF current_department_slug() <> 'it' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only IT or the MD can sync an issue to a task';
  END IF;

  SELECT * INTO v_story FROM user_stories WHERE id = p_story_id AND source = 'flagged';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_title := COALESCE(NULLIF(v_story.title, ''), 'As a ' || v_story.persona || ', ' || v_story.need);

  IF v_story.assignee_id IS NULL THEN
    IF v_story.linked_task_id IS NOT NULL THEN
      DELETE FROM tasks WHERE id = v_story.linked_task_id;
      UPDATE user_stories SET linked_task_id = NULL WHERE id = p_story_id;
    END IF;
    RETURN;
  END IF;

  IF v_story.linked_task_id IS NOT NULL THEN
    UPDATE tasks SET
      user_id = v_story.assignee_id,
      title = v_title,
      description = v_story.details,
      completed = (v_story.status = 'done'),
      completed_at = CASE WHEN v_story.status = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
    WHERE id = v_story.linked_task_id;
  ELSE
    INSERT INTO tasks (user_id, title, description, completed, completed_at, assigned_by)
    VALUES (
      v_story.assignee_id, v_title, v_story.details,
      v_story.status = 'done', CASE WHEN v_story.status = 'done' THEN now() ELSE NULL END,
      auth.uid()
    )
    RETURNING id INTO v_task_id;
    UPDATE user_stories SET linked_task_id = v_task_id WHERE id = p_story_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_issue_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION delete_issue(p_story_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task_id uuid;
BEGIN
  IF current_department_slug() <> 'it' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only IT or the MD can delete an issue';
  END IF;

  SELECT linked_task_id INTO v_task_id FROM user_stories WHERE id = p_story_id AND source = 'flagged';
  DELETE FROM user_stories WHERE id = p_story_id AND source = 'flagged';
  IF v_task_id IS NOT NULL THEN
    DELETE FROM tasks WHERE id = v_task_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_issue(uuid) TO authenticated;
