/*
# Fix activity_log privacy leaks

Two bugs, same root cause: activity_log RLS treats department_id IS NULL
as "company-wide visible" (correct for announcements, which are always
meant to broadcast). But two other event sources also ended up with
department_id = NULL for reasons that had nothing to do with being
company-wide, so they leaked into everyone's feed:

1. Comments: only the MD can author them (comments_insert RLS), and the
   MD usually has no department, so every "MD commented" event logged
   with department_id = NULL - broadcasting private one-on-one feedback
   between the MD and a single employee to the entire company. Comments
   are a private channel like personal tasks, not a shared work object -
   remove the trigger entirely, matching the same privacy principle
   already applied to tasks.
2. Meetings shared with visibility='md' (author + MD only) still logged
   with department_id = NULL, broadcasting a narrowly-shared meeting to
   everyone. Only 'department' and 'company' visibility should produce a
   company/department-visible activity entry - 'private' and 'md' are
   both narrow-audience shares and should stay out of the shared feed.
*/

DROP TRIGGER IF EXISTS comments_activity_log ON comments;
DROP FUNCTION IF EXISTS log_comment_activity();

CREATE OR REPLACE FUNCTION log_meeting_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.visibility IN ('department', 'company') THEN
    INSERT INTO public.activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (NEW.author_id, NEW.department_id, 'shared meeting notes', 'meeting', NEW.id, NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

DELETE FROM activity_log WHERE entity_type = 'comment';
DELETE FROM activity_log WHERE entity_type = 'meeting' AND department_id IS NULL;
