/*
# Custom document categories are private to their creator

Confirmed with the operator: a category someone creates (the MD's own
"Deal Contracts" and "Outsourcing Agreements" are the concrete example)
should be visible only to them - not to the rest of their department,
and for the MD specifically, not to anyone else at all. The one
exception is the MD, who still sees every category everyone has ever
created, across every department's own window plus company-wide -
nothing is hidden from the MD.

The bug this fixes: document_categories_select's old USING clause was
`department_id IS NULL OR department_id = current_department_id() OR
is_managing_director()` - the department_id IS NULL branch has no
identity check at all, so a company-wide category (the only kind the MD
can create, since the MD has no department of their own) was visible to
literally every authenticated user, not just the MD who made it.

Fix: only the seeded, undeletable "General" category per scope stays
shared the way it always was (every member of a department, or everyone
for company-wide General, needs that baseline folder to exist). Any
other (non-default) category is visible only to whoever created it, or
the MD. Applies the identical creator-or-MD rule to documents_select and
documents_insert too - otherwise a document filed under a private
category would still show up for everyone via "All Documents" in that
scope, silently defeating the category's own privacy. A document with no
category, or one filed under a shared default "General", is completely
unaffected and keeps working exactly as it did before.

Real data checked before writing this: only 2 non-default categories
exist today (Deal Contracts, Outsourcing Agreements), both created by
the MD, both company-wide, zero created by anyone else - so this is a
pure bug fix with no other user's existing workflow affected.
*/

DROP POLICY IF EXISTS "document_categories_select" ON document_categories;
CREATE POLICY "document_categories_select" ON document_categories FOR SELECT TO authenticated
  USING (
    is_managing_director()
    OR (is_default AND (department_id IS NULL OR department_id = current_department_id()))
    OR (NOT is_default AND created_by = auth.uid())
  );

DROP POLICY IF EXISTS "documents_select" ON documents;
CREATE POLICY "documents_select" ON documents FOR SELECT TO authenticated
  USING (
    is_managing_director()
    OR uploader_id = auth.uid()
    OR (
      (department_id IS NULL OR department_id = current_department_id())
      AND NOT EXISTS (
        SELECT 1 FROM document_categories dc WHERE dc.id = documents.category_id AND dc.is_default = false
      )
    )
  );

DROP POLICY IF EXISTS "documents_insert" ON documents;
CREATE POLICY "documents_insert" ON documents FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = uploader_id
    AND (department_id IS NULL OR department_id = current_department_id() OR is_managing_director())
    AND (
      category_id IS NULL
      OR EXISTS (
        SELECT 1 FROM document_categories dc
        WHERE dc.id = category_id AND (dc.is_default OR dc.created_by = auth.uid() OR is_managing_director())
      )
    )
  );
