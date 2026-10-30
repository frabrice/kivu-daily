/*
# Linking our drivers to their Kivu Ride app accounts (MD, 30 Oct 2026)

Found: MUPENZI Felix showed "Not found in the app" while online in the app.
Matching by phone alone breaks as soon as the phone differs between Kivu
Daily and the app. Now, in this order:
  1. driver_app_links - Fleet or the MD links a driver (or freelancer) to
     an app account by hand; always wins;
  2. the same phone (last 9 digits);
  3. the app account driving our car (same plate) with a name that shares
     a word with our driver's name.
platform_driver_status.match_method says which one linked them, so a
phone that doesn't match shows up and can be corrected.
*/

CREATE TABLE IF NOT EXISTS driver_app_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid UNIQUE REFERENCES drivers(id) ON DELETE CASCADE,
  freelancer_id uuid UNIQUE REFERENCES freelance_drivers(id) ON DELETE CASCADE,
  platform_driver_id int NOT NULL,
  linked_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((driver_id IS NOT NULL) <> (freelancer_id IS NOT NULL))
);
ALTER TABLE driver_app_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_app_links_select ON driver_app_links;
CREATE POLICY driver_app_links_select ON driver_app_links FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('call_center', 'fleet', 'finance', 'it'));
DROP POLICY IF EXISTS driver_app_links_write ON driver_app_links;
CREATE POLICY driver_app_links_write ON driver_app_links FOR ALL TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('fleet', 'it'))
  WITH CHECK ((is_managing_director() OR current_department_slug() IN ('fleet', 'it')) AND linked_by = auth.uid());

ALTER TABLE platform_driver_status ADD COLUMN IF NOT EXISTS match_method text CHECK (match_method IN ('link', 'phone', 'plate_name'));
