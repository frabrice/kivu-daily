/*
# Driver balance adjustments

"Next payment date", "Owes" and "Behind" are calculated from a driver's
payments (depositRules.ts), so they are adjusted by recording an entry the
calculation includes, never by overwriting a number:

- kind 'amount': a credit (+) or charge (-) counted like a payment on its
  date. It is not money received: Finance's cash and collections only ever
  read driver_deposits, so they never see it.
- kind 'grace': the driver may drive until `until` although not paid up
  (the next payment date moves there); those days are not counted as lost.

Each entry keeps who, when, the reason and the numbers before and after.
Only adjust_driver_balance() writes them (MD, Finance, Fleet, and anyone
the MD granted 'adjust_balances'); a direct edit of the column is refused.
*/

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance_adjustments jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION can_adjust_balances()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_managing_director() OR current_department_slug() IN ('finance', 'fleet')
    OR EXISTS (SELECT 1 FROM access_grants WHERE profile_id = auth.uid() AND area = 'adjust_balances');
$$;
REVOKE ALL ON FUNCTION can_adjust_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_adjust_balances() TO authenticated;

CREATE OR REPLACE FUNCTION adjust_driver_balance(p_driver uuid, p_amount numeric, p_until date, p_reason text, p_before jsonb, p_after jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Kigali')::date;
  v_name text;
  v_entries jsonb := '[]'::jsonb;
  v_driver text;
BEGIN
  IF auth.uid() IS NULL OR NOT can_adjust_balances() THEN
    RAISE EXCEPTION 'Only the MD, Finance, Fleet and people the MD allowed can adjust a driver''s numbers';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Write the reason for this adjustment'; END IF;
  IF coalesce(p_amount, 0) = 0 AND p_until IS NULL THEN RAISE EXCEPTION 'Nothing to adjust'; END IF;
  IF abs(coalesce(p_amount, 0)) > 10000000 THEN RAISE EXCEPTION 'That amount is too large'; END IF;
  IF p_until IS NOT NULL AND (p_until < v_today OR p_until > v_today + 60) THEN RAISE EXCEPTION 'The payment date must be between today and 60 days from now'; END IF;
  SELECT full_name INTO v_driver FROM drivers WHERE id = p_driver;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  SELECT trim(full_name) INTO v_name FROM profiles WHERE id = auth.uid();

  IF coalesce(p_amount, 0) <> 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'amount', 'date', v_today, 'amount', p_amount,
      'reason', trim(p_reason), 'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p_before, 'after', p_after));
  END IF;
  IF p_until IS NOT NULL THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'grace', 'date', v_today, 'until', p_until,
      'reason', trim(p_reason), 'by', auth.uid(), 'by_name', v_name, 'at', now(), 'before', p_before, 'after', p_after));
  END IF;

  PERFORM set_config('kivu.adjusting', 'on', true);
  UPDATE drivers SET balance_adjustments = balance_adjustments || v_entries, updated_at = now() WHERE id = p_driver;
  PERFORM set_config('kivu.adjusting', 'off', true);

  INSERT INTO activity_log (actor_id, department_id, action, entity_type, entity_id, entity_label, metadata)
  VALUES (auth.uid(), (SELECT department_id FROM profiles WHERE id = auth.uid()), 'driver_balance_adjusted', 'driver', p_driver, v_driver,
    jsonb_build_object('amount', p_amount, 'until', p_until, 'reason', trim(p_reason), 'before', p_before, 'after', p_after));
  RETURN v_entries;
END;
$$;
REVOKE ALL ON FUNCTION adjust_driver_balance(uuid, numeric, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION adjust_driver_balance(uuid, numeric, date, text, jsonb, jsonb) TO authenticated;

-- The adjustments can only change through adjust_driver_balance().
CREATE OR REPLACE FUNCTION guard_balance_adjustments()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance_adjustments IS DISTINCT FROM OLD.balance_adjustments AND coalesce(current_setting('kivu.adjusting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Adjustments are recorded with the Adjust button only';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS drivers_guard_balance_adjustments ON drivers;
CREATE TRIGGER drivers_guard_balance_adjustments BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION guard_balance_adjustments();

-- A new area the MD can open to one person: adjusting drivers' (and later Finance's) numbers.
ALTER TABLE access_grants DROP CONSTRAINT IF EXISTS access_grants_area_check;
ALTER TABLE access_grants ADD CONSTRAINT access_grants_area_check CHECK (area IN ('business', 'adjust_balances'));

-- Janviere may adjust too (MD, 31 Oct 2026).
INSERT INTO access_grants (profile_id, area, granted_by)
SELECT '14ec9140-f096-4630-ac5e-c854a6b7be12', 'adjust_balances', (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active LIMIT 1)
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = '14ec9140-f096-4630-ac5e-c854a6b7be12')
  AND NOT EXISTS (SELECT 1 FROM access_grants WHERE profile_id = '14ec9140-f096-4630-ac5e-c854a6b7be12' AND area = 'adjust_balances');
