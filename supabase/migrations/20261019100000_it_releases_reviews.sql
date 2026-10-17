/*
# IT & Product, phase 3: releases, decisions log, weekly review (MD, 17 Oct 2026)

- it_releases: what goes out to riders, drivers and staff (the one app with
  its rider and driver sides, the dashboard, the backend, admin, website).
  Planned -> testing -> released (or rolled back), with a release checklist,
  release notes and the issues it ships (it_issues.release_id). Marking a
  release "released" tells IT, the MD and - for the app - Call Center and
  Fleet what changed.
- it_decisions: the decisions log (D1, D2...): context, what was decided,
  options considered, consequences; any IT member records one as
  "proposed", the head of IT / MD decide it.
- it_weekly_reviews: one row per week (Monday) holding the meeting notes,
  who attended and a frozen copy of the numbers when it's marked as held.
*/

-- ------------------------------------------------------------ releases
CREATE SEQUENCE IF NOT EXISTS it_release_number;
CREATE TABLE IF NOT EXISTS it_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('it_release_number') UNIQUE,
  version text NOT NULL CHECK (length(trim(version)) > 0),
  platform text NOT NULL DEFAULT 'app' CHECK (platform IN ('app', 'dashboard', 'backend', 'admin', 'website')),
  name text,
  milestone_id uuid REFERENCES it_milestones(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'testing', 'released', 'rolled_back', 'cancelled')),
  planned_date date,
  released_at timestamptz,
  released_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  checklist jsonb NOT NULL DEFAULT '[]',
  rollback_reason text,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, version)
);
ALTER TABLE it_issues ADD COLUMN IF NOT EXISTS release_id uuid REFERENCES it_releases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS it_issues_release ON it_issues (release_id) WHERE release_id IS NOT NULL;

-- Stamps who released it and when; tells people once it's out.
CREATE OR REPLACE FUNCTION it_release_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'released' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'released') THEN
    NEW.released_at := COALESCE(NEW.released_at, now());
    NEW.released_by := COALESCE(auth.uid(), NEW.released_by);
    -- Notes default to what the release ships, grouped by type.
    IF NULLIF(trim(COALESCE(NEW.notes, '')), '') IS NULL THEN
      SELECT string_agg(line, E'\n' ORDER BY ord, line) INTO NEW.notes FROM (
        SELECT CASE type WHEN 'feature' THEN 1 WHEN 'improvement' THEN 2 WHEN 'bug' THEN 3 ELSE 4 END ord,
               '- ' || CASE type WHEN 'feature' THEN 'New: ' WHEN 'improvement' THEN 'Better: ' WHEN 'bug' THEN 'Fixed: ' ELSE '' END || title line
        FROM it_issues WHERE release_id = NEW.id AND status <> 'wont_do') x;
    END IF;
  END IF;
  IF NEW.status <> 'released' AND NEW.status <> 'rolled_back' THEN NEW.released_at := NULL; NEW.released_by := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS it_release_stamp ON it_releases;
CREATE TRIGGER it_release_stamp BEFORE INSERT OR UPDATE ON it_releases FOR EACH ROW EXECUTE FUNCTION it_release_stamp();

CREATE OR REPLACE FUNCTION it_release_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'released' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'released') THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('it_release_shipped', jsonb_build_object('release_id', NEW.id, 'actor_id', auth.uid()));
  ELSIF NEW.status = 'rolled_back' AND TG_OP = 'UPDATE' AND OLD.status = 'released' THEN
    INSERT INTO notification_events (rule_key, payload) VALUES ('it_release_shipped', jsonb_build_object('release_id', NEW.id, 'actor_id', auth.uid(), 'rolled_back', true));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS it_release_after ON it_releases;
CREATE TRIGGER it_release_after AFTER INSERT OR UPDATE OF status ON it_releases FOR EACH ROW EXECUTE FUNCTION it_release_after();

-- ------------------------------------------------------------ decisions
CREATE SEQUENCE IF NOT EXISTS it_decision_number;
CREATE TABLE IF NOT EXISTS it_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL DEFAULT nextval('it_decision_number') UNIQUE,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  context text,                 -- why we had to decide
  decision text,                -- what we decided
  options text,                 -- what else we considered
  consequences text,            -- what follows / what we accept
  areas text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'decided', 'superseded', 'reversed')),
  decided_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  issue_id bigint REFERENCES it_issues(id) ON DELETE SET NULL,
  initiative_id uuid REFERENCES it_initiatives(id) ON DELETE SET NULL,
  release_id uuid REFERENCES it_releases(id) ON DELETE SET NULL,
  superseded_by uuid REFERENCES it_decisions(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only the head of IT / MD decide; a member's own entry stays "proposed".
CREATE OR REPLACE FUNCTION it_decision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.uid() IS NOT NULL AND NOT is_it_lead() THEN
    IF NEW.status <> 'proposed' THEN RAISE EXCEPTION 'Only the head of IT or the MD can mark a decision as decided'; END IF;
  END IF;
  IF NEW.status = 'decided' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'decided') THEN
    NEW.decided_at := COALESCE(NEW.decided_at, now()); NEW.decided_by := COALESCE(auth.uid(), NEW.decided_by);
  ELSIF NEW.status = 'proposed' THEN
    NEW.decided_at := NULL; NEW.decided_by := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS it_decision_guard ON it_decisions;
CREATE TRIGGER it_decision_guard BEFORE INSERT OR UPDATE ON it_decisions FOR EACH ROW EXECUTE FUNCTION it_decision_guard();

-- ------------------------------------------------------------ weekly reviews
CREATE TABLE IF NOT EXISTS it_weekly_reviews (
  week_start date PRIMARY KEY CHECK (extract(isodow FROM week_start) = 1),
  highlights text,
  risks text,
  next_focus text,
  notes text,
  attendees uuid[] NOT NULL DEFAULT '{}',
  held_at timestamptz,
  held_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  snapshot jsonb,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ access
ALTER TABLE it_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_weekly_reviews ENABLE ROW LEVEL SECURITY;

-- Releases: everyone at work can read what shipped; IT leads manage them.
DROP POLICY IF EXISTS itrel_select ON it_releases; CREATE POLICY itrel_select ON it_releases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS itrel_write ON it_releases;  CREATE POLICY itrel_write ON it_releases FOR ALL TO authenticated USING (is_it_lead()) WITH CHECK (is_it_lead());

DROP POLICY IF EXISTS itdec_select ON it_decisions; CREATE POLICY itdec_select ON it_decisions FOR SELECT TO authenticated USING (is_it_member());
DROP POLICY IF EXISTS itdec_insert ON it_decisions; CREATE POLICY itdec_insert ON it_decisions FOR INSERT TO authenticated WITH CHECK (is_it_member());
DROP POLICY IF EXISTS itdec_update ON it_decisions; CREATE POLICY itdec_update ON it_decisions FOR UPDATE TO authenticated
  USING (is_it_lead() OR (created_by = auth.uid() AND status = 'proposed')) WITH CHECK (is_it_member());
DROP POLICY IF EXISTS itdec_delete ON it_decisions; CREATE POLICY itdec_delete ON it_decisions FOR DELETE TO authenticated USING (is_it_lead());

-- Anyone in IT takes notes in the weekly meeting.
DROP POLICY IF EXISTS itwr_select ON it_weekly_reviews; CREATE POLICY itwr_select ON it_weekly_reviews FOR SELECT TO authenticated USING (is_it_member());
DROP POLICY IF EXISTS itwr_write ON it_weekly_reviews;  CREATE POLICY itwr_write ON it_weekly_reviews FOR ALL TO authenticated USING (is_it_member()) WITH CHECK (is_it_member());

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['it_release_stamp()', 'it_release_after()', 'it_decision_guard()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
  END LOOP;
END $$;

-- Live updates (the roadmap page already listens to it_initiatives).
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE it_weekly_reviews; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE it_initiatives; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE it_releases; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app) VALUES
  ('it_release_shipped', 'New release out', 'What changed, sent when IT marks a release as released (or rolls it back). App releases also go to Call Center and Fleet.', 'Instant', ARRAY['dept:it', 'md'], 3, 455, 'IT & product', true),
  ('it_weekly_review', 'IT week in review', 'Friday summary of the IT week: what shipped, bugs, milestones, who did what, decisions - and the link to the review meeting page.', 'Friday 16:00', ARRAY['dept:it', 'md'], 3, 456, 'IT & product', true)
ON CONFLICT (key) DO NOTHING;

-- First release is R1, first decision D1.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM it_releases) THEN PERFORM setval('it_release_number', 1, false); END IF;
  IF NOT EXISTS (SELECT 1 FROM it_decisions) THEN PERFORM setval('it_decision_number', 1, false); END IF;
END $$;
