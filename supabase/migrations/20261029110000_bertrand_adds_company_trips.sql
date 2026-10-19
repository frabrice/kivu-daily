/*
# Company trips: people with the 'business' access add trips too (MD, 19 Oct 2026)

Bertrand (access_grants 'business') adds trips to a company, like Janviere
and the Call Center. Every trip he adds waits for Finance or the MD to
verify it; only verified trips can go on an invoice.
*/

CREATE OR REPLACE FUNCTION can_tag_trips() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR current_department_slug() IN ('finance', 'call_center')
    OR auth.uid() IN (SELECT profile_id FROM responsibilities WHERE key = 'company_trips' AND profile_id IS NOT NULL)
    OR has_access_grant('business');
$$;
