/*
# Driver stage redesign: computed active, raw/ready pool, no training

Confirmed with the operator: the old six-stage pipeline (applying,
training, active, waiting, flagged, inactive) let "active" drift out of
sync with reality, since it was just another manually-picked dropdown
value - a driver could be marked active with no vehicle or no deposit,
or stay stuck on an old stage after actually going active.

New model:
- 'active' is no longer a value Fleet can pick. It's computed by the
  app (effectiveStage() in lib/fleet.ts) from vehicle_id + initial_
  deposit_paid + contract_status, so it can never be wrong. This
  migration removes it from what can actually be stored.
- 'training' is removed entirely.
- 'waiting' is renamed/redefined as 'raw' - a vetted, good driver who
  just doesn't have the money for their first week's deposit yet.
- 'ready' is new - vetted, no vehicle assigned, ideally already holding
  a paid deposit, sitting in a bench pool specifically to slot into a
  car the moment another driver's contract ends.

Checked the live data first: only 'active' (5 drivers) and 'inactive'
(2 drivers) are actually in use today, nothing in 'training' or
'waiting'. The 5 active drivers already have a vehicle and a paid
deposit, so effectiveStage() will keep showing them as active
immediately after this runs - their stored value just moves to 'ready'
since 'active' can no longer be stored.
*/

-- Widen the constraint first so the backfill below (which lands on a
-- value, 'ready', the old constraint didn't allow) doesn't get rejected.
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_stage_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_stage_check
  CHECK (stage IN ('applying', 'training', 'raw', 'ready', 'active', 'waiting', 'flagged', 'inactive'));

UPDATE drivers SET stage = 'ready' WHERE stage = 'active';
UPDATE drivers SET stage = 'raw' WHERE stage IN ('training', 'waiting');

-- Now narrow it to the final set - 'active' can never be stored again.
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_stage_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_stage_check
  CHECK (stage IN ('applying', 'raw', 'ready', 'flagged', 'inactive'));
