/*
# Correct Willard's and Obed's initial deposit amounts

Both drivers were recorded with a flat 180,000 initial deposit, which
was wrong for both of them:

- Gatore Willard actually paid 100,000 initially (confirmed by the
  operator, and matching the 100,000 / 2026-09-10 entry that the prior
  turn's finance_transactions backfill had recorded before it was
  wrongly cleaned up as "stray test data"). His date is corrected to
  the real payment date, 2026-09-10.
- Obed Ntwari Nziza actually paid 210,000 initially (30,000 over the
  180,000 weekly amount), confirmed by the operator and matching the
  210,000 / 2026-09-12 backfill entry.

Every other driver's initial_deposit_amount (180,000, all correct) and
their already-logged week-2 driver_deposits rows were verified against
the operator's account and left untouched - this migration only fixes
these two rows.
*/

UPDATE drivers SET initial_deposit_amount = 100000, initial_deposit_date = '2026-09-10'
WHERE id = '57bcb4ee-cbac-4d80-a31e-44ab36287d34'; -- Gatore Willard

UPDATE drivers SET initial_deposit_amount = 210000
WHERE id = '16b162dc-585e-48a1-b1e9-d798dfc055cc'; -- Obed Ntwari Nziza
