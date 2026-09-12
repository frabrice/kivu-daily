/*
# Phase 2.4 - Social Media content calendar

One row per planned post. pillar/intent/audience/format are plain text
(UI offers real Kivu Ride pillars as suggestions) rather than DB-enforced
enums, so the team isn't blocked by a migration if a new pillar or format
comes up - same reasoning as the CRM's free-text type_tag.
*/

CREATE TABLE IF NOT EXISTS content_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_date date NOT NULL,
  platforms text[] NOT NULL DEFAULT '{}',
  pillar text,
  intent text,
  audience text,
  format text,
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'drafted', 'scheduled', 'posted')),
  boosted boolean NOT NULL DEFAULT false,
  budget numeric,
  caption text,
  performance_notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_calendar_date_idx ON content_calendar(post_date);

ALTER TABLE content_calendar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_calendar_select" ON content_calendar;
CREATE POLICY "content_calendar_select" ON content_calendar FOR SELECT TO authenticated
  USING (current_department_slug() = 'social_media' OR is_managing_director());

DROP POLICY IF EXISTS "content_calendar_write" ON content_calendar;
CREATE POLICY "content_calendar_write" ON content_calendar FOR ALL TO authenticated
  USING (current_department_slug() = 'social_media' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'social_media' OR is_managing_director());

CREATE OR REPLACE FUNCTION log_content_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sm_dept_id uuid;
  post_label text;
BEGIN
  SELECT id INTO sm_dept_id FROM departments WHERE slug = 'social_media';
  post_label := COALESCE(NEW.pillar, 'Untitled') || ' · ' || to_char(NEW.post_date, 'Mon DD');
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), sm_dept_id, 'planned a post', 'content_post', NEW.id, post_label);
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NEW.status = 'posted' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), sm_dept_id, 'posted content', 'content_post', NEW.id, post_label);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_calendar_activity_log ON content_calendar;
CREATE TRIGGER content_calendar_activity_log
  AFTER INSERT OR UPDATE ON content_calendar
  FOR EACH ROW EXECUTE FUNCTION log_content_activity();
