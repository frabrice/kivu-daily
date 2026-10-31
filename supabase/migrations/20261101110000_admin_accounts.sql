/*
# Which KivuRide admin account is which agent

Trips dispatched from the KivuRide admin dashboard carry the admin
account's id (platform_trips.dispatched_by_admin_id), not a name. This
list says whose account it is, so Call Center > Reports can credit past
and future dashboard dispatches to the agent who made them.

kind: 'agent' (one person, profile_id set), 'shared' (a shared or
management account: its dispatches count for the team on shift).
The MD keeps the list up to date from the Reports page.

Seeded 2026-10-31 from shift overlap, confirmed by the MD.
*/

CREATE TABLE IF NOT EXISTS kivuride_admin_accounts (
  admin_id bigint PRIMARY KEY,
  profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent', 'shared')),
  note text,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'shared' OR profile_id IS NOT NULL)
);
ALTER TABLE kivuride_admin_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kivuride_admin_accounts_select" ON kivuride_admin_accounts;
CREATE POLICY "kivuride_admin_accounts_select" ON kivuride_admin_accounts FOR SELECT TO authenticated
  USING (is_managing_director() OR current_department_slug() IN ('call_center', 'finance'));
DROP POLICY IF EXISTS "kivuride_admin_accounts_write" ON kivuride_admin_accounts;
CREATE POLICY "kivuride_admin_accounts_write" ON kivuride_admin_accounts FOR ALL TO authenticated
  USING (is_managing_director()) WITH CHECK (is_managing_director());
REVOKE ALL ON kivuride_admin_accounts FROM anon;

INSERT INTO kivuride_admin_accounts (admin_id, profile_id, kind, note) VALUES
  (19, 'e3eb9be6-7552-4017-b97b-fb69a8f4a3e7', 'agent', 'Nsengiyumva Joseph'),
  (16, 'a3aaea4b-75a1-44c9-a04e-0d35d9c847a9', 'agent', 'Izibyose Olivier'),
  (24, '30a1ef1f-6432-4862-be12-0c738aa10504', 'agent', 'Tuyishimire Marie Solange'),
  (20, '00174462-0562-4c0e-8b98-c78caf28f81b', 'agent', 'Igiraneza Uwase Benitha'),
  (8,  'a3676c87-e1c7-447e-9cc2-1eb17ceebaab', 'agent', 'Urayeneza Angel'),
  (17, '1ceeab02-bd3c-4597-bc49-a3b30b1cc45b', 'agent', 'NGOGA Eric'),
  (4,  NULL, 'shared', 'Shared or management account'),
  (1,  NULL, 'shared', 'Main admin account')
ON CONFLICT (admin_id) DO NOTHING;
