/*
# Extra access, person by person (MD, 19 Oct 2026)

access_grants: the MD opens an area to one person outside its department.
First area: 'business' - see the Trips sub-pages Companies and Invoices
(companies, their riders and trips, invoices, payments, invoice PDFs).
Seeing only: creating companies, verifying trips, issuing invoices and
recording payments stay with Finance and the MD.
Given to Ndekwe Jean Bertrand (BEX), Fleet.
*/

CREATE TABLE IF NOT EXISTS access_grants (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  area text NOT NULL CHECK (area IN ('business')),
  granted_by uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, area)
);
ALTER TABLE access_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ag_select ON access_grants;
CREATE POLICY ag_select ON access_grants FOR SELECT TO authenticated USING (profile_id = auth.uid() OR is_managing_director());
DROP POLICY IF EXISTS ag_write ON access_grants;
CREATE POLICY ag_write ON access_grants FOR ALL TO authenticated USING (is_managing_director()) WITH CHECK (is_managing_director());

CREATE OR REPLACE FUNCTION has_access_grant(p_area text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM access_grants WHERE profile_id = auth.uid() AND area = p_area);
$$;
REVOKE EXECUTE ON FUNCTION has_access_grant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION has_access_grant(text) TO authenticated;

-- Seeing the companies and invoices (writes are unchanged).
DROP POLICY IF EXISTS bc_select ON business_clients;
CREATE POLICY bc_select ON business_clients FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it' OR has_access_grant('business'));
DROP POLICY IF EXISTS bcr_select ON business_client_riders;
CREATE POLICY bcr_select ON business_client_riders FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it' OR has_access_grant('business'));
DROP POLICY IF EXISTS bct_select ON business_client_trips;
CREATE POLICY bct_select ON business_client_trips FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it' OR has_access_grant('business'));
DROP POLICY IF EXISTS bctl_select ON business_client_trip_log;
CREATE POLICY bctl_select ON business_client_trip_log FOR SELECT TO authenticated USING (can_tag_trips() OR current_department_slug() = 'it' OR has_access_grant('business'));
DROP POLICY IF EXISTS bi_select ON business_invoices;
CREATE POLICY bi_select ON business_invoices FOR SELECT TO authenticated USING (can_bill() OR has_access_grant('business'));
DROP POLICY IF EXISTS bip_select ON business_invoice_payments;
CREATE POLICY bip_select ON business_invoice_payments FOR SELECT TO authenticated USING (can_bill() OR has_access_grant('business'));
DROP POLICY IF EXISTS is_select ON invoice_settings;
CREATE POLICY is_select ON invoice_settings FOR SELECT TO authenticated USING (can_bill() OR has_access_grant('business'));
DROP POLICY IF EXISTS "business_invoices_read" ON storage.objects;
CREATE POLICY "business_invoices_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'business-invoices' AND (can_bill() OR has_access_grant('business')));

INSERT INTO access_grants (profile_id, area, granted_by)
SELECT p.id, 'business', (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1)
FROM profiles p WHERE p.full_name ILIKE 'Ndekwe Jean Bertrand%' AND p.is_active
ON CONFLICT DO NOTHING;
