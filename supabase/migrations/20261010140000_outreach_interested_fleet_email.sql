/*
# Daily email to the Fleet Manager: Non-Insider drivers who said yes

Requested by the MD (10 Oct 2026): Bertrand (Ndekwe Jean Bertrand,
fleet_manager) gets a report of the Non-Insider drivers interested in our
device or branding. Monday-Saturday 08:00, only when there is at least one;
new ones since the last report first, with where his follow-up stands.
*/
INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('outreach_interested_fleet', 'Non-Insider drivers who said yes',
   'Every Non-Insider driver who said yes to our device or branding in the Call Center''s outreach calls - new ones first - with phone, car, answers and the Branding & Devices follow-up status.',
   'Monday–Saturday 08:00, only if anyone', ARRAY['resp:fleet_manager'], 3, 415, 'Fleet & operations', true, NULL)
ON CONFLICT (key) DO NOTHING;
