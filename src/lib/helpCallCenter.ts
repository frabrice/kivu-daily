import type { NavKey } from '../components/AppShell';
import type { HelpEntry } from './helpContent';

// How to Use for the Call Center and the pages around it, written from
// the Kivu Ride Call Center Script Book v1.0 and how the app works.
// Kept in its own file so it's easy to update when the book changes.

const PLAYBOOK: HelpEntry['sections'][number] = {
  heading: 'The Call Center Playbook — every call, the same six steps',
  body: [
    `1. Greet & identify — "Thank you for contacting Kivu Ride on 6023. My name is [name]. How may I assist you today?" Press New call and type the caller's phone number first: Kivu Daily shows if they've called before and whether a case is still open.`,
    `2. Listen & classify — let them explain, then type a word in "What's it about?" ("late", "refund", "breakdown"…). The Script Book card for that situation appears beside the form with what to say, what to do and what to collect — and the right person is pre-selected.`,
    `3. Verify — only what that caller type needs. Drivers: registered full name, phone number and plate (tick "Driver verified"). Never ask for a Mobile Money PIN, card number, CVV, OTP or password.`,
    `4. Act — solve it within your authority ("Solved on the call"), or assign it to the person in charge ("Needs someone else"). Bookings are dispatched in the operations platform; just log them with "Log booking".`,
    `5. Confirm — repeat the action, who has it, the reference and when they'll hear back (2 hours unless you chose otherwise).`,
    `6. Record & close — "Thank you for choosing Kivu Ride. Your reference is [reference]. We will update you within two hours. You may contact us again free of charge on 6023."`,
  ],
};

export const CALL_CENTER_HELP: Partial<Record<NavKey, HelpEntry>> = {
  call_center_tickets: {
    blurb: 'Your inbound desk: log every contact (call, WhatsApp, SMS, website), solve what you can on the spot, and send the rest to the person in charge.',
    sections: [
      PLAYBOOK,
      {
        heading: 'Emergencies',
        body: [
          `If anyone is in immediate danger or injured, stop routine troubleshooting. Public help first: 112 police, 113 traffic accident, 912 ambulance, 111 fire. Then set Priority to Emergency (or pick an Emergency situation).`,
          `Record the exact location (required), injuries and which number was called. The moment you save, the MD and the Fleet Manager are alerted by email, day or night.`,
          `An emergency can't be "solved on the call" and can't be closed until the MD has acknowledged it — the record stays open.`,
        ],
      },
      {
        heading: 'Urgent, normal, and the two-hour standard',
        body: [
          `Urgent: serious but nobody is in danger (a breakdown with a passenger on board, a serious complaint). Normal: everything else.`,
          `Every case you hand on must get an initial response from its owner within two hours. If it doesn't, the owner and the MD are emailed automatically, and the case shows "No response yet" in red.`,
          `For serious issues (urgent, complaints, driver behaviour) ask for the caller's email too.`,
        ],
      },
      {
        heading: 'Linking the driver or car',
        body: [
          `When a passenger complains about a driver or reports a lost item, search the driver's name, phone or plate under "Driver or car involved" — it covers our own drivers and Non-Insider drivers. The case then appears on that driver's record for Fleet.`,
          `If the caller's own number belongs to a driver, Kivu Daily offers to link them.`,
        ],
      },
      {
        heading: 'Closing the loop',
        body: [
          `"Call back" lists cases the owner has resolved. Call the caller, tell them the outcome, then press "Close — caller informed" and record how they felt (Happy / Neutral / Unhappy). If it isn't fixed, press "Reopen" and say what they reported.`,
          `"Pending" means the owner needs something from the caller — you're emailed what's needed. Call them, get it, add it as a note.`,
          `Promised to ring someone at a set time? Open the case and set a "Call-back time" — it rises to the top of the list when it's due.`,
        ],
      },
      {
        heading: 'Shifts: start, end, hand over',
        body: [
          `There are three shifts a day — Morning 06:00–14:00, Afternoon 14:00–22:00, Night 22:00–06:00 — in teams of two on Computer 1 and Computer 2. When you sign in, press "Start shift" (pick the shift, your computer and who you're working with). Your time starts then; arriving more than 10 minutes after the shift starts shows as late.`,
          `You can't sign out without ending your shift. Press "End shift" (top of the screen, or Sign Out) and fill in the shift report. Check your phone's call log and enter your calls by type — received from passengers, our drivers, Non-Insider drivers, owners & partners and others; made to our drivers, Non-Insider drivers, call-backs to passengers and others (0 where you had none) — then missed calls, WhatsApp/SMS handled, what you worked on, what was resolved and what's still open, problems you hit, what drivers and passengers told you, and your suggestions. Kivu Daily shows what you logged during the shift next to it.`,
          `The same form is your handover: a note for the next shift, plus the last action and exact next action for each open case. The next shift sees it at the top of Calls & Tickets and presses "Got it". The MD receives every shift report by email.`,
          `Quiet shift? Use the time: work the Call Queue (check-ins, payment backup, follow-ups), then Non-Insider Outreach — call Non-Insider drivers about what's new, our device and branding. It all counts in your shift report and on the Call Analytics page.`,
        ],
      },
    ],
    tips: [
      `Statuses: Assigned → In progress → Pending (waiting on the caller) → Resolved (owner finished) → Closed (caller informed).`,
      `Calls are not recorded — never tell a caller they are.`,
      `When you don't know: "Let me confirm the correct information for you." Then check the Script Book or log a case for the MD.`,
    ],
  },

  call_center_scripts: {
    blurb: `The Kivu Ride Call Center Script Book, in the app — every situation with what to say, what to do, what to collect, and who owns it.`,
    sections: [
      {
        heading: 'Finding the answer fast',
        body: [
          `Type a word in the search bar ("late", "refund", "lost", "login", "accident") or pick a section. Each card shows: Say (the exact words), Do (the steps), Collect (the details to write down) and Owner (who it goes to if you can't solve it).`,
          `Quick reference cards are pinned at the top: the opening and closing lines, the fare guide (RWF 1,600 base incl. the first km, RWF 1,000 per km after, first 15 minutes of waiting free then RWF 1,500 per 30 minutes, no cancellation fee), payment methods, emergency numbers and the non-negotiable rules.`,
          `The same cards appear inside New call when you pick a situation, so you rarely need to switch pages mid-call.`,
        ],
      },
    ],
    tips: [`Only the MD can edit cards. If something in the book is wrong or missing, tell the MD.`],
  },

  call_center_queue: {
    blurb: 'Drivers to call, grouped by why — payment backup, follow-ups, onboarding and check-ins.',
    sections: [
      {
        heading: 'The groups',
        body: [
          `Payment backup — active drivers behind on their weekly payment. Janviere leads payment reminders; you're the backup (use the "Payment reminder (backup)" reason).`,
          `Follow-ups — the last call needed a follow-up, or Fleet flagged the driver.`,
          `Onboarding — applicants not driving yet; help them finish their documents and steps.`,
          `Check-ins — active drivers not called in 7 days or more.`,
          `Called recently — nothing due; hidden unless you open it.`,
        ],
      },
      {
        heading: 'Logging the call',
        body: [`Click a driver, pick the reason and the outcome, add a short note. An outcome marked "needs follow-up" puts them back in Follow-ups.`],
      },
    ],
    tips: [`This page is for calls you make to our drivers. Calls that come in to 6023 go on Calls & Tickets.`],
  },

  call_center_directory: {
    blurb: 'Every driver with their phone number and call history, searchable.',
    sections: [{ heading: 'Using it', body: [`Search by name or phone to see when a driver was last called and what happened. It's read-only — Fleet keeps driver details up to date.`] }],
    tips: [],
  },

  non_insider: {
    blurb: 'Drivers on the passenger app whose car is not part of our managed fleet (independent drivers).',
    sections: [
      {
        heading: 'What the Call Center can do here',
        body: [
          `View drivers and cars, and press "Sync from Platform" to refresh the list.`,
          `On a car, press "Update branding / device" to record three answers from the owner: currently branded, allows branding, wants to buy our device — plus a note. Everything else is changed by Fleet.`,
          `Saying Yes to "allows branding" or "wants our device" sends the car straight to the Fleet Manager's Branding & Devices list, and emails them.`,
        ],
      },
    ],
    tips: [`Independent drivers can be linked to Call Center cases too — search their name or plate under "Driver or car involved".`],
  },

  fleet_branding: {
    blurb: 'Non-Insider car owners who allow branding or want to buy our device — your follow-up list.',
    sections: [
      {
        heading: 'Working the list',
        body: [
          `Allows branding: To contact → Scheduled → Branded (or Not going ahead). Marking a car Branded also records it as branded on the car.`,
          `Wants our device: To contact → Agreed → Installed (or Not going ahead).`,
          `Each card shows the driver/owner and their phone. Call them, pick the new step, add follow-up notes and Save.`,
        ],
      },
    ],
    tips: [`You're emailed the moment the Call Center records a new owner, and Monday's Fleet email counts what's still waiting.`],
  },

  call_center: {
    blurb: 'The whole Call Center in one place: the inbound desk, the driver call queue, the directory and the Script Book.',
    sections: [
      {
        heading: 'Calls & Tickets (inbound desk)',
        body: [
          `Every contact to 6023 is logged here — solved on the call, or handed to the person in charge. Emergencies alert you and the Fleet Manager instantly and wait for your Acknowledge before they can be closed.`,
          `Your morning briefing lists unacknowledged emergencies and cases that missed the two-hour response standard; Monday's report has the week's Call Center numbers (contacts, solved on the spot, response standard, satisfaction).`,
        ],
      },
      {
        heading: 'Script Book',
        body: [`All the book's situations as cards. You can edit any card, add new ones, or mark a draft — agents only see approved cards. Who each situation goes to is set by department in MD Panel → Email notifications → Who's in charge.`],
      },
      {
        heading: 'Call Queue and Directory',
        body: [`Outbound calls to our drivers, grouped by purpose (payment backup, follow-ups, onboarding, check-ins).`],
      },
    ],
    tips: [
      `Call Center sees drivers and vehicles read-only — Deposits, Fines and the Leaderboard are hidden from them. On Non-Insider cars they can only set branded / allows branding / wants our device.`,
      `Call numbers by type, agent punctuality and outreach results are on the Call Analytics page (you and Finance only).`,
    ],
  },

  call_center_outreach: {
    blurb: `Call every Non-Insider driver, one by one, in rounds — get them the updated app, our device and branding, so more drivers are online in more places.`,
    sections: [
      {
        heading: 'The three questions',
        body: [
          `1. The updated app — we now send clients to our drivers. Will they come to our office so IT installs the updated app and shows the new features, or do they already have it? Also ask how much they use the Kivu Ride app.`,
          `2. Our device — 120,000 RWF, one-time. Yes, thinking about it, or no.`,
          `3. Branding — 20,000 RWF, one-time, paid by the driver. Branded drivers become priority drivers. Yes, thinking about it, or no.`,
          `A Yes to the device or branding goes straight to the Fleet Manager's Branding & Devices list. Never promise a number of trips, an income figure or a discount.`,
        ],
      },
      {
        heading: 'Working a round',
        body: [
          `Press "Call next driver": you get the next driver nobody else is calling (call-backs that are due first, then drivers not called yet this round). The other computer can't get the same driver — a driver someone is calling shows a lock with their name.`,
          `Choose whether you reached them. If you did, answer all three questions (their earlier answers are already filled in — change what's changed), then "Save & call next driver". No answer comes back after 2 hours; "Call back later" comes back at the time you set; a wrong number leaves the rounds.`,
          `The round is finished when every driver has been reached. Then press "Start round 2", write what to tell drivers this round (for example this week's average passengers per driver, from IT or the MD), and call everyone again who hasn't come to the office.`,
        ],
      },
      {
        heading: 'Came to the office',
        body: [
          `When IT tells you a driver came to the office, find them (search by name, phone or plate) and press "Mark as came" with the date. They leave the call rounds. Undo if it was a mistake.`,
        ],
      },
      {
        heading: 'Categories and filters',
        body: [
          `Every driver is in one category from their answers: Accepted — expected at office, Came to the office, Thinking about it, Said no, Not reached yet, Wrong number.`,
          `Narrow any list by answer — Updated app, Device, Branding (or "Not asked yet"). For example: Accepted + Branding Yes = drivers to remind to come and get branded.`,
        ],
      },
    ],
    tips: [
      `Goal: 15 outreach calls a day — it's on your daily task list, and your count is at the top of the page and in your shift report.`,
      `The pitch is in the Script Book under "Non-Insider outreach"; the MD can edit it there.`,
    ],
  },

  call_analytics: {
    blurb: `How the Call Center is doing: calls per day and by type, what callers need, the busiest hours, and how each agent performs. For the MD and Finance.`,
    sections: [
      {
        heading: 'Where the numbers come from',
        body: [
          `Calls received and made come from each agent's end-of-shift report, by type (passengers, our drivers, Non-Insider drivers, owners & partners, call-backs). Reports before 5 Oct 2026 only had totals, so those show as "Other".`,
          `"What calls are about", busiest hours, solved on the spot, the two-hour reply standard and caller satisfaction come from the contacts agents log in Calls & Tickets.`,
        ],
      },
      {
        heading: 'Agent performance',
        body: [
          `On time = the shift was started within 10 minutes of its start (06:00, 14:00 or 22:00). "Not ended" = the agent signed off without a shift report and the shift was closed automatically.`,
          `"Made / hour" is outgoing calls per hour on shift — the best measure of how quiet time is used. Outreach shows Non-Insider calls and how many drivers said yes.`,
        ],
      },
    ],
    tips: [
      `Press "Table" on a chart to see the exact numbers day by day.`,
      `If calls received are much higher than contacts logged, agents aren't logging every call.`,
    ],
  },

  from_call_center: {
    blurb: `Callers' issues the Call Center couldn't solve on the call and assigned to you.`,
    sections: [
      {
        heading: 'Working a case',
        body: [
          `You're emailed every time a case is assigned to you, with the caller's details and a button that opens it here. The sidebar badge counts your open cases.`,
          `Respond within two hours — press "Start working" or add a note. If nobody responds in two hours, you and the MD are emailed.`,
          `Need something from the caller? Press "Pending on caller" and say what — the Call Center will ring them. Done? Press "Mark resolved" and write what you did; the Call Center informs the caller and closes it.`,
          `Not yours? Press "Reassign", choose the right person and say why.`,
        ],
      },
    ],
    tips: [
      `Statuses: Assigned → In progress → Pending → Resolved → Closed.`,
      `Every morning at 8:00 (Monday–Saturday) you get one email listing your open cases, the late ones first.`,
    ],
  },
};
