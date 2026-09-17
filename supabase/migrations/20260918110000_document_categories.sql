/*
# Document categories

Documents only ever had a free-text `category` string with no fixed
list - so there was no real way to "browse by category" or guarantee
every dashboard actually has one to start from. This adds a real
document_categories table (one row per category, scoped to a
department or company-wide the same way documents already are) and a
new documents.category_id pointing at it. The old `category` text
column is left in place, unused going forward, rather than dropped -
there's no existing data in it to migrate, and removing a column is
harder to undo than leaving a dead one.

Every department gets a seeded "General" category (is_default, can't
be deleted), plus one company-wide "General" for the MD's own
Documents page - satisfying "every dashboard has at least General
already created" without needing per-department special-casing in the
app, since the same shared DocumentsPage component reads whatever
categories RLS makes visible to the signed-in user.

Any employee can create a new category for their own department;
company-wide categories are MD-only to create, to keep that shared
space from getting cluttered.
*/

CREATE TABLE IF NOT EXISTS document_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS document_categories_dept_name_idx
  ON document_categories (department_id, name) WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS document_categories_company_name_idx
  ON document_categories (name) WHERE department_id IS NULL;

ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_categories_select" ON document_categories;
CREATE POLICY "document_categories_select" ON document_categories FOR SELECT TO authenticated
  USING (department_id IS NULL OR department_id = current_department_id() OR is_managing_director());

DROP POLICY IF EXISTS "document_categories_insert" ON document_categories;
CREATE POLICY "document_categories_insert" ON document_categories FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      department_id = current_department_id()
      OR (department_id IS NULL AND is_managing_director())
    )
  );

DROP POLICY IF EXISTS "document_categories_delete" ON document_categories;
CREATE POLICY "document_categories_delete" ON document_categories FOR DELETE TO authenticated
  USING (NOT is_default AND (created_by = auth.uid() OR is_managing_director()));

ALTER TABLE documents ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES document_categories(id) ON DELETE SET NULL;

INSERT INTO document_categories (name, department_id, is_default)
SELECT 'General', id, true FROM departments
ON CONFLICT DO NOTHING;

INSERT INTO document_categories (name, department_id, is_default)
SELECT 'General', NULL, true
WHERE NOT EXISTS (SELECT 1 FROM document_categories WHERE department_id IS NULL AND name = 'General');
