# Kivu OS build — progress log

Branch: `kivu-os` (main stays live until release). Plan: `docs/kivu-os-redesign-plan.md`.

MD decisions (11 Oct 2026): everyone at once (no opt-in switch) · Light + Dark only ·
keep teal/navy · workspace tabs YES · all modules at once · Finance ledger merge YES.

## Status
- [x] P1 Foundation: deps, tokens/themes (contrast-checked), type scale codemod (139 files), fonts, query cache, lazy pages
- [x] P2 Shell: router + registry (one app for MD + staff), top bar, rail + hover flyouts, sidebars with counters, workspace tabs, command palette, side peeks, Today drawer, mobile bar, shortcuts, legacy email links, page error boundary
- [x] P3 Objects: Driver, Car, Owner, Person, Agent, Case, Non-Insider pages; EntityLink + hover cards wired into lists (stations stay in MD Panel)
- [x] P4 Modules: MD Command Center, staff Home, Fleet overview, Finance ledger (suppliers/transfers/expenses folded in), Call Center live board, number strips on Fleet/Cases/Growth/Product/People lists, What's new
- [x] P5 Polish: How to Use 'Getting around', launch email rule kivu_os_launch (OFF until MD switches it on; sends once), old shells deleted, debug harness removed, phone check 375px on 36 pages, 59-route crash sweep clean, build 672 KB main chunk (was 1.78 MB)
- [ ] Release: MD reviews with real data (Vercel preview of branch kivu-os), merge to main, switch on kivu_os_launch

## Notes
- (removed) Debug harness: `?debugos=md|fleet|call_center|finance|it` (sessionStorage flag) renders OsApp with a fake profile, no login. Files marked `DEBUG TEMP` (src/DebugOs.tsx, main.tsx lines, lib/auth.tsx export) must be removed before release.
- Stubs to replace: src/pages/os/{FleetOverview,FinanceLedger,CallCenterOverview,WhatsNew,StaffHome}.tsx, src/pages/entities/*.tsx.
- Old shells EmployeeApp.tsx / components/AppShell.tsx no longer mounted (AppShell types NavKey/NavItem still imported by HowToUse) - delete in P5.
