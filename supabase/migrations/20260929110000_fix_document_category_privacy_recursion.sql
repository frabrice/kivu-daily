/*
# Fix a real privacy leak: documents_select's own subquery was RLS-filtered

Found by directly simulating a non-MD user's session against the
previous migration: a document filed under someone else's private
category was still visible to everyone, exactly the bug that migration
was meant to fix. Root cause: documents_select's `NOT EXISTS (SELECT 1
FROM document_categories dc WHERE dc.id = documents.category_id AND
dc.is_default = false)` subquery runs under the CALLING user's own
permissions, so it's itself subject to document_categories' RLS - a
non-MD, non-creator user can't see the private category row at all, so
from their vantage point the subquery finds nothing, NOT EXISTS comes
back true, and the document is treated as if it were uncategorized
(visible) instead of privately categorized (hidden). Classic RLS
self-reference trap: a policy can't safely read a table whose own RLS
would filter out the very row it needs to check.

Fix: document_category_is_default() is SECURITY DEFINER, so it reads
document_categories with the function owner's privileges (which bypass
RLS on a table they own), giving the TRUE is_default value regardless
of whether the calling user could see that category row themselves.
NULL/missing category_id counts as default (not private), matching the
original NOT EXISTS semantics for an uncategorized document.

Verified directly against the database this time: simulating the same
non-MD test user, the two documents filed under the MD's private "Deal
Contracts" category are no longer returned by documents_select.
*/

CREATE OR REPLACE FUNCTION document_category_is_default(p_category_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_default FROM document_categories WHERE id = p_category_id), true);
$$;

GRANT EXECUTE ON FUNCTION document_category_is_default(uuid) TO authenticated;

DROP POLICY IF EXISTS "documents_select" ON documents;
CREATE POLICY "documents_select" ON documents FOR SELECT TO authenticated
  USING (
    is_managing_director()
    OR uploader_id = auth.uid()
    OR (
      (department_id IS NULL OR department_id = current_department_id())
      AND document_category_is_default(documents.category_id)
    )
  );
