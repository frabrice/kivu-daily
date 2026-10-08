/*
# Call Center duty: drivers who owe commission

Requested by the MD (8 Oct 2026). Replaces the standing duty "Work the
Payment backup and Follow-ups groups in the Call Queue".

Most passengers pay drivers in cash or straight to the driver's MoMo, so
Kivu Ride's commission can't be taken off the fare. After a trip (from
manual dispatch or an app request) the driver has to pay the commission
before the app sends them new requests - and the Call Center won't
dispatch rides to them either. The Call Center calls these drivers,
explains why, and guides them through paying.

- The standing duty is renamed and reworded (same template, so its history
  stays); today's unfinished copies are updated too.
- A Script Book card "Driver owes commission" is added as a DRAFT: the
  payment steps are for the MD to fill in, then approve, before agents see it.
*/

UPDATE recurring_tasks SET
  title = 'Call drivers who owe commission and help them pay it',
  description = 'Drivers paid in cash or to their own MoMo still owe Kivu Ride its commission, and the app (and the Call Center) won''t give them new rides until it''s paid. Call each driver who owes commission, explain why, and guide them step by step through paying it (Script Book: "Driver owes commission"). Log each call with its outcome.',
  updated_at = now()
WHERE id = '351a06b6-0f37-4852-8e88-b6ee305f8bd0';

UPDATE tasks t SET
  title = r.title,
  description = r.description
FROM recurring_tasks r
WHERE t.recurring_task_id = r.id AND r.id = '351a06b6-0f37-4852-8e88-b6ee305f8bd0'
  AND NOT t.completed
  AND t.created_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Kigali') AT TIME ZONE 'Africa/Kigali');

INSERT INTO script_cards (section_key, section_title, section_order, card_order, situation, say, steps, collect, owner_duty, default_priority, is_quick, approved)
SELECT 'driver_support', 'Driver support', 8, 20, 'Driver owes commission',
  $$Hello [name], this is [your name] from Kivu Ride on 6023. Your last trip was paid to you in cash or on your MoMo, so the Kivu Ride commission for it is still unpaid. Until it's paid, the app can't send you new requests and we can't dispatch rides to you. Let me show you how to pay it now so you can keep getting clients.$$,
  ARRAY[
    $$Confirm the driver's name, phone and plate.$$,
    $$Tell them the trip(s) and the commission amount they owe.$$,
    $$[MD: write the exact steps to pay the commission here, then approve this card.]$$,
    $$Stay on the line until they've paid, or agree when they will.$$,
    $$Once it's paid, tell them they'll receive requests again.$$
  ],
  ARRAY[$$Amount owed and for which trip(s)$$, $$Paid on the call, or the day they promised$$],
  NULL, 'normal', false, false
WHERE NOT EXISTS (SELECT 1 FROM script_cards WHERE situation = 'Driver owes commission');
