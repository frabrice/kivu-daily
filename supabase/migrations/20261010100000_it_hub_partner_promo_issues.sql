/*
# IT Hub: Partner Promo, Analytics and EV Reporting

The MD's 18 issues (pasted 10 Oct 2026) plus 3 new ones, created as one IT
Hub product for IT (Imanariyo Baptiste). Issue text and acceptance criteria
are kept as written, except where the MD's decisions of 10 Oct 2026 change
them; those changes and additions are marked "(Decision 10 Oct)" or
"(Added in review)".

Decisions confirmed by the MD on 10 Oct 2026:
1. The discount applies to the ride-fare subtotal only.
2. Nobody funds the discount: the passenger pays the discounted fare and the
   driver receives that amount ("drivers take what they take"). No funding
   party, no funding split, no partner invoicing for discounts.
3. Institutional codes are restricted by default (verified against the
   partner's approved phone list); a campaign can be marked open/public
   (events, hotels).
4. A partner code cannot be combined with any other promotion.
5. Partners see aggregated information only.
6. The Rwanda grid emission-factor source is proposed by Kivu Ride (IT/MD)
   and approved by the MD.
7. Version 1 uses estimated electricity consumption.
8. Report approval: account manager -> Finance (Rodrigue) -> MD.
Also: every car on the platform (our fleet and Non-Insider) is electric.
No driver-app display is built for now.

Safe to run more than once: nothing is created if the product exists.
*/

CREATE OR REPLACE FUNCTION pg_temp.ac(items text[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('text', t, 'done', false) ORDER BY o), '[]'::jsonb)
  FROM unnest(items) WITH ORDINALITY AS u(t, o);
$$;

DO $$
DECLARE
  v_product uuid;
  v_it uuid := (SELECT id FROM profiles WHERE full_name ILIKE 'Imanariyo Baptiste%' AND is_active ORDER BY created_at LIMIT 1);
  v_md uuid := (SELECT id FROM profiles WHERE role = 'managing_director' AND is_active ORDER BY created_at LIMIT 1);
  m0 uuid; m1 uuid; m2 uuid; m3 uuid;
  f_data uuid; f_codes uuid; f_booking uuid; f_reporting uuid; f_ev uuid; f_reports uuid; f_portal uuid; f_trust uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE name = 'Partner Promo & EV Reporting') THEN
    RAISE NOTICE 'Already created';
    RETURN;
  END IF;

  INSERT INTO products (name, description) VALUES ('Partner Promo & EV Reporting',
    'Institutional partners, promo codes and discounts, partner trip attribution, partner analytics and monthly reports covering mobility, finance, service quality, operations and estimated EV impact. '
    || 'Decisions (MD, 10 Oct 2026): discount on ride fare only; nobody funds the discount - the driver receives the discounted fare; codes restricted by verified phone list by default (public option); no combining with other promotions; partners see aggregated data only; grid emission-factor source proposed by Kivu Ride and approved by the MD; v1 uses estimated electricity; reports approved by account manager -> Finance -> MD. Every car on the platform is electric. No driver-app display for now.')
  RETURNING id INTO v_product;

  INSERT INTO milestones (product_id, name, description) VALUES (v_product, 'Phase 0 - Foundations', 'The data the rest depends on: trips flowing from the ride platform, and vehicle energy data.') RETURNING id INTO m0;
  INSERT INTO milestones (product_id, name, description) VALUES (v_product, 'Phase 1 - Pilot-ready core', 'Partners, promo codes, booking validation, discounts, trip attribution, the reporting dataset and the staff dashboard.') RETURNING id INTO m1;
  INSERT INTO milestones (product_id, name, description) VALUES (v_product, 'Phase 2 - EV impact and monthly reports', 'Carbon methodology, EV impact results, the monthly report, its approval workflow and delivery.') RETURNING id INTO m2;
  INSERT INTO milestones (product_id, name, description) VALUES (v_product, 'Phase 3 - Partner portal, analytics and launch', 'Secure partner access, full analytics, audit and privacy controls, migration, testing and the one-partner pilot.') RETURNING id INTO m3;

  INSERT INTO features (milestone_id, name, description) VALUES (m0, 'Platform data for reporting', 'Trip feed from the ride platform and vehicle energy data.') RETURNING id INTO f_data;
  INSERT INTO features (milestone_id, name, description) VALUES (m1, 'Partners and promo codes', 'Partner records, campaigns, discount rules and misuse controls.') RETURNING id INTO f_codes;
  INSERT INTO features (milestone_id, name, description) VALUES (m1, 'Booking and discount', 'Code validation on every booking channel, discount calculation and permanent trip attribution.') RETURNING id INTO f_booking;
  INSERT INTO features (milestone_id, name, description) VALUES (m1, 'Reporting data and staff dashboard', 'One governed reporting dataset and the partner overview dashboard.') RETURNING id INTO f_reporting;
  INSERT INTO features (milestone_id, name, description) VALUES (m2, 'EV impact', 'Versioned carbon methodology and trip-level / monthly impact results.') RETURNING id INTO f_ev;
  INSERT INTO features (milestone_id, name, description) VALUES (m2, 'Monthly partner reports', 'Report design, generation and approval, delivery and history.') RETURNING id INTO f_reports;
  INSERT INTO features (milestone_id, name, description) VALUES (m3, 'Partner portal and analytics', 'Secure partner access and full analytics.') RETURNING id INTO f_portal;
  INSERT INTO features (milestone_id, name, description) VALUES (m3, 'Trust, migration and launch', 'Audit trails and privacy, migration of existing partners, testing and pilot.') RETURNING id INTO f_trust;

  -- ================================================================ Phase 0
  INSERT INTO user_stories (feature_id, product_id, title, persona, need, benefit, details, acceptance_criteria, priority, assignee_id, source, created_by) VALUES
  (f_data, v_product, '19. Feed completed trips from the ride platform into the reporting store (new)',
   'Kivu Ride reporting administrator',
   'every booked, completed, cancelled and refunded trip delivered automatically from the ride platform to the reporting store',
   'the partner dashboard, finance totals, EV impact and monthly reports have complete and current trip data without manual exports',
   $d$(Added in review) Bookings, fares and trips live in the ride platform (passenger app, operations dashboard, backend on Render). The reporting work in issues 7-16 needs that data. This issue builds the feed.

Each trip record should carry: trip ID, booking channel, booking/confirmation/completion/cancellation times, status, partner and campaign attribution, promo code, discount rate and amount, original eligible fare, excluded charges, final amount payable, payment method, refund amounts, vehicle ID and model, driver ID, distance, pickup and destination zones (aggregated, not exact addresses), arrival time and rating.

Changes after completion (refunds, attribution corrections, repricing) must flow as updates, not as new trips.$d$,
   pg_temp.ac(ARRAY[
     'Every trip completed, cancelled or refunded on the platform reaches the reporting store automatically.',
     'The feed is idempotent: sending the same trip twice updates it and never creates a duplicate.',
     'Later changes (refunds, corrections, repricing) update the stored trip and keep a record of the change.',
     'Times are stored in UTC and reported in Africa/Kigali; a trip belongs to the month of its completion time in Kigali.',
     'Exact routes and full addresses are not copied into the reporting store; pickup and destination are stored as zones.',
     'Feed failures and delays are visible to administrators with the time of the last successful sync.',
     'The feed is authenticated and only the platform backend can write to it.'
   ]), 'high', v_it, 'manual', v_md),

  (f_data, v_product, '20. Record vehicle model and energy data for every car (new)',
   'Kivu Ride sustainability or reporting administrator',
   'every car on the platform recorded with its make, model and rated energy consumption',
   'electricity use and avoided emissions can be estimated per trip using the right figures for each vehicle',
   $d$(Added in review) Every car on the platform, our own fleet and Non-Insider cars, is electric (MD, 10 Oct 2026). Version 1 estimates electricity from distance (decision 7), so each car needs its model's rated consumption (kWh/km) from a documented source such as the manufacturer specification.

Each vehicle should have: plate, make, model, model year where known, powertrain (electric), rated kWh/km, source of that figure, and the comparable petrol vehicle class used for the baseline (issue 10).$d$,
   pg_temp.ac(ARRAY[
     'Every vehicle on the platform has make, model and powertrain recorded.',
     'Each vehicle model has a rated kWh/km value with its source and the date it was recorded.',
     'Each vehicle model is mapped to an approved comparable petrol vehicle class for the baseline.',
     'A vehicle without approved energy data is flagged, and its trips are shown as "energy data missing", not as zero.',
     'If a vehicle is ever not electric, its trips are flagged and excluded from EV impact results.',
     'Changes to a model''s energy values are versioned and do not change published reports.'
   ]), 'high', v_it, 'manual', v_md);

  -- ================================================================ Phase 1
  INSERT INTO user_stories (feature_id, product_id, title, persona, need, benefit, details, acceptance_criteria, priority, assignee_id, source, created_by) VALUES
  (f_codes, v_product, '1. Create and manage institutional partners',
   'Kivu Ride administrator',
   'to create and manage institutional partner accounts',
   'every partner''s promo codes, trips, discounts, contacts, analytics, and reports can be managed from one place',
   $d$The admin dashboard should have a partner-management section where authorized employees can create a new partner and maintain its information.

Each partner should have:
- Partner name and legal name
- Partner type, such as company, NGO, government institution, hotel, school, event organizer, or family account
- Partner logo for dashboards and branded reports
- Primary contact and finance contact
- Telephone numbers and email addresses
- Contract start date and end date
- Account manager responsible for the partner
- Reporting recipients and preferred reporting schedule
- Status: draft, active, suspended, expired, or archived
- Internal notes

A partner may have different promo campaigns over time, but its historical trips and reports must remain connected to the same partner record.$d$,
   pg_temp.ac(ARRAY[
     'An authorized administrator can create, view, edit, suspend, reactivate, and archive a partner.',
     'A partner can be saved as a draft before its promo code becomes active.',
     'Required fields are validated before activation.',
     'An expired, suspended, or archived partner cannot receive new promo-code trips.',
     'Editing a partner does not change its historical completed trips or published reports.',
     'All important changes record who made the change and when it was made.'
   ]), 'high', v_it, 'manual', v_md),

  (f_codes, v_product, '2. Create and manage partner promo codes and discounts',
   'Kivu Ride administrator',
   'to assign a promo code and discount percentage to a partner',
   'eligible passengers can receive the partner''s approved discount and their trips can be recorded under that partner',
   $d$When creating or editing a partner campaign, the administrator should be able to configure:
- Promo code
- Discount percentage, such as 5%
- Campaign start date and end date
- Optional maximum discount per trip
- Optional campaign budget (the total discount the campaign may give)
- Optional total redemption limit
- Optional limit per passenger, day, or month
- Eligible service types
- Open (public) or restricted code; restricted is the default (Decision 10 Oct)
- Whether membership verification is required

(Decision 10 Oct) Nobody funds the discount: the passenger pays the discounted fare and the driver receives that amount. The funding-party and partner-funding-percentage settings from the original issue are not built.

Promo codes should be case-insensitive. For example, KIVUPARTNER, kivupartner, and KivuPartner must be treated as the same code.

Changing the discount from 5% to another percentage must affect only new eligible trips. Historical trips must retain the discount rate that was applied when they were booked and completed.$d$,
   pg_temp.ac(ARRAY[
     'An administrator can create, edit, activate, suspend, and expire a promo code.',
     'The system does not allow two active promo codes with the same code, regardless of capitalization or spaces.',
     'The discount percentage must be greater than 0% and within the maximum percentage approved by Kivu Ride.',
     'The campaign end date cannot be earlier than its start date.',
     'A suspended, expired, exhausted, or not-yet-active code cannot be used for a new booking.',
     'Historical trips keep their original promo code, discount rate, and discount amount.',
     '(Decision 10 Oct) The campaign records that the discount is not funded by Kivu Ride or the partner: the driver receives the discounted fare. Finance reports show discount given, not a funding split.',
     '(Decision 10 Oct) Only one partner promo code can be used per trip, and it cannot be combined with any other promotion.',
     '(Added in review) The maximum approved discount percentage is a single Kivu Ride setting that only the MD can change.'
   ]), 'high', v_it, 'manual', v_md),

  (f_codes, v_product, '6. Control promo-code eligibility and misuse',
   'Kivu Ride administrator',
   'controls that restrict and monitor partner promo-code usage',
   'discounts are used only by eligible passengers and campaign abuse is reduced',
   $d$Some partner codes may be public, while others may be limited to employees, members, invited guests, or approved telephone numbers.

(Decision 10 Oct) Institutional codes are restricted by default, verified against the partner's approved telephone-number list. A campaign can be marked open (public), for example for events or hotels.

The system should support optional verification through approved telephone-number lists, email domains, employee or member IDs, partner account membership, or a separate PIN. It should also monitor repeated failed attempts, unusual redemption frequency, and suspicious use across accounts.$d$,
   pg_temp.ac(ARRAY[
     'Kivu Ride can configure whether a promo code is open or restricted.',
     'Restricted codes are accepted only for verified eligible passengers.',
     'Per-passenger, daily, monthly, campaign, and budget limits are enforced.',
     'Promo-code validation requests are rate limited.',
     'Administrators can suspend a compromised code immediately without deleting historical usage.',
     'Suspicious activity appears in an abuse-review list with a reason.',
     'Overrides require an authorized role and a written reason.',
     'The system does not reveal whether another person belongs to a partner organization.',
     '(Decision 10 Oct) New restricted codes default to verification by the partner''s approved telephone-number list.',
     '(Added in review) A partner''s phone list is uploaded only after a data-sharing agreement with that partner is recorded, and is used only for code verification.'
   ]), 'high', v_it, 'manual', v_md),

  (f_booking, v_product, '3. Validate the promo code during booking',
   'passenger or call-centre agent',
   'to enter a partner promo code during booking',
   'the system can confirm eligibility and show the discounted estimated fare before the trip is confirmed',
   $d$The promo-code field should be available on every supported booking channel, including the passenger app, web booking, and call-centre booking (manual dispatch in the operations platform).

(Added in review) A booking API for partners does not exist today; partner API bookings are out of scope for the first release.

When a code is entered, the system should check whether it exists, is active, is within its valid dates, has available budget or redemptions, applies to the selected service, and is available to that passenger.

If the code is valid, the passenger or agent should see the partner name, discount percentage, estimated saving, and estimated final fare.$d$,
   pg_temp.ac(ARRAY[
     'A valid promo code updates the estimated fare before booking confirmation.',
     'Promo-code validation produces the same result across all booking channels.',
     'Invalid, expired, suspended, exhausted, ineligible, and not-yet-active codes display clear and different messages.',
     'Promo codes work regardless of capitalization.',
     'Internal information such as partner budgets and contract terms is not exposed to passengers.',
     'Two passengers trying to use the final available redemption at the same time cannot both exceed the campaign limit.',
     'If validation is unavailable, the system does not provide an unauthorized discount.',
     '(Added in review) A redemption is reserved when the booking is confirmed, counted when the trip completes, and released if the trip is cancelled.',
     '(Added in review) A new booking is refused when the campaign''s remaining budget cannot cover its estimated discount.'
   ]), 'high', v_it, 'manual', v_md),

  (f_booking, v_product, '4. Calculate and apply the partner discount',
   'passenger using a valid partner promo code',
   'the correct discount applied to my eligible fare',
   'I pay the amount agreed between Kivu Ride and the partner',
   $d$The initial discount calculation should be:

Eligible ride-fare subtotal x discount percentage = discount amount

(Decision 10 Oct) The discount applies to the ride-fare subtotal only. Waiting charges, tolls, tips, cancellation fees, and other charges remain outside the discount.

The server should calculate the final discount. The system should record the original eligible fare, discount percentage, final discount, excluded charges, and final amount payable.

(Decision 10 Oct) Nobody funds the discount: the passenger pays the discounted fare and the driver receives that amount. This replaces the original "driver earnings are not reduced" rule. Nothing about the discount is shown in the driver app for now.$d$,
   pg_temp.ac(ARRAY[
     'The discount is calculated from the approved eligible fare.',
     'The final receipt shows the original fare, discount percentage, discount amount, excluded charges, and final amount.',
     'The discount does not produce a negative fare.',
     'An optional maximum discount per trip is respected.',
     '(Decision 10 Oct) The driver receives the discounted fare; no compensation is paid by Kivu Ride or the partner. Kivu Ride''s commission is calculated on the amount the passenger actually pays (to be confirmed by the MD before build).',
     'Repricing the trip recalculates the discount using the campaign terms saved on the booking.',
     'Full and partial refunds reverse the relevant discount and campaign usage correctly.',
     '(Decision 10 Oct) Kivu Ride Finance can reconcile discounts given by partner, campaign, and month.',
     '(Added in review) Amounts are in whole RWF; the discount is rounded to the nearest franc.'
   ]), 'high', v_it, 'manual', v_md),

  (f_booking, v_product, '5. Record every qualifying trip under the correct partner',
   'Kivu Ride partner manager',
   'every eligible trip linked to the correct partner',
   'the dashboard, financial totals, analytics, and monthly reports are complete and accurate',
   $d$A trip may be attributed through a passenger promo code, a code entered by a call-centre agent, an approved partner membership on the passenger account, or an authorized administrative correction.

When a trip is confirmed, the system should save the partner and campaign attribution. When it is completed, the system should save a permanent snapshot containing the partner, campaign, promo code, discount rate, and discount amount.

For the initial release, one trip should have only one primary partner.$d$,
   pg_temp.ac(ARRAY[
     'Every valid partner trip has one primary partner attribution.',
     'Completed trips retain their original attribution and discount information.',
     'Cancelled trips remain available for operational analysis but are not counted as completed trips.',
     'The same trip cannot appear twice in a partner''s totals.',
     'Authorized staff can correct a wrong attribution before the reporting period is locked.',
     'A correction requires a reason and creates an audit record.',
     'A correction made after publication creates a revised report rather than silently changing the existing report.',
     '(Added in review) A trip belongs to the reporting month of its completion time in Africa/Kigali.'
   ]), 'high', v_it, 'manual', v_md),

  (f_booking, v_product, '21. Save the promo code on Call Center booking logs in Kivu Daily (new)',
   'call-centre agent',
   'to record the partner promo code when I log a booking in Kivu Daily',
   'Finance can cross-check Call Center bookings against the promo trips recorded on the ride platform',
   $d$(Added in review) Call Center agents dispatch bookings in the operations platform and log them in Kivu Daily (Calls & Tickets, "Log booking"). The platform applies the discount (issues 3-4); Kivu Daily keeps a copy of the code for reconciliation.$d$,
   pg_temp.ac(ARRAY[
     'The booking log in Kivu Daily has an optional promo-code field.',
     'Codes are saved in one standard form (capitals, no spaces).',
     'The code shows on the booking record and in Call Analytics bookings.',
     'The field does not apply any discount itself; the platform remains the source of truth.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_reporting, v_product, '9. Create one reliable partner reporting dataset',
   'Kivu Ride reporting administrator',
   'one governed source of partner reporting data',
   'dashboard figures, downloads, finance totals, carbon calculations, and PDF reports always agree',
   $d$The reporting dataset should combine settled trips, partner attribution, discounts, payments, refunds, vehicles, energy, distance, passenger information, arrival times, cancellations, ratings, and environmental results. Every metric should have a documented definition, and measured information must be separated from estimates.

It is built on the trip feed (issue 19) and vehicle energy data (issue 20).

(Added in review) Many passengers pay drivers in cash or directly on MoMo, so "settled" needs one definition. Proposed: a completed trip with its final fare recorded counts as settled; card and Kivu-collected MoMo trips settle when the payment is confirmed. To be confirmed by the MD and Finance before build.$d$,
   pg_temp.ac(ARRAY[
     'The dashboard, API, export, and PDF use the same governed data source.',
     'Duplicate trip IDs are rejected or flagged.',
     'Refunds and reversals appear as controlled adjustments.',
     'Finance totals reconcile within an approved tolerance.',
     'Late-arriving data trigger a controlled recalculation or adjustment.',
     'Data refresh failures and incomplete records are visible to administrators.',
     'Reporting periods use the Africa/Kigali timezone.',
     'A reporting period can be locked after approval.',
     '(Added in review) The definition of a settled trip is documented and used by every metric.'
   ]), 'high', v_it, 'manual', v_md),

  (f_reporting, v_product, '7. Create the partner dashboard overview',
   'Kivu Ride account manager or authorized partner representative',
   'a dashboard showing the partner''s activity and results',
   'I can understand usage, spending, service performance, discounts, and environmental impact',
   $d$The dashboard should show completed trips, cancellations, unique passengers, distance, passenger-kilometres where available, gross ride value, discounts given, net passenger payments, average fare, electricity used (estimated), fuel-equivalent avoided, net emissions avoided, ratings, arrival time, and on-time pickup performance.

(Decision 10 Oct) Every car is electric, so there is no EV-versus-combustion filter or EV share. Nobody funds the discount, so there is no funding split.

(Added in review) The staff (Kivu Ride) version is built first in Phase 1. Partner representatives get access through the partner portal (issue 15).$d$,
   pg_temp.ac(ARRAY[
     '(Decision 10 Oct) Users can filter by date, partner, campaign, promo code, trip status, and vehicle model.',
     'All metrics use completed and settled trips unless the metric states otherwise.',
     'Dashboard totals match the approved reporting dataset.',
     'Each metric has a clear definition or tooltip.',
     'The dashboard shows the last data-refresh time.',
     'A partner user can see only their own organization''s information.',
     'Loading, empty, incomplete, and error states are clearly presented.'
   ]), 'high', v_it, 'manual', v_md);

  -- ================================================================ Phase 2
  INSERT INTO user_stories (feature_id, product_id, title, persona, need, benefit, details, acceptance_criteria, priority, assignee_id, source, created_by) VALUES
  (f_ev, v_product, '10. Create and manage the EV carbon-calculation methodology',
   'Kivu Ride sustainability or reporting administrator',
   'an approved and versioned carbon-calculation methodology',
   'partner environmental results are transparent, consistent, traceable, and credible',
   $d$The methodology should use the following calculations:

Baseline fuel litres = comparable trip distance / approved fuel efficiency
Baseline emissions = baseline fuel litres x approved fuel emission factor
EV electricity = measured allocated kWh or distance x approved kWh/km x charging-loss adjustment
EV emissions = EV electricity x approved electricity emission factor
Net avoided emissions = baseline emissions - EV emissions

The system should maintain approved factors for petrol, diesel, Rwanda grid electricity, verified renewable electricity, charging losses, and vehicle efficiency. Every factor must record its value, unit, source, source year, effective dates, approval status, reviewer, and methodology version.

(Decision 10 Oct) Every car on the platform is electric; the baseline is the comparable petrol vehicle class for each model (issue 20). Version 1 uses estimated electricity (distance x rated kWh/km x charging-loss adjustment). The Rwanda grid emission-factor source is proposed by Kivu Ride and approved by the MD.$d$,
   pg_temp.ac(ARRAY[
     'Authorized administrators can create, review, approve, retire, and version calculation factors.',
     'Updating a factor does not change an already published historical report.',
     'Comparable fuel efficiency is selected through an approved vehicle-class rule.',
     'The baseline cannot be changed for one partner simply to produce a better result.',
     'Reports state whether electricity use is measured or estimated.',
     'The treatment of charging losses and empty kilometres is documented.',
     'The methodology is reviewed annually or when an important source changes.',
     'Results are described as estimated avoided emissions, not certified carbon credits or offsets.',
     '(Decision 10 Oct) The Rwanda grid emission factor is used only after the MD approves its source.',
     '(Added in review) Version 1 states how empty kilometres are treated: excluded, or allocated by a documented ratio.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_ev, v_product, '11. Calculate trip-level and monthly EV environmental impact',
   'Kivu Ride institutional partner',
   'the environmental impact of my electric trips calculated',
   'I can understand and report the estimated benefit of choosing electric mobility',
   $d$The system should calculate EV trip kilometres, allocated operational kilometres, electricity consumption, fuel-equivalent avoided, baseline emissions, EV electricity emissions, zero-tailpipe emissions avoided, net operational emissions avoided, reduction percentage, emissions per kilometre, emissions per passenger-kilometre, and cumulative tonnes of CO2e avoided.

Measured charging data should take priority over estimated consumption when reliable charger or vehicle data are available. (Decision 10 Oct) Version 1 uses estimated consumption; measured data can replace it later.

(Decision 10 Oct) Every car is electric, so all partner trips count toward EV impact; there is no separate combustion-vehicle reporting.$d$,
   pg_temp.ac(ARRAY[
     'Calculations use the methodology and factors valid for the reporting period.',
     'Every result can be traced to relevant trips, vehicles, energy information, and factors.',
     'Measured and estimated values are clearly identified.',
     '(Decision 10 Oct) A trip on a vehicle not recorded as electric, or missing energy data, is flagged and excluded from impact results, never counted as zero.',
     'Cancelled, test, duplicate, and fully refunded trips are excluded.',
     'Negative avoided-emissions results are shown honestly and are not changed to zero.',
     'Recalculation creates a new result version.',
     'Automated tests cover missing data, zero distance, refunds, factor changes, and month boundaries.',
     '(Added in review) Passenger-kilometre figures are shown only where the number of passengers was recorded.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_reports, v_product, '12. Design a beautiful monthly partner report',
   'Kivu Ride institutional partner',
   'a professional and visually attractive monthly report',
   'I can understand our activity, present results internally, and use credible information in sustainability and management reporting',
   $d$The report should contain:
1. Branded cover with the partner and Kivu Ride logos
2. Executive impact summary
3. Mobility activity and trends
4. Financial summary and discounts given (Decision 10 Oct: no funding split)
5. Operational service performance
6. Fleet contribution by vehicle model (Decision 10 Oct: all cars are electric)
7. Fuel-equivalent avoided and emissions results
8. Current-month, previous-month, and year-to-date graphs
9. Recommendations for improving service or moving more of the partner's travel to Kivu Ride
10. Methodology, assumptions, exclusions, definitions, and sources
11. Report ID, approval status, methodology version, and revision number

(Decision 10 Oct) Partners see aggregated information only.$d$,
   pg_temp.ac(ARRAY[
     'The report is attractive, readable, print-friendly, and suitable for institutional presentation.',
     'It uses Kivu Ride branding and the partner''s approved logo.',
     'All figures match the approved reporting dataset.',
     'Graphs have correct units, labels, legends, and reporting periods.',
     'Measured, calculated, and estimated values are clearly distinguished.',
     'Missing data are shown as unavailable with an explanation, not as zero.',
     'The report does not describe EV trips as completely zero-carbon.',
     'The report does not imply that avoided emissions are certified carbon credits.',
     'Low-volume reports do not reveal individual passenger behaviour.',
     '(Added in review) Breakdowns with fewer than 5 trips are combined or hidden.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_reports, v_product, '13. Generate and approve monthly partner reports',
   'Kivu Ride account manager',
   'monthly partner reports generated and reviewed through a controlled workflow',
   'only accurate and approved reports are shared with partners',
   $d$The workflow should be:

Reporting period closes -> validation runs -> draft is generated -> account and finance review -> approval -> final PDF publication -> delivery -> archive

(Decision 10 Oct) Approval order: the partner's account manager reviews, then Finance (MUGISHA Rodrigue), then the MD gives final approval.

Before report generation, the system should check for missing charging or energy data, incomplete carbon factors, unreconciled finance totals, missing partner information, and unusual results.$d$,
   pg_temp.ac(ARRAY[
     'An authorized user can generate a report for a selected partner and month.',
     'The system can prepare reports automatically according to each partner''s schedule.',
     'Validation problems are displayed before approval.',
     'Draft reports contain a visible draft label or watermark.',
     'Only authorized approvers can publish a final report.',
     '(Decision 10 Oct) A report is published only after the account manager, Finance and the MD have approved it, in that order.',
     'Every final report receives a unique ID, date, methodology version, and revision number.',
     'A published report cannot be overwritten.',
     'Corrections create a new revision linked to the earlier report.',
     'Report statuses include pending data, draft, under review, approved, delivered, failed, and superseded.',
     'Retrying a failed generation does not create duplicate final reports.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_reports, v_product, '14. Send monthly reports and maintain report history',
   'authorized partner contact',
   'to receive the approved monthly report and access previous reports',
   'my institution has a reliable history of its Kivu Ride usage and impact',
   $d$Kivu Ride administrators should manage report recipients, reporting frequency, delivery date, and delivery status. The email should contain a short monthly summary and either a secure report link or an approved attachment.

(Added in review) Kivu Ride already sends email from updates@kivuride.com through Resend; report delivery can use the same sender.$d$,
   pg_temp.ac(ARRAY[
     'Only approved reports can be delivered automatically.',
     'Authorized administrators can add and remove recipients.',
     'Removing a recipient stops future emails without deleting historical delivery records.',
     'Delivery success, failure, bounce, and retry information is recorded.',
     'Partners can access only their own current and historical reports.',
     'Secure report links expire or require authenticated access.',
     'A superseded report is clearly identified and replaced by the latest approved revision.'
   ]), 'medium', v_it, 'manual', v_md);

  -- ================================================================ Phase 3
  INSERT INTO user_stories (feature_id, product_id, title, persona, need, benefit, details, acceptance_criteria, priority, assignee_id, source, created_by) VALUES
  (f_portal, v_product, '15. Create secure partner portal access',
   'authorized partner representative',
   'secure access to my organization''s dashboard and reports',
   'I can review our performance without seeing another partner''s information',
   $d$The platform should support Kivu Ride administrator, account manager, finance reviewer, sustainability approver, partner administrator, and partner viewer roles.

(Decision 10 Oct) Partners see aggregated information only. Passenger personal information and exact routes stay restricted.

(Added in review) Kivu Daily is the staff-only internal app. Recommended: a separate partner portal (or a strictly separated partner area) so outside users never sign in to the staff app. To be decided before this phase starts. Until a sustainability approver is named, the MD fills that role.$d$,
   pg_temp.ac(ARRAY[
     'Partner users can see only their assigned organization and permitted campaigns.',
     'Direct URL changes cannot expose another partner''s records.',
     'Role permissions control access to financial, trip, personal, export, and report information.',
     'Kivu Ride can disable a partner user immediately.',
     'Login and session controls follow platform security requirements.',
     'Access changes, exports, and report downloads are recorded.',
     'Partner administrators can manage viewers only when Kivu Ride enables that permission.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_portal, v_product, '8. Add partner analytics, graphs, trends, and tables',
   'partner or Kivu Ride account manager',
   'visual analysis of partner activity',
   'I can identify patterns, understand performance, and make better mobility decisions',
   $d$The dashboard should include graphs for trips, spending, discounts, distance, avoided emissions, activity by hour and weekday, aggregated pickup and destination zones, completion, cancellation, ratings, arrival times, promo usage, campaign budgets, and vehicle-model contribution.

(Decision 10 Oct) Every car is electric, so there is no EV-share graph.

Exact passenger routes and locations should not be exposed. Location analysis should use privacy-safe aggregated zones.$d$,
   pg_temp.ac(ARRAY[
     'All graphs follow the active dashboard filters.',
     'Graph totals match the summary cards and exported data.',
     'Every graph has a clear title, units, legend, and reporting period.',
     'Users can download authorized aggregated data in CSV or Excel format.',
     'Maps use aggregated areas and minimum-volume privacy rules.',
     'Graphs identify measured, calculated, and estimated values.',
     'The design is accessible, print-friendly, and usable on desktop and tablet screens.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_trust, v_product, '16. Add audit trails, privacy, and reporting controls',
   'Kivu Ride administrator or auditor',
   'a reliable record of important changes and reporting decisions',
   'financial, operational, and environmental information can be reviewed and trusted',
   $d$The system should record material changes to partners, promo codes, discount rules, trip attribution, carbon factors, reports, approvals, recipients, exports, and downloads. Each record should show the person, date and time, previous value, new value, and reason where required.

(Added in review) Personal data (including partner phone lists for restricted codes) is handled under Rwanda's data protection law.$d$,
   pg_temp.ac(ARRAY[
     'Material changes create an audit event.',
     'Published reports and settled financial records cannot be permanently removed through the normal interface.',
     'Data-retention rules can be configured according to Kivu Ride policy and applicable law.',
     'Personal information is minimized in dashboards, exports, and reports.',
     'Reports disclose the baseline, boundaries, sources, assumptions, exclusions, and calculation version.',
     'Reports explain that avoided emissions are separate from certified carbon credits.',
     'All data exports are permission checked and logged.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_trust, v_product, '17. Migrate existing partners and historical promo trips',
   'Kivu Ride administrator',
   'existing partners, promo arrangements, and reliable historical trips migrated',
   'the new dashboard begins with useful history without inventing unsupported data',
   $d$Existing partner and promo information should be mapped to the new structure. Historical trips should be attributed only when a reliable promo code, partner account, agreement, or other trustworthy record exists. Estimated historical values must be labelled with their source and confidence level.

(Added in review) Candidates: the existing Kivu Business corporate accounts (KR-07, 5 active) and Kivu Circle family accounts (KR-06). Whether they become partners in this system is for the MD to confirm before migration.$d$,
   pg_temp.ac(ARRAY[
     'Existing partners are mapped without duplication.',
     'Known promo campaigns retain historical dates and rules where records exist.',
     'Historical trips are attributed only when supported by reliable evidence.',
     'Estimated historical data are clearly labelled.',
     'Migration produces reconciliation totals and an exception list.',
     'A dry run is reviewed before production migration.',
     'Re-running migration does not create duplicate records.',
     'A safe rollback or correction process is documented.'
   ]), 'medium', v_it, 'manual', v_md),

  (f_trust, v_product, '18. Test and launch the complete partner reporting solution',
   'Kivu Ride product owner',
   'the complete solution tested and piloted before full launch',
   'partners receive accurate discounts, secure dashboards, and reliable monthly reports',
   $d$Testing should cover partner creation, permissions, promo-code conditions, discount calculations, refunds, concurrent redemptions, trip attribution, dashboards, exports, reconciliation, carbon formulas, report approval, delivery, privacy, unauthorized-access attempts, and performance at high trip volumes.

The first production release should be piloted with one institutional partner for one complete reporting month. (Added in review) The pilot partner is chosen by the MD before Phase 1 ends.

Testing runs through every phase, not only at the end.$d$,
   pg_temp.ac(ARRAY[
     'Critical user journeys pass end-to-end testing.',
     'Dashboard, export, finance, and report totals reconcile within the approved tolerance.',
     'Critical and high-severity defects are fixed before launch.',
     'No partner can access another partner''s information.',
     'Important service failures generate monitoring alerts.',
     'Backup, rollback, and incident-response procedures are documented and tested.',
     'Product, Finance, Operations, Security, and Sustainability representatives approve the release.',
     'Pilot feedback and corrections are completed before expansion.'
   ]), 'high', v_it, 'manual', v_md);
END $$;
