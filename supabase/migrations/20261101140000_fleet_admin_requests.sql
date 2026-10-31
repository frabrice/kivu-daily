/*
# Under Management: training company, and changes only the admin dashboard can make

- "kivu ride transport company" (#24) is for training and teaching drivers,
  like the test company (#26): not an owner we manage (MD, 31 Oct 2026).
- fleet_admin_requests: changes API keys may never make in the Kivu Ride
  app (moving a car to another owner or company, decommissioning a car),
  listed on Under Management for Baptiste / an admin, ticked when done.
*/

UPDATE platform_fleet_companies SET kind = 'ignore' WHERE id = 24;

CREATE TABLE IF NOT EXISTS fleet_admin_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL CHECK (length(trim(text)) > 3),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  done_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE fleet_admin_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fleet_admin_requests_select" ON fleet_admin_requests;
CREATE POLICY "fleet_admin_requests_select" ON fleet_admin_requests FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('fleet', 'finance', 'it'));
DROP POLICY IF EXISTS "fleet_admin_requests_write" ON fleet_admin_requests;
CREATE POLICY "fleet_admin_requests_write" ON fleet_admin_requests FOR ALL TO authenticated
  USING (is_managing_director() OR current_department_slug() = 'fleet')
  WITH CHECK (is_managing_director() OR current_department_slug() = 'fleet');
REVOKE ALL ON fleet_admin_requests FROM anon;

INSERT INTO fleet_admin_requests (text, created_by)
SELECT t, (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active LIMIT 1) FROM (VALUES
  ('Move RAC 407 I from BIGIMBA Emile''s own account (independent) into VUNINGOMA Chuma''s fleet company'),
  ('Move RAK 238 L and RAK 239 L from "kivu ride transport company" (training) into Jean Chrisostome NDAMUZEYE''s fleet company'),
  ('Take RAJ195V out of "kivu ride transport company": it is a Non-Insider driver''s own car'),
  ('Decommission RAC304R: the car does not exist')
) x(t)
WHERE NOT EXISTS (SELECT 1 FROM fleet_admin_requests);
