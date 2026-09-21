/*
# Driver onboarding documents

Seven fixed documents Fleet collects from every applying driver:
application letter, CV, national ID, driving license, medical
certificate, criminal record, and a discipline certificate from the
village chief. One row per driver per document type - uploading again
for the same type replaces the file reference (the old file is left in
storage rather than deleted, since the existing 'documents' bucket's
delete policy only lets the original uploader remove their own object,
and a replacement is often done by a different staff member).

Reuses the existing 'documents' storage bucket (see phase1_foundation)
rather than creating a new one - its SELECT/INSERT policies are already
bucket-wide for any authenticated user, so no storage policy changes
are needed, only a path convention: drivers/<driver_id>/<doc_type>-<uuid>-<filename>.
*/

CREATE TABLE IF NOT EXISTS driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'application_letter', 'cv', 'id', 'driving_license',
    'medical_certificate', 'criminal_record', 'discipline_certificate'
  )),
  file_url text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, doc_type)
);

CREATE INDEX IF NOT EXISTS driver_documents_driver_idx ON driver_documents(driver_id);

ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_documents_select" ON driver_documents;
CREATE POLICY "driver_documents_select" ON driver_documents FOR SELECT TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_documents_insert" ON driver_documents;
CREATE POLICY "driver_documents_insert" ON driver_documents FOR INSERT TO authenticated
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_documents_update" ON driver_documents;
CREATE POLICY "driver_documents_update" ON driver_documents FOR UPDATE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director())
  WITH CHECK (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());

DROP POLICY IF EXISTS "driver_documents_delete" ON driver_documents;
CREATE POLICY "driver_documents_delete" ON driver_documents FOR DELETE TO authenticated
  USING (current_department_slug() IN ('fleet', 'call_center', 'it') OR is_managing_director());
