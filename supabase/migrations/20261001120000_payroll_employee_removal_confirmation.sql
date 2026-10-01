/*
# Finance removing a payroll employee needs the MD's confirmation

Confirmed with the operator: Internal Payroll employees are already
standalone records (full_name is free text, no Kivu Daily login needed
- linked_profile_id is optional and usually null), so Finance could
already create and edit anyone regardless of whether they have an
account or belong to a department. What was missing: Finance's "Remove"
button deleted a payroll employee immediately and permanently, with no
review - the operator wants Finance to still be able to flag someone
for removal, but the MD confirms before it's actually gone.

Added pending_removal / removal_requested_by / removal_requested_at to
payroll_employees. request_payroll_employee_removal() branches on the
caller: the MD still deletes immediately (no need to confirm your own
request), Finance instead flags the row pending_removal = true.
confirm_payroll_employee_removal() (MD-only) performs the actual
delete; cancel_payroll_employee_removal() (Finance or MD) un-flags it,
for "actually, keep them" without losing the record. The existing
payroll_employees_delete RLS policy (Finance or MD) is untouched - it's
what lets confirm actually delete the row, and still lets the MD's own
branch of request_ delete directly, exactly as before for the MD.
*/

ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS pending_removal boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS removal_requested_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS removal_requested_at timestamptz;

CREATE OR REPLACE FUNCTION request_payroll_employee_removal(p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'finance') THEN
    RAISE EXCEPTION 'Only Finance or the MD can remove a payroll employee';
  END IF;

  IF is_managing_director() THEN
    DELETE FROM payroll_employees WHERE id = p_employee_id;
  ELSE
    UPDATE payroll_employees SET
      pending_removal = true,
      removal_requested_by = auth.uid(),
      removal_requested_at = now(),
      updated_at = now()
    WHERE id = p_employee_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION request_payroll_employee_removal(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION confirm_payroll_employee_removal(p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_managing_director() THEN
    RAISE EXCEPTION 'Only the Managing Director can confirm a payroll employee removal';
  END IF;
  DELETE FROM payroll_employees WHERE id = p_employee_id AND pending_removal = true;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_payroll_employee_removal(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_payroll_employee_removal(p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() = 'finance') THEN
    RAISE EXCEPTION 'Only Finance or the MD can cancel a payroll employee removal request';
  END IF;
  UPDATE payroll_employees SET
    pending_removal = false,
    removal_requested_by = NULL,
    removal_requested_at = NULL,
    updated_at = now()
  WHERE id = p_employee_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_payroll_employee_removal(uuid) TO authenticated;
