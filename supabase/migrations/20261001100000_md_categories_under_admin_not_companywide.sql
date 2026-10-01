/*
# The MD's own categories belong under Admin, not a vague "Company-wide"

Confirmed with the operator: the previous privacy fix correctly hid the
MD's own categories (Deal Contracts, Outsourcing Agreements) from
everyone else at the data level, but they were still filed under
"Company-wide" (department_id IS NULL) - a label that means "shared
with everyone", the opposite of what they actually are. The operator
doesn't want a company-wide bucket at all for this; they want their own
categories to live under Admin specifically.

Root cause of why they ended up there in the first place: the MD has no
department_id of their own, and document_categories_insert/the UI's
canCreateCategory only ever let the MD create a category while on the
NULL/"Company-wide" scope - there was no path to create one anywhere
else, Admin included, even though an Admin department already exists in
the system (seeded, zero employees - it was never actually used).

This migration:
- Re-points the MD's two existing custom categories, and the two
  documents filed under them, from department_id IS NULL to the real
  Admin department's id.
- Deletes the now-orphaned company-wide "General" default category (0
  documents, nothing left needs it once this move is done).
- Swaps document_categories_insert's and documents_insert's "NULL +
  is_managing_director()" special case for "Admin department +
  is_managing_director()" - the MD's dedicated creation scope is now
  Admin, not a null/company-wide bucket. Looked up by the department's
  stable slug rather than a hardcoded id.
- Tightens documents_insert to drop the old unconditional "anyone can
  insert with department_id IS NULL" branch, which was never actually
  reachable from the UI but had no business being open at the database
  level either.

Existing privacy rules (document_categories_select / documents_select /
document_category_is_default) are untouched - they already treat Admin
exactly like any other department (its own default "General" is only
shared with Admin's own members, of which there are none, plus the MD;
any non-default category stays creator-or-MD only) - so nothing more
needs to change there for this to work correctly.
*/

DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM departments WHERE slug = 'admin';

  UPDATE document_categories SET department_id = v_admin_id
  WHERE department_id IS NULL AND is_default = false;

  UPDATE documents SET department_id = v_admin_id
  WHERE department_id IS NULL;

  DELETE FROM document_categories WHERE department_id IS NULL AND is_default = true;
END $$;

DROP POLICY IF EXISTS "document_categories_insert" ON document_categories;
CREATE POLICY "document_categories_insert" ON document_categories FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      department_id = current_department_id()
      OR (is_managing_director() AND department_id = (SELECT id FROM departments WHERE slug = 'admin'))
    )
  );

DROP POLICY IF EXISTS "documents_insert" ON documents;
CREATE POLICY "documents_insert" ON documents FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = uploader_id
    AND (department_id = current_department_id() OR is_managing_director())
    AND (
      category_id IS NULL
      OR EXISTS (
        SELECT 1 FROM document_categories dc
        WHERE dc.id = category_id AND (dc.is_default OR dc.created_by = auth.uid() OR is_managing_director())
      )
    )
  );
