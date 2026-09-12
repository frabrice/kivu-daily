/*
# Kivu Ride Daily - Phase 1 Foundation

Fresh schema for the rebuilt platform. Replaces the retired 3-role
(employee/manager/managing_director) model with a flat 2-role model
(employee/managing_director) where department drives each employee's
workspace.

## Tables
- departments: the 7 real Kivu Ride departments
- profiles: role + department + forced first-login password change
- meetings: minutes with per-meeting visibility
- announcements: MD company-wide broadcasts
- tasks: personal daily task loop (+ assignment + meeting-link)
- comments: MD feedback on an employee's task day
- notifications: in-app notification center backing store
- documents: shared file storage (department-scoped or company-wide)
- activity_log: append-only feed of shared work-object events,
  populated only via SECURITY DEFINER triggers (no direct client insert)

## Security
- RLS enabled on every table
- profiles readable by all authenticated users (directory use), writable
  by self or the MD
- tasks: personal - owner + MD only (never visible to peers)
- activity_log: MD sees everything; employees see their own department's
  entries plus company-wide (department_id IS NULL) entries
*/

-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_select" ON departments;
CREATE POLICY "dept_select" ON departments FOR SELECT TO authenticated USING (true);

INSERT INTO departments (name) VALUES
  ('IT'),
  ('Marketing/Sales/BD'),
  ('Call Center'),
  ('Social Media'),
  ('Finance'),
  ('Fleet'),
  ('Admin')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'managing_director')),
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  force_password_change boolean NOT NULL DEFAULT true,
  last_comment_seen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT employee_requires_department CHECK (role <> 'employee' OR department_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION is_managing_director()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'managing_director'
  );
$$;

CREATE OR REPLACE FUNCTION current_department_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT department_id FROM profiles WHERE id = auth.uid();
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR is_managing_director())
  WITH CHECK (auth.uid() = id OR is_managing_director());

DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE TO authenticated
  USING (is_managing_director());

DROP POLICY IF EXISTS "dept_write" ON departments;
CREATE POLICY "dept_write" ON departments FOR ALL TO authenticated
  USING (is_managing_director())
  WITH CHECK (is_managing_director());

-- ============================================================
-- MEETINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  notes text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'md', 'department', 'company')),
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_author_idx ON meetings(author_id);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meetings_select" ON meetings;
CREATE POLICY "meetings_select" ON meetings FOR SELECT TO authenticated
  USING (
    auth.uid() = author_id
    OR visibility = 'company'
    OR (visibility = 'md' AND is_managing_director())
    OR (visibility = 'department' AND (department_id = current_department_id() OR is_managing_director()))
  );

DROP POLICY IF EXISTS "meetings_insert" ON meetings;
CREATE POLICY "meetings_insert" ON meetings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "meetings_update" ON meetings;
CREATE POLICY "meetings_update" ON meetings FOR UPDATE TO authenticated
  USING (auth.uid() = author_id OR is_managing_director())
  WITH CHECK (auth.uid() = author_id OR is_managing_director());

DROP POLICY IF EXISTS "meetings_delete" ON meetings;
CREATE POLICY "meetings_delete" ON meetings FOR DELETE TO authenticated
  USING (auth.uid() = author_id OR is_managing_director());

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_select" ON announcements;
CREATE POLICY "announcements_select" ON announcements FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "announcements_insert" ON announcements;
CREATE POLICY "announcements_insert" ON announcements FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id AND is_managing_director());

DROP POLICY IF EXISTS "announcements_delete" ON announcements;
CREATE POLICY "announcements_delete" ON announcements FOR DELETE TO authenticated
  USING (is_managing_director());

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  completed boolean NOT NULL DEFAULT false,
  date date NOT NULL DEFAULT CURRENT_DATE,
  completed_at timestamptz,
  is_carried_over boolean NOT NULL DEFAULT false,
  original_date date,
  parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  review_status text CHECK (review_status IN ('completed', 'in_progress', 'not_done')),
  review_note text,
  reviewed_at timestamptz,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_user_date_idx ON tasks(user_id, date);
CREATE INDEX IF NOT EXISTS tasks_date_idx ON tasks(date);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_managing_director());

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR (is_managing_director() AND auth.uid() = assigned_by));

DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR is_managing_director())
  WITH CHECK (auth.uid() = user_id OR is_managing_director());

DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR is_managing_director());

-- ============================================================
-- COMMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_date date NOT NULL DEFAULT CURRENT_DATE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  parent_comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_target_date_idx ON comments(target_user_id, task_date);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON comments FOR SELECT TO authenticated
  USING (auth.uid() = target_user_id OR auth.uid() = author_id OR is_managing_director());

DROP POLICY IF EXISTS "comments_insert" ON comments;
CREATE POLICY "comments_insert" ON comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id AND is_managing_director());

DROP POLICY IF EXISTS "comments_update" ON comments;
CREATE POLICY "comments_update" ON comments FOR UPDATE TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "comments_delete" ON comments;
CREATE POLICY "comments_delete" ON comments FOR DELETE TO authenticated
  USING (auth.uid() = author_id OR is_managing_director());

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_select" ON notifications;
CREATE POLICY "notif_select" ON notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_insert" ON notifications;
CREATE POLICY "notif_insert" ON notifications FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "notif_update" ON notifications;
CREATE POLICY "notif_update" ON notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_delete" ON notifications;
CREATE POLICY "notif_delete" ON notifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  file_url text NOT NULL,
  category text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_department_idx ON documents(department_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_select" ON documents;
CREATE POLICY "documents_select" ON documents FOR SELECT TO authenticated
  USING (department_id IS NULL OR department_id = current_department_id() OR is_managing_director());

DROP POLICY IF EXISTS "documents_insert" ON documents;
CREATE POLICY "documents_insert" ON documents FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = uploader_id
    AND (department_id IS NULL OR department_id = current_department_id() OR is_managing_director())
  );

DROP POLICY IF EXISTS "documents_delete" ON documents;
CREATE POLICY "documents_delete" ON documents FOR DELETE TO authenticated
  USING (auth.uid() = uploader_id OR is_managing_director());

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "documents_bucket_select" ON storage.objects;
CREATE POLICY "documents_bucket_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents_bucket_insert" ON storage.objects;
CREATE POLICY "documents_bucket_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents_bucket_delete" ON storage.objects;
CREATE POLICY "documents_bucket_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND owner = auth.uid());

-- ============================================================
-- ACTIVITY LOG (append-only, trigger-populated only)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_department_idx ON activity_log(department_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log(created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_log_select" ON activity_log;
CREATE POLICY "activity_log_select" ON activity_log FOR SELECT TO authenticated
  USING (department_id IS NULL OR department_id = current_department_id() OR is_managing_director());

-- No INSERT/UPDATE/DELETE policies: rows are written exclusively by the
-- SECURITY DEFINER trigger functions below, never directly by clients.

CREATE OR REPLACE FUNCTION log_comment_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  actor_dept uuid;
BEGIN
  SELECT department_id INTO actor_dept FROM profiles WHERE id = NEW.author_id;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.author_id, actor_dept, 'commented', 'comment', NEW.id, left(NEW.content, 80));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_activity_log ON comments;
CREATE TRIGGER comments_activity_log
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION log_comment_activity();

CREATE OR REPLACE FUNCTION log_meeting_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.visibility <> 'private' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (NEW.author_id, NEW.department_id, 'shared meeting notes', 'meeting', NEW.id, NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meetings_activity_log ON meetings;
CREATE TRIGGER meetings_activity_log
  AFTER INSERT ON meetings
  FOR EACH ROW EXECUTE FUNCTION log_meeting_activity();

CREATE OR REPLACE FUNCTION log_announcement_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.author_id, NULL, 'posted an announcement', 'announcement', NEW.id, NEW.title);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS announcements_activity_log ON announcements;
CREATE TRIGGER announcements_activity_log
  AFTER INSERT ON announcements
  FOR EACH ROW EXECUTE FUNCTION log_announcement_activity();

CREATE OR REPLACE FUNCTION log_document_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.uploader_id, NEW.department_id, 'uploaded a document', 'document', NEW.id, NEW.title);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_activity_log ON documents;
CREATE TRIGGER documents_activity_log
  AFTER INSERT ON documents
  FOR EACH ROW EXECUTE FUNCTION log_document_activity();
