import { useState } from 'react';
import {
  Plus, CheckCircle2, ListTodo, TrendingUp, HelpCircle,
  Truck, Car, Wallet, Receipt,
  PhoneCall, Users2, BookOpen,
  Target, CalendarClock,
  Package, AlertTriangle,
  Image as ImageIcon,
  LayoutDashboard, ArrowLeftRight, Landmark, ClipboardCheck,
  CarFront, ShieldCheck, Mail, Trophy, UserCog, Headphones, PhoneIncoming, Paintbrush,
  BarChart3, Megaphone, CalendarOff,
} from 'lucide-react';
import AppShell, { NavKey, NavItem } from '../components/AppShell';
import NotificationBell from '../components/NotificationBell';
import { useAuth } from '../lib/auth';
import { useTasks } from '../lib/hooks';
import CalendarView from './CalendarView';
import PersonalAnalytics from './PersonalAnalytics';
import SettingsPage from './SettingsPage';
import GeneralPage from './GeneralPage';
import FleetPipelinePage from './fleet/FleetPipelinePage';
import FleetVehiclesPage from './fleet/FleetVehiclesPage';
import FleetDepositsPage from './fleet/FleetDepositsPage';
import FleetFinesPage from './fleet/FleetFinesPage';
import DepositLeaderboardPage from './fleet/DepositLeaderboardPage';
import FleetPage from './FleetPage';
import NonInsiderPage from './nonInsider/NonInsiderPage';
import FinanceDashboardPage from './finance/FinanceDashboardPage';
import FinanceRevenuePage from './finance/FinanceRevenuePage';
import FinanceFleetCollectionsPage from './finance/FinanceFleetCollectionsPage';
import FinanceVehicleOwnersPage from './finance/FinanceVehicleOwnersPage';
import NewslettersPage from './finance/NewslettersPage';
import FinancePayrollPage from './finance/FinancePayrollPage';
import FinanceDriverPayrollPage from './finance/FinanceDriverPayrollPage';
import FinanceSuppliersPage from './finance/FinanceSuppliersPage';
import FinanceTransfersPage from './finance/FinanceTransfersPage';
import FinanceExpenseClaimsPage from './finance/FinanceExpenseClaimsPage';
import FinanceAccountsPage from './finance/FinanceAccountsPage';
import FinanceReconciliationPage from './finance/FinanceReconciliationPage';
import FinanceDepositConfirmationsPage from './finance/FinanceDepositConfirmationsPage';
import FinanceTeamPage from './finance/FinanceTeamPage';
import CallQueuePage from './callCenter/CallQueuePage';
import CallDirectoryPage from './callCenter/CallDirectoryPage';
import ScriptBookPage from './callCenter/ScriptBookPage';
import CampaignsPage from './marketing/CampaignsPage';
import FollowUpsPage from './marketing/FollowUpsPage';
import SocialMediaPage from './SocialMediaPage';
import ProductsPage from './itHub/ProductsPage';
import IssuesPage from './itHub/IssuesPage';
import HowToUsePage from './HowToUsePage';
import FromCallCenterPage from './FromCallCenterPage';
import OutreachPage from './callCenter/OutreachPage';
import DriverPausesPage from './fleet/DriverPausesPage';
import CallAnalyticsPage from './callCenter/CallAnalyticsPage';
import CallTicketsPage from './callCenter/CallTicketsPage';
import { takeTicketLink, useMyOpenTicketCount } from '../lib/callTickets';
import { useMyOpenShift } from '../lib/shifts';
import { StartShiftScreen, ShiftChip, EndShiftDrawer } from '../components/callTickets/ShiftControls';
import BrandingDevicesPage from './fleet/BrandingDevicesPage';
import { useCarFollowupCount } from '../lib/nonInsider';

export default function EmployeeApp() {
  const { profile, signOut } = useAuth();
  // Scoped by department slug so a persisted page from one department
  // never leaks into another employee's nav (or a re-assigned employee's
  // new one) - a reload lands back on the same page instead of General.
  const navStorageKey = `kivu-active-nav-${profile?.department?.slug ?? 'none'}`;
  const isCallCenter = profile?.department?.slug === 'call_center';
  // A ticket link from an email (?ticket=...) opens straight onto it.
  const [link] = useState(() => takeTicketLink());
  const [active, setActiveRaw] = useState<NavKey>(() => {
    if (link.page === 'fleet_branding') {
      if (profile?.department?.slug === 'fleet') return 'fleet_branding';
      try { localStorage.setItem('kivu-active-nav-fleet-tab', 'branding'); } catch { /* ignore */ }
      return 'fleet';
    }
    if (link.ticketId || link.page) return isCallCenter && link.page !== 'from_call_center' ? 'call_center_tickets' : 'from_call_center';
    try {
      const saved = localStorage.getItem(navStorageKey);
      if (saved) return saved as NavKey;
    } catch { /* ignore */ }
    return profile?.department?.slug === 'finance' ? 'finance_dashboard' : 'home';
  });
  const setActive = (key: NavKey) => {
    setActiveRaw(key);
    try { localStorage.setItem(navStorageKey, key); } catch { /* ignore */ }
  };
  const { tasks, reload } = useTasks(profile?.id);
  const myOpenTickets = useMyOpenTicketCount(profile?.id);
  // Call Center: a shift must be started to work, and ended to sign out.
  const { shift, loading: shiftLoading, reload: reloadShift } = useMyOpenShift(profile?.id, isCallCenter);
  const [ending, setEnding] = useState<null | 'end' | 'signout'>(null);
  const needsShift = isCallCenter && !shiftLoading && !shift;
  const carFollowups = useCarFollowupCount(profile?.department?.slug === 'fleet');

  const TITLES: Record<NavKey, string> = {
    home: 'General',
    calendar: 'Calendar',
    comments: 'Comments',
    analytics: 'Analytics',
    meetings: 'Meetings',
    documents: 'Documents',
    announcements: 'Announcements',
    settings: 'Settings',
    dashboard: 'Dashboard',
    departments: 'Departments',
    leaderboard: 'Leaderboard',
    search: 'Search',
    admin: 'MD Panel',
    tasks: 'My Tasks',
    fleet: 'Fleet',
    call_center: 'Call Center',
    marketing: 'Campaigns',
    social: 'Content Calendar',
    it_hub: 'Product Hub',
    help: 'How to Use',
    activity_log: 'Activity Log',
    finance: 'Finance',
    finance_dashboard: 'Finance Dashboard',
    finance_revenue: 'Revenue',
    finance_fleet_collections: 'Fleet Collections',
    finance_vehicle_owners: 'Vehicle Owners',
    finance_newsletters: 'Newsletters',
    finance_payroll: 'Internal Payroll',
    finance_driver_payroll: 'Driver Payroll',
    finance_suppliers: 'Supplier Payments',
    finance_transfers: 'Inter-Bank Transfers',
    finance_expense_claims: 'Expense Claims',
    finance_accounts: 'Bank Accounts',
    finance_reconciliation: 'Reconciliation',
    finance_deposit_confirmations: 'Deposit Confirmations',
    finance_team: 'Team',
    fleet_pipeline: 'Driver Pipeline',
    fleet_vehicles: 'Vehicles',
    fleet_deposits: 'Deposits',
    fleet_fines: 'Fines',
    fleet_leaderboard: 'Leaderboard',
    fleet_branding: 'Branding & Devices',
    finance_driver_leaderboard: 'Driver Leaderboard',
    call_center_queue: 'Call Queue',
    call_center_directory: 'Directory',
    call_center_scripts: 'Script Book',
    call_center_tickets: 'Calls & Tickets',
    from_call_center: 'From Call Center',
    call_center_outreach: 'Non-Insider Outreach',
    call_analytics: 'Call Analytics',
    marketing_campaigns: 'Campaigns',
    marketing_followups: 'Follow-ups',
    it_hub_products: 'Products',
    it_hub_issues: 'Issues',
    non_insider: 'Non-Insider',
    driver_pauses: 'Driver days off',
  };
  const title = TITLES[active];

  const NAV: NavItem[] = [
    { key: 'home', label: 'General', icon: ListTodo },
    { key: 'calendar', label: 'Calendar', icon: CheckCircle2 },
    { key: 'from_call_center', label: 'From Call Center', icon: Headphones, badge: myOpenTickets },
    ...(profile?.department?.slug === 'fleet' ? [
      { key: 'fleet_pipeline' as const, label: 'Driver Pipeline', icon: Truck },
      { key: 'fleet_vehicles' as const, label: 'Vehicles', icon: Car },
      { key: 'fleet_deposits' as const, label: 'Deposits', icon: Wallet },
      { key: 'fleet_leaderboard' as const, label: 'Leaderboard', icon: Trophy },
      { key: 'fleet_fines' as const, label: 'Fines', icon: Receipt },
      { key: 'fleet_branding' as const, label: 'Branding & Devices', icon: Paintbrush, badge: carFollowups },
      { key: 'driver_pauses' as const, label: 'Driver days off', icon: CalendarOff },
      { key: 'non_insider' as const, label: 'Non-Insider', icon: CarFront },
    ] : []),
    ...(profile?.department?.slug === 'finance' ? [
      { key: 'finance_dashboard' as const, label: 'Finance Dashboard', icon: LayoutDashboard },
      { key: 'finance_revenue' as const, label: 'Revenue', icon: TrendingUp },
      { key: 'finance_fleet_collections' as const, label: 'Fleet Collections', icon: Wallet },
      { key: 'finance_driver_leaderboard' as const, label: 'Driver Leaderboard', icon: Trophy },
      { key: 'finance_vehicle_owners' as const, label: 'Vehicle Owners', icon: Car },
      { key: 'finance_newsletters' as const, label: 'Newsletters', icon: Mail },
      { key: 'finance_payroll' as const, label: 'Internal Payroll', icon: Users2 },
      { key: 'finance_driver_payroll' as const, label: 'Driver Payroll', icon: Truck },
      { key: 'finance_suppliers' as const, label: 'Supplier Payments', icon: Truck },
      { key: 'finance_transfers' as const, label: 'Inter-Bank Transfers', icon: ArrowLeftRight },
      { key: 'finance_expense_claims' as const, label: 'Expense Claims', icon: Receipt },
      { key: 'finance_accounts' as const, label: 'Bank Accounts', icon: Landmark },
      { key: 'finance_reconciliation' as const, label: 'Reconciliation', icon: ClipboardCheck },
      { key: 'finance_deposit_confirmations' as const, label: 'Deposit Confirmations', icon: ShieldCheck },
      { key: 'finance_team' as const, label: 'Team', icon: UserCog },
      { key: 'driver_pauses' as const, label: 'Driver days off', icon: CalendarOff },
      { key: 'call_analytics' as const, label: 'Call Analytics', icon: BarChart3 },
    ] : []),
    ...(profile?.department?.slug === 'call_center' ? [
      { key: 'call_center_tickets' as const, label: 'Calls & Tickets', icon: PhoneIncoming },
      { key: 'call_center_queue' as const, label: 'Call Queue', icon: PhoneCall },
      { key: 'call_center_directory' as const, label: 'Directory', icon: Users2 },
      { key: 'call_center_scripts' as const, label: 'Script Book', icon: BookOpen },
      { key: 'call_center_outreach' as const, label: 'Non-Insider Outreach', icon: Megaphone },
      // No Fleet page: insider-driver details stay with Fleet/Finance (MD, 10 Oct 2026).
      { key: 'non_insider' as const, label: 'Non-Insider', icon: CarFront },
    ] : []),
    ...(profile?.department?.slug === 'marketing_sales_bd' ? [
      { key: 'marketing_campaigns' as const, label: 'Campaigns', icon: Target },
      { key: 'marketing_followups' as const, label: 'Follow-ups', icon: CalendarClock },
    ] : []),
    ...(profile?.department?.slug === 'social_media' ? [{ key: 'social' as const, label: 'Content Calendar', icon: ImageIcon }] : []),
    ...(profile?.department?.slug === 'it' ? [
      { key: 'it_hub_issues' as const, label: 'Issues', icon: AlertTriangle },
      { key: 'it_hub_products' as const, label: 'Products', icon: Package },
      { key: 'driver_pauses' as const, label: 'Driver days off', icon: CalendarOff },
      { key: 'fleet' as const, label: 'Fleet', icon: Truck },
    ] : []),
    { key: 'analytics', label: 'Analytics', icon: TrendingUp },
    { key: 'help', label: 'How to Use', icon: HelpCircle },
    { key: 'settings', label: 'Settings', icon: Plus },
  ];

  return (
    <AppShell active={active} onNavigate={setActive} navItems={NAV} title={title}
      notifications={<>{shift && <ShiftChip shift={shift} onEnd={() => setEnding('end')} />}<NotificationBell /></>}
      onSignOut={isCallCenter && shift ? () => setEnding('signout') : undefined}>
      {ending && shift && (
        <EndShiftDrawer shift={shift} onClose={() => setEnding(null)}
          onEnded={() => { const thenSignOut = ending === 'signout'; setEnding(null); if (thenSignOut) signOut(); else reloadShift(); }} />
      )}
      {needsShift ? <StartShiftScreen onStarted={reloadShift} /> : <>
      {active === 'home' && <GeneralPage tasks={tasks} reload={reload} />}
      {active === 'calendar' && <CalendarView tasks={tasks} />}

      {active === 'fleet_pipeline' && <FleetPipelinePage />}
      {active === 'fleet_vehicles' && <FleetVehiclesPage />}
      {active === 'fleet_deposits' && <FleetDepositsPage />}
      {active === 'fleet_fines' && <FleetFinesPage />}
      {active === 'fleet_leaderboard' && <DepositLeaderboardPage />}
      {active === 'fleet_branding' && <BrandingDevicesPage />}
      {active === 'driver_pauses' && !isCallCenter && <DriverPausesPage />}
      {active === 'non_insider' && <NonInsiderPage />}
      {active === 'fleet' && !isCallCenter && <FleetPage />}

      {active === 'finance_dashboard' && <FinanceDashboardPage />}
      {active === 'finance_revenue' && <FinanceRevenuePage />}
      {active === 'finance_fleet_collections' && <FinanceFleetCollectionsPage />}
      {active === 'finance_driver_leaderboard' && <DepositLeaderboardPage />}
      {active === 'finance_vehicle_owners' && <FinanceVehicleOwnersPage />}
      {active === 'finance_newsletters' && <NewslettersPage />}
      {active === 'finance_payroll' && <FinancePayrollPage />}
      {active === 'finance_driver_payroll' && <FinanceDriverPayrollPage />}
      {active === 'finance_suppliers' && <FinanceSuppliersPage />}
      {active === 'finance_transfers' && <FinanceTransfersPage />}
      {active === 'finance_expense_claims' && <FinanceExpenseClaimsPage />}
      {active === 'finance_accounts' && <FinanceAccountsPage />}
      {active === 'finance_reconciliation' && <FinanceReconciliationPage />}
      {active === 'finance_deposit_confirmations' && <FinanceDepositConfirmationsPage />}
      {active === 'finance_team' && <FinanceTeamPage />}

      {active === 'call_center_queue' && <CallQueuePage />}
      {active === 'call_center_directory' && <CallDirectoryPage />}
      {active === 'call_center_scripts' && <ScriptBookPage />}
      {active === 'call_center_tickets' && <CallTicketsPage initialTicketId={link.ticketId} />}
      {active === 'from_call_center' && <FromCallCenterPage initialTicketId={link.ticketId} />}
      {active === 'call_center_outreach' && isCallCenter && <OutreachPage />}
      {active === 'call_analytics' && profile?.department?.slug === 'finance' && <CallAnalyticsPage />}

      {active === 'marketing_campaigns' && <CampaignsPage />}
      {active === 'marketing_followups' && <FollowUpsPage />}

      {active === 'social' && <SocialMediaPage />}

      {active === 'it_hub_products' && <ProductsPage />}
      {active === 'it_hub_issues' && <IssuesPage />}

      {active === 'help' && <HowToUsePage navItems={NAV} />}
      {active === 'analytics' && <PersonalAnalytics tasks={tasks} profileName={profile?.full_name ?? ''} />}
      {active === 'settings' && <SettingsPage />}
      </>}
    </AppShell>
  );
}
