/*
# Fix handle_new_user() and re-attach the trigger

The trigger caused "Database error creating new user" on every signup.
Root cause: the function referenced `profiles` unqualified, relying on
search_path resolution - but triggers fired from auth.users via GoTrue's
connection don't carry the `public` schema in their search_path, so the
relation couldn't be found (invisibly, since even the debug exception
handler's own unqualified insert failed the same way). Fixed by pinning
search_path on the function and fully qualifying the table name.
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, department_id, force_password_change)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee'),
    NULLIF(NEW.raw_user_meta_data->>'department_id', '')::uuid,
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

DROP TABLE IF EXISTS _debug_log;

CREATE OR REPLACE FUNCTION log_comment_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_dept uuid;
BEGIN
  SELECT department_id INTO actor_dept FROM public.profiles WHERE id = NEW.author_id;
  INSERT INTO public.activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.author_id, actor_dept, 'commented', 'comment', NEW.id, left(NEW.content, 80));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION log_meeting_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.visibility <> 'private' THEN
    INSERT INTO public.activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (NEW.author_id, NEW.department_id, 'shared meeting notes', 'meeting', NEW.id, NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION log_announcement_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.author_id, NULL, 'posted an announcement', 'announcement', NEW.id, NEW.title);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION log_document_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.uploader_id, NEW.department_id, 'uploaded a document', 'document', NEW.id, NEW.title);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION is_managing_director()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'managing_director'
  );
$$;

CREATE OR REPLACE FUNCTION current_department_id()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT department_id FROM public.profiles WHERE id = auth.uid();
$$;
