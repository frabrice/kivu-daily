/*
# Close anonymous access to protected functions

Found while testing Call Analytics: role checks written as
  IF NOT (current_department_slug() = 'finance' OR is_managing_director())
  IF current_department_slug() <> 'finance' AND NOT is_managing_director()
evaluate to NULL - not true - when nobody is signed in, because
current_department_slug() returns NULL. IF NULL doesn't raise, so a
caller with only the public anon key could get past them.

1. current_department_slug() returns '' instead of NULL for callers
   without a department (nobody signed in). Every active employee has a
   department and the MD is checked separately, so signed-in behaviour is
   unchanged; the comparisons above now fail closed.
2. Belt and braces: nobody who isn't signed in may execute the
   SECURITY DEFINER functions any more - except the four the public
   charging-station survey uses.
*/

CREATE OR REPLACE FUNCTION public.current_department_slug()
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT d.slug FROM profiles p JOIN departments d ON d.id = p.department_id WHERE p.id = auth.uid()), '');
$$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname NOT IN ('get_survey_progress', 'validate_collector_email', 'submit_charging_station', 'survey_token_is_active')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
  END LOOP;
END $$;
