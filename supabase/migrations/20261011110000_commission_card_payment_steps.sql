/*
# Script Book: "Driver owes commission" - payment steps, approved

The MD gave the payment steps (11 Oct 2026): in the driver portal's Wallet
tab the balance shows in negative when the driver owes; they tap Pay,
enter the number they pay with, and approve the MTN pop-up. The card was a
draft waiting for these steps; it is now approved, so agents see it.
*/

UPDATE script_cards SET
  steps = ARRAY[
    $$Confirm the driver's name, phone and plate.$$,
    $$Tell them the trip(s) and the commission amount they owe.$$,
    $$Ask them to open the Kivu Ride driver portal and go to the Wallet tab.$$,
    $$Their balance shows in negative (a minus amount) - that is the commission they owe.$$,
    $$Ask them to tap Pay and enter the MTN number they are paying with.$$,
    $$They get the MTN pop-up on that phone: they confirm it with their MoMo PIN to complete the payment.$$,
    $$Stay on the line until they've paid, or agree when they will.$$,
    $$Once it's paid, tell them they'll receive requests again.$$
  ],
  approved = true,
  updated_at = now()
WHERE situation = 'Driver owes commission' AND section_key = 'driver_support';
