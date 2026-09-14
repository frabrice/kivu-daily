/*
# Initial deposit date

Drivers onboarded before this app tracked deposits often already paid
their first weekly deposit days or weeks earlier - initial_deposit_paid
alone gave no reference point, so the 7-day overdue cycle in Deposits
had nothing to count from and every such driver read as "Never paid"
the moment they were entered, regardless of when they actually paid.
This date is that reference point: the deposit cycle counts from here
until a real driver_deposits row is logged and takes over as the most
recent payment.
*/

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS initial_deposit_date date;
