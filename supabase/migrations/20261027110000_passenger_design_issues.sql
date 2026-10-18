/*
# Passenger app: the new design, screen by screen, for Janviere (MD, 18 Oct 2026)

Design: https://kivu-ride-future-passenger.cheekyflame256.chatgpt.site/
14 screens with developer handoff notes. One issue per screen plus the
shared design system, in Janviere's design milestones:
  M10 Design 1 (19 Oct - 1 Nov): design system + 01 Launch ... 07 Choose ride
  M11 Design 2 (2 - 15 Nov):     08 Finding driver ... 14 Menu & account
*/
DO $$
DECLARE
  md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
  jan uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Uwera Janviere%' LIMIT 1);
  m1 uuid := (SELECT id FROM it_milestones WHERE name = 'Design 1: fewer steps to book');
  m2 uuid := (SELECT id FROM it_milestones WHERE name = 'Design 2: driver flow, translations, testing');
  link text := 'Design: https://kivu-ride-future-passenger.cheekyflame256.chatgpt.site/ — ';
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM it_issues WHERE title LIKE 'Passenger app — 01 Launch%') THEN RETURN; END IF;
  CREATE TEMP TABLE pd (ord int, ms text, title text, size text, areas text[], body text, criteria text[]) ON COMMIT DROP;
  INSERT INTO pd VALUES
    (0, 'm1', 'Passenger app — design system: colours, type, components', 'm', ARRAY['design', 'app_core'],
     'The shared base for all 14 screens: Midnight, Kivu Mint, Lake Mist and Warm Gold; one primary action per screen; consistent inputs (55 px, 17 px radius, persistent labels, Mint focus ring), 48 px rows and tap targets, bottom sheets with 28 px top corners.',
     ARRAY['Colour and spacing tokens in one place, used by every screen', 'Reusable button, input, menu-row, bottom-sheet and status-card components', 'Reduced-motion and accessibility labels handled in the components']),
    (1, 'm1', 'Passenger app — 01 Launch screen', 's', ARRAY['design', 'app_rider'],
     'Wordless branded motion while the app starts: the Kivu symbol assembles in three timed segments (one incomplete rounded square, one circle orbit with a moving signal point), then replaces itself with Welcome after ~2.6 s or when start-up work is done. No text, no button. Reduced motion = short fade.',
     ARRAY['Moves to Welcome automatically and is not left in back history', 'Short opacity fade when reduced motion is on']),
    (2, 'm1', 'Passenger app — 02 Welcome', 's', ARRAY['design', 'app_rider'],
     'One dominant "Continue as a passenger" action (at least 56 px tall) on a full-height dark canvas with an animated horizon and light logo. Driver access stays quiet: revealed by swipe-up or tap, never as prominent as the passenger action. Mode and language indicators.',
     ARRAY['Continue opens Sign in at once', 'Driver access opens by gesture and by tap (accessible chevron)', 'Driver sign-in stays disconnected in this phase']),
    (3, 'm1', 'Passenger app — 03 Sign in', 's', ARRAY['design', 'app_rider', 'app_core'],
     'Phone/email and password, password recovery, social sign-in alternatives. Inline errors; a valid field is never cleared after an error; the keyboard never covers the submit button. New users go to Create account.',
     ARRAY['Required fields validated with inline errors', 'Success opens Home map', 'Keyboard never hides the submit button']),
    (4, 'm1', 'Passenger app — 04 Create account', 'm', ARRAY['design', 'app_rider', 'app_core'],
     'Minimal: name and phone number, consent, then OTP verification, then Home map. Link back for existing accounts. Legal text readable; optional marketing consent never pre-checked.',
     ARRAY['Phone formatted and checked for an existing account on the server', 'OTP verification before entering Home', 'Marketing consent is never pre-ticked']),
    (5, 'm1', 'Passenger app — 05 Home map', 'm', ARRAY['design', 'app_rider'],
     'Map-first home: current location, destination search, saved Home and Work, menu and profile. Floating light controls with 17 px edge margins and safe-area padding.',
     ARRAY['Destination search opens Set destination', 'Saved places fill the destination', 'Location permission asked in context, not at launch']),
    (6, 'm1', 'Passenger app — 06 Set destination', 'm', ARRAY['design', 'app_rider'],
     'Connected pickup/destination rail; Now / add stop / rider controls; suggested and recent places (title + address, 48 px rows). Choosing a destination goes straight to Choose ride — no separate route-confirmation screen.',
     ARRAY['Search is debounced and shows title and secondary address', 'Selecting a place opens Choose ride directly (one step fewer)']),
    (7, 'm1', 'Passenger app — 07 Choose ride', 'm', ARRAY['design', 'app_rider'],
     'Route over the map with a bottom sheet comparing Kivu Eco and Comfort: fare, ETA, payment method preview. The selected option has a 1 px Mint border and 8% Mint fill — never colour alone. Booking starts driver matching.',
     ARRAY['Selecting a class updates styling, price and the button', 'The fare on the button comes from the selected class data', 'Book starts matching']),
    (8, 'm2', 'Passenger app — 08 Finding driver', 's', ARRAY['design', 'app_rider'],
     'Animated radar (2.4 s linear) with a clear matching message and the ride, payment and fare summary. Cancel — with a light confirmation if a driver has already accepted. Status changes announced for screen readers.',
     ARRAY['Matching resolves to Driver assigned', 'Cancel is confirmed once a driver accepted', 'Reduced-motion fallback for the radar']),
    (9, 'm2', 'Passenger app — 09 Driver assigned (pickup code)', 'm', ARRAY['design', 'app_rider', 'backend'],
     'Driver ETA on a live map, driver identity, rating and call, car model and plate, and a four-digit pickup code. The passenger gives the code to the driver; there is no "Start trip" button — the trip moves to Trip underway only when the driver validates the code. Needs the backend to support the pickup code.',
     ARRAY['Driver, car, ETA and code come from live trip data', 'No passenger start button', 'Moves to Trip underway only after the driver confirms the code']),
    (10, 'm2', 'Passenger app — 10 Trip underway (with SOS)', 'm', ARRAY['design', 'app_rider', 'security'],
     'Destination and remaining time, driver and car, distance, ETA and progress timeline, and a contained SOS control (1 px danger border, soft 8% fill, 16 px radius, 52 px tap target). SOS opens a safety confirmation sheet — one accidental tap never calls emergency services.',
     ARRAY['Route, ETA and progress update from live location (throttled)', 'SOS first opens a sheet; the emergency action needs a hold or second confirmation', 'Arrival is triggered by the driver/backend']),
    (11, 'm2', 'Passenger app — 11 Arrived', 's', ARRAY['design', 'app_rider'],
     'Arrival confirmation with distance, duration and CO₂ saved, total fare and unpaid status (Warm Gold only for unpaid). "Complete & pay" opens Payment. No rating prompt before payment is resolved.',
     ARRAY['Fare comes from the completed-trip record, never calculated in the screen', 'Complete & pay passes the trip and amount to Payment']),
    (12, 'm2', 'Passenger app — 12 Payment (MoMo, card, cash)', 'm', ARRAY['design', 'app_rider', 'backend'],
     'Exact order: MoMo (selected by default), Cards, Cash. The main button changes with the method: MoMo sends a secure prompt, card opens card processing, cash records pay-to-driver. Pending, success and failure are clear states; double submission impossible.',
     ARRAY['Order is MoMo, Card, Cash with MoMo preselected', 'Button disabled while processing', 'Pending, success and failure states all designed and handled']),
    (13, 'm2', 'Passenger app — 13 Payment confirmed', 's', ARRAY['design', 'app_rider'],
     'Strong success state with amount, method, trip, driver and route summary and one Done action (to Menu & account). Shown only after a verified payment event — never for a pending or failed payment. Keeps the transaction id for receipts.',
     ARRAY['Rendered only after a verified payment', 'Done opens Menu & account', 'Trip and transaction ids kept for receipts and support']),
    (14, 'm2', 'Passenger app — 14 Menu & account', 's', ARRAY['design', 'app_rider'],
     'Verified profile, trips and receipts, payments and wallet, smart/corporate and family profiles, 24/7 support on 6023. Reusable 48 px rows (icon, label, chevron), ready for translation (no fixed text widths). Back to map keeps the session.',
     ARRAY['Every row opens its area', 'Rows built from one reusable component', 'Texts can grow for Kinyarwanda and French without breaking']);

  FOR r IN SELECT * FROM pd ORDER BY ord LOOP
    INSERT INTO it_issues (title, description, type, areas, priority, size, status, assignee_id, milestone_id, source, planned, labels, acceptance_criteria, created_by)
    VALUES (r.title, link || r.body, 'feature', r.areas, CASE WHEN r.ord IN (0, 5, 6, 7, 12) THEN 'p1' ELSE 'p2' END, r.size, 'backlog', jan,
      CASE r.ms WHEN 'm1' THEN m1 ELSE m2 END, 'md', true, ARRAY['passenger-redesign'],
      (SELECT jsonb_agg(jsonb_build_object('text', c, 'done', false)) FROM unnest(r.criteria) c), md);
  END LOOP;
END $$;
