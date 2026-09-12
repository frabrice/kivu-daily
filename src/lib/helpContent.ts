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

export const HELP_CONTENT: Partial<Record<NavKey, HelpEntry>> = {
  home: {
    blurb: "Your daily task list — the thing you fill in every morning and get reviewed on every evening.",
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
          'Six columns: Applying, Training, Active, Waiting, Flagged, Inactive. Each driver is a card in exactly one column, showing their name and phone number.',
        ],
      },
      {
        heading: 'Adding and editing drivers',
        body: [
          '"Add Driver" opens a form for name, phone, starting stage, and free-text notes. Clicking any existing driver card opens the same form to edit them — change their stage here to move them to a different column, add notes, or update their phone number.',
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
