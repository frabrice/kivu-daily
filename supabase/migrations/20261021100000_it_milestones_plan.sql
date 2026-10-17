/*
# IT plan, 17 Oct 2026 (MD): finished milestones on record + the next ones

Finished (Completed, issues Done, past dates from the trip data):
  - MVP launch: rider & driver apps live (May 2026; first trips 31 May)
  - Payments (Jun - Oct 2026; gateway Mobile Money live 18 Aug), incl.
    KR-122 smart/corporate account deposits, KR-123 driver withdrawals,
    KR-124 maximum outstanding commission
  - Smart dispatch: one driver at a time (live; exact dates not known)
New:
  - Move to DigitalOcean (project) - Infra 1 + Infra 2 - CTO
  - Kivu AI voice agent (project) - Voice 1 (Kinyarwanda) / 2 (English,
    French) / 3 (Kiswahili, polish) - CTO
  - Design & UX workflows (project) - Design 1 + Design 2 - Janviere
Projects start as Ideas without budgets: the head of IT adds the budget
and asks the MD to approve.
*/

DO $$
DECLARE
  md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND full_name ILIKE 'Frabrice%' LIMIT 1);
  cto uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'NIYOKWIZERWA Fabrice%' LIMIT 1);
  bap uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Imanariyo Baptiste%' LIMIT 1);
  jan uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Uwera Janviere%' LIMIT 1);
  m_mvp uuid; m_pay uuid; m_disp uuid; m_inf1 uuid; m_inf2 uuid; m_v1 uuid; m_v2 uuid; m_v3 uuid; m_d1 uuid; m_d2 uuid;
  i_inf uuid; i_voice uuid; i_design uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM it_milestones WHERE name = 'MVP launch: rider & driver apps live') THEN RETURN; END IF;
  -- Numbers continue from the last real ones (test runs used some up).
  PERFORM setval('it_initiative_number', (SELECT COALESCE(max(number), 0) FROM it_initiatives) + 1, false);
  PERFORM setval('it_milestone_number', (SELECT COALESCE(max(number), 0) FROM it_milestones) + 1, false);
  PERFORM setval(pg_get_serial_sequence('it_issues', 'id'), (SELECT max(id) FROM it_issues));

  -- ---------------------------------------------------------- projects
  INSERT INTO it_initiatives (name, problem, outcome, owner_id, areas, priority, start_date, target_date, status, horizon, created_by)
  VALUES ('Move to DigitalOcean: reliable, backed-up infrastructure',
    'The platform runs on Render: slow cold starts, limited control over the database, no tested backups and no clear security baseline. A lost or broken database today would stop every trip and payment.',
    'Database and API run on DigitalOcean with automatic daily backups that are tested by restoring them, a security baseline, monitoring and alerts, and a written runbook. Render is switched off.',
    cto, ARRAY['infra', 'security', 'backend'], 'p1', '2026-10-19', '2026-11-15', 'idea', 'now', md) RETURNING id INTO i_inf;
  INSERT INTO it_initiatives (name, problem, outcome, owner_id, areas, priority, start_date, target_date, status, horizon, created_by)
  VALUES ('Kivu AI voice agent',
    'Many riders prefer to call rather than use the app, and the Call Center can only take so many calls. Most voice assistants do not understand Kinyarwanda well.',
    'Riders call a number and book a ride by talking - first perfectly in Kinyarwanda, then English and French, then Kiswahili - with a smooth handover to a Call Center agent when needed. Most calls end in a confirmed booking without human help.',
    cto, ARRAY['data_ai', 'backend', 'infra'], 'p1', '2026-10-19', '2027-01-31', 'idea', 'now', md) RETURNING id INTO i_voice;
  INSERT INTO it_initiatives (name, problem, outcome, owner_id, areas, priority, start_date, target_date, status, horizon, created_by)
  VALUES ('Design & UX workflows: fewer steps, every screen translated',
    'Booking and driving take more steps than they should, screens are not consistent, and some text is not translated - riders and drivers get lost or give up.',
    'A rider books in 3 taps or fewer, drivers handle a trip with the fewest taps, every screen is consistent and fully translated (Kinyarwanda, English, French), tested with real riders and drivers.',
    jan, ARRAY['design', 'app_rider', 'app_driver', 'app_core'], 'p2', '2026-10-19', '2026-11-15', 'idea', 'now', md) RETURNING id INTO i_design;

  -- ---------------------------------------------------------- milestones
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, completed_at) VALUES
    ('MVP launch: rider & driver apps live', 'Riders can book and pay for a ride and drivers can take it, end to end, on the live apps.', '2026-05-04', '2026-05-31', 'completed', md, '2026-05-31 18:00+02') RETURNING id INTO m_mvp;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, completed_at) VALUES
    ('Payments', 'Every way to pay works inside the system: cash, Mobile Money, card, company accounts, smart-account deposits and driver withdrawals.', '2026-06-01', '2026-10-17', 'completed', bap, now()) RETURNING id INTO m_pay;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, completed_at) VALUES
    ('Smart dispatch: one driver at a time', 'A trip goes to the nearest driver for 15 s, then the second nearest for 15 s, then to 4 more drivers at once - the first to accept gets it.', '2026-09-28', '2026-10-11', 'completed', bap, '2026-10-11 18:00+02') RETURNING id INTO m_disp;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, initiative_id) VALUES
    ('Infra 1: DigitalOcean ready, backups on', 'Staging runs on DigitalOcean, the database has automatic backups and we have restored one successfully.', '2026-10-19', '2026-11-01', 'planned', cto, i_inf) RETURNING id INTO m_inf1;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, initiative_id) VALUES
    ('Infra 2: cut-over and hardening', 'Production runs on DigitalOcean, Render is off, and anyone in IT can deploy, restore or roll back from the runbook.', '2026-11-02', '2026-11-15', 'planned', cto, i_inf) RETURNING id INTO m_inf2;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, initiative_id) VALUES
    ('Voice agent 1: books rides in Kinyarwanda', 'A rider calls, speaks Kinyarwanda and gets a confirmed booking - at least 80% of test calls without human help.', '2026-10-19', '2026-11-15', 'planned', cto, i_voice) RETURNING id INTO m_v1;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, initiative_id) VALUES
    ('Voice agent 2: English and French', 'The same quality in English and French, switching language when the caller does.', '2026-11-16', '2026-12-13', 'planned', cto, i_voice) RETURNING id INTO m_v2;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, initiative_id) VALUES
    ('Voice agent 3: Kiswahili, then polish', 'Kiswahili works as well as the other three; noisy calls and mixed languages are handled; we can see how every call went.', '2027-01-04', '2027-01-31', 'planned', cto, i_voice) RETURNING id INTO m_v3;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, initiative_id) VALUES
    ('Design 1: fewer steps to book', 'Every screen is mapped, a rider books in 3 taps or fewer, and the app uses one design system.', '2026-10-19', '2026-11-01', 'planned', jan, i_design) RETURNING id INTO m_d1;
  INSERT INTO it_milestones (name, goal, start_date, end_date, status, owner_id, initiative_id) VALUES
    ('Design 2: driver flow, translations, testing', 'Drivers handle a trip with the fewest taps, every screen is translated, and real riders and drivers have tested it.', '2026-11-02', '2026-11-15', 'planned', jan, i_design) RETURNING id INTO m_d2;

  -- ---------------------------------------------------------- issues
  CREATE TEMP TABLE plan_issues (
    ord serial, ms uuid, title text, description text, type text, areas text[], priority text, size text, status text, who uuid,
    created timestamptz, started timestamptz, done timestamptz, criteria text[]
  ) ON COMMIT DROP;

  -- MVP (done, May 2026). Features: Baptiste; deployments: the MD.
  INSERT INTO plan_issues (ms, title, description, type, areas, priority, size, status, who, created, started, done, criteria) VALUES
    (m_mvp, 'Rider sign-up and login with a phone number', NULL, 'feature', ARRAY['app_rider', 'backend'], 'p0', 'm', 'done', bap, '2026-05-04', '2026-05-04', '2026-05-08', ARRAY['A new rider signs up with a phone number and a code', 'A returning rider logs in without a password']),
    (m_mvp, 'Book a ride: pickup, destination and fare estimate', NULL, 'feature', ARRAY['app_rider', 'backend'], 'p0', 'l', 'done', bap, '2026-05-04', '2026-05-06', '2026-05-15', ARRAY['The rider sees the estimated fare before confirming', 'The trip is created and sent to drivers']),
    (m_mvp, 'See the driver coming on the map, live', NULL, 'feature', ARRAY['app_rider'], 'p0', 'm', 'done', bap, '2026-05-04', '2026-05-12', '2026-05-18', ARRAY['The rider sees the driver''s position and arrival time']),
    (m_mvp, 'Rate the trip and leave feedback', NULL, 'feature', ARRAY['app_rider', 'app_driver'], 'p1', 's', 'done', bap, '2026-05-04', '2026-05-18', '2026-05-20', ARRAY['Riders rate the trip, drivers rate the rider']),
    (m_mvp, 'Trip history for riders', NULL, 'feature', ARRAY['app_rider'], 'p2', 's', 'done', bap, '2026-05-04', '2026-05-19', '2026-05-21', ARRAY['A rider sees past trips with date, route and fare']),
    (m_mvp, 'Driver goes online and receives trip requests', NULL, 'feature', ARRAY['app_driver', 'backend'], 'p0', 'm', 'done', bap, '2026-05-04', '2026-05-06', '2026-05-12', ARRAY['Only online drivers receive requests']),
    (m_mvp, 'Driver accepts, navigates to pickup, starts and finishes the trip', NULL, 'feature', ARRAY['app_driver', 'backend'], 'p0', 'l', 'done', bap, '2026-05-04', '2026-05-10', '2026-05-20', ARRAY['Each step updates the trip for the rider in real time', 'The final fare is shown at the end']),
    (m_mvp, 'Driver earnings view', NULL, 'feature', ARRAY['app_driver'], 'p2', 's', 'done', bap, '2026-05-04', '2026-05-20', '2026-05-23', ARRAY['A driver sees today''s trips and earnings']),
    (m_mvp, 'Fare engine: base, distance, time and waiting fee', NULL, 'feature', ARRAY['backend'], 'p0', 'm', 'done', bap, '2026-05-04', '2026-05-05', '2026-05-13', ARRAY['The fare is calculated the same way for the estimate and the final price']),
    (m_mvp, 'Admin panel: trips, drivers, vehicles and manual dispatch', NULL, 'feature', ARRAY['admin', 'backend'], 'p1', 'l', 'done', bap, '2026-05-04', '2026-05-14', '2026-05-27', ARRAY['Staff see all trips and can dispatch one by hand']),
    (m_mvp, 'Deploy the backend to production', 'Deployments are done by the MD.', 'chore', ARRAY['infra', 'backend'], 'p0', 's', 'done', md, '2026-05-04', '2026-05-25', '2026-05-28', ARRAY['The API runs in production with its database and secrets']),
    (m_mvp, 'Publish the rider and driver apps on Google Play and the App Store', 'Deployments are done by the MD.', 'chore', ARRAY['infra', 'app_core'], 'p0', 's', 'done', md, '2026-05-04', '2026-05-26', '2026-05-31', ARRAY['Both apps can be downloaded from the stores']);

  -- Payments (done). Baptiste.
  INSERT INTO plan_issues (ms, title, description, type, areas, priority, size, status, who, created, started, done, criteria) VALUES
    (m_pay, 'Company account trips: the ride is charged to the company', NULL, 'feature', ARRAY['backend', 'app_rider'], 'p1', 'm', 'done', bap, '2026-06-01', '2026-06-02', '2026-06-09', ARRAY['A company rider pays nothing at the end of the trip', 'The trip is recorded against the company']),
    (m_pay, 'Cash payment recorded at the end of the trip', NULL, 'feature', ARRAY['backend', 'app_driver'], 'p0', 's', 'done', bap, '2026-06-01', '2026-06-10', '2026-06-15', ARRAY['The driver confirms cash received and the trip is marked paid']),
    (m_pay, 'Mobile Money payments through the payment gateway', NULL, 'feature', ARRAY['backend', 'app_rider'], 'p0', 'l', 'done', bap, '2026-06-01', '2026-07-20', '2026-08-18', ARRAY['A rider pays with MoMo from the app', 'The trip shows paid once the gateway confirms']),
    (m_pay, 'Card payments through the payment gateway', NULL, 'feature', ARRAY['backend', 'app_rider'], 'p1', 'l', 'done', bap, '2026-06-01', '2026-07-20', '2026-08-18', ARRAY['A rider pays by card from the app']),
    (m_pay, 'Payment confirmations: gateway callbacks update the payment status', NULL, 'feature', ARRAY['backend', 'security'], 'p0', 'm', 'done', bap, '2026-06-01', '2026-08-04', '2026-08-18', ARRAY['Pending, successful and failed payments are recorded correctly', 'Callbacks are verified before they are trusted']);

  -- Smart dispatch (done, live). Baptiste.
  INSERT INTO plan_issues (ms, title, description, type, areas, priority, size, status, who, created, started, done, criteria) VALUES
    (m_disp, 'Offer a new trip to the nearest available driver for 15 seconds', 'Before: every request went to 4 drivers at once and the first to accept took it.', 'feature', ARRAY['backend'], 'p0', 'm', 'done', bap, '2026-09-28', '2026-09-28', '2026-10-11', ARRAY['Only the nearest available driver sees the offer for the first 15 seconds']),
    (m_disp, 'If not accepted, offer it to the second-nearest driver for 15 seconds', NULL, 'feature', ARRAY['backend'], 'p0', 's', 'done', bap, '2026-09-28', '2026-09-30', '2026-10-11', ARRAY['After 15 s (or a decline) the second-nearest driver gets it alone for 15 s']),
    (m_disp, 'Then offer it to the next 4 nearest drivers at once (not the first two)', NULL, 'feature', ARRAY['backend'], 'p0', 's', 'done', bap, '2026-09-28', '2026-10-01', '2026-10-11', ARRAY['The first two drivers are excluded', 'The first of the 4 to accept gets the trip']),
    (m_disp, 'Driver app: trip offer with a 15-second countdown', NULL, 'feature', ARRAY['app_driver'], 'p0', 's', 'done', bap, '2026-09-28', '2026-10-02', '2026-10-11', ARRAY['The driver sees the countdown and can accept or decline']),
    (m_disp, 'Move on at once when a driver declines or goes offline; only one driver can win', NULL, 'feature', ARRAY['backend'], 'p0', 's', 'done', bap, '2026-09-28', '2026-10-05', '2026-10-11', ARRAY['A decline or going offline skips the rest of the 15 s', 'Two drivers can never both get the same trip']);

  -- Infra 1 + 2 (CTO).
  INSERT INTO plan_issues (ms, title, description, type, areas, priority, size, status, who, criteria) VALUES
    (m_inf1, 'Decide the DigitalOcean setup and its monthly cost', 'Managed PostgreSQL, app hosting for the API and background jobs, file storage. Compare with what Render costs today.', 'research', ARRAY['infra'], 'p1', 's', 'backlog', cto, ARRAY['A one-page setup with sizes and monthly cost, approved by the MD']),
    (m_inf1, 'Create a staging environment on DigitalOcean that mirrors production', NULL, 'chore', ARRAY['infra', 'backend'], 'p1', 'm', 'backlog', cto, ARRAY['The API and database run on staging with test data', 'The apps can point to staging for testing']),
    (m_inf1, 'Managed database with automatic daily backups and point-in-time recovery', NULL, 'feature', ARRAY['infra'], 'p0', 's', 'backlog', cto, ARRAY['Backups run every day and are kept for at least 7 days', 'We can restore to any minute of the last week']),
    (m_inf1, 'Restore drill: restore a backup into staging and check the data', 'A backup we have never restored is not a backup.', 'chore', ARRAY['infra', 'testing'], 'p0', 's', 'backlog', cto, ARRAY['A backup is restored and the trip, driver and payment counts match', 'The steps and time taken are written down']),
    (m_inf1, 'Security baseline: private network, firewall, least-privilege database users, SSL, rotated secrets', NULL, 'feature', ARRAY['security', 'infra'], 'p0', 'm', 'backlog', cto, ARRAY['The database is not reachable from the internet', 'The API uses its own limited database user', 'All old keys are rotated']),
    (m_inf1, 'Monitoring and alerts: uptime, CPU, memory, database, linked to Sentry', NULL, 'feature', ARRAY['infra'], 'p1', 's', 'backlog', cto, ARRAY['IT is alerted within 5 minutes when the API is down or the database is full']),
    (m_inf2, 'Rehearse the database move on staging and time it', NULL, 'chore', ARRAY['infra', 'testing'], 'p0', 's', 'backlog', cto, ARRAY['The full move is done once on staging', 'We know how long riders would be affected']),
    (m_inf2, 'Move the database and the API in a quiet-hour window', NULL, 'chore', ARRAY['infra', 'backend'], 'p0', 'm', 'backlog', cto, ARRAY['Riders and drivers are told in advance', 'Trips and payments work right after the move']),
    (m_inf2, 'Switch DNS and SSL, with a tested rollback to Render', NULL, 'chore', ARRAY['infra'], 'p0', 's', 'backlog', cto, ARRAY['We can go back to Render within 15 minutes if something breaks']),
    (m_inf2, 'Shut down Render after 2 stable weeks', NULL, 'chore', ARRAY['infra'], 'p2', 'xs', 'backlog', cto, ARRAY['Render services and billing are stopped', 'A final backup from Render is kept']),
    (m_inf2, 'Write the runbook: deploy, restore a backup, roll back', NULL, 'chore', ARRAY['infra'], 'p1', 's', 'backlog', cto, ARRAY['Someone other than the CTO can follow it and succeed']);

  -- Voice agent (CTO).
  INSERT INTO plan_issues (ms, title, description, type, areas, priority, size, status, who, criteria) VALUES
    (m_v1, 'Define what the voice agent must do and how we measure it', 'Booking success rate, calls handled without a human, understanding accuracy, call length, rider satisfaction.', 'research', ARRAY['data_ai'], 'p1', 's', 'backlog', cto, ARRAY['Targets agreed with the MD and written on the project page']),
    (m_v1, 'Choose the speech stack for Kinyarwanda (speech-to-text, text-to-speech, language model)', 'Test at least 3 options on real Kinyarwanda audio; compare accuracy, speed and cost per call.', 'research', ARRAY['data_ai'], 'p0', 'm', 'backlog', cto, ARRAY['A comparison table with accuracy, speed and cost', 'The chosen option is recorded as a decision']),
    (m_v1, 'Collect Kinyarwanda test recordings of booking calls, with consent', NULL, 'chore', ARRAY['data_ai'], 'p1', 'm', 'backlog', cto, ARRAY['At least 100 transcribed booking calls, with callers'' consent', 'Names and phone numbers removed']),
    (m_v1, 'Design the booking conversation in Kinyarwanda', 'Greeting, pickup, destination, time, fare, confirmation - short, natural and polite.', 'feature', ARRAY['data_ai', 'design'], 'p1', 'm', 'backlog', cto, ARRAY['Reviewed by Call Center agents who speak to riders every day']),
    (m_v1, 'Understand Kigali places: landmarks, neighbourhoods and the names people use', NULL, 'feature', ARRAY['data_ai', 'backend'], 'p1', 'm', 'backlog', cto, ARRAY['The agent turns "near Kimironko market" into the right pickup point']),
    (m_v1, 'Connect the agent to booking: fare estimate, create the trip, confirm', NULL, 'feature', ARRAY['backend', 'data_ai'], 'p0', 'm', 'backlog', cto, ARRAY['A call ends with a real trip in the system and an SMS confirmation']),
    (m_v1, 'Phone line: riders call a number and talk to the agent', NULL, 'feature', ARRAY['infra', 'backend'], 'p0', 'm', 'backlog', cto, ARRAY['A Rwandan number answers 24/7']),
    (m_v1, 'Hand over to a Call Center agent when unsure or when the rider asks', NULL, 'feature', ARRAY['backend', 'dashboard'], 'p0', 's', 'backlog', cto, ARRAY['The agent passes what it already knows so the rider does not repeat it']),
    (m_v1, 'Test with 30 real Kinyarwanda calls', NULL, 'chore', ARRAY['testing', 'data_ai'], 'p0', 's', 'backlog', cto, ARRAY['At least 80% of calls end in a correct booking without human help']),
    (m_v2, 'English conversation and voice', NULL, 'feature', ARRAY['data_ai'], 'p1', 'm', 'backlog', cto, ARRAY['Same targets as Kinyarwanda']),
    (m_v2, 'French conversation and voice', NULL, 'feature', ARRAY['data_ai'], 'p1', 'm', 'backlog', cto, ARRAY['Same targets as Kinyarwanda']),
    (m_v2, 'Detect the caller''s language and switch mid-call', NULL, 'feature', ARRAY['data_ai'], 'p1', 'm', 'backlog', cto, ARRAY['A caller mixing Kinyarwanda and French is still understood']),
    (m_v2, 'Check, change or cancel a booking by voice', NULL, 'feature', ARRAY['data_ai', 'backend'], 'p2', 'm', 'backlog', cto, ARRAY['A rider can ask "where is my driver?" and get the answer']),
    (m_v2, 'Test with 20 calls in English and 20 in French', NULL, 'chore', ARRAY['testing'], 'p1', 's', 'backlog', cto, ARRAY['At least 80% correct bookings without help in each language']),
    (m_v3, 'Kiswahili conversation and voice', NULL, 'feature', ARRAY['data_ai'], 'p2', 'm', 'backlog', cto, ARRAY['Same targets as the other languages']),
    (m_v3, 'Handle noisy calls and mixed languages', 'Traffic and moto noise, mixed Kinyarwanda/French/English, different accents.', 'improvement', ARRAY['data_ai'], 'p2', 'm', 'backlog', cto, ARRAY['Accuracy on noisy test calls is within 10% of quiet calls']),
    (m_v3, 'Voice agent dashboard in Kivu Daily: calls, bookings, failures, languages', NULL, 'feature', ARRAY['dashboard', 'data_ai'], 'p2', 'm', 'backlog', cto, ARRAY['The MD sees daily calls, bookings and handovers per language']),
    (m_v3, 'Learn from failed calls: weekly review and fixes', NULL, 'improvement', ARRAY['data_ai'], 'p2', 's', 'backlog', cto, ARRAY['Failed calls are reviewed weekly and the top causes fixed']),
    (m_v3, 'Test with 20 Kiswahili calls', NULL, 'chore', ARRAY['testing'], 'p2', 's', 'backlog', cto, ARRAY['At least 80% correct bookings without help']);

  -- Design (Janviere).
  INSERT INTO plan_issues (ms, title, description, type, areas, priority, size, status, who, criteria) VALUES
    (m_d1, 'Audit every rider and driver screen: steps per task, with screenshots', NULL, 'research', ARRAY['design', 'app_core'], 'p1', 'm', 'backlog', jan, ARRAY['A map of every screen and how many taps each task takes today']),
    (m_d1, 'Book a ride in 3 taps or fewer after opening the app', NULL, 'improvement', ARRAY['design', 'app_rider'], 'p0', 'm', 'backlog', jan, ARRAY['From opening the app to a confirmed booking in 3 taps or fewer for a usual trip']),
    (m_d1, 'Simpler sign-up and login', NULL, 'improvement', ARRAY['design', 'app_core'], 'p1', 's', 'backlog', jan, ARRAY['A new rider is ready to book in under a minute']),
    (m_d1, 'Clear payment choice: cash, Mobile Money, card', NULL, 'improvement', ARRAY['design', 'app_rider'], 'p1', 's', 'backlog', jan, ARRAY['The chosen payment method is always visible before confirming']),
    (m_d1, 'One design system: colours, fonts, buttons and components', NULL, 'feature', ARRAY['design'], 'p1', 'm', 'backlog', jan, ARRAY['All new screens use the shared components']),
    (m_d2, 'Driver trip flow with the fewest taps: accept, pickup, start, finish', NULL, 'improvement', ARRAY['design', 'app_driver'], 'p0', 'm', 'backlog', jan, ARRAY['Big, clear buttons a driver can use safely at a glance']),
    (m_d2, 'Every screen translated: Kinyarwanda, English, French', NULL, 'improvement', ARRAY['app_core', 'design'], 'p0', 'm', 'backlog', jan, ARRAY['No missing or English-only text on any screen in any language']),
    (m_d2, 'Readable for everyone: text size, contrast and tap targets', NULL, 'improvement', ARRAY['design'], 'p2', 's', 'backlog', jan, ARRAY['Text and buttons meet basic accessibility contrast and size']),
    (m_d2, 'Test with 5 riders and 5 drivers; fix what confuses them', NULL, 'chore', ARRAY['testing', 'design'], 'p1', 's', 'backlog', jan, ARRAY['Findings written down and the top ones fixed']),
    (m_d2, 'Hand the final designs to development with specs', NULL, 'chore', ARRAY['design'], 'p1', 's', 'backlog', jan, ARRAY['Baptiste has every screen, state and text needed to build it']);

  INSERT INTO it_issues (title, description, type, areas, priority, size, status, assignee_id, milestone_id, source, planned, acceptance_criteria, created_by, created_at, started_at, completed_at)
  SELECT title, description, type, areas, priority, size, status, who, ms, 'md', true,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('text', c, 'done', status = 'done')) FROM unnest(criteria) c), '[]'::jsonb),
         md, COALESCE(created, now()), started, done
  FROM plan_issues ORDER BY ord;

  -- Finished milestones: they were in the milestone from the start.
  UPDATE it_issues SET milestone_added_at = created_at WHERE milestone_id IN (m_mvp, m_pay, m_disp);

  -- The three payment issues already on the board: done (confirmed by the MD today).
  UPDATE it_issues SET milestone_id = m_pay, status = 'done' WHERE id IN (122, 123, 124) AND status <> 'done';
  UPDATE it_issues SET milestone_id = m_pay WHERE id IN (122, 123, 124);

  -- Follow-ups for dispatch, not planned in a milestone yet.
  INSERT INTO it_issues (title, description, type, areas, priority, size, status, source, planned, acceptance_criteria, created_by) VALUES
    ('Log every dispatch offer: who, when, accepted, declined or expired', 'So we can see how the new dispatch performs (Health page) and tune the 15 seconds.', 'improvement', ARRAY['backend', 'data_ai'], 'p2', 's', 'backlog', 'md', true, '[{"text": "Each offer is stored with the driver, distance and outcome", "done": false}]', md),
    ('When nobody accepts: tell the rider and alert the Call Center for manual dispatch', NULL, 'feature', ARRAY['backend', 'dashboard'], 'p1', 's', 'backlog', 'md', true, '[{"text": "The rider is never left waiting without an answer", "done": false}, {"text": "The Call Center sees the trip at once", "done": false}]', md),
    ('Make the dispatch timings and number of drivers adjustable in admin', NULL, 'improvement', ARRAY['admin', 'backend'], 'p3', 's', 'backlog', 'md', true, '[{"text": "15 s and 4 drivers can be changed without a release", "done": false}]', md);
END $$;
