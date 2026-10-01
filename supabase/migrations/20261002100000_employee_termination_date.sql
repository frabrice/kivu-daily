/*
# Terminating an employee records the exact date it happened

Confirmed with the operator: Finance had no visible way to terminate an
employee at all, and deactivating (the MD's own existing action on the
Departments page) never asked which date it actually happened on - it
just stamped whatever moment someone clicked the button, which is wrong
when Finance or the MD is recording a termination after the fact (the
person's real last day was days or weeks earlier).

Added profiles.terminated_at (date, nullable). admin_deactivate_employee
now takes an explicit p_termination_date instead of implicitly using
"now" - defaults to today if omitted, but the caller is expected to pick
the real date. Same caller/target-role guard as before: Finance can
terminate any regular employee, only the MD can terminate another MD.
Dropped and recreated rather than CREATE OR REPLACE since the parameter
list changed (adding a parameter would otherwise create a second,
ambiguous overload instead of replacing the original).
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS terminated_at date;

DROP FUNCTION IF EXISTS admin_deactivate_employee(uuid);

CREATE OR REPLACE FUNCTION admin_deactivate_employee(p_user_id uuid, p_termination_date date DEFAULT CURRENT_DATE)
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

  UPDATE profiles SET
    is_active = false,
    terminated_at = COALESCE(p_termination_date, CURRENT_DATE),
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_deactivate_employee(uuid, date) TO authenticated;
