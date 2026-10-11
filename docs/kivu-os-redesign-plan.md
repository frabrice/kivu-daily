# Kivu OS — redesign plan (draft for MD approval, 11 Oct 2026)

Goal: turn Kivu Daily from "a list of pages" into an operating system for
Kivu Ride — GitHub-style navigation and density, every person, driver, car,
case and owner as a page you can link to, analytics on every screen, and a
dark mode with real depth.

## 0. What's wrong today (measured)

| Problem | Evidence |
|---|---|
| Pages have no address | Navigation is a `useState` + localStorage key. No URLs → no back/forward, no "open in new tab", email links need special query handling. |
| Two apps, one product | `ManagingDirectorApp.tsx` (910 lines) and `EmployeeApp.tsx` define navigation separately; the MD gets department pages as tabs inside mega-pages, employees as sidebar items. |
| Few entry points | Only 9 places where one page links to another. A driver's name in a list doesn't open the driver. |
| No design system | 1,400+ hard-coded font sizes (`text-[11px]`, 110× `text-[9px]`, 23× `text-[8px]`); colours written per component. |
| Flat dark mode | Page `#0a1119`, sidebar `#0f1926`, card `#17263A`, borders `white/5` — three near-identical layers and near-invisible edges. |
| Slow first load | One 1.78 MB JavaScript file (plus 2.2 MB pdfmake loaded with it). |
| Analytics in silos | Charts live on 3–4 pages; most lists have no numbers on top. |

## 1. Design principles

1. **Everything is an object with a page.** Driver, car, owner, staff member, agent, case, Non-Insider driver, partner car, charging station, product, story, transaction. Each has a URL, a header, tabs, a details sidebar and a timeline.
2. **Every name is a link.** Anywhere a driver/car/person appears it is an `EntityLink`: click to open, hover for a card with key facts, middle-click for a new tab.
3. **Numbers first.** Every list page opens with an insight strip (2–4 stat cards with sparkline and change). Every stat is a link to the filtered list behind it.
4. **Three depths, never more:** page → side peek → full page. Peeks stack (driver → car → owner) with a breadcrumb inside the panel.
5. **Keyboard and search reach everything:** Ctrl K / `/` command palette, `g f` go to Fleet, `j/k` move in lists, `?` shows shortcuts.
6. **Restraint:** one primary button per view, colour only for meaning, dense rows not bubbly cards for lists.

## 2. Design system v2 (foundation)

**Tokens as CSS variables** (Tailwind reads them), three themes — Light, Dark, Dark dimmed — chosen in Settings, following the OS by default.

| Token | Light | Dark | Use |
|---|---|---|---|
| canvas | `#F6F8FA` | `#0B1220` | Page background |
| surface-1 | `#FFFFFF` | `#111B2E` | Sidebars, list rows |
| surface-2 | `#FFFFFF` + border | `#15223A` | Cards |
| surface-3 | `#FFFFFF` + shadow | `#1B2A45` | Popovers, peeks, hover |
| border | `#D0D7DE` | `#24344F` | Default edge (visible!) |
| border-muted | `#E5E9EE` | `#1B2940` | Dividers |
| fg | `#1F2328` | `#E6EDF5` | Text |
| fg-muted | `#59636E` | `#93A4BA` | Supporting text |
| fg-subtle | `#818B98` | `#6B7C93` | Captions |
| accent (brand teal) | `#2F8C86` | `#3CB9AE` | Selection, primary action |
| link | `#0969DA` | `#58A6FF` | Entity links |
| success / attention / danger / done | GitHub-Primer-like steps, validated | | Status labels with icon |

- **Type scale** (no more px): `caption 11`, `small 12`, `body 13`, `ui 14`, `title 16`, `h2 20`, `h1 24`; tabular numbers everywhere; monospace for plates, references and amounts in tables. Minimum 11px.
- **Chart palette** per theme (the validated blue/orange/aqua/yellow/violet set) + status steps, run through the palette validator for both themes.
- **Elevation, radius, spacing, motion** tokens; visible focus rings; `prefers-reduced-motion` respected.
- **Component kit `src/ui/`:** Button, IconButton, Label (GitHub-style coloured pills), Counter, Avatar + stack, StatCard (sparkline, delta, link), Box (header/body/footer), UnderlineTabs with counters, SegmentedControl, Breadcrumbs, PageHeader, FilterBar with chips (`status:owing shift:night`), DataTable v2 (sort, column picker, density, sticky header, row selection + bulk actions, pagination, CSV), EmptyState, Skeleton, Timeline, SidePeek, HoverCard, Popover, Tooltip, Toast, CommandPalette, ActivityHeatmap (GitHub contribution graph), ProgressRing, Sparkline, Kanban board.

## 3. The shell ("the OS")

```
┌ Top bar: logo · breadcrumb · search/jump (Ctrl K) · + New · inbox · shift · avatar ┐
│ Rail │ Module sidebar        │ Page                                │ Peek (optional) │
│ icons│ sections + counters   │ header · tabs · insight strip · body │ stacked panels  │
│      │ saved views · recent  │                                     │                 │
```

- **Rail (always visible, 48px):** Home, My work, Fleet, Finance, Call Center, Growth (Marketing + Social), Product Hub, People, Performance, Docs. Badges show what needs you.
- **Module sidebar:** opens for the current module; collapses to the rail. When collapsed, **hovering the left edge or a rail icon slides it out as a flyout** (the "navigation that opens with the cursor"). Pin/unpin per module, remembered per person.
- **Sections with live counters** (Drivers 27, Deposits 2 overdue), **Saved views** (personal + shared filters), **Recent** (last 8 objects opened), **Pinned**.
- **Right edge:** hovering opens a "Today" drawer — your tasks, shift, notifications — from any page.
- **Side peek:** clicking a row opens the object on the right without leaving the list; Esc closes; "Open full page" expands. Peeks stack.
- **Workspace tabs (optional, see decisions):** an OS-style strip of open objects across the top of the page area, kept per person.
- **One app for everyone:** a single route registry describes every module and page with `canSee(profile, duties)`. The MD sees all modules; staff see theirs plus shared ones. Removes the MD/employee duplication.
- **Mobile:** bottom tab bar (5 most-used modules), module sidebar as a sheet, peeks as full-screen sheets.

## 4. Page templates

1. **Module overview** — insight strip, 2–3 charts, "Needs attention" queue, recent activity. Every number clickable.
2. **List** — header with counters as tabs (`Open 12 · Closed 40`, like GitHub issues), filter bar with chips + saved views, view switch (table / board / cards / calendar), bulk actions, pagination, export.
3. **Object page** — title + status label + key facts, underline tabs with counters, right details sidebar (related objects as links), timeline of everything that happened, contribution-style heatmap where it fits (payments, attendance, activity).
4. **Report** — period picker, compare to previous period, printable/PDF.

## 5. Object pages (new or rebuilt)

| Object | Tabs | Analytics on the page |
|---|---|---|
| Driver | Overview · Payments · Days off · Fines · Calls/cases · Documents · Activity | Payment heatmap, paid-on-time %, days lost trend, owes now, vs fleet average |
| Car | Overview · Drivers · Days · Owner payouts · Licences · Branding/device | Utilisation calendar, worked/lost/off days, revenue vs owner payout |
| Vehicle owner | Cars · Payouts · Newsletters | Paid vs pending, per-car earnings |
| Staff member | Tasks · Activity · Cases · Shifts (agents) | Activity heatmap, task completion & on-time trend, response times |
| Call Center agent | (exists) moved into the new template | Starts calendar, calls, outreach, quality |
| Case / ticket | Conversation timeline · Details sidebar | Response clock, SLA state |
| Non-Insider driver / partner car | Calls · Answers · Branding/device | Rounds history, conversion |
| Charging station | Survey · Analysis · Photos | Existing analysis, in template |
| Product / story | Stories · Issues | Status burndown |
| Department | People · Duties · Tasks | Team completion, workload |

## 6. Module by module

- **Home / My work (everyone):** in-app "Your day" (focus line, smart tasks with progress rings, urgent first), personal heatmap and streak, inbox of mentions/cases, quick actions for the role.
- **MD Command Center:** replaces Dashboard + Performance overview: "Waiting on you", company pulse (live cars working, drivers paid up, money today, calls now, agents on shift), department health cards, alerts feed. Performance tabs become the "Insights" section.
- **Fleet:** overview (cars per day, payment health, days off), Drivers (list/board by stage), Cars (grid with live state), Deposits (queue + calendar), Days off (calendar view), Fines, Branding & Devices (kanban), Leaderboard.
- **Finance:** overview (cash in/out, revenue, approvals queue with ageing), Transactions (one ledger with type filters instead of 6 separate pages), Approvals inbox (check → approve flow with keyboard), Payroll, Owners, Reconciliation (side-by-side matching), Deposit confirmations.
- **Call Center:** live board (who's on shift, open cases by age, callbacks due), Cases (inbox like GitHub notifications: assigned, mentioned, waiting), Queue, Outreach (rounds progress, funnel), Script Book (searchable, with usage stats), Agents.
- **Growth (Marketing + Social):** campaigns pipeline (board), contacts/CRM with follow-up calendar, content calendar, B2B outreach funnel.
- **Product Hub:** products, stories as a project board (GitHub Projects-style: Backlog / In progress / Review / Done), issues from departments, release notes.
- **People:** directory, departments, duties (who owns what), leaderboard, payroll links (Finance only).
- **Docs:** documents, meetings, announcements, How to Use (rewritten for the new layout).

## 7. Technical approach

- **Routing:** `react-router` (data router) with real URLs (`/fleet/drivers/:id`, `/call-center/agents/:id`); email links become plain URLs; old `?ticket=` links keep working through a redirect.
- **Data:** `@tanstack/react-query` as the shared cache so a driver opened in a peek, a list and a page is one fetch, updated live from Supabase realtime. Existing hooks are wrapped, not rewritten, in phase 1.
- **Command palette:** `cmdk`; **popovers/hover cards:** `@floating-ui/react`; **tables:** `@tanstack/react-table` under our own DataTable v2. Charts stay on recharts via the shared kit.
- **Code splitting:** each module loads on demand (`React.lazy`); pdfmake only when a PDF is made. Target: first screen under 400 KB.
- **Safe rollout:** the new shell ships behind a per-person switch ("Try the new Kivu OS" in Settings), every old page mounted inside it from day one, then pages move to the new templates one module at a time. When everything is moved, the old shell is deleted.
- **Quality gates per phase:** type check + build, light/dark/dim contrast check on tokens, palette validator on chart colours, 375px phone check, keyboard-only pass, real-data review with the MD before switching anyone else.

## 8. Phases

| Phase | Delivers | Visible result |
|---|---|---|
| 1. Foundation | Tokens + 3 themes, type scale, `src/ui` kit, router, query cache, code splitting | Faster app; new dark mode everywhere existing pages use `.card`/`.btn` |
| 2. Shell | Top bar, rail, flyout module sidebars, command palette, side peek, Today drawer, one route registry for MD + staff, mobile tab bar | The OS feel; every page reachable by URL and search |
| 3. Objects | Driver, Car, Owner, Staff, Case, Non-Insider pages + EntityLink/hover cards everywhere | Click any name, see everything about it |
| 4. Modules | Fleet → Finance → Call Center → MD Command Center → Growth → Product Hub → People/Docs, each with overview + insight strips + saved views | Analytics on every page |
| 5. Polish | Workspace tabs, shortcuts, saved/shared views, How to Use rewrite, announcement email to staff, old shell removed | Done |

Each phase is shipped and usable on its own; nothing breaks for staff in between.

## 9. Decisions for the MD

1. Rollout: new shell for the MD first behind a switch, then everyone (recommended) — or switch everyone at once.
2. Themes: Light + Dark + Dark dimmed (recommended) — or Light + Dark only.
3. Brand: keep teal + navy as the accent (recommended) — or a fresh accent.
4. Workspace tabs (OS-style open objects strip): yes / later.
5. Module order after the shell: Fleet → Finance → Call Center → MD (recommended) — or another order.
6. Merge Finance's six transaction pages into one ledger with filters (recommended): yes / no.
