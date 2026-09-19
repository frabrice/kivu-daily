/*
# Post the initial deposit to Finance too

The driver_deposits_post_to_finance trigger only fires on INSERT to
driver_deposits - the weekly logged deposits. The initial deposit was
never inserted there at all; it only ever lived as fields on the
drivers row (initial_deposit_paid/amount/date). Result: every driver's
first week's payment was invisible on Finance's Fleet Collections page
and its KPIs, even though it's real money sitting in Bank of Kigali
exactly like every other logged deposit - confirmed against the live
database, all 7 onboarded drivers have initial_deposit_paid = true but
zero of them have a matching finance_transactions row.

Mirrors the existing pattern exactly: an AFTER INSERT OR UPDATE trigger
on drivers (scoped to just the three relevant columns) posts a
'fleet_collection' row the first time initial_deposit_paid becomes true
with an amount and date set, guarded by a NOT EXISTS check keyed off
linked_driver_id + a fixed description prefix (not the driver's name,
so a later name change can't cause a duplicate). Then a one-time
backfill for the 7 drivers already onboarded before this trigger
existed, same NOT EXISTS guard so it's safe to re-run.
*/

CREATE OR REPLACE FUNCTION post_initial_deposit_to_finance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bk_account_id uuid;
  v_already_posted boolean;
BEGIN
  IF NEW.initial_deposit_paid = true AND NEW.initial_deposit_amount IS NOT NULL AND NEW.initial_deposit_date IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM finance_transactions
      WHERE type = 'fleet_collection' AND system_generated = true AND linked_driver_id = NEW.id
        AND description LIKE 'Initial deposit%'
    ) INTO v_already_posted;

    IF NOT v_already_posted THEN
      SELECT id INTO v_bk_account_id FROM finance_accounts WHERE key = 'bank_of_kigali';
      IF v_bk_account_id IS NOT NULL THEN
        INSERT INTO finance_transactions (
          type, account_id, direction, amount, transaction_date, description, counterparty,
          linked_driver_id, status, system_generated, created_by, created_at
        ) VALUES (
          'fleet_collection', v_bk_account_id, 'in', NEW.initial_deposit_amount, NEW.initial_deposit_date,
          'Initial deposit — ' || NEW.full_name, NEW.full_name, NEW.id, 'posted', true, NEW.created_by, now()
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_post_initial_deposit ON drivers;
CREATE TRIGGER drivers_post_initial_deposit
  AFTER INSERT OR UPDATE OF initial_deposit_paid, initial_deposit_amount, initial_deposit_date ON drivers
  FOR EACH ROW EXECUTE FUNCTION post_initial_deposit_to_finance();

-- Backfill the drivers onboarded before this trigger existed.
DO $$
DECLARE
  v_bk_account_id uuid;
BEGIN
  SELECT id INTO v_bk_account_id FROM finance_accounts WHERE key = 'bank_of_kigali';
  IF v_bk_account_id IS NOT NULL THEN
    INSERT INTO finance_transactions (
      type, account_id, direction, amount, transaction_date, description, counterparty,
      linked_driver_id, status, system_generated, created_by, created_at
    )
    SELECT
      'fleet_collection', v_bk_account_id, 'in', d.initial_deposit_amount, d.initial_deposit_date,
      'Initial deposit — ' || d.full_name, d.full_name, d.id, 'posted', true, d.created_by, now()
    FROM drivers d
    WHERE d.initial_deposit_paid = true AND d.initial_deposit_amount IS NOT NULL AND d.initial_deposit_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM finance_transactions ft
        WHERE ft.type = 'fleet_collection' AND ft.system_generated = true AND ft.linked_driver_id = d.id
          AND ft.description LIKE 'Initial deposit%'
      );
  END IF;
END $$;
