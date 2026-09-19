/*
# Clean up orphaned Fleet Collection ledger entries

The 2026-09-13 finance module migration backfilled every driver_deposits
row that existed at the time into finance_transactions (type =
'fleet_collection'), and added an AFTER INSERT trigger to keep doing
that for every new deposit Fleet logs. Nothing was ever added to remove
a ledger entry if the underlying driver_deposits row got deleted.

The 2026-09-17 migration wiped a batch of stray test-session
driver_deposits rows - but their already-posted ledger entries were
left behind in finance_transactions. The result: Finance's Fleet
Collections page (and the Finance Dashboard's Fleet Collections total)
was showing 17 "Driver deposit" entries across 6 drivers, dated
2026-09-09 through 2026-09-14, that no longer correspond to anything in
Fleet's own Deposits page - deposits that, per the current
driver_deposits table, never happened. Only 3 real deposits exist
(all logged 2026-09-18), and only those 3 should ever have shown up.

This removes the orphans - matched by driver + date + amount against
the current driver_deposits table, the same predicate used to verify
all 17 rows by hand before writing this migration - and adds the
missing AFTER DELETE trigger so any driver_deposits row removed in the
future takes its ledger entry with it, instead of leaving Finance's
numbers to silently drift from Fleet's.
*/

DELETE FROM finance_transactions ft
WHERE ft.type = 'fleet_collection' AND ft.system_generated = true
  AND NOT EXISTS (
    SELECT 1 FROM driver_deposits dd
    WHERE dd.driver_id = ft.linked_driver_id
      AND dd.paid_date = ft.transaction_date
      AND dd.amount = ft.amount
  );

CREATE OR REPLACE FUNCTION remove_driver_deposit_from_finance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM finance_transactions
  WHERE type = 'fleet_collection' AND system_generated = true
    AND linked_driver_id = OLD.driver_id
    AND transaction_date = OLD.paid_date
    AND amount = OLD.amount;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS driver_deposits_remove_from_finance ON driver_deposits;
CREATE TRIGGER driver_deposits_remove_from_finance
  AFTER DELETE ON driver_deposits
  FOR EACH ROW EXECUTE FUNCTION remove_driver_deposit_from_finance();
