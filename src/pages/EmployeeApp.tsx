import { useState } from 'react';
import {
  Plus, CheckCircle2, ListTodo, TrendingUp, HelpCircle,
  Truck, Car, Wallet, Receipt,
  PhoneCall, Users2, BookOpen,
  Target, CalendarClock,
  Package, AlertTriangle,
  Image as ImageIcon,
  LayoutDashboard, ArrowLeftRight, Landmark, ClipboardCheck,
  CarFront, ShieldCheck,
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
import FleetPage from './FleetPage';
import NonInsiderPage from './nonInsider/NonInsiderPage';
import FinanceDashboardPage from './finance/FinanceDashboardPage';
import FinanceRevenuePage from './finance/FinanceRevenuePage';
import FinanceFleetCollectionsPage from './finance/FinanceFleetCollectionsPage';
import FinanceVehicleOwnersPage from './finance/FinanceVehicleOwnersPage';
import FinancePayrollPage from './finance/FinancePayrollPage';
import FinanceDriverPayrollPage from './finance/FinanceDriverPayrollPage';
import FinanceSuppliersPage from './finance/FinanceSuppliersPage';
import FinanceTransfersPage from './finance/FinanceTransfersPage';
import FinanceExpenseClaimsPage from './finance/FinanceExpenseClaimsPage';
import FinanceAccountsPage from './finance/FinanceAccountsPage';
import FinanceReconciliationPage from './finance/FinanceReconciliationPage';
import FinanceDepositConfirmationsPage from './finance/FinanceDepositConfirmationsPage';
import CallQueuePage from './callCenter/CallQueuePage';
import CallDirectoryPage from './callCenter/CallDirectoryPage';
import CallScriptsPage from './callCenter/CallScriptsPage';
import CampaignsPage from './marketing/CampaignsPage';
import FollowUpsPage from './marketing/FollowUpsPage';
import SocialMediaPage from './SocialMediaPage';
import ProductsPage from './itHub/ProductsPage';
import IssuesPage from './itHub/IssuesPage';
import HowToUsePage from './HowToUsePage';

export default function EmployeeApp() {
  const { profile } = useAuth();
  // Scoped by department slug so a persisted page from one department
  // never leaks into another employee's nav (or a re-assigned employee's
  // new one) - a reload lands back on the same page instead of General.
  const navStorageKey = `kivu-active-nav-${profile?.department?.slug ?? 'none'}`;
  const [active, setActiveRaw] = useState<NavKey>(() => {
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
    finance_payroll: 'Internal Payroll',
    finance_driver_payroll: 'Driver Payroll',
    finance_suppliers: 'Supplier Payments',
    finance_transfers: 'Inter-Bank Transfers',
    finance_expense_claims: 'Expense Claims',
    finance_accounts: 'Bank Accounts',
    finance_reconciliation: 'Reconciliation',
    finance_deposit_confirmations: 'Deposit Confirmations',
    fleet_pipeline: 'Driver Pipeline',
    fleet_vehicles: 'Vehicles',
    fleet_deposits: 'Deposits',
    fleet_fines: 'Fines',
    call_center_queue: 'Call Queue',
    call_center_directory: 'Directory',
    call_center_scripts: 'Scripts',
    marketing_campaigns: 'Campaigns',
    marketing_followups: 'Follow-ups',
    it_hub_products: 'Products',
    it_hub_issues: 'Issues',
    non_insider: 'Non-Insider',
  };
  const title = TITLES[active];

  const NAV: NavItem[] = [
    { key: 'home', label: 'General', icon: ListTodo },
    { key: 'calendar', label: 'Calendar', icon: CheckCircle2 },
    ...(profile?.department?.slug === 'fleet' ? [
      { key: 'fleet_pipeline' as const, label: 'Driver Pipeline', icon: Truck },
      { key: 'fleet_vehicles' as const, label: 'Vehicles', icon: Car },
      { key: 'fleet_deposits' as const, label: 'Deposits', icon: Wallet },
      { key: 'fleet_fines' as const, label: 'Fines', icon: Receipt },
      { key: 'non_insider' as const, label: 'Non-Insider', icon: CarFront },
    ] : []),
    ...(profile?.department?.slug === 'finance' ? [
      { key: 'finance_dashboard' as const, label: 'Finance Dashboard', icon: LayoutDashboard },
      { key: 'finance_revenue' as const, label: 'Revenue', icon: TrendingUp },
      { key: 'finance_fleet_collections' as const, label: 'Fleet Collections', icon: Wallet },
      { key: 'finance_vehicle_owners' as const, label: 'Vehicle Owners', icon: Car },
      { key: 'finance_payroll' as const, label: 'Internal Payroll', icon: Users2 },
      { key: 'finance_driver_payroll' as const, label: 'Driver Payroll', icon: Truck },
      { key: 'finance_suppliers' as const, label: 'Supplier Payments', icon: Truck },
      { key: 'finance_transfers' as const, label: 'Inter-Bank Transfers', icon: ArrowLeftRight },
      { key: 'finance_expense_claims' as const, label: 'Expense Claims', icon: Receipt },
      { key: 'finance_accounts' as const, label: 'Bank Accounts', icon: Landmark },
      { key: 'finance_reconciliation' as const, label: 'Reconciliation', icon: ClipboardCheck },
      { key: 'finance_deposit_confirmations' as const, label: 'Deposit Confirmations', icon: ShieldCheck },
    ] : []),
    ...(profile?.department?.slug === 'call_center' ? [
      { key: 'call_center_queue' as const, label: 'Call Queue', icon: PhoneCall },
      { key: 'call_center_directory' as const, label: 'Directory', icon: Users2 },
      { key: 'call_center_scripts' as const, label: 'Scripts', icon: BookOpen },
      { key: 'fleet' as const, label: 'Fleet', icon: Truck },
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
      { key: 'fleet' as const, label: 'Fleet', icon: Truck },
    ] : []),
    { key: 'analytics', label: 'Analytics', icon: TrendingUp },
    { key: 'help', label: 'How to Use', icon: HelpCircle },
    { key: 'settings', label: 'Settings', icon: Plus },
  ];

  return (
    <AppShell active={active} onNavigate={setActive} navItems={NAV} title={title} notifications={<NotificationBell />}>
      {active === 'home' && <GeneralPage tasks={tasks} reload={reload} />}
      {active === 'calendar' && <CalendarView tasks={tasks} />}

      {active === 'fleet_pipeline' && <FleetPipelinePage />}
      {active === 'fleet_vehicles' && <FleetVehiclesPage />}
      {active === 'fleet_deposits' && <FleetDepositsPage />}
      {active === 'fleet_fines' && <FleetFinesPage />}
      {active === 'non_insider' && <NonInsiderPage />}
      {active === 'fleet' && <FleetPage />}

      {active === 'finance_dashboard' && <FinanceDashboardPage />}
      {active === 'finance_revenue' && <FinanceRevenuePage />}
      {active === 'finance_fleet_collections' && <FinanceFleetCollectionsPage />}
      {active === 'finance_vehicle_owners' && <FinanceVehicleOwnersPage />}
      {active === 'finance_payroll' && <FinancePayrollPage />}
      {active === 'finance_driver_payroll' && <FinanceDriverPayrollPage />}
      {active === 'finance_suppliers' && <FinanceSuppliersPage />}
      {active === 'finance_transfers' && <FinanceTransfersPage />}
      {active === 'finance_expense_claims' && <FinanceExpenseClaimsPage />}
      {active === 'finance_accounts' && <FinanceAccountsPage />}
      {active === 'finance_reconciliation' && <FinanceReconciliationPage />}
      {active === 'finance_deposit_confirmations' && <FinanceDepositConfirmationsPage />}

      {active === 'call_center_queue' && <CallQueuePage />}
      {active === 'call_center_directory' && <CallDirectoryPage />}
      {active === 'call_center_scripts' && <CallScriptsPage />}

      {active === 'marketing_campaigns' && <CampaignsPage />}
      {active === 'marketing_followups' && <FollowUpsPage />}

      {active === 'social' && <SocialMediaPage />}

      {active === 'it_hub_products' && <ProductsPage />}
      {active === 'it_hub_issues' && <IssuesPage />}

      {active === 'help' && <HowToUsePage navItems={NAV} />}
      {active === 'analytics' && <PersonalAnalytics tasks={tasks} profileName={profile?.full_name ?? ''} />}
      {active === 'settings' && <SettingsPage />}
    </AppShell>
  );
}
