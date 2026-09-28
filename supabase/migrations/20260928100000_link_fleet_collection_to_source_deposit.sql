/*
# Fix an over-broad delete: link fleet_collection rows to their exact source deposit

Found while cleaning up a genuine duplicate: driver IRADUKUNDA Aime Bruno
had two identical driver_deposits rows (same driver, same paid_date, same
amount, logged 4 minutes apart - an accidental double-log). Deleting the
duplicate row was meant to remove only its own mirrored fleet_collection
finance_transactions row, but remove_driver_deposit_from_finance() finds
what to delete by matching (linked_driver_id, transaction_date, amount) -
exactly the three columns that make two deposits "duplicates" in the
first place, so it deleted BOTH mirrored rows instead of just the one
tied to the row actually being deleted. This was never safe: any two
deposits sharing driver + date + amount (not only a mistaken duplicate -
a driver could quite reasonably pay 180,000 twice in one day through two
separate transfers) would have hit the same problem.

Fix: give finance_transactions a source_deposit_id column pointing at the
exact driver_deposits row that generated it. post_driver_deposit_to_finance()
sets it at insert time, and remove_driver_deposit_from_finance() now
deletes by that exact link instead of by driver+date+amount, so it can
never over- or under-match again regardless of how many deposits share
the same driver, date and amount.

Backfill: every existing fleet_collection row is linked to its source
deposit by matching (driver_id, transaction_date, amount) - confirmed
unambiguous first (no two remaining driver_deposits rows share all
three), and the missing fleet_collection row for IRADUKUNDA's real
(non-duplicate) deposit - deleted by the over-broad trigger above before
this fix existed - is re-created identically to what the insert trigger
would have produced, correctly linked this time.
*/

ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS source_deposit_id uuid REFERENCES driver_deposits(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION post_driver_deposit_to_finance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bk_account_id uuid;
  v_driver_name text;
BEGIN
  SELECT id INTO v_bk_account_id FROM finance_accounts WHERE key = 'bank_of_kigali';
  SELECT full_name INTO v_driver_name FROM drivers WHERE id = NEW.driver_id;
  IF v_bk_account_id IS NOT NULL THEN
    INSERT INTO finance_transactions (
      type, account_id, direction, amount, transaction_date, description, counterparty,
      linked_driver_id, source_deposit_id, status, system_generated, created_by, created_at
    ) VALUES (
      'fleet_collection', v_bk_account_id, 'in', NEW.amount, NEW.paid_date,
      'Driver deposit — ' || COALESCE(v_driver_name, 'Unknown driver'), v_driver_name,
      NEW.driver_id, NEW.id, 'posted', true, NEW.created_by, NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION remove_driver_deposit_from_finance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM finance_transactions
  WHERE type = 'fleet_collection' AND system_generated = true
    AND source_deposit_id = OLD.id;
  RETURN OLD;
END;
$$;

-- Backfill the link for every existing fleet_collection row (confirmed
-- unambiguous: no two driver_deposits rows currently share driver + date
-- + amount).
UPDATE finance_transactions ft
SET source_deposit_id = dd.id
FROM driver_deposits dd
WHERE ft.type = 'fleet_collection' AND ft.system_generated = true AND ft.source_deposit_id IS NULL
  AND ft.linked_driver_id = dd.driver_id
  AND ft.transaction_date = dd.paid_date
  AND ft.amount = dd.amount;

-- Re-create the fleet_collection row the over-broad trigger wrongly
-- swept away along with the real duplicate, for IRADUKUNDA Aime Bruno's
-- remaining (genuine) deposit - identical to what the insert trigger
-- itself would have produced, this time correctly linked.
INSERT INTO finance_transactions (
  reference, type, account_id, direction, amount, transaction_date, description, counterparty,
  linked_driver_id, source_deposit_id, status, system_generated, created_by, created_at
)
SELECT
  'DRV-2026-09-040', 'fleet_collection', fa.id, 'in', dd.amount, dd.paid_date,
  'Driver deposit — ' || d.full_name, d.full_name,
  dd.driver_id, dd.id, 'posted', true, dd.created_by, dd.created_at
FROM driver_deposits dd
JOIN drivers d ON d.id = dd.driver_id
CROSS JOIN (SELECT id FROM finance_accounts WHERE key = 'bank_of_kigali') fa
WHERE dd.id = '05eaf0f5-6cc6-43ee-b4ea-4c69c594bcc2'
  AND NOT EXISTS (SELECT 1 FROM finance_transactions WHERE source_deposit_id = dd.id);
