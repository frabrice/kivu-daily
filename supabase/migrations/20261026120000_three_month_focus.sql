/*
# The 3-month focus: prove the concept, collect every franc (MD, 18 Oct 2026)

Decisions taken by the MD:
- Until mid-January the company focuses on collecting every franc the
  managed cars and the commissions should bring, with daily follow-up (the
  19:00 fleet meeting, the Call Center commission follow-up), corporate
  accounts door to door, light in-house marketing; IT and the Call Center
  keep improving.
- Monday payments are late: the week is paid by Sunday (in the deposit rule
  from 19 Oct 2026).
- "All of Rwanda by 31 December" moves behind a gate: the provinces start
  after the managed cars keep >= 98% for 8 weeks in a row.
*/
DO $$
DECLARE
  md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
  bap uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Imanariyo Baptiste%' LIMIT 1);
  o uuid; s3 uuid; d_old uuid; d_new uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM company_objectives WHERE title = 'Collect every franc the cars and commissions should bring') THEN RETURN; END IF;

  -- Objective + key results for the 3 months.
  INSERT INTO company_objectives (period, title, why, owner_id, departments, status, sort, created_by)
  VALUES ('2026-Q4', 'Collect every franc the cars and commissions should bring', 'We cannot yet fund the best technology and marketing; we prove the concept by making every car and every commission pay, with daily follow-up.', md, ARRAY['fleet', 'finance', 'call_center'], 'active', 0, md)
  RETURNING id INTO o;
  INSERT INTO company_key_results (objective_id, title, unit, source, start_value, target_value, current_value, lower_is_better, sort) VALUES
    (o, 'Kept of what the managed cars should bring (each week)', '%', 'manual', 75, 98, 75, false, 1),
    (o, 'Drivers not cleared on Monday morning', 'drivers', 'manual', 0, 0, 0, true, 2),
    (o, 'Unpaid commissions followed up the next morning', '%', 'manual', 0, 95, 0, false, 3),
    (o, 'Corporate accounts signed (door to door)', 'companies', 'manual', 1, 5, 1, false, 4);
  UPDATE company_objectives SET status = 'draft', period = '2027-Q1', why = 'Moved after the 3-month focus: starts when the managed cars keep 98% for 8 weeks (see Expansion S3).'
    WHERE title = 'Be present across Rwanda by 31 December';

  -- Priorities: the focus goes first in Now.
  UPDATE company_priorities SET sort = sort + 10;
  INSERT INTO company_priorities (title, problem, expected_impact, departments, owner_id, objective_id, horizon, status, sort, created_by) VALUES
    ('Collect every franc from the managed cars', 'About 1M RWF a month leaks from 8 cars (drivers owing, empty seats, paused days).', '120,000 RWF per car every week; with 30 cars ~15M a month.', ARRAY['fleet', 'finance'], md, o, 'now', 'active', 1, md),
    ('Collect every commission, the next morning', 'Commissions are in the Kivu Ride dashboard but nobody follows them up daily.', 'Every driver pays commission within a day; money for marketing.', ARRAY['call_center', 'finance'], md, o, 'now', 'active', 2, md),
    ('Management structure ready for 60 managed cars', '30 more managed cars and 30 financed EVs are coming; today''s way of managing 8 cars won''t hold.', 'Each car has a responsible officer, a daily meeting and clear rules.', ARRAY['fleet'], md, o, 'now', 'active', 3, md);
  UPDATE company_priorities SET horizon = 'next' WHERE title = 'Be present across Rwanda by 31 December';

  -- Expansion S3 behind the gate.
  SELECT id INTO s3 FROM company_expansion_stages WHERE name = 'All Rwanda: one town in every province';
  IF s3 IS NOT NULL THEN
    UPDATE company_expansion_stages SET target_date = NULL, summary = summary || ' Starts after the 3-month focus, once the managed cars keep 98% for 8 weeks in a row.' WHERE id = s3;
    INSERT INTO company_expansion_gates (stage_id, title, source, comparator, target, current_value, sort) VALUES
      (s3, 'Weeks in a row with >= 98% kept from the managed cars', 'manual', '>=', 8, 0, 0);
  END IF;

  -- Decisions log.
  SELECT id INTO d_old FROM company_decisions WHERE title = 'Expand to all of Rwanda by the end of 2026';
  INSERT INTO company_decisions (title, context, decision, options, consequences, departments, status, decided_by, decided_at, created_by)
  VALUES ('3 months to prove the concept: collect every franc', 'Not enough budget yet for the best technology and marketing.',
    'Until mid-January: daily follow-up so every car and every commission pays (19:00 fleet meeting with the MD and Rodrigue; Call Center commission follow-up every morning); corporate accounts door to door; light in-house marketing. IT and the Call Center keep improving. Payment is due by Sunday - Monday is late; unpaid on Monday means the car is taken back.',
    'Keep spending on tech and marketing first; expand to the provinces now.', 'Provinces move behind a gate (98% kept for 8 weeks). Review the results after 3 months.',
    ARRAY['fleet', 'finance', 'call_center', 'marketing_sales_bd', 'it'], 'decided', md, '2026-10-18', md) RETURNING id INTO d_new;
  IF d_old IS NOT NULL THEN UPDATE company_decisions SET status = 'superseded', superseded_by = d_new WHERE id = d_old; END IF;

  -- IT: let Kivu Daily read commission balances, so the follow-up becomes automatic.
  IF bap IS NOT NULL THEN
    INSERT INTO it_issues (title, description, type, areas, priority, size, status, assignee_id, source, planned, acceptance_criteria, created_by)
    VALUES ('Expose driver commission balances in the API for Kivu Daily',
      'The Call Center follows up unpaid commissions every morning from the Kivu Ride dashboard and records the outcome in Kivu Daily by hand. With an admin API endpoint (driver, commission owed, since when, last payment), Kivu Daily can build the daily list and mark payments by itself.',
      'feature', ARRAY['backend', 'admin'], 'p1', 's', 'backlog', bap, 'md', true,
      '[{"text": "GET endpoint returns each driver with commission owed, oldest unpaid date and last payment", "done": false}, {"text": "Kivu Daily can read it with the existing API key", "done": false}]', md);
  END IF;
END $$;
