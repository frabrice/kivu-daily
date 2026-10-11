# Kivu OS build — progress log

Branch: `kivu-os` (main stays live until release). Plan: `docs/kivu-os-redesign-plan.md`.

MD decisions (11 Oct 2026): everyone at once (no opt-in switch) · Light + Dark only ·
keep teal/navy · workspace tabs YES · all modules at once · Finance ledger merge YES.

## Status
- [x] P1 Foundation: deps, tokens/themes (contrast-checked), type scale codemod (139 files), fonts, query cache, lazy pages
- [~] P2 Shell (working: router, registry, top bar, rail+flyout, sidebar, tabs, palette, peek, Today, mobile bar, shortcuts, legacy links): router + route registry (one app for MD + staff), top bar, rail, flyout sidebars, command palette, peeks, Today drawer, workspace tabs, mobile
- [ ] P3 Objects: Driver, Car, Owner, Staff, Agent, Case, Non-Insider, Station pages; EntityLink + hover cards
- [ ] P4 Modules: Fleet, Finance (ledger), Call Center, MD Command Center, Growth, Product Hub, People, Docs
- [ ] P5 Polish: shortcuts, saved views, How to Use, staff email, remove old shell
- [ ] Release: build, phone check, real-data review with MD, merge to main

## Notes
- Debug harness: `?debugos=md|fleet|call_center|finance|it` (sessionStorage flag) renders OsApp with a fake profile, no login. Files marked `DEBUG TEMP` (src/DebugOs.tsx, main.tsx lines, lib/auth.tsx export) must be removed before release.
- Stubs to replace: src/pages/os/{FleetOverview,FinanceLedger,CallCenterOverview,WhatsNew,StaffHome}.tsx, src/pages/entities/*.tsx.
- Old shells EmployeeApp.tsx / components/AppShell.tsx no longer mounted (AppShell types NavKey/NavItem still imported by HowToUse) - delete in P5.
