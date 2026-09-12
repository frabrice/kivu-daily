/*
# Phase 2.5 - IT/Product Hub

Product -> Milestone -> Feature -> User Story hierarchy. Stories carry the
persona/need/benefit format the team writes them in, plus a details field
and an acceptance-criteria checklist (jsonb array of {text, done} so items
can be checked off without a separate table). `source` distinguishes
manually-authored stories from ones created by the future "Flag to IT"
connector (Phase 2.6) - not used yet, but the column exists so that
migration doesn't need to alter this table again.
*/

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  target_date date,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'shipped')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id uuid NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  persona text NOT NULL,
  need text NOT NULL,
  benefit text NOT NULL,
  details text,
  acceptance_criteria jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'in_progress', 'review', 'done')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'flagged')),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS milestones_product_idx ON milestones(product_id);
CREATE INDEX IF NOT EXISTS features_milestone_idx ON features(milestone_id);
CREATE INDEX IF NOT EXISTS user_stories_feature_idx ON user_stories(feature_id);
CREATE INDEX IF NOT EXISTS user_stories_status_idx ON user_stories(status);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE features ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select" ON products;
CREATE POLICY "products_select" ON products FOR SELECT TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director());
DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_write" ON products FOR ALL TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'it' OR is_managing_director());

DROP POLICY IF EXISTS "milestones_select" ON milestones;
CREATE POLICY "milestones_select" ON milestones FOR SELECT TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director());
DROP POLICY IF EXISTS "milestones_write" ON milestones;
CREATE POLICY "milestones_write" ON milestones FOR ALL TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'it' OR is_managing_director());

DROP POLICY IF EXISTS "features_select" ON features;
CREATE POLICY "features_select" ON features FOR SELECT TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director());
DROP POLICY IF EXISTS "features_write" ON features;
CREATE POLICY "features_write" ON features FOR ALL TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'it' OR is_managing_director());

DROP POLICY IF EXISTS "user_stories_select" ON user_stories;
CREATE POLICY "user_stories_select" ON user_stories FOR SELECT TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director());
DROP POLICY IF EXISTS "user_stories_write" ON user_stories;
CREATE POLICY "user_stories_write" ON user_stories FOR ALL TO authenticated
  USING (current_department_slug() = 'it' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'it' OR is_managing_director());

CREATE OR REPLACE FUNCTION log_user_story_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it_dept_id uuid;
  story_label text;
BEGIN
  SELECT id INTO it_dept_id FROM departments WHERE slug = 'it';
  story_label := 'As a ' || NEW.persona || ', ' || NEW.need;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), it_dept_id, 'wrote a user story', 'user_story', NEW.id, story_label);
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NEW.status = 'done' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), it_dept_id, 'shipped a user story', 'user_story', NEW.id, story_label);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_stories_activity_log ON user_stories;
CREATE TRIGGER user_stories_activity_log
  AFTER INSERT OR UPDATE ON user_stories
  FOR EACH ROW EXECUTE FUNCTION log_user_story_activity();
