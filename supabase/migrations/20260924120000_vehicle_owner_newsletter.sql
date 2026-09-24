/*
# Vehicle Owner Newsletter

Confirmed with the operator: a weekly newsletter to vehicle owners -
one HTML body written/pasted by Finance/the MD, shared by everyone that
week, with a personalized PDF report attached per owner (generated
client-side from data typed in for each of their cars, since there's no
mileage/odometer tracking anywhere in this system yet - every field is
manual except "this week's payout", which is read back from real
finance_transactions data already on file).

newsletters is deliberately generic (an `audience` column, currently
only 'vehicle_owners') since the operator explicitly wants this to grow
into a tabbed Newsletters page covering drivers/passengers later - the
shared shell (subject, HTML body, draft/sent, who it went to) is common
across audiences even though the attachment logic per audience is
bespoke, same reasoning as MD Panel's survey_cases registry.

Access matches Vehicle Owners itself: Finance or the MD, not MD-only -
this lives in the Finance/Vehicle-Owners world, not the MD-only Panel.
*/

CREATE TABLE IF NOT EXISTS newsletters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('vehicle_owners')),
  subject text NOT NULL,
  html_body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  sent_at timestamptz,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE newsletters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletters_finance_all" ON newsletters;
CREATE POLICY "newsletters_finance_all" ON newsletters FOR ALL TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

CREATE TABLE IF NOT EXISTS newsletter_vehicle_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_id uuid NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  current_mileage numeric,
  remaining_mileage_to_service numeric,
  distance_this_week numeric,
  total_earnings_so_far numeric,
  personal_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (newsletter_id, vehicle_id)
);

ALTER TABLE newsletter_vehicle_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletter_vehicle_reports_finance_all" ON newsletter_vehicle_reports;
CREATE POLICY "newsletter_vehicle_reports_finance_all" ON newsletter_vehicle_reports FOR ALL TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());

CREATE TABLE IF NOT EXISTS newsletter_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_id uuid NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES vehicle_owners(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (newsletter_id, owner_id)
);

ALTER TABLE newsletter_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletter_sends_finance_all" ON newsletter_sends;
CREATE POLICY "newsletter_sends_finance_all" ON newsletter_sends FOR ALL TO authenticated
  USING (current_department_slug() = 'finance' OR is_managing_director())
  WITH CHECK (current_department_slug() = 'finance' OR is_managing_director());
