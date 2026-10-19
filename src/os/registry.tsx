import { lazy, LazyExoticComponent, ComponentType } from 'react';
import {
  Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpen, Calendar, CalendarClock, CalendarOff, Car, CarFront, ClipboardCheck,
  Route, Flag, Inbox, FileSignature, FileText, Gauge, Headphones, HelpCircle, Home, Image as ImageIcon, Landmark, LayoutDashboard, ListTodo, LucideIcon, Mail,
  Megaphone, MessageSquare, Package, Paintbrush, PhoneCall, PhoneIncoming, Radio, Receipt, Rocket, Search, Settings, Shield, ShieldCheck,
  Target, Timer, TrendingUp, Trophy, Truck, UserCog, Users2, Wallet, Building2, BookMarked, ScrollText, CalendarCheck, Gavel, Compass, Coins,
} from 'lucide-react';
import { Access } from './access';
import { withChunkReload } from '../lib/chunkReload';

// The whole app in one table: every module (rail icon), every page in its
// sidebar, its address, and who may see it. The shell, the router, the
// command palette, How to Use and the mobile menu all read from here.

export type BadgeKey = 'itInbox' | 'itProposed' | 'planBudgets' | 'myCases' | 'unreadComments' | 'carFollowups' | 'overdueDeposits' | 'pendingPauses' | 'openIssues' | 'pendingFinance' | 'myOpenTasks' | 'missingContracts' | 'missingAgreements';

export interface PageDef {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  component: LazyExoticComponent<ComponentType>;
  can?: (a: Access) => boolean;
  badge?: BadgeKey;
  group?: string;          // sidebar section heading
  keywords?: string;       // extra words for the command palette
  description?: string;    // shown in How to Use and the palette
  hidden?: boolean;        // has an address but no menu entry (old pages folded into others)
}

export interface ModuleDef {
  id: string;
  label: string;
  icon: LucideIcon;
  base: string;
  pages: PageDef[];
  shortcut?: string;       // "g f" etc.
}

// Every page loads through withChunkReload: right after a deploy, a stale
// page file reloads the app with the new version instead of an error.
const L = (f: () => Promise<{ default: ComponentType<never> }>) => lazy(withChunkReload(f as () => Promise<{ default: ComponentType }>));
// A list page with its number strip on top (see strips.tsx).
type StripName = 'DriversStrip' | 'CarsStrip' | 'DepositsStrip' | 'DaysOffStrip' | 'FinesStrip' | 'CasesStrip' | 'GrowthStrip' | 'ProductStrip' | 'PeopleStrip';
const LS = (f: () => Promise<{ default: ComponentType<never> }>, strip: StripName) =>
  lazy(withChunkReload(() => Promise.all([f(), import('./strips')]).then(([page, s]) => ({ default: s.withStrip(page.default as ComponentType, s[strip]) }))));

// ---- adapters for pages that need props from the old app shells
const A = {
  StaffTasks: L(() => import('./adapters').then((m) => ({ default: m.StaffTasks }))),
  StaffCalendar: L(() => import('./adapters').then((m) => ({ default: m.StaffCalendar }))),
  StaffAnalytics: L(() => import('./adapters').then((m) => ({ default: m.StaffAnalytics }))),
  MyCases: L(() => import('./adapters').then((m) => ({ default: m.MyCases }))),
  CallCases: L(() => import('./adapters').then((m) => ({ default: m.CallCases }))),
  CallCasesStripped: LS(() => import('./adapters').then((m) => ({ default: m.CallCases })), 'CasesStrip'),
  StaffLeaderboard: L(() => import('./adapters').then((m) => ({ default: m.StaffLeaderboard }))),
  PeopleSearch: L(() => import('./adapters').then((m) => ({ default: m.PeopleSearch }))),
  Activity: L(() => import('./adapters').then((m) => ({ default: m.ActivityLog }))),
  Help: L(() => import('./adapters').then((m) => ({ default: m.Help }))),
  Departments: LS(() => import('./adapters').then((m) => ({ default: m.Departments })), 'PeopleStrip'),
  Performance: L(() => import('./adapters').then((m) => ({ default: m.Performance }))),
  Home: L(() => import('./adapters').then((m) => ({ default: m.Home }))),
};

const md = (a: Access) => a.isMd;
const staff = (a: Access) => !a.isMd;

export const MODULES: ModuleDef[] = [
  {
    id: 'home', label: 'Home', icon: Home, base: '/', shortcut: 'g h',
    pages: [
      { id: 'home', path: '/', label: 'Home', icon: Home, component: A.Home, description: 'Your day: what needs you, your numbers, what changed.' },
    ],
  },
  {
    id: 'me', label: 'My work', icon: ListTodo, base: '/me', shortcut: 'g m',
    pages: [
      { id: 'my-tasks', path: '/me/tasks', label: 'My tasks', icon: ListTodo, component: A.StaffTasks, can: staff, badge: 'myOpenTasks', description: 'Your tasks for today, including the ones that update themselves.' },
      { id: 'md-tasks', path: '/me/tasks', label: 'Tasks', icon: ListTodo, component: L(() => import('../pages/MDTasksPage')), can: md, description: 'Your own tasks and tasks you gave the team.' },
      { id: 'my-calendar', path: '/me/calendar', label: 'Calendar', icon: Calendar, component: A.StaffCalendar, can: staff },
      { id: 'my-cases', path: '/me/cases', label: 'Cases for me', icon: Headphones, component: A.MyCases, badge: 'myCases', keywords: 'from call center tickets', description: 'Callers the Call Center handed to you.' },
      { id: 'my-analytics', path: '/me/analytics', label: 'My analytics', icon: TrendingUp, component: A.StaffAnalytics, can: staff },
      { id: 'md-comments', path: '/me/comments', label: 'Comments', icon: MessageSquare, component: L(() => import('../pages/MDCommentsPage')), can: md, badge: 'unreadComments' },
    ],
  },
  {
    id: 'meetings', label: 'Meetings', icon: CalendarCheck, base: '/meetings', shortcut: 'g e',
    pages: [
      { id: 'meetings', path: '/meetings', label: 'Meetings', icon: CalendarCheck, component: L(() => import('../pages/meetings/MeetingsPage')), keywords: 'meeting attendance notes one-to-one booking daily fleet it call center 19:00', description: 'Regular meetings, attendance, notes, numbers, actions — and one-to-one bookings.' },
    ],
  },
  {
    id: 'fleet', label: 'Fleet', icon: Truck, base: '/fleet', shortcut: 'g f',
    pages: [
      { id: 'fleet-overview', path: '/fleet', label: 'Overview', icon: Gauge, component: L(() => import('../pages/os/FleetOverview')), can: (a) => a.in('fleet', 'it', 'finance') },
      { id: 'fleet-drivers', path: '/fleet/drivers', label: 'Drivers', icon: Truck, component: LS(() => import('../pages/fleet/FleetPipelinePage'), 'DriversStrip'), can: (a) => a.in('fleet', 'it'), keywords: 'pipeline' },
      { id: 'fleet-cars', path: '/fleet/cars', label: 'Cars', icon: Car, component: LS(() => import('../pages/fleet/FleetVehiclesPage'), 'CarsStrip'), can: (a) => a.in('fleet', 'it'), keywords: 'vehicles' },
      { id: 'fleet-deposits', path: '/fleet/deposits', label: 'Deposits', icon: Wallet, component: LS(() => import('../pages/fleet/FleetDepositsPage'), 'DepositsStrip'), can: (a) => a.in('fleet', 'it'), badge: 'overdueDeposits', group: 'Money' },
      { id: 'fleet-fines', path: '/fleet/fines', label: 'Fines', icon: Receipt, component: LS(() => import('../pages/fleet/FleetFinesPage'), 'FinesStrip'), can: (a) => a.in('fleet', 'it'), group: 'Money' },
      { id: 'fleet-car-money', path: '/fleet/car-money', label: 'Cars: should vs did', icon: Car, component: L(() => import('../pages/fleet/CarMoneyPage')), can: (a) => a.in('fleet', 'finance', 'it'), group: 'Money', keywords: 'car by car expected collected lost defaulted replaced freelance every franc', description: 'Every car: what it should have brought, what it did, who defaulted and who replaced them.' },
      { id: 'fleet-freelancers', path: '/fleet/freelancers', label: 'Freelance drivers', icon: UserCog, component: L(() => import('../pages/fleet/FreelancersPage')), can: (a) => a.in('fleet', 'finance', 'it'), group: 'Money', keywords: 'freelance part-time cover shift 30k pool replacement', description: 'The pool that covers a shift the same day a driver does not pay.' },
      { id: 'fleet-days-off', path: '/fleet/days-off', label: 'Days off', icon: CalendarOff, component: LS(() => import('../pages/fleet/DriverPausesPage'), 'DaysOffStrip'), can: (a) => a.in('fleet', 'it', 'finance'), badge: 'pendingPauses', group: 'Money', keywords: 'pauses sick garage' },
      { id: 'fleet-contracts', path: '/fleet/contracts', label: 'Contracts', icon: FileSignature, component: L(() => import('../pages/os/LegalDocsPage').then((m) => ({ default: m.FleetContractsPage }))), can: (a) => a.in('fleet', 'it'), badge: 'missingContracts', keywords: 'contract termination letter amendment signed stamped missing documents', description: 'Signed and stamped driver contracts, amendments and termination letters — and what is missing.' },
      { id: 'fleet-leaderboard', path: '/fleet/leaderboard', label: 'Leaderboard', icon: Trophy, component: L(() => import('../pages/fleet/DepositLeaderboardPage')), can: (a) => a.in('fleet', 'it', 'finance'), group: 'Money' },
      { id: 'fleet-branding', path: '/fleet/branding', label: 'Branding & devices', icon: Paintbrush, component: L(() => import('../pages/fleet/BrandingDevicesPage')), can: (a) => a.in('fleet', 'it'), badge: 'carFollowups', group: 'Partners' },
      { id: 'non-insider', path: '/non-insider', label: 'Non-Insider', icon: CarFront, component: L(() => import('../pages/nonInsider/NonInsiderPage')), can: (a) => a.in('fleet', 'it'), group: 'Partners', keywords: 'platform drivers cars partners' },
    ],
  },
  {
    id: 'trips', label: 'Trips', icon: Route, base: '/trips', shortcut: 'g r',
    pages: [
      { id: 'trips', path: '/trips', label: 'All trips', icon: Route, component: L(() => import('../pages/os/TripsPage')), can: (a) => a.in('call_center', 'fleet', 'finance', 'it'), keywords: 'rides kivuride platform trips status rider driver fare', description: 'Every KivuRide trip and its live status, synced from the platform every 2 minutes.' },
      { id: 'trips-companies', path: '/trips/companies', label: 'Companies', icon: Building2, component: L(() => import('../pages/os/CompaniesPage')), can: (a) => a.in('finance', 'call_center') || a.duties.has('company_trips') || a.grants.has('business'), group: 'Business', keywords: 'business clients corporate company cevr billing riders', description: 'Companies whose people ride with Kivu Ride: their trips, weekly analytics, invoices and statement.' },
      { id: 'trips-invoices', path: '/trips/invoices', label: 'Invoices', icon: Receipt, component: L(() => import('../pages/os/InvoicesPage')), can: (a) => a.in('finance') || a.grants.has('business'), group: 'Business', keywords: 'invoice billing vat payments unpaid overdue statement', description: 'Every company invoice: unpaid and overdue first, payments, and the details printed on invoices.' },
    ],
  },
  {
    id: 'finance', label: 'Finance', icon: Wallet, base: '/finance', shortcut: 'g $',
    pages: [
      { id: 'finance-overview', path: '/finance', label: 'Overview', icon: LayoutDashboard, component: L(() => import('../pages/os/FinanceOverview')), can: (a) => a.in('finance'), description: 'What we made, spent and lost; money in and out; every car against its 360,000 a week.', keywords: 'made spent lost leakage commissions management fees onboarding owners' },
      { id: 'finance-ledger', path: '/finance/ledger', label: 'Ledger', icon: ScrollText, component: L(() => import('../pages/os/FinanceLedger')), can: (a) => a.in('finance'), badge: 'pendingFinance', keywords: 'transactions suppliers transfers expense claims payments', description: 'Every transaction in one place, with filters by type, status and account.' },
      { id: 'finance-confirmations', path: '/finance/confirmations', label: 'Deposit confirmations', icon: ShieldCheck, component: L(() => import('../pages/finance/FinanceDepositConfirmationsPage')), can: (a) => a.in('finance') },
      { id: 'finance-revenue', path: '/finance/revenue', label: 'Revenue', icon: TrendingUp, component: L(() => import('../pages/finance/FinanceRevenuePage')), can: (a) => a.in('finance'), group: 'Income' },
      { id: 'finance-collections', path: '/finance/collections', label: 'Fleet collections', icon: Wallet, component: L(() => import('../pages/finance/FinanceFleetCollectionsPage')), can: (a) => a.in('finance'), group: 'Income' },
      { id: 'finance-owners', path: '/finance/owners', label: 'Vehicle owners', icon: Car, component: L(() => import('../pages/finance/FinanceVehicleOwnersPage')), can: (a) => a.in('finance'), group: 'Owners' },
      { id: 'finance-agreements', path: '/finance/agreements', label: 'Agreements', icon: FileSignature, component: L(() => import('../pages/os/LegalDocsPage').then((m) => ({ default: m.FinanceAgreementsPage }))), can: (a) => a.in('finance'), badge: 'missingAgreements', group: 'Owners', keywords: 'management agreement owner signed stamped missing documents', description: 'Signed and stamped owner management agreements — and which owners are missing one.' },
      { id: 'finance-newsletters', path: '/finance/newsletters', label: 'Newsletters', icon: Mail, component: L(() => import('../pages/finance/NewslettersPage')), can: (a) => a.in('finance'), group: 'Owners' },
      { id: 'finance-payroll', path: '/finance/payroll', label: 'Staff payroll', icon: Users2, component: L(() => import('../pages/finance/FinancePayrollPage')), can: (a) => a.in('finance'), group: 'Payroll' },
      { id: 'finance-driver-payroll', path: '/finance/driver-payroll', label: 'Driver payroll', icon: Truck, component: L(() => import('../pages/finance/FinanceDriverPayrollPage')), can: (a) => a.in('finance'), group: 'Payroll' },
      { id: 'finance-suppliers', path: '/finance/suppliers', label: 'Supplier payments', icon: Truck, component: L(() => import('./adapters').then((m) => ({ default: m.ledgerOf('supplier_payment') }))), can: (a) => a.in('finance'), group: 'Payments', hidden: true },
      { id: 'finance-transfers', path: '/finance/transfers', label: 'Bank transfers', icon: ArrowLeftRight, component: L(() => import('./adapters').then((m) => ({ default: m.ledgerOf('transfer') }))), can: (a) => a.in('finance'), group: 'Payments', hidden: true },
      { id: 'finance-expenses', path: '/finance/expenses', label: 'Expense claims', icon: Receipt, component: L(() => import('./adapters').then((m) => ({ default: m.ledgerOf('expense_claim') }))), can: (a) => a.in('finance'), group: 'Payments', hidden: true },
      { id: 'finance-accounts', path: '/finance/accounts', label: 'Bank accounts', icon: Landmark, component: L(() => import('../pages/finance/FinanceAccountsPage')), can: (a) => a.in('finance'), group: 'Banks' },
      { id: 'finance-reconciliation', path: '/finance/reconciliation', label: 'Reconciliation', icon: ClipboardCheck, component: L(() => import('../pages/finance/FinanceReconciliationPage')), can: (a) => a.in('finance'), group: 'Banks' },
      { id: 'finance-team', path: '/finance/team', label: 'Team', icon: UserCog, component: L(() => import('../pages/finance/FinanceTeamPage')), can: (a) => a.in('finance'), group: 'Banks' },
    ],
  },
  {
    id: 'calls', label: 'Call Center', icon: PhoneCall, base: '/call-center', shortcut: 'g c',
    pages: [
      { id: 'calls-overview', path: '/call-center', label: 'Live board', icon: Gauge, component: L(() => import('../pages/os/CallCenterOverview')), can: (a) => a.in('call_center', 'finance'), description: 'Who is on shift, open cases by age, call-backs due and today\'s numbers.' },
      { id: 'calls-cases', path: '/call-center/cases', label: 'Calls & cases', icon: PhoneIncoming, component: A.CallCasesStripped, can: (a) => a.in('call_center'), keywords: 'tickets' },
      { id: 'calls-queue', path: '/call-center/queue', label: 'Call queue', icon: PhoneCall, component: L(() => import('../pages/callCenter/CallQueuePage')), can: (a) => a.in('call_center') },
      { id: 'calls-commissions', path: '/call-center/commissions', label: 'Commission follow-up', icon: Coins, component: L(() => import('../pages/callCenter/CommissionFollowupPage')), can: (a) => a.in('call_center', 'finance') || a.plan === 'full', keywords: 'commission unpaid drivers follow-up collect', description: "Call every driver with yesterday's unpaid commission and record the outcome." },
      { id: 'calls-outreach', path: '/call-center/outreach', label: 'Outreach', icon: Megaphone, component: L(() => import('../pages/callCenter/OutreachPage')), can: (a) => a.in('call_center') , keywords: 'non-insider rounds calls log' },
      { id: 'calls-non-insider', path: '/non-insider', label: 'Non-Insider', icon: CarFront, component: L(() => import('../pages/nonInsider/NonInsiderPage')), can: (a) => a.dept === 'call_center', keywords: 'platform drivers cars partners' },
      { id: 'calls-directory', path: '/call-center/directory', label: 'Directory', icon: BookMarked, component: L(() => import('../pages/callCenter/CallDirectoryPage')), can: (a) => a.in('call_center') },
      { id: 'calls-scripts', path: '/call-center/scripts', label: 'Script Book', icon: BookOpen, component: L(() => import('../pages/callCenter/ScriptBookPage')), can: (a) => a.in('call_center') },
      { id: 'calls-shifts', path: '/call-center/shifts', label: 'Shifts & agents', icon: Timer, component: L(() => import('../pages/callCenter/ShiftsPerformancePage')), can: md, group: 'Performance' },
      { id: 'calls-analytics', path: '/call-center/analytics', label: 'Call analytics', icon: BarChart3, component: L(() => import('../pages/callCenter/CallAnalyticsPage')), can: (a) => a.in('finance'), group: 'Performance' },
    ],
  },
  {
    id: 'growth', label: 'Growth', icon: Target, base: '/growth', shortcut: 'g g',
    pages: [
      { id: 'growth-campaigns', path: '/growth/campaigns', label: 'Campaigns', icon: Target, component: LS(() => import('../pages/marketing/CampaignsPage'), 'GrowthStrip'), can: (a) => a.in('marketing_sales_bd'), keywords: 'marketing sales crm contacts' },
      { id: 'growth-followups', path: '/growth/follow-ups', label: 'Follow-ups', icon: CalendarClock, component: LS(() => import('../pages/marketing/FollowUpsPage'), 'GrowthStrip'), can: (a) => a.in('marketing_sales_bd') },
      { id: 'growth-content', path: '/growth/content', label: 'Content calendar', icon: ImageIcon, component: L(() => import('../pages/SocialMediaPage')), can: (a) => a.in('social_media'), keywords: 'social media posts' },
    ],
  },
  {
    id: 'product', label: 'IT & Product', icon: Package, base: '/product', shortcut: 'g p',
    pages: [
      { id: 'it-overview', path: '/product', label: 'Overview', icon: Gauge, component: L(() => import('../pages/it/ItPages').then((m) => ({ default: m.ItOverview }))), can: (a) => a.in('it'), keywords: 'it product roadmap engineering', description: 'Milestones now, who is on what, what needs attention.' },
      { id: 'product-issues', path: '/product/issues', label: 'Issues', icon: AlertTriangle, component: L(() => import('../pages/it/ItPages').then((m) => ({ default: m.ItIssues }))), can: (a) => a.in('it'), keywords: 'it stories bugs tasks board kanban', description: 'All IT work on a board or a table.' },
      { id: 'it-milestones', path: '/product/milestones', label: 'Milestones', icon: Flag, component: L(() => import('../pages/it/ItPages').then((m) => ({ default: m.ItMilestones }))), can: (a) => a.in('it'), keywords: 'sprint milestone release plan', description: 'Time-boxed delivery with progress by area.' },
      { id: 'it-inbox', path: '/product/inbox', label: 'Inbox', icon: Inbox, component: L(() => import('../pages/it/ItPages').then((m) => ({ default: m.ItInbox }))), can: (a) => a.in('it'), badge: 'itInbox', keywords: 'requests flags ideas triage', description: 'Requests from the company, triaged by the head of IT.' },
      { id: 'it-roadmap', path: '/product/roadmap', label: 'Roadmap', icon: Route, component: L(() => import('../pages/it/ItPlanPages').then((m) => ({ default: m.ItRoadmap }))), can: (a) => a.in('it'), badge: 'itProposed', group: 'Plan', keywords: 'projects initiatives now next later timeline gantt', description: 'Big projects: now, next and later, with budgets and MD approval.' },
      { id: 'it-objectives', path: '/product/objectives', label: 'Objectives', icon: Target, component: L(() => import('../pages/it/ItPlanPages').then((m) => ({ default: m.ItObjectives }))), can: (a) => a.in('it'), group: 'Plan', keywords: 'okr goals key results quarter', description: 'Quarterly objectives and the key results that measure them.' },
      { id: 'it-budget', path: '/product/budget', label: 'Budget', icon: Wallet, component: L(() => import('../pages/it/ItPlanPages').then((m) => ({ default: m.ItBudget }))), can: (a) => a.in('it', 'finance'), group: 'Plan', keywords: 'it spending money approved planned', description: 'IT project budgets: approved, planned, committed and spent.' },
      { id: 'it-health', path: '/product/health', label: 'Health', icon: Activity, component: L(() => import('../pages/it/ItHealthPage').then((m) => ({ default: m.ItHealth }))), can: (a) => a.in('it'), group: 'Ship', keywords: 'sentry github errors crashes commits trips completion metrics', description: 'Trips, app errors and code activity against our goals.' },
      { id: 'it-releases', path: '/product/releases', label: 'Releases', icon: Rocket, component: L(() => import('../pages/it/ItShipPages').then((m) => ({ default: m.ItReleases }))), can: (a) => a.in('it'), group: 'Ship', keywords: 'release version deploy store changelog notes', description: 'Versions going out, what they ship, the checklist and release notes.' },
      { id: 'it-review', path: '/product/review', label: 'Weekly review', icon: CalendarCheck, component: L(() => import('../pages/it/ItShipPages').then((m) => ({ default: m.ItReview }))), can: (a) => a.in('it'), group: 'Ship', keywords: 'meeting weekly report retro pdf', description: 'The IT meeting on one page, with notes and a PDF.' },
      { id: 'it-decisions', path: '/product/decisions', label: 'Decisions', icon: Gavel, component: L(() => import('../pages/it/ItShipPages').then((m) => ({ default: m.ItDecisions }))), can: (a) => a.in('it'), group: 'Ship', keywords: 'decision log adr why architecture', description: 'Why things are the way they are.' },
      { id: 'it-team', path: '/product/team', label: 'Team', icon: Users2, component: L(() => import('../pages/it/ItPages').then((m) => ({ default: m.ItTeam }))), can: (a) => a.in('it'), keywords: 'check-in working on developers', description: 'What everyone is working on, and the daily check-ins.' },
      { id: 'product-products', path: '/product/products', label: 'Products (old)', icon: Package, component: LS(() => import('../pages/itHub/ProductsPage'), 'ProductStrip'), can: (a) => a.in('it'), hidden: true },
    ],
  },
  {
    id: 'people', label: 'People', icon: Users2, base: '/people', shortcut: 'g t',
    pages: [
      { id: 'people-departments', path: '/people', label: 'Departments', icon: Building2, component: A.Departments, can: md, keywords: 'team staff employees' },
      { id: 'people-leaderboard', path: '/people/leaderboard', label: 'Leaderboard', icon: Trophy, component: A.StaffLeaderboard, can: md },
      { id: 'people-search', path: '/people/search', label: 'Search tasks', icon: Search, component: A.PeopleSearch, can: md },
      { id: 'people-activity', path: '/people/activity', label: 'Activity log', icon: Radio, component: A.Activity, can: md },
    ],
  },
  {
    id: 'insights', label: 'Insights', icon: Activity, base: '/insights', shortcut: 'g i',
    pages: [
      { id: 'insights', path: '/insights', label: 'Performance', icon: Activity, component: A.Performance, can: md, keywords: 'analytics kpi trends', description: 'People, drivers, cars, money and the Call Center over time.' },
    ],
  },
  {
    id: 'docs', label: 'Docs', icon: FileText, base: '/docs', shortcut: 'g d',
    pages: [
      { id: 'docs-announcements', path: '/docs/announcements', label: 'Announcements', icon: Megaphone, component: L(() => import('../pages/AnnouncementsPage')), can: md },
      { id: 'docs-meetings', path: '/docs/meetings', label: 'Meetings', icon: Calendar, component: L(() => import('../pages/meetings/MeetingsPage')), hidden: true },
      { id: 'docs-meeting-notes', path: '/docs/meeting-notes', label: 'Old meeting notes', icon: Calendar, component: L(() => import('../pages/MeetingsPage')), can: md, hidden: true },
      { id: 'docs-documents', path: '/docs/documents', label: 'Documents', icon: FileText, component: L(() => import('../pages/DocumentsPage')), can: md },
      { id: 'help', path: '/docs/help', label: 'How to use', icon: HelpCircle, component: A.Help },
      { id: 'whats-new', path: '/docs/whats-new', label: "What's new", icon: Rocket, component: L(() => import('../pages/os/WhatsNew')) },
    ],
  },
  {
    // The company plan: the MD and owners see everything, department heads their part.
    id: 'company', label: 'Company plan', icon: Compass, base: '/company', shortcut: 'g v',
    pages: [
      { id: 'company-direction', path: '/company', label: 'Direction', icon: Compass, component: L(() => import('../pages/company/CompanyPages').then((m) => ({ default: m.CompanyDirection }))), can: (a) => !!a.plan, keywords: 'vision mission north star strategy plan company', description: 'Vision, the North Star and what matters this quarter.' },
      { id: 'company-objectives', path: '/company/objectives', label: 'Objectives', icon: Target, component: L(() => import('../pages/company/CompanyPages').then((m) => ({ default: m.CompanyObjectives }))), can: (a) => !!a.plan, keywords: 'okr goals quarter key results company', description: 'Quarterly company objectives with live key results.' },
      { id: 'company-priorities', path: '/company/priorities', label: 'Priorities', icon: Flag, component: L(() => import('../pages/company/CompanyPages').then((m) => ({ default: m.CompanyPriorities }))), can: (a) => !!a.plan, keywords: 'priorities bets roadmap now next later not doing', description: 'One ranked list of company bets.' },
      { id: 'company-expansion', path: '/company/expansion', label: 'Expansion', icon: Route, component: L(() => import('../pages/company/GrowthPages').then((m) => ({ default: m.CompanyExpansion }))), can: (a) => !!a.plan, keywords: 'expansion provinces cities musanze rubavu huye rwamagana gates stages rwanda', description: 'The journey to all of Rwanda: stages, gates and what each needs.' },
      { id: 'company-marketing', path: '/company/marketing', label: 'Marketing plan', icon: Megaphone, component: L(() => import('../pages/company/GrowthPages').then((m) => ({ default: m.CompanyMarketing }))), can: (a) => !!a.plan, keywords: 'marketing plan activities channels drivers riders companies launch cost per result', description: 'Marketing activities grouped by what the company needs.' },
      { id: 'company-review', path: '/company/review', label: 'Monthly review', icon: CalendarCheck, component: L(() => import('../pages/company/ReviewPages').then((m) => ({ default: m.CompanyReview }))), can: (a) => a.plan === 'full', keywords: 'monthly review partners meeting report pdf board', description: "The partners' monthly meeting on one page, with notes and a PDF." },
      { id: 'company-decisions', path: '/company/decisions', label: 'Decisions', icon: Gavel, component: L(() => import('../pages/company/ReviewPages').then((m) => ({ default: m.CompanyDecisions }))), can: (a) => !!a.plan, keywords: 'decisions log why company', description: 'What the company decided and why.' },
      { id: 'company-money', path: '/company/money', label: 'Money', icon: Landmark, component: L(() => import('../pages/company/MoneyPage').then((m) => ({ default: m.CompanyMoney }))), can: (a) => a.plan === 'full', keywords: 'cash runway burn funding investors pipeline sources uses scenario break-even', description: 'Cash, runway, funding pipeline, sources & uses and scenarios.' },
      { id: 'company-budgets', path: '/company/budgets', label: 'Budgets', icon: Wallet, component: L(() => import('../pages/company/CompanyPages').then((m) => ({ default: m.CompanyBudgets }))), can: (a) => !!a.plan, badge: 'planBudgets', keywords: 'budget money spending marketing plan approve', description: 'Budgets built one by one, approved by the MD, spending from Finance.' },
    ],
  },
  {
    id: 'admin', label: 'Admin', icon: Shield, base: '/admin',
    pages: [
      { id: 'md-panel', path: '/admin', label: 'MD Panel', icon: Shield, component: L(() => import('../pages/MDPanel')), can: md, keywords: 'research charging stations email notifications recurring tasks' },
      { id: 'settings', path: '/settings', label: 'Settings', icon: Settings, component: L(() => import('../pages/SettingsPage')) },
    ],
  },
];

export const visiblePages = (m: ModuleDef, a: Access) => m.pages.filter((p) => !p.hidden && (!p.can || p.can(a)));
const allowedPages = (m: ModuleDef, a: Access) => m.pages.filter((p) => !p.can || p.can(a));
export const visibleModules = (a: Access) => MODULES.filter((m) => visiblePages(m, a).length > 0);

// Route table: first visible page per path wins (MD and staff variants
// can share one address).
export function routeTable(a: Access): PageDef[] {
  const seen = new Set<string>();
  const out: PageDef[] = [];
  for (const m of MODULES) for (const p of allowedPages(m, a)) if (!seen.has(p.path)) { seen.add(p.path); out.push(p); }
  return out;
}

export function moduleOfPath(path: string, a: Access): ModuleDef | null {
  const mods = visibleModules(a);
  const exact = mods.find((m) => m.pages.some((p) => p.path === path));
  if (exact && exact.id !== 'home') return exact;
  const best = mods.filter((m) => m.base !== '/' && (path === m.base || path.startsWith(`${m.base}/`))).sort((x, y) => y.base.length - x.base.length)[0];
  if (best) return best;
  if (path.startsWith('/non-insider')) return mods.find((m) => m.id === 'fleet') ?? mods.find((m) => m.id === 'calls') ?? null;
  if (path.startsWith('/settings')) return mods.find((m) => m.id === 'admin') ?? null;
  return exact ?? mods.find((m) => m.id === 'home') ?? null;
}

export function pageOfPath(path: string, a: Access): PageDef | null {
  return routeTable(a).find((p) => p.path === path) ?? null;
}

// Old in-app keys (setActive('fleet') etc.) -> addresses.
export const LEGACY_PATH: Record<string, string> = {
  dashboard: '/', home: '/', tasks: '/me/tasks', calendar: '/me/calendar', analytics: '/me/analytics', comments: '/me/comments',
  from_call_center: '/me/cases', fleet: '/fleet', fleet_pipeline: '/fleet/drivers', fleet_vehicles: '/fleet/cars', fleet_deposits: '/fleet/deposits',
  fleet_fines: '/fleet/fines', fleet_leaderboard: '/fleet/leaderboard', fleet_branding: '/fleet/branding', driver_pauses: '/fleet/days-off',
  non_insider: '/non-insider', finance: '/finance', finance_dashboard: '/finance', finance_vehicle_owners: '/finance/owners',
  finance_newsletters: '/finance/newsletters', finance_ledger: '/finance/ledger', finance_deposit_confirmations: '/finance/confirmations', call_center: '/call-center', call_center_tickets: '/call-center/cases', call_analytics: '/call-center/analytics',
  marketing: '/growth/campaigns', social: '/growth/content', it_hub: '/product/issues', performance: '/insights', departments: '/people',
  leaderboard: '/people/leaderboard', search: '/people/search', activity_log: '/people/activity', meetings: '/meetings',
  documents: '/docs/documents', announcements: '/docs/announcements', help: '/docs/help', admin: '/admin', settings: '/settings',
};
