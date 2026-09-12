/*
# Log task completion / not-done outcomes into the MD's Live Activity feed

The Live Activity feed on the MD dashboard (activity_log table, trigger-
populated only) already covers comments, meetings, announcements,
documents, campaigns, contacts, content posts, fleet vehicles/drivers,
call logs and user stories - but never tasks, which is the one thing
every employee does every day. The MD asked for the feed to actually
name who did what, and who didn't.

## Why this needed a new column, not just a new trigger
tasks RLS is intentionally owner + MD only ("never visible to peers" -
see the design note atop 20260809120000_phase1_foundation.sql). The
existing activity_log_select policy makes a department_id match (or
NULL) visible to every employee in that department - reusing that as-is
for task events would leak one employee's task completions to their
department co-workers, which is exactly what the tasks RLS forbids.

md_only marks a row as visible to the Managing Director alone,
regardless of department_id. Every existing event type defaults to
md_only = false, so nothing already in the feed changes visibility.
*/

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS md_only boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "activity_log_select" ON activity_log;
CREATE POLICY "activity_log_select" ON activity_log FOR SELECT TO authenticated
  USING (
    is_managing_director()
    OR (md_only = false AND (department_id IS NULL OR department_id = current_department_id()))
  );

CREATE OR REPLACE FUNCTION log_task_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_name text;
  owner_dept_id uuid;
BEGIN
  SELECT full_name, department_id INTO owner_name, owner_dept_id FROM profiles WHERE id = NEW.user_id;

  IF NEW.completed = true AND COALESCE(OLD.completed, false) = false THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, md_only)
    VALUES (NEW.user_id, owner_dept_id, 'completed a task', 'task', NEW.id, NEW.title, true);
  END IF;

  IF NEW.review_status IS DISTINCT FROM OLD.review_status AND NEW.review_status = 'not_done' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, md_only)
    VALUES (auth.uid(), owner_dept_id, 'marked ' || COALESCE(owner_name, 'an employee') || '''s task as not done', 'task', NEW.id, NEW.title, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_activity_log ON tasks;
CREATE TRIGGER tasks_activity_log
  AFTER UPDATE OF completed, review_status ON tasks
  FOR EACH ROW EXECUTE FUNCTION log_task_activity();
