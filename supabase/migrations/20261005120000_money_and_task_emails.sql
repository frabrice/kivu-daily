/*
# Money & growth emails; task reminders for everyone

- money_daily: Monday-Saturday 07:45 to the MD and Finance (route_finance
  duty) - collections vs what driving should bring in, owed/behind,
  revenue, owner payouts and costs this month vs last, cash, payouts due
  vs the Fleet Collection account, empty driver slots and what they
  cost - then the day's most important actions, each with its number.
- money_monthly: the 1st at 09:00, last month in review vs the month
  before, where the costs went, and the month's focus.
- task_morning now goes to everyone at 07:00 with their list for the day
  (standing duties first); task_overdue at 13:00 for anything past its
  done-by time; task_unfinished every day at 17:30.
*/

INSERT INTO notification_rules (key, label, description, schedule_label, audience, phase, sort_order, area, in_app, preference_key) VALUES
  ('money_daily', 'Money & growth brief', 'Collections vs expected, owed and behind, revenue/costs vs last month, cash vs payouts due, empty driver slots — then today''s most important actions, each with its number.', 'Monday–Saturday 07:45', ARRAY['md', 'resp:route_finance'], 5, 205, 'Managing Director', true, NULL),
  ('money_monthly', 'Month in review', 'Last month''s revenue, collections, owner payouts, costs and net vs the month before, where costs went, and the focus for the month.', '1st of the month, 09:00', ARRAY['md', 'resp:route_finance'], 5, 206, 'Managing Director', true, NULL),
  ('task_overdue', 'Tasks past due', 'Only to people with tasks whose done-by time has passed and aren''t ticked.', 'Daily 13:00', ARRAY['employees'], 5, 505, 'Everyone''s workspace', true, 'unfinished_task_reminders')
ON CONFLICT (key) DO NOTHING;

UPDATE notification_rules SET label = 'Your day', schedule_label = 'Daily 07:00',
  description = 'Everyone''s list for the day with done-by times, standing duties included. Monday–Saturday, anyone with nothing on their list is asked to add tasks.'
WHERE key = 'task_morning';
UPDATE notification_rules SET schedule_label = 'Daily 17:30',
  description = 'Tasks still open at the end of the day. Missed standing duties show in the MD''s briefing.'
WHERE key = 'task_unfinished';
UPDATE notification_rules SET description = description || ' Names standing duties missed yesterday.'
WHERE key = 'md_daily_digest' AND description NOT LIKE '%standing duties%';
