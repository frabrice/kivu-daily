/*
# Willing to buy the app's device (Non-Insider cars)

The physical tracking/ride device is tied to the car, not the driver -
if the driver changes but the car stays, the device question stays
answered; if the car changes, it resets to unknown on the new one. Same
NULL-starts-unknown convention as is_branded/allows_branding: this is
survey data the call center fills in over time, not a claim either way
until someone's actually asked.
*/

ALTER TABLE platform_cars ADD COLUMN IF NOT EXISTS willing_to_buy_device boolean;
