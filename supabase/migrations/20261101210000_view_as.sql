/*
# Open someone's dashboard (MD, 1 Nov 2026)

The MD can open any person's Kivu Daily exactly as they see it (their menu,
home, pages and tasks) and use it, to improve their dashboards. Whatever the
MD does there is done by the MD's own account and recorded as the MD, never
as the person.

How:
- While the MD is in someone's view, the app sends the header
  x-kd-view-as: <their id> on every database request. viewing_as() returns
  that id only when the caller really is the MD (anyone else: NULL), so the
  header gives no one any extra right.
- view_as_stamp(): on every table with a "who did it" column (created_by,
  assigned_by, author_id, agent_id, ...), a value equal to the viewed person
  is replaced with the MD on insert, and on update when that column changes.
  So "Joseph" filled in by the screen becomes "Frabrice" in the data. It does
  nothing when the header is absent (everyone, every day).
- activity_log.on_behalf_of: whose view the MD was in.
- view_as_sessions / view_as_actions: each visit and every change made in it
  (the app records each write), for the MD's history in Admin > Open a dashboard.
- Read-only extras for the MD in a view: the person's in-app notifications
  and email preferences (otherwise private to them).
Actions that would act on the caller's own record (start or end a Call
Center shift, confirm IT work, decline a meeting) are stopped by the app in
a view.
*/

CREATE OR REPLACE FUNCTION viewing_as()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h text;
  v uuid;
BEGIN
  BEGIN
    h := nullif(current_setting('request.headers', true), '')::json ->> 'x-kd-view-as';
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF h IS NULL OR h !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT is_managing_director() THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v FROM profiles WHERE id = h::uuid AND role <> 'managing_director';
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION viewing_as() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION viewing_as() TO authenticated, service_role;

-- "Who did it" columns: the viewed person becomes the MD.
CREATE OR REPLACE FUNCTION view_as_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v uuid := viewing_as();
  n jsonb;
  o jsonb;
  col text;
  changed boolean := false;
BEGIN
  IF v IS NULL THEN
    RETURN NEW;
  END IF;
  n := to_jsonb(NEW);
  o := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF n ->> col = v::text AND (TG_OP = 'INSERT' OR (o ->> col) IS DISTINCT FROM (n ->> col)) THEN
      n := jsonb_set(n, ARRAY[col], to_jsonb(auth.uid()));
      changed := true;
    END IF;
  END LOOP;
  IF changed THEN
    NEW := jsonb_populate_record(NEW, n);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name, array_agg(c.column_name::text ORDER BY c.column_name) AS cols
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = 'uuid'
      AND c.is_generated = 'NEVER'
      AND c.column_name ~ '(_by|^author_id|^actor_id|^agent_id|^reporter_id)$'
    GROUP BY c.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_view_as_stamp ON public.%I', r.table_name);
    EXECUTE format('CREATE TRIGGER zz_view_as_stamp BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION view_as_stamp(%s)',
      r.table_name, (SELECT string_agg(quote_literal(x), ', ') FROM unnest(r.cols) x));
  END LOOP;
END;
$$;

-- Whose view the MD was in.
-- No foreign key: activity_log already links to profiles for actor:profiles(*),
-- and a second link would make that embed ambiguous.
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS on_behalf_of uuid;

CREATE OR REPLACE FUNCTION activity_log_view_as()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.on_behalf_of := coalesce(NEW.on_behalf_of, viewing_as());
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS activity_log_view_as ON activity_log;
CREATE TRIGGER activity_log_view_as BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION activity_log_view_as();

-- Visits and what was done in them.
CREATE TABLE IF NOT EXISTS view_as_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  md_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS view_as_sessions_started_idx ON view_as_sessions (started_at DESC);

CREATE TABLE IF NOT EXISTS view_as_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES view_as_sessions(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('add', 'change', 'delete', 'action', 'function', 'blocked')),
  target text NOT NULL,
  status int,
  detail text
);
CREATE INDEX IF NOT EXISTS view_as_actions_session_idx ON view_as_actions (session_id, at);

ALTER TABLE view_as_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_as_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS view_as_sessions_select ON view_as_sessions;
CREATE POLICY view_as_sessions_select ON view_as_sessions FOR SELECT TO authenticated USING (is_managing_director());
DROP POLICY IF EXISTS view_as_actions_select ON view_as_actions;
CREATE POLICY view_as_actions_select ON view_as_actions FOR SELECT TO authenticated USING (is_managing_director());
REVOKE ALL ON view_as_sessions, view_as_actions FROM anon;

CREATE OR REPLACE FUNCTION view_as_start(p_target uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t profiles;
  v_id uuid;
BEGIN
  IF NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the MD can open someone''s dashboard';
  END IF;
  SELECT * INTO t FROM profiles WHERE id = p_target;
  IF NOT FOUND OR t.role = 'managing_director' THEN
    RAISE EXCEPTION 'Person not found';
  END IF;
  UPDATE view_as_sessions SET ended_at = now() WHERE md_id = auth.uid() AND ended_at IS NULL;
  INSERT INTO view_as_sessions (md_id, target_id) VALUES (auth.uid(), p_target) RETURNING id INTO v_id;
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata, on_behalf_of)
  VALUES (auth.uid(), NULL, 'opened_dashboard', 'profile', p_target, trim(t.full_name), jsonb_build_object('session_id', v_id), p_target);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION view_as_end(p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE view_as_sessions SET ended_at = now(), last_at = now()
  WHERE id = p_session AND md_id = auth.uid() AND ended_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION view_as_log(p_session uuid, p_kind text, p_target text, p_status int, p_detail text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_managing_director() OR NOT EXISTS (SELECT 1 FROM view_as_sessions WHERE id = p_session AND md_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not your visit';
  END IF;
  INSERT INTO view_as_actions (session_id, kind, target, status, detail)
  VALUES (p_session, p_kind, left(p_target, 120), p_status, left(p_detail, 800));
  UPDATE view_as_sessions SET last_at = now() WHERE id = p_session;
END;
$$;

REVOKE ALL ON FUNCTION view_as_start(uuid), view_as_end(uuid), view_as_log(uuid, text, text, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION view_as_start(uuid), view_as_end(uuid), view_as_log(uuid, text, text, int, text) TO authenticated;

-- In a view the MD also sees the person's private in-app notifications and
-- email preferences (read only).
DROP POLICY IF EXISTS notif_select_view_as ON notifications;
CREATE POLICY notif_select_view_as ON notifications FOR SELECT TO authenticated USING (user_id = viewing_as());
DROP POLICY IF EXISTS email_prefs_select_view_as ON email_preferences;
CREATE POLICY email_prefs_select_view_as ON email_preferences FOR SELECT TO authenticated USING (user_id = viewing_as());
