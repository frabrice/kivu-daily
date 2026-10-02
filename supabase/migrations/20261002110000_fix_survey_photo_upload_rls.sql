/*
# Fix: survey collectors couldn't upload station photos (RLS violation)

Reported from the field by a data collector: attaching a photo and
submitting a charging station failed with "new row violates row-level
security policy". Reproduced directly against the database - an
anonymous upload under the active survey's own link token was denied
exactly the same way.

Root cause: survey_uploads_anon_insert checked the upload path's token
with `EXISTS (SELECT 1 FROM survey_cases WHERE link_token = ...)`, but
that subquery runs as the anonymous collector, and survey_cases is
MD-only under its own RLS - so from the collector's side the case never
exists and every upload is rejected. Because the public form uploads
photos before calling submit_charging_station and aborts on the first
failed upload, any submission with a photo was lost entirely (zero
stations had been recorded at the time of this fix).

Fix: survey_token_is_active() is SECURITY DEFINER, so it reads
survey_cases with the function owner's privileges and returns only a
yes/no - the collector still can't read the table itself, and a
missing, closed or made-up token is still rejected.
*/

CREATE OR REPLACE FUNCTION survey_token_is_active(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM survey_cases WHERE link_token = p_token AND status = 'active');
$$;

GRANT EXECUTE ON FUNCTION survey_token_is_active(text) TO anon, authenticated;

DROP POLICY IF EXISTS "survey_uploads_anon_insert" ON storage.objects;
CREATE POLICY "survey_uploads_anon_insert" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'survey-uploads'
    AND survey_token_is_active((storage.foldername(name))[1])
  );
