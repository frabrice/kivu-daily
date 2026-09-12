/*
# Phase 2.3 - Marketing/Sales/BD CRM

Campaign-first model: a Campaign (goal, owner, timeframe) holds a list of
Contacts, each with its own pipeline stage, rolling up to campaign-level
results. Contact "type" is a free-text tag, not a fixed enum - the user
demonstrated during planning that new campaign types get invented on the
spot (e.g. "office space providers"), so hardcoding categories would mean
a migration every time a new kind of campaign starts.
*/

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  goal text,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  org_name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  type_tag text,
  stage text NOT NULL DEFAULT 'not_contacted' CHECK (stage IN ('not_contacted', 'contacted', 'negotiating', 'won', 'lost')),
  last_touch date,
  next_follow_up date,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_campaign_idx ON contacts(campaign_id);
CREATE INDEX IF NOT EXISTS contacts_follow_up_idx ON contacts(next_follow_up);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_select" ON campaigns;
CREATE POLICY "campaigns_select" ON campaigns FOR SELECT TO authenticated
  USING (current_department_slug() = 'marketing_sales_bd' OR is_managing_director());

DROP POLICY IF EXISTS "campaigns_write" ON campaigns;
CREATE POLICY "campaigns_write" ON campaigns FOR ALL TO authenticated
  USING (current_department_slug() = 'marketing_sales_bd' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'marketing_sales_bd' OR is_managing_director());

DROP POLICY IF EXISTS "contacts_select" ON contacts;
CREATE POLICY "contacts_select" ON contacts FOR SELECT TO authenticated
  USING (current_department_slug() = 'marketing_sales_bd' OR is_managing_director());

DROP POLICY IF EXISTS "contacts_write" ON contacts;
CREATE POLICY "contacts_write" ON contacts FOR ALL TO authenticated
  USING (current_department_slug() = 'marketing_sales_bd' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'marketing_sales_bd' OR is_managing_director());

-- ============================================================
-- Activity log
-- ============================================================
CREATE OR REPLACE FUNCTION log_campaign_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mkt_dept_id uuid;
BEGIN
  SELECT id INTO mkt_dept_id FROM departments WHERE slug = 'marketing_sales_bd';
  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
  VALUES (NEW.owner_id, mkt_dept_id, 'started a campaign', 'campaign', NEW.id, NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_activity_log ON campaigns;
CREATE TRIGGER campaigns_activity_log
  AFTER INSERT ON campaigns
  FOR EACH ROW EXECUTE FUNCTION log_campaign_activity();

CREATE OR REPLACE FUNCTION log_contact_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mkt_dept_id uuid;
BEGIN
  SELECT id INTO mkt_dept_id FROM departments WHERE slug = 'marketing_sales_bd';
  IF TG_OP = 'INSERT' THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (COALESCE(NEW.created_by, auth.uid()), mkt_dept_id, 'added a contact', 'contact', NEW.id, NEW.org_name);
  ELSIF TG_OP = 'UPDATE' AND NEW.stage <> OLD.stage THEN
    INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label)
    VALUES (auth.uid(), mkt_dept_id, 'moved ' || NEW.org_name || ' to ' || NEW.stage, 'contact', NEW.id, NEW.org_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_activity_log ON contacts;
CREATE TRIGGER contacts_activity_log
  AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION log_contact_activity();
