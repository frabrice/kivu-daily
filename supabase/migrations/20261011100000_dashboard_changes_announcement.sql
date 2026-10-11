/*
# One-off email: "What's new in your Kivu Daily"

Requested by the MD (11 Oct 2026) after approving the recent changes.
Every active employee gets one email, at 08:00 on Monday 12 Oct 2026,
listing only the changes that affect their department and duties
(notifications-run/announce.ts). The MD receives every version first as a
test. Turning the rule off in Email notifications stops the send.
*/

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key, delivery) VALUES
  ('dashboard_changes_oct', 'What''s new in your Kivu Daily',
   'One-off announcement to every employee: the changes in their own dashboard (smart tasks, the morning email, outreach and the calls log, driver days off, payments report, IT Hub stories), tailored to their department and duties.',
   'Once: Monday 12 Oct 2026, 08:00', ARRAY['employees'], 3, 990, 'Managing Director', true, NULL, 'instant')
ON CONFLICT (key) DO NOTHING;
