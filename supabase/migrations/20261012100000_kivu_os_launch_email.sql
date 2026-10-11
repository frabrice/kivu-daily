/*
# One-off email: "The new Kivu Daily is here"

Sent once to every active employee, at 07:45 on the morning after the MD
switches this rule on (MD Panel -> Email notifications). It ships switched
OFF so nothing goes out before the new design is released. The MD's
"Send test to me" shows every person's version first.
*/

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key, delivery, enabled) VALUES
  ('kivu_os_launch', 'The new Kivu Daily is here',
   'One-off announcement of the new design to every employee: search (Ctrl K), the module menus, tabs, clickable names, object pages, numbers on every page, the Today panel - plus where their own pages are now.',
   'Once: 07:45 the morning after it is switched on', ARRAY['employees'], 3, 995, 'Managing Director', true, NULL, 'instant', false)
ON CONFLICT (key) DO NOTHING;
