/*
# Other money: deposit or collateral, connected to the driver; driver collateral (MD, 27 Nov 2026)

"When creating a new driver we sync with these recorded payments, so they
are not counted twice."

- other_money_received.kind: 'deposit' (pays for driving days once they
  start) or 'collateral' (security money, held, never counted as paying
  for days).
- other_money_received.driver_id: once the person becomes a driver, the
  entry is connected to them (from the driver form). A connected deposit
  becomes their start deposit (or a payment, if they already have one);
  connected collateral becomes the driver's collateral. Connected entries
  are no longer counted as "not yet in the system" in the report.
- drivers.collateral_*: the collateral held, and at the end of the
  contract what was given back and what was kept (debt, fines, damage).
  Collateral drivers are on Solo car (45k a day) and pay no start deposit.
*/

ALTER TABLE other_money_received
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'deposit' CHECK (kind IN ('deposit', 'collateral')),
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS linked_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS other_money_received_unlinked ON other_money_received (received_on) WHERE driver_id IS NULL;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS collateral_amount numeric CHECK (collateral_amount IS NULL OR collateral_amount > 0),
  ADD COLUMN IF NOT EXISTS collateral_date date,
  ADD COLUMN IF NOT EXISTS collateral_returned numeric CHECK (collateral_returned IS NULL OR collateral_returned >= 0),
  ADD COLUMN IF NOT EXISTS collateral_kept numeric CHECK (collateral_kept IS NULL OR collateral_kept >= 0),
  ADD COLUMN IF NOT EXISTS collateral_kept_reason text,
  ADD COLUMN IF NOT EXISTS collateral_settled_on date;

-- Connect entries to a driver. Anyone who records other money can do it,
-- whoever recorded the entry; an entry already connected is left alone.
CREATE OR REPLACE FUNCTION link_other_money(p_driver uuid, p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT (is_managing_director() OR current_department_slug() IN ('fleet', 'it', 'finance') OR is_driver_payment_followup()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE other_money_received SET driver_id = p_driver, linked_at = now(), linked_by = auth.uid()
  WHERE id = ANY(p_ids) AND driver_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION link_other_money(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION link_other_money(uuid, uuid[]) TO authenticated;

-- Undo a wrong connection: the MD only (the driver's start deposit or
-- collateral is then fixed by hand on the driver).
CREATE OR REPLACE FUNCTION unlink_other_money(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_managing_director() THEN RAISE EXCEPTION 'Only the MD can undo a connection'; END IF;
  UPDATE other_money_received SET driver_id = NULL, linked_at = NULL, linked_by = NULL WHERE id = p_id;
END $$;
REVOKE EXECUTE ON FUNCTION unlink_other_money(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION unlink_other_money(uuid) TO authenticated;

-- A connected entry can't be removed (the money is on the driver now).
DROP POLICY IF EXISTS omr_delete ON other_money_received;
CREATE POLICY omr_delete ON other_money_received FOR DELETE TO authenticated
  USING (driver_id IS NULL AND (is_managing_director() OR (created_by = auth.uid() AND created_at > now() - interval '1 day')));
