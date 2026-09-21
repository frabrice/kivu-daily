import { NavKey } from '../components/AppShell';

export interface HelpSection {
  heading: string;
  body: string[];
}

export interface HelpEntry {
  blurb: string;
  sections: HelpSection[];
  tips: string[];
}

// Shared by both 'finance' (the MD's bundled tab view) and
// 'finance_dashboard' (Finance's own sidebar landing page) - same full
// model either way, just reached through a different nav shape.
const FINANCE_ENTRY: HelpEntry = {
  blurb: "The full financial picture — three bank accounts, driver deposits, car-management payouts and margin, and every ledger page, in one place.",
  sections: [
    {
      heading: 'The Three Bank Accounts',
      body: [
        'Bank of Kigali (BK) — the collection account. Every driver\'s weekly deposit and every new car\'s onboarding fee lands here first. MoMo is a separate collection channel that settles into BK.',
        'Equity — the revenue and treasury account. Kivu\'s own income goes here: trip commissions and anything else Finance logs directly as Revenue, the weekly management margin on each managed car, the monthly management fee, and the onboarding margin.',
        'I&M — the payment and operating account. Everything Kivu pays out comes from here: payroll, vehicle-owner payouts, supplier payments, expense claims. When I&M is short for what\'s due, Equity funds it via Inter-Bank Transfers — Equity is where the margin and fees accumulate, I&M is where they actually get spent.',
      ],
    },
    {
      heading: 'Driver Weekly Deposits — How The Math Works',
      body: [
        'Each managed car has two shift drivers (day and night). Each pays 30,000 RWF/day for 6 days = 180,000 RWF/week — the weekly deposit amount. Together the two drivers collect 360,000 RWF/week per car into BK. This is the car\'s operating remittance, not a refundable deposit — it\'s what funds the owner\'s payout and Kivu\'s margin.',
        'A driver\'s initial deposit (paid when they join) counts as the first payment toward their first week, exactly like any later logged deposit. Pay less than 180,000 and the shortfall is what they owe before their week is even considered started; pay more and the extra rolls forward as credit against the next week.',
        'Deposits can be logged in installments — 30k, then 40k, then 60k — without resetting anything. The "Log Deposit" button is always available; each logged payment is labeled Due, Covered, or Extra depending on where it lands. Once cumulative payments for a week reach 180,000, that week\'s cycle closes and the 7-day clock for the next week starts from that date.',
        'Status colors follow the same logic everywhere it shows up: green while there\'s no rush, amber with one day left, red from the due day onward and every day after ("Overdue by Xd"). A driver who\'s never paid shows red immediately.',
      ],
    },
    {
      heading: "Car Management: Owner Payouts & Kivu's Margin",
      body: [
        'Of the 360,000/week collected from a car\'s two drivers, the owner is paid a flat daily rate x 6 days/week from I&M — regardless of how much was actually collected that week. Kivu absorbs the collection risk, not the owner. The default is 40,000/day (240,000/week), but this is set per car — some pay more (e.g. a car paying 45,000/day = 270,000/week) depending on the car and its contract.',
        'Whatever\'s left of the 360,000 after the owner\'s cut is Kivu\'s management margin, recognized straight to Equity — 120,000/week at the 240,000 default, less on a car with a higher payout.',
        'Owners also pay a separate flat monthly management fee of 30,000/car, also to Equity, tracked as a Revenue-type entry.',
        'These are prepayments, not payments in arrears: the payment for a given week is due the moment that week starts, not after it finishes. A car starting Wednesday counts its first payment as due that same Wednesday, its second the following Wednesday, and so on.',
        'Both the weekly margin and the monthly fee are schedule-driven from each car\'s own operation start date, not tied to any individual driver payment — the system checks every time Finance opens the app and posts whatever periods are due but haven\'t been recognized yet. Nothing needs to be typed in by hand.',
        'Owner payouts work differently: they\'re a real bank transfer, so they\'re created as "Pending" and stay that way until Finance actually sends the money and clicks "Confirm Paid" on the Vehicle Owners → Payments tab (or from the owner\'s own profile page). The margin and monthly fee, by contrast, post as already-recognized income once confirmed, since they\'re just bookkeeping on money already sitting in the accounts.',
      ],
    },
    {
      heading: 'Onboarding a New Managed Car',
      body: [
        'A one-time 140,000 RWF fee: 120,000 for the device/phone and 20,000 for branding, collected into BK.',
        'Costs: the device actually costs 90,000, branding costs 15,000, and uniforms for the two assigned drivers cost 15,000 total (7,500 each) — all booked as supplier payments.',
        'Net onboarding margin: 140,000 − 90,000 − 15,000 − 15,000 = 20,000 per car onboarded.',
        'On the Vehicle Owners page, use "Onboard Vehicle Owner" on a car that needs an owner — one guided flow that links the owner (new or existing), sets the car\'s operation start date and daily payout rate, and auto-loads the 140,000 onboarding fee and first month\'s management fee as pending. Confirming the onboarding fee then loads the device/branding/uniform costs for approval.',
        'For a car already on the books before this flow existed, the same thing happens from the owner\'s own profile page — under "Vehicles & Payout Schedule", use "Set Start Date" (or "Edit Schedule" if one\'s already set) on that car.',
      ],
    },
    {
      heading: "What Counts As Kivu's Own Revenue",
      body: [
        '"Monthly Kivu Revenue" on the Dashboard is deliberately narrower than "everything that came in." It\'s Revenue (trip commissions etc.) plus the weekly management margin plus the onboarding margin — genuine income.',
        'Fleet Collections (the 360k/week gross from drivers) is shown separately and is NOT counted as revenue, because most of it — the owner\'s 240k share — passes straight back out. Counting it as revenue would double it up with the margin that\'s already counted on its own.',
      ],
    },
    {
      heading: 'Driver Stages, Briefly',
      body: [
        'Applying → Raw (vetted, good, but doesn\'t have the money for their first week yet) → Ready (vetted, no car yet, ideally already holding a paid deposit, on the bench to slot in the moment another driver\'s contract ends) → Active.',
        'Active is never picked by hand — it\'s computed automatically the moment a driver has both a vehicle and a paid initial deposit, and disappears automatically if either stops being true. The "Drivers" figure on the Finance Dashboard counts only drivers in this computed Active state.',
      ],
    },
    {
      heading: 'The Finance Pages',
      body: [
        'Vehicle Owners has its own place in the sidebar, separate from the rest — see its own How-To-Use entry. Everything below is bundled under Finance.',
        'Dashboard: the summary above, all in one place, plus cash position per account and what\'s overdue or pending.',
        'Revenue: trip commissions and other income logged directly, plus the auto-generated monthly management fees.',
        'Fleet Collections: every driver\'s weekly remittance, auto-posted the moment Fleet logs a deposit or a driver\'s initial deposit is recorded. Filterable by week and by a specific driver, with a running total per driver.',
        'Deposit Confirmations: deposits Fleet logs start "Pending" — Finance (or the MD) confirms each one here before it counts as settled.',
        'Internal Payroll: standalone employee records (position, start date, salary, ID) paid on one shared date each month; monthly runs pre-fill from those salaries. Approving one auto-creates the Equity → I&M funding transfer and the payroll payment from I&M together.',
        'Driver Payroll: a flat 150,000/month per driver, counted from their own initial deposit date, each its own pending payment until confirmed.',
        'Supplier Payments: insurance, charging, maintenance, RURA, office/admin — paid from I&M against an invoice or purchase order.',
        'Inter-Bank Transfers: moving money between Kivu\'s own accounts, most commonly Equity topping up I&M. Never counted as revenue or expense — it\'s Kivu\'s own money moving, not new money.',
        'Expense Claims: employee reimbursements, needs a supporting receipt before approval.',
        'Bank Accounts: live balances for all four accounts against their stated purpose, with a shortcut to reconcile each one.',
        'Reconciliation: match the system\'s running balance against the real bank statement for a period; any variance is flagged until explained.',
      ],
    },
  ],
  tips: [
    'A transaction\'s status moves Pending → Checked → Approved → Posted (or Rejected at any point) — use it to show who\'s reviewed what before money actually moves.',
    'System-generated entries (fleet collections, margin, onboarding fee, monthly management fee) can be viewed but not edited or deleted from here — Fleet or the car\'s own schedule is the source of truth, editing here would just drift from it.',
    'If Equity or I&M ever looks short for what\'s due, that\'s what Inter-Bank Transfers is for — move money from Equity into I&M before payroll or owner payouts are due.',
    'The 40,000/day (240,000/week) owner payout and 30,000/month management fee are defaults — override either on a specific car from its owner\'s profile page ("Vehicles & Payout Schedule" → Edit Schedule) if that car\'s actual contract is different.',
    'Reconcile every account against its real bank statement at least monthly — a variance that isn\'t zero means something in the ledger doesn\'t match reality and needs chasing down before it compounds.',
  ],
};

export const HELP_CONTENT: Partial<Record<NavKey, HelpEntry>> = {
  finance: FINANCE_ENTRY,
  finance_dashboard: FINANCE_ENTRY,
  finance_revenue: {
    blurb: "Kivu's own income, logged directly — trip commissions, platform fees, and anything else that isn't a car-management payout.",
    sections: [
      {
        heading: 'What shows up here',
        body: [
          'Anything Finance logs by hand as income, plus the monthly 30,000/car management fee, which posts here automatically every month per managed car rather than needing to be typed in.',
          'This does not include Fleet Collections (drivers\' weekly remittance) or the weekly management margin — those have their own pages. See Fleet Collections and Vehicle Owners.',
        ],
      },
    ],
    tips: ['New entries start Pending — move them through Checked → Approved → Posted as they\'re reviewed and confirmed.'],
  },
  finance_fleet_collections: {
    blurb: "Every driver's weekly remittance into Bank of Kigali — the money that funds owner payouts and Kivu's management margin.",
    sections: [
      {
        heading: 'How it gets here',
        body: [
          'Auto-posted the moment Fleet logs a driver\'s deposit, or the moment a new driver\'s initial deposit is recorded — nothing needs to be entered here by hand.',
          'Use "By Week" to see one week at a time, or pick a specific driver from the dropdown to see their full deposit history and running total in one place.',
        ],
      },
    ],
    tips: ['This is gross collection, not Kivu\'s revenue — most of it (240,000 of the 360,000/week per car) passes straight through to the vehicle owner.'],
  },
  finance_vehicle_owners: {
    blurb: 'Who owns each managed car, their bank details, and the weekly payout queue.',
    sections: [
      {
        heading: 'Owners tab',
        body: [
          'A car with no owner yet shows under "Needs an Owner" — click "Onboard Vehicle Owner" to link a new or existing owner, set the car\'s start date and daily payout rate, and auto-load the onboarding fee and first month\'s fee as pending, all in one guided flow.',
          'Click any owner in the directory to open their full profile page: contact/bank details up top (with its own Edit), then "Vehicles & Payout Schedule" for each car they have, and three history sections — Onboarding & Setup, Monthly Management Fees, and Weekly Payments — each row showing its status and, if pending, a one-click action to confirm or approve it.',
          'Payment day on an owner\'s basic info is a reference note only — the actual schedule runs off each car\'s own operation start date, since one owner can have more than one car.',
        ],
      },
      {
        heading: 'Payments tab',
        body: [
          '"Needs Your Action" surfaces every pending onboarding fee, setup cost, and monthly fee across all owners in one queue — the same items also visible from each owner\'s own profile page.',
          'Below that, every weekly owner payout, generated automatically and left "Pending" until Finance actually sends the money and clicks "Confirm Paid". Filter by owner or by week.',
        ],
      },
    ],
    tips: [
      'For a car whose owner was assigned before this automation existed, open that owner\'s profile page and use "Set Start Date" under "Vehicles & Payout Schedule" — it loads the same onboarding fee and backfills every weekly payout and monthly fee elapsed since that date, without disturbing anything already on the books.',
      'The daily payout rate (240,000/week default = 40,000/day x 6) is set per car, not fixed — some cars pay more depending on the car and its contract.',
    ],
  },
  finance_deposit_confirmations: {
    blurb: "Driver deposits Fleet logs stay 'Pending' here until Finance confirms them.",
    sections: [
      {
        heading: 'Who can confirm',
        body: ['Only Finance or the MD can confirm a deposit — Fleet can log one but can\'t confirm their own, by design.'],
      },
    ],
    tips: ['Confirming is the last step before a deposit counts as fully settled — check the amount and payment method match what was actually received before confirming.'],
  },
  finance_payroll: {
    blurb: 'Internal staff — position, start date, salary and ID on file, all paid on one shared date each month.',
    sections: [
      {
        heading: 'Employees tab',
        body: [
          'A payroll employee is a standalone record — it doesn\'t need a Kivu Daily login, since this covers everyone Kivu pays a salary to, not just app users. "Add Employee" captures their position, start date, monthly salary and ID document.',
          'Every employee is paid on the same shared date each month — the KPI row shows how many days are left until it, and "Change Date" (Finance/MD only) moves that shared date.',
        ],
      },
      {
        heading: 'Payroll Runs tab',
        body: [
          '"New Payroll Run" pre-fills one line per active employee at their current salary — a smart default, not a hard rule. Adjust or remove any line (bonus, deduction, unpaid leave) before saving, same as before.',
          '"Approve & Pay" does three things at once: creates the Equity → I&M funding transfer for the full run total, records the payroll payment out of I&M, and marks the run Paid — so the money trail is always there without extra manual entries.',
        ],
      },
    ],
    tips: ['Save as a draft first if you\'re still entering amounts — nothing is paid until you explicitly Approve & Pay.'],
  },
  finance_driver_payroll: {
    blurb: "A flat 150,000/month per driver, counted from each driver's own initial deposit date.",
    sections: [
      {
        heading: 'How a driver gets on payroll',
        body: [
          'The moment a driver\'s initial deposit is marked paid, their deposit date becomes their "official start date" for payroll purposes — not the shared Internal Payroll date, since every driver joins on a different day.',
          'Each driver\'s monthly payment is its own individual pending transaction, generated automatically once a full month has elapsed since their start date (or their last payment) — nothing is typed in by hand.',
          'A driver whose contract ends simply stops generating new months from that point on — no partial or prorated final payment, they just drop off the list.',
        ],
      },
    ],
    tips: ['"Confirm Paid" is the only manual step — check the amount matches what was actually sent before confirming.'],
  },
  finance_suppliers: {
    blurb: 'Payments to suppliers — insurance, charging, maintenance, RURA, office/admin — paid from I&M.',
    sections: [
      {
        heading: 'What belongs here',
        body: ['Anything paid to an outside vendor against an invoice or purchase order, including the device/branding/uniform costs logged automatically when a car is onboarded.'],
      },
    ],
    tips: [],
  },
  finance_transfers: {
    blurb: "Moving money between Kivu's own accounts — most commonly Equity topping up I&M.",
    sections: [
      {
        heading: 'Why this exists',
        body: [
          'Equity accumulates margin, fees and revenue; I&M is where payroll, owner payouts, and supplier payments actually go out. When I&M runs low for what\'s due, move money over here rather than paying from the wrong account.',
          'Never counted as revenue or expense — it\'s the same money, just relocated.',
        ],
      },
    ],
    tips: [],
  },
  finance_expense_claims: {
    blurb: 'Employee reimbursement requests, each needing a supporting receipt before approval.',
    sections: [],
    tips: [],
  },
  finance_accounts: {
    blurb: 'Live balances for all four accounts — Bank of Kigali, Equity, I&M, MoMo — against their stated purpose.',
    sections: [
      {
        heading: 'Reconcile from here',
        body: ['Click "Reconcile" on any account to compare its running system balance against the real bank statement for a period.'],
      },
    ],
    tips: [],
  },
  finance_reconciliation: {
    blurb: 'Every account matched against its real bank statement, at least monthly.',
    sections: [
      {
        heading: 'Reading the variance',
        body: ['A variance of exactly 0 means the books match the bank. Anything else needs explaining — a missed entry, a timing difference, or a real discrepancy — before that period is considered closed.'],
      },
    ],
    tips: [],
  },

  home: {
    blurb: "General — your daily task list, plus Meetings, Comments, Announcements and Documents, all on one page since they're common to every department.",
    sections: [
      {
        heading: 'Adding tasks',
        body: [
          'Tap "Add New Task" to open a small form: a title (required) and an optional description. Save it and it appears in today\'s list. You can add tasks any time of day.',
        ],
      },
      {
        heading: 'Working through the day',
        body: [
          'Each task is a row with a round checkbox on the left. Tapping the checkbox marks it complete or incomplete instantly — this is just for your own tracking as you go.',
          'Tapping anywhere else on a row (for today\'s tasks only) opens the Review panel — see "End-of-day review" below.',
          'Hover a task to reveal a trash icon if you need to delete it outright (only available for today, not past days).',
        ],
      },
      {
        heading: 'End-of-day review',
        body: [
          'Clicking a task from today opens a review panel where you pick one of three outcomes: Completed, In Progress, or Not Done.',
          'Completed needs no explanation (though you can add an optional note). In Progress and Not Done both require you to type a short note explaining what happened — the Submit button stays disabled until you do.',
          'If you mark something In Progress or Not Done, the app automatically copies that same task onto tomorrow\'s list (tagged "Carried Over") so it isn\'t forgotten. Completed tasks do not carry over.',
          'A carried-over task keeps its full history — open it and click "Task History" to see every previous day it was pushed and the notes left each time, so a task that keeps slipping is visible, not hidden.',
        ],
      },
      {
        heading: 'Streak, completion, and past days',
        body: [
          'The three tiles at the top show today\'s completion percentage, how many tasks you set today, and your current daily streak (consecutive days with at least one task marked complete).',
          'Below the "Add New Task" button is a timeline of previous days. Past days are read-only — you can look back at what you did, but can\'t edit or delete old tasks.',
        ],
      },
    ],
    tips: [
      'A quick checkbox tick is not the same as a review. Reviewing (clicking the row) is what generates the note history the MD sees.',
      'Marking something "In Progress" isn\'t a failure — it\'s the honest option, and it\'s exactly what carries the task forward so it doesn\'t get lost.',
    ],
  },

  tasks: {
    blurb: "The MD's own daily task list — works exactly like every employee's Today page, since the MD tracks personal work the same way.",
    sections: [
      {
        heading: 'Same mechanics as every employee',
        body: [
          'Add New Task, the checkbox toggle, and clicking a task to review it (Completed / In Progress / Not Done with required notes for the latter two) all work identically to the employee Today page.',
          'This is a personal accountability tool for the MD, separate from the company-wide Dashboard — it tracks the MD\'s own to-dos, not the team\'s.',
        ],
      },
    ],
    tips: [
      'Use the Dashboard for managing the team; use My Tasks for your own daily list.',
    ],
  },

  calendar: {
    blurb: "A month grid showing how complete each day's tasks were, at a glance.",
    sections: [
      {
        heading: 'Reading the grid',
        body: [
          'Each day with tasks shows a small colored dot: green means high completion, orange/amber means partial, red means low. The color scale is explained in the legend under the calendar.',
          'Today is marked with a ring around the date. Use the arrows or "Today" button above the grid to move between months.',
        ],
      },
      {
        heading: 'Drilling into a day',
        body: [
          'Click any day with a dot to open a side panel listing every task set that day, with its completion state — a quick way to check "what did I actually do on the 3rd."',
        ],
      },
    ],
    tips: [],
  },

  analytics: {
    blurb: 'Personal performance charts — completion rates, streaks, and trend lines built from your own task history.',
    sections: [
      {
        heading: 'Stat tiles',
        body: [
          "Today's, weekly, and monthly completion percentages, current streak, longest streak ever, total tasks completed, total tasks created, and your average daily completion rate.",
        ],
      },
      {
        heading: 'Charts',
        body: [
          'A bar chart of the last 7 days\' completion percentage, and a line chart of the last 30 days — useful for spotting whether a slump is a one-off day or a longer pattern.',
        ],
      },
    ],
    tips: ['This page is read-only — it reflects your task history, nothing to click through here beyond reading the numbers.'],
  },

  meetings: {
    blurb: 'A shared log of meeting notes — anyone can write one, and you control exactly who sees it.',
    sections: [
      {
        heading: 'Creating a note',
        body: [
          'Click "New Note", give it a title, pick the date, and write your notes in free text.',
          'The key choice is "Who can see this" — four options: Only me (private), Share with MD (just you and the Managing Director), Share with my department (everyone in your department), or Share with everyone (the whole company). Default is private, so nothing leaks unless you deliberately widen it.',
        ],
      },
      {
        heading: 'Turning a note into a task',
        body: [
          'Open any meeting note and click "Create a task from this meeting". Type a title and save — it becomes a real task on today\'s list, permanently linked back to that meeting.',
          'If the MD opens the note, they get an extra option to assign that task to any active employee instead of themselves — the employee gets a notification the moment it\'s assigned.',
        ],
      },
    ],
    tips: [
      'Department- and company-visible meetings also show up in the Live Activity feed on the MD Dashboard — private and MD-only notes stay off that feed.',
      'Use this for anything you\'d otherwise just remember and forget: a call with a partner, a decision made on a phone call, instructions given verbally.',
    ],
  },

  documents: {
    blurb: 'Shared file storage — contracts, scripts, guides, anything worth keeping in one place instead of scattered across phones.',
    sections: [
      {
        heading: 'Uploading',
        body: [
          'Click "Upload a Document", give it a title and an optional category (e.g. "Contract", "Script", "Guide"), choose a file, and pick who can see it: your department only, or everyone in the company.',
        ],
      },
      {
        heading: 'Downloading and removing',
        body: [
          'Each document shows who uploaded it, which department (or "Company-wide") it belongs to, and how long ago it was added. Click the download icon to open the file in a new tab.',
          'You can delete any document you personally uploaded. The MD can delete anything, regardless of who uploaded it.',
        ],
      },
    ],
    tips: [],
  },

  announcements: {
    blurb: 'Company-wide broadcasts from the MD — read by everyone, written only by the MD.',
    sections: [
      {
        heading: 'For employees',
        body: [
          'This is a read-only feed. New announcements appear here automatically as the MD posts them — nothing to click except reading them.',
        ],
      },
      {
        heading: 'For the MD',
        body: [
          'Click "Broadcast an Announcement", write a title and body, and everyone in the company sees it immediately. The MD can also delete any announcement afterward.',
        ],
      },
    ],
    tips: ['Use this for things that genuinely apply to everyone — for anything department-specific, a department-visibility Meeting Note is a better fit.'],
  },

  comments: {
    blurb: "A private, threaded feedback channel between you and the MD — not visible to anyone else.",
    sections: [
      {
        heading: 'How a conversation starts',
        body: [
          'Employees can\'t start a brand-new conversation from this page — it only shows threads the MD has already opened with you (usually while reviewing your work from your profile page). Once a thread exists, you can reply to it freely.',
          'Conversations are grouped by the date of the task they relate to, most recent first.',
        ],
      },
      {
        heading: 'Replying',
        body: [
          'Click "Reply" under any message, type your response, and press Enter or the send button. Replies can go several levels deep — click "Show N replies" to expand a thread.',
          'Your own messages appear on the right in brand color; the MD\'s messages are marked with a small "MD" badge on their avatar.',
        ],
      },
    ],
    tips: ['This is private between you and the MD — it is not visible to your department or anyone else, unlike department Meeting Notes.'],
  },

  settings: {
    blurb: 'Your personal account settings — name, password, theme, and which emails you receive.',
    sections: [
      {
        heading: 'Profile & password',
        body: [
          'Update your display name under Profile. Under Change Password, type a new password (6+ characters) and click Update — takes effect immediately, no need to log out.',
        ],
      },
      {
        heading: 'Theme',
        body: ['Switch between Light and Dark. Applies to the whole app immediately and is remembered next time you log in.'],
      },
      {
        heading: 'Email notifications',
        body: [
          'Five separate toggles: Morning Reminder (7 AM nudge to add tasks), Daily Summary (6 PM completion report), Comment Notifications (instant, when you get feedback), Unfinished Task Reminders (midday nudges), and Performance Nudges (weekly, if productivity drops). "Enable all" / "Disable all" set them all at once.',
        ],
      },
    ],
    tips: [],
  },

  dashboard: {
    blurb: "The MD's control center — a live, company-wide view of who's doing what, updated in real time.",
    sections: [
      {
        heading: 'Top stats and charts',
        body: [
          'Four tiles: overall completion today, how many employees are active today, total tasks set, total completed.',
          'A weekly completion trend chart, and a Department Performance bar chart — bar color reflects how well that department is doing (green = strong, red = struggling), not an arbitrary department color.',
        ],
      },
      {
        heading: 'Quick actions',
        body: [
          '"Assign a Task" pushes a task directly onto any employee\'s list — they get a notification immediately.',
          '"Broadcast" posts a company-wide announcement.',
          '"New Meeting Note" opens the same meeting note composer available everywhere, straight from the dashboard.',
        ],
      },
      {
        heading: 'Needs Your Attention',
        body: [
          'Surfaces exactly what needs a decision: tasks employees marked In Progress/Not Done that are awaiting your review, unread replies in Comments, and a "Silent today" list of employees who haven\'t logged a single task yet. Click any name or item to jump straight to it.',
        ],
      },
      {
        heading: 'Live Activity',
        body: [
          'A real-time feed of shared work across the whole company — new drivers added, calls logged, campaigns started, content planned, user stories written, meetings shared beyond private. Personal task check-offs and private comments deliberately do not appear here.',
        ],
      },
      {
        heading: 'Employee cards',
        body: [
          'Every active employee, sortable by Completion, Name, or Tasks. Click any card to open their full profile: task history, streak, a personal completion trend chart, and a box to leave them private feedback (this is how a Comments conversation actually gets started).',
        ],
      },
    ],
    tips: [
      'The Department Performance bar chart is the fastest way to spot which team needs a check-in without reading every row.',
      'Clicking a name anywhere on this page — Silent today, an employee card, a leaderboard row — always opens the same detailed profile view.',
    ],
  },

  fleet: {
    blurb: "The driver pipeline — every driver's stage from first applying to fully active, in one board.",
    sections: [
      {
        heading: 'The board',
        body: [
          'Six columns: Applying, Raw, Ready, Active, Flagged, Inactive. Each driver is a card in exactly one column, showing their name and phone number.',
          'Applying: just applied. Raw: vetted and good, but doesn\'t have the money for their first week\'s deposit yet. Ready: vetted, no vehicle assigned yet, ideally already holding a paid deposit — sitting on the bench specifically to slot in the moment another driver\'s contract ends. Active isn\'t picked by hand: it happens automatically the moment a driver has both a vehicle and a paid initial deposit, and drops back out automatically if either stops being true.',
        ],
      },
      {
        heading: 'Adding and editing drivers',
        body: [
          '"Add Driver" opens a form for name, phone, starting stage, and free-text notes. Clicking any existing driver card opens the same form to edit them — change their stage here to move them between Applying, Raw, Ready, Flagged or Inactive, add notes, or update their phone number.',
          'Fleet can remove a driver entirely from this drawer if needed.',
        ],
      },
      {
        heading: 'Flag to IT',
        body: [
          'Inside a driver\'s edit drawer is a "Flag to IT" button. Use it when a driver hits a product problem (app crash, confusing screen, repeated complaint) — it opens a small form (who\'s affected, what\'s the problem, extra context) and drops it straight into IT\'s backlog as a draft user story, with a notification sent to every IT person and the MD.',
        ],
      },
    ],
    tips: [
      'Call Center can see this same driver list (read-only) so calls and pipeline stage stay in sync — only Fleet can actually move a driver between columns.',
      'Use search to jump straight to a driver by name or phone instead of scanning columns.',
    ],
  },

  call_center: {
    blurb: 'Everything for calling drivers: a prioritized queue of who to call next, a full directory, and reusable scripts.',
    sections: [
      {
        heading: 'Call Queue',
        body: [
          'Automatically ranks every active driver by urgency: never-called drivers first, then anyone flagged "needs follow-up" from their last call, then anyone not called in 7+ days, then everyone else. No manual sorting needed — just start from the top.',
          'Click a driver to log a call with them.',
        ],
      },
      {
        heading: 'Logging a call',
        body: [
          'Everything is selection-only — no free typing for driver, reason, or outcome, so logs stay consistent and searchable. Pick the driver, pick a reason for the call, pick the outcome, and optionally add a short note.',
          'If a matching script exists for the reason you picked, it appears automatically so you know what to say.',
          'A "Flag to IT" button is also here — use it if the call reveals a product problem, even before you finish logging the call itself.',
        ],
      },
      {
        heading: 'Directory & Scripts',
        body: [
          'Directory is a searchable list of every driver with their call history at a glance (never called, or last call time). Scripts is a library of what-to-say guides, taggable by call reason — "Add Script" lets anyone in Call Center contribute a new one.',
        ],
      },
    ],
    tips: [
      'The Call Queue re-ranks itself the instant you log a call — a driver you just called drops out of "urgent" immediately.',
      'A call outcome marked "needs follow-up" is what pushes a driver back to the top of tomorrow\'s queue — pick outcomes honestly, not just to clear the queue.',
    ],
  },

  marketing: {
    blurb: 'The outreach CRM — campaigns (a push with a goal) holding contacts (the actual organizations/people you\'re reaching), each moving through a pipeline.',
    sections: [
      {
        heading: 'Campaigns',
        body: [
          '"New Campaign" needs just a name and an optional goal/timeframe — start one for any push (hotel partnerships, freight companies, a referral drive, anything). Each campaign card shows a rollup bar of how many contacts are at each pipeline stage.',
          'Click a campaign to open it and see its full contact list.',
        ],
      },
      {
        heading: 'Contacts and the pipeline',
        body: [
          'Inside a campaign, "Add Contact" captures an organization name, contact person, phone/email, a free-text type (e.g. "Hotel", "Freight", "Corporate" — type whatever fits, it\'s not a fixed list), and a next follow-up date.',
          'Contacts sit in a 5-stage board: Not Contacted → Contacted → Negotiating → Won / Lost. Click a contact and change its stage to move it.',
        ],
      },
      {
        heading: 'Follow-ups',
        body: [
          'A separate tab lists every contact across every campaign with a follow-up due in the next 3 days — overdue ones are flagged red. This is the page to check every morning so nothing goes cold.',
        ],
      },
    ],
    tips: ['The "type" field is free text on purpose — don\'t force a new category into an existing one, just type what makes sense.'],
  },

  social: {
    blurb: 'The content calendar for every planned post — what, where, when, and whether it\'s boosted.',
    sections: [
      {
        heading: 'Week and List views',
        body: [
          'Week view (default) shows a 7-day grid you can page through with the arrows. List view shows every post as a flat list — better for scanning everything at once.',
        ],
      },
      {
        heading: 'Adding a post',
        body: [
          'Click any day (or "New Post") to open the composer: pick the date, tick one or more platforms, choose a content pillar (Launch, Driver Heroes, Rider Love/UGC, Explore Kigali, and the other real Kivu Ride pillars), intent, audience, and format, write a caption, and mark whether it\'s boosted with a budget.',
          'Status moves through Idea → Drafted → Scheduled → Posted as the post actually goes out.',
        ],
      },
    ],
    tips: ['Marking a post "Posted" is what logs it to the company Live Activity feed — earlier statuses stay quiet.'],
  },

  it_hub: {
    blurb: "IT's product backlog, organized top-down: Product → Milestone → Feature → User Story, so work always traces back to what it's actually for.",
    sections: [
      {
        heading: 'Drilling down',
        body: [
          'Start at Products (iOS App, Android App, Web Dashboard, whatever exists). Click one to see its Milestones (each with a status: Planned / In Progress / Shipped). Click a milestone to see its Features. Click a feature to reach its user story board.',
          'Each level has its own "New…" button and an Edit link on every card — use the back button at the top-left of each screen to climb back up.',
        ],
      },
      {
        heading: 'Writing a user story',
        body: [
          'Every story follows the same format: "As a [persona], I need [need], so that [benefit]." — fill in the three fields and a live preview sentence updates as you type, so you can see exactly how it reads.',
          'Add free-text Details for extra context, then build an Acceptance Criteria checklist — click "Add criterion" for each condition that must be true for the story to count as done, and tick them off as they\'re satisfied.',
          'Set Status (Backlog / In Progress / Review / Done), Priority (Low/Medium/High), and optionally assign it to someone in IT.',
        ],
      },
      {
        heading: 'The flagged inbox',
        body: [
          'Every product always has a "Flagged Issues → Inbox → Flagged from Call Center & Fleet" feature — this is where issues flagged by Call Center and Fleet land automatically as draft stories. Check it regularly and triage: move real work into the right feature under the right product, or work it directly from there.',
        ],
      },
    ],
    tips: [
      'Moving a story to "Done" is what logs "shipped a user story" to the company activity feed.',
      'Only IT and the MD can write here — that\'s deliberate, so the backlog stays organized by the people who own the roadmap.',
    ],
  },

  departments: {
    blurb: 'A department-by-department breakdown of the whole company — the same employee data as the Dashboard, grouped differently.',
    sections: [
      {
        heading: 'Reading it',
        body: [
          'Each department shows its active employees and their completion stats side by side, useful for comparing performance within one team without the noise of every other department.',
          'Click any employee to open their full profile, same as everywhere else in the app.',
        ],
      },
    ],
    tips: [],
  },

  leaderboard: {
    blurb: 'A weekly ranking of the top 10 employees by task completion — a lightweight nudge toward friendly competition.',
    sections: [
      {
        heading: 'How ranking works',
        body: [
          'Ranked by this week\'s completion percentage, with current streak as the tiebreaker. Only employees with at least one task set this week are included. Resets every Monday.',
          'Top 3 get a trophy, medal, or award icon and a colored border; click anyone to open their profile.',
        ],
      },
    ],
    tips: [],
  },

  search: {
    blurb: 'One search box across employees, tasks, and departments company-wide.',
    sections: [
      {
        heading: 'Using it',
        body: [
          'Start typing and results appear instantly, grouped into Employees and Tasks. Matches on employee name, department name, or task title.',
          'Click an employee result to open their profile; task results just show which employee owns them and when.',
        ],
      },
    ],
    tips: [],
  },

  admin: {
    blurb: 'User and department management — creating accounts, changing roles, and adding departments.',
    sections: [
      {
        heading: 'Creating a user',
        body: [
          '"Create User" needs a full name, email, and a temporary password (6+ characters) — the new person is forced to set their own password the first time they log in, so the temp one is disposable.',
          'Pick a role: Employee (requires picking a department — this determines exactly which workspace pages they see) or Managing Director (no department, sees everything).',
        ],
      },
      {
        heading: 'Editing an existing user',
        body: [
          'Click "Edit" on any employee card to change their role or move them to a different department. Click the trash icon to deactivate someone (their account stops working, but their historical task data is kept, not deleted).',
        ],
      },
      {
        heading: 'Departments tab',
        body: [
          'Add a new department by name, and see each existing department\'s current employee count.',
        ],
      },
    ],
    tips: [
      'Only the MD can see this page at all.',
      'Deactivating is not the same as deleting — it\'s reversible and preserves history, use it instead of trying to delete someone.',
    ],
  },
};
