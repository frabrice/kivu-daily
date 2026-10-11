import { useMemo } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useTasks } from '../lib/hooks';
import { useCompanyData, buildEmployeeStats } from '../lib/company';
import GeneralPage from '../pages/GeneralPage';
import CalendarView from '../pages/CalendarView';
import PersonalAnalytics from '../pages/PersonalAnalytics';
import FromCallCenterPage from '../pages/FromCallCenterPage';
import CallTicketsPage from '../pages/callCenter/CallTicketsPage';
import Leaderboard from '../pages/Leaderboard';
import SearchPage from '../pages/SearchPage';
import ActivityLogPage from '../pages/ActivityLogPage';
import HowToUsePage from '../pages/HowToUsePage';
import PerformancePage from '../pages/performance/PerformancePage';
import ManagingDirectorApp from '../pages/ManagingDirectorApp';
import StaffHome from '../pages/os/StaffHome';
import CommandCenter from '../pages/os/CommandCenter';
import { GettingAround } from '../pages/os/WhatsNew';
import { NavItem, NavKey } from '../components/AppShell';
import { useAccess } from './access';
import { LEGACY_PATH, MODULES, visiblePages } from './registry';

// Pages that used to get their data as props from the old app shells.

export function StaffTasks() {
  const { profile } = useAuth();
  const { tasks, reload } = useTasks(profile?.id);
  return <GeneralPage tasks={tasks} reload={reload} />;
}

export function StaffCalendar() {
  const { profile } = useAuth();
  const { tasks } = useTasks(profile?.id);
  return <CalendarView tasks={tasks} />;
}

export function StaffAnalytics() {
  const { profile } = useAuth();
  const { tasks } = useTasks(profile?.id);
  return <PersonalAnalytics tasks={tasks} profileName={profile?.full_name ?? ''} />;
}

export function MyCases() {
  const [params] = useSearchParams();
  return <FromCallCenterPage initialTicketId={params.get('ticket')} />;
}

export function CallCases() {
  const [params] = useSearchParams();
  const n = params.get('new');
  return <CallTicketsPage initialTicketId={params.get('ticket')} initialNew={n === 'call' || n === 'booking' ? n : null} />;
}

function useEmployees() {
  const { profiles, allTasks } = useCompanyData();
  const employees = useMemo(() => profiles.map((p) => buildEmployeeStats(p, allTasks)), [profiles, allTasks]);
  return { profiles, allTasks, employees };
}

export function StaffLeaderboard() {
  const go = useNavigate();
  const { employees, allTasks } = useEmployees();
  return <Leaderboard employees={employees} allTasks={allTasks} onSelect={(e) => go(`/people/${e.id}`)} />;
}

export function PeopleSearch() {
  const go = useNavigate();
  const { employees, allTasks } = useEmployees();
  return <SearchPage employees={employees} allTasks={allTasks} onSelect={(e) => go(`/people/${e.id}`)} />;
}

export function ActivityLog() {
  const { profiles } = useCompanyData();
  return <ActivityLogPage profiles={profiles} />;
}

export function Help() {
  const access = useAccess();
  const items: NavItem[] = [];
  const keyOf = (path: string) => Object.entries(LEGACY_PATH).find(([, p]) => p === path)?.[0] as NavKey | undefined;
  for (const m of MODULES) for (const p of visiblePages(m, access)) {
    const key = keyOf(p.path);
    if (key && !items.some((i) => i.key === key)) items.push({ key, label: p.label, icon: p.icon });
  }
  return <div className="space-y-4"><GettingAround /><HowToUsePage navItems={items} /></div>;
}

export function Performance() {
  const go = useNavigate();
  return <PerformancePage onNavigate={(k) => go(LEGACY_PATH[k] ?? '/')} />;
}

export function Departments() {
  return <ManagingDirectorApp view="departments" />;
}

export function Home() {
  const access = useAccess();
  return access.isMd ? <CommandCenter /> : <StaffHome />;
}

// Supplier payments, bank transfers and expense claims now live in the ledger.
const ledgers: Record<string, () => JSX.Element> = {};
export function ledgerOf(type: string) {
  ledgers[type] ??= () => <Navigate to={`/finance/ledger?type=${type}`} replace />;
  return ledgers[type];
}
