/*
# Finance can add, edit and deactivate employees too

Confirmed with the operator: Finance needs the same employee-management
rights the MD already has - adding new employees, editing their role/
department, deactivating them - not just the MD.

profiles_update's RLS (`auth.uid() = id OR is_managing_director()`)
can't simply be widened to include Finance, because RLS only decides
which ROWS a role can touch, not which COLUMNS - a raw UPDATE policy
open to Finance would let a Finance user set their own (or anyone's)
role to 'managing_director', a straightforward privilege escalation.
Instead, two SECURITY DEFINER RPCs do the column-level enforcement
directly, the same pattern already used everywhere else in this app for
a privilege-sensitive write (onboard_vehicle_owner, confirm_driver_deposit,
etc.):

- admin_update_employee: callable by the MD or Finance. A caller who
  isn't the MD can never set role to 'managing_director' (ignored/
  rejected), and can never edit a profile that is already a Managing
  Director - Finance can manage every regular employee, but can't touch
  or create another MD account. The MD keeps full, unrestricted power
  exactly as before.
- admin_deactivate_employee: same caller and target-role guard, for
  deactivating (is_active = false) rather than editing.

create-user and resend-invite (Edge Functions) get the matching
widening - Finance can now call both, but create-user forces role to
'employee' server-side for any non-MD caller regardless of what the
client sends, so there is no path to mint a new MD account from
Finance's own UI even if the client-side form were ever changed.
*/

CREATE OR REPLACE FUNCTION admin_update_employee(p_user_id uuid, p_role text, p_department_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_role text;
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'finance') THEN
    RAISE EXCEPTION 'Only the Managing Director or Finance can edit an employee';
  END IF;

  IF p_role NOT IN ('employee', 'managing_director') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  SELECT role INTO v_target_role FROM profiles WHERE id = p_user_id;

  IF v_target_role = 'managing_director' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the Managing Director can edit a Managing Director';
  END IF;

  IF p_role = 'managing_director' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the Managing Director can grant the Managing Director role';
  END IF;

  UPDATE profiles SET
    role = p_role,
    department_id = CASE WHEN p_role = 'employee' THEN p_department_id ELSE NULL END,
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_employee(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION admin_deactivate_employee(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_role text;
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'finance') THEN
    RAISE EXCEPTION 'Only the Managing Director or Finance can deactivate an employee';
  END IF;

  SELECT role INTO v_target_role FROM profiles WHERE id = p_user_id;

  IF v_target_role = 'managing_director' AND NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the Managing Director can deactivate a Managing Director';
  END IF;

  UPDATE profiles SET is_active = false, updated_at = now() WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_deactivate_employee(uuid) TO authenticated;
