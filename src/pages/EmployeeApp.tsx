import { useEffect, useState, useMemo } from 'react';
import { Plus, Flame, CheckCircle2, ListTodo, TrendingUp, MessageSquare, FileText, Megaphone, Calendar as CalendarIcon, Truck, PhoneCall, Target, Image as ImageIcon, Package, HelpCircle, Wallet, LayoutDashboard, Car, Landmark, ArrowLeftRight, Receipt, Users2, ClipboardCheck } from 'lucide-react';
import AppShell, { NavKey, NavItem } from '../components/AppShell';
import AddTaskModal from '../components/AddTaskModal';
import TaskReviewModal from '../components/TaskReviewModal';
import TaskCard from '../components/TaskCard';
import ProgressRing from '../components/ProgressRing';
import NotificationBell from '../components/NotificationBell';
import { useAuth } from '../lib/auth';
import { useTasks, tasksForDate, completionPct, computeStreak, useUnreadComments } from '../lib/hooks';
import { supabase, Task } from '../lib/supabase';
import { todayStr, greeting, formatDateFull, formatTime, formatDateLabel } from '../lib/utils';
import CalendarView from './CalendarView';
import PersonalAnalytics from './PersonalAnalytics';
import SettingsPage from './SettingsPage';
import CommentsPage from './CommentsPage';
import DocumentsPage from './DocumentsPage';
import AnnouncementsPage from './AnnouncementsPage';
import MeetingsPage from './MeetingsPage';
import FleetPage from './FleetPage';
import FinanceDashboardPage from './finance/FinanceDashboardPage';
import FinanceRevenuePage from './finance/FinanceRevenuePage';
import FinanceFleetCollectionsPage from './finance/FinanceFleetCollectionsPage';
import FinanceVehicleOwnersPage from './finance/FinanceVehicleOwnersPage';
import FinancePayrollPage from './finance/FinancePayrollPage';
import FinanceSuppliersPage from './finance/FinanceSuppliersPage';
import FinanceTransfersPage from './finance/FinanceTransfersPage';
import FinanceExpenseClaimsPage from './finance/FinanceExpenseClaimsPage';
import FinanceAccountsPage from './finance/FinanceAccountsPage';
import FinanceReconciliationPage from './finance/FinanceReconciliationPage';
import CallCenterPage from './CallCenterPage';
import MarketingPage from './MarketingPage';
import SocialMediaPage from './SocialMediaPage';
import ITHubPage from './ITHubPage';
import HowToUsePage from './HowToUsePage';

export default function EmployeeApp() {
  const { profile } = useAuth();
  const [active, setActive] = useState<NavKey>('home');
  const [addOpen, setAddOpen] = useState(false);
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const [now, setNow] = useState(new Date());
  const { tasks, reload } = useTasks(profile?.id);
  const unreadComments = useUnreadComments(profile);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const toggleTask = async (task: Task) => {
    // Optimistic: update UI immediately via reload, then sync to DB
    const newCompleted = !task.completed;
    const completedAt = newCompleted ? new Date().toISOString() : null;
    await supabase
      .from('tasks')
      .update({ completed: newCompleted, completed_at: completedAt })
      .eq('id', task.id);
    reload();
  };

  const deleteTask = async (task: Task) => {
    await supabase.from('tasks').delete().eq('id', task.id);
  };

  const todayTasks = useMemo(() => tasksForDate(tasks, todayStr()), [tasks]);
  const todayPct = completionPct(todayTasks);
  const completedCount = todayTasks.filter((t) => t.completed).length;
  const streak = computeStreak(tasks);

  // Build timeline: today + previous days that have tasks
  const timelineDates = useMemo(() => {
    const dates = new Set<string>();
    dates.add(todayStr());
    for (const t of tasks) dates.add(t.date);
    return Array.from(dates).sort().reverse();
  }, [tasks]);

  const TITLES: Record<NavKey, string> = {
    home: 'Today',
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
    admin: 'Admin Panel',
    tasks: 'My Tasks',
    fleet: 'Fleet',
    call_center: 'Call Center',
    marketing: 'Campaigns',
    social: 'Content Calendar',
    it_hub: 'Product Hub',
    help: 'How to Use',
    activity_log: 'Activity Log',
    finance_dashboard: 'Finance Dashboard',
    finance_revenue: 'Revenue',
    finance_fleet_collections: 'Fleet Collections',
    finance_vehicle_owners: 'Vehicle-Owner Payments',
    finance_payroll: 'Payroll',
    finance_suppliers: 'Supplier Payments',
    finance_transfers: 'Inter-Bank Transfers',
    finance_expense_claims: 'Expense Claims',
    finance_accounts: 'Bank Accounts',
    finance_reconciliation: 'Reconciliation',
  };
  const title = TITLES[active];

  const NAV: NavItem[] = [
    { key: 'home', label: 'Today', icon: ListTodo },
    { key: 'calendar', label: 'Calendar', icon: CheckCircle2 },
    ...(profile?.department?.slug === 'fleet' ? [{ key: 'fleet' as const, label: 'Fleet', icon: Truck }] : []),
    ...(profile?.department?.slug === 'finance' ? [
      { key: 'finance_dashboard' as const, label: 'Finance Dashboard', icon: LayoutDashboard },
      { key: 'finance_revenue' as const, label: 'Revenue', icon: TrendingUp },
      { key: 'finance_fleet_collections' as const, label: 'Fleet Collections', icon: Wallet },
      { key: 'finance_vehicle_owners' as const, label: 'Vehicle-Owner Payments', icon: Car },
      { key: 'finance_payroll' as const, label: 'Payroll', icon: Users2 },
      { key: 'finance_suppliers' as const, label: 'Supplier Payments', icon: Truck },
      { key: 'finance_transfers' as const, label: 'Inter-Bank Transfers', icon: ArrowLeftRight },
      { key: 'finance_expense_claims' as const, label: 'Expense Claims', icon: Receipt },
      { key: 'finance_accounts' as const, label: 'Bank Accounts', icon: Landmark },
      { key: 'finance_reconciliation' as const, label: 'Reconciliation', icon: ClipboardCheck },
    ] : []),
    ...(profile?.department?.slug === 'call_center' ? [{ key: 'call_center' as const, label: 'Call Center', icon: PhoneCall }] : []),
    ...(profile?.department?.slug === 'marketing_sales_bd' ? [{ key: 'marketing' as const, label: 'Campaigns', icon: Target }] : []),
    ...(profile?.department?.slug === 'social_media' ? [{ key: 'social' as const, label: 'Content Calendar', icon: ImageIcon }] : []),
    ...(profile?.department?.slug === 'it' ? [{ key: 'it_hub' as const, label: 'Product Hub', icon: Package }] : []),
    { key: 'meetings', label: 'Meetings', icon: CalendarIcon },
    { key: 'documents', label: 'Documents', icon: FileText },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'comments', label: 'Comments', icon: MessageSquare, badge: unreadComments },
    { key: 'analytics', label: 'Analytics', icon: TrendingUp },
    { key: 'help', label: 'How to Use', icon: HelpCircle },
    { key: 'settings', label: 'Settings', icon: Plus },
  ];

  return (
    <AppShell active={active} onNavigate={setActive} navItems={NAV} title={title} notifications={<NotificationBell />}>
      {active === 'home' && (
        <div className="space-y-5">
          {/* Greeting */}
          <div className="animate-fade-in flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">
                {greeting()}, {profile?.full_name?.split(' ')[0]}
              </h2>
              <p className="text-[12px] text-gray-400 mt-0.5">{formatDateFull(now)}</p>
            </div>
            <p className="text-xl font-light text-brand-500 tabular-nums">{formatTime(now)}</p>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card p-3.5 flex items-center gap-3">
              <ProgressRing pct={todayPct} size={48} stroke={5} showLabel={false} />
              <div>
                <p className="stat-label mb-0.5">Completion</p>
                <p className="text-xl font-bold leading-none">{Math.round(todayPct)}%</p>
              </div>
            </div>
            <div className="card p-3.5">
              <p className="stat-label mb-0.5">Tasks Today</p>
              <p className="text-xl font-bold leading-none">{todayTasks.length}<span className="text-[11px] font-normal text-gray-400 ml-1">{completedCount} done</span></p>
            </div>
            <div className="card p-3.5 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
                <Flame size={16} className="text-orange-500" />
              </div>
              <div>
                <p className="stat-label mb-0.5">Streak</p>
                <p className="text-xl font-bold leading-none">{streak} {streak === 1 ? 'Day' : 'Days'}</p>
              </div>
            </div>
          </div>

          {/* Add Task Section */}
          <button
            onClick={() => setAddOpen(true)}
            className="btn-primary flex items-center justify-center gap-2 py-2.5"
          >
            <Plus size={16} />
            <span>Add New Task</span>
          </button>

          {/* Timeline */}
          <div className="space-y-5">
            {timelineDates.slice(0, 14).map((date) => {
              const dayTasks = tasksForDate(tasks, date);
              if (dayTasks.length === 0 && date !== todayStr()) return null;
              const pct = completionPct(dayTasks);
              const isToday = date === todayStr();
              const carried = dayTasks.filter((t) => t.is_carried_over);

              return (
                <div key={date} className="animate-fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="section-title">
                      {formatDateLabel(date)}
                      {isToday && <span className="ml-2 text-[9px] font-bold text-brand-700 dark:text-brand-300 bg-brand/10 px-1.5 py-0.5 rounded-full">LIVE</span>}
                    </h3>
                    {dayTasks.length > 0 && (
                      <span className="text-[11px] text-gray-400">
                        {dayTasks.filter((t) => t.completed).length}/{dayTasks.length} · {Math.round(pct)}%
                      </span>
                    )}
                  </div>

                  {carried.length > 0 && isToday && (
                    <p className="text-[11px] font-medium text-orange-500 mb-1.5 px-0.5">Carried Over</p>
                  )}

                  <div className="space-y-1.5">
                    {dayTasks
                      .sort((a, b) => Number(a.completed) - Number(b.review_status ? 1 : 0))
                      .sort((a, b) => Number(a.review_status !== 'completed') - Number(b.review_status !== 'completed'))
                      .map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onToggle={toggleTask}
                          onDelete={isToday ? deleteTask : undefined}
                          onClick={isToday ? (t) => setReviewTask(t) : undefined}
                          reviewMode={isToday}
                        />
                      ))}
                    {dayTasks.length === 0 && isToday && (
                      <div className="card p-6 text-center">
                        <p className="text-gray-400 text-[13px]">No tasks yet. Tap + to add your first task.</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {active === 'calendar' && <CalendarView tasks={tasks} />}
      {active === 'fleet' && <FleetPage />}
      {active === 'finance_dashboard' && <FinanceDashboardPage />}
      {active === 'finance_revenue' && <FinanceRevenuePage />}
      {active === 'finance_fleet_collections' && <FinanceFleetCollectionsPage />}
      {active === 'finance_vehicle_owners' && <FinanceVehicleOwnersPage />}
      {active === 'finance_payroll' && <FinancePayrollPage />}
      {active === 'finance_suppliers' && <FinanceSuppliersPage />}
      {active === 'finance_transfers' && <FinanceTransfersPage />}
      {active === 'finance_expense_claims' && <FinanceExpenseClaimsPage />}
      {active === 'finance_accounts' && <FinanceAccountsPage />}
      {active === 'finance_reconciliation' && <FinanceReconciliationPage />}
      {active === 'call_center' && <CallCenterPage />}
      {active === 'marketing' && <MarketingPage />}
      {active === 'social' && <SocialMediaPage />}
      {active === 'it_hub' && <ITHubPage />}
      {active === 'help' && <HowToUsePage navItems={NAV} />}
      {active === 'meetings' && <MeetingsPage />}
      {active === 'documents' && <DocumentsPage />}
      {active === 'announcements' && <AnnouncementsPage />}
      {active === 'comments' && <CommentsPage />}
      {active === 'analytics' && <PersonalAnalytics tasks={tasks} profileName={profile?.full_name ?? ''} />}
      {active === 'settings' && <SettingsPage />}

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} userId={profile!.id} onAdded={reload} />

      {reviewTask && (
        <TaskReviewModal
          open={!!reviewTask}
          onClose={() => setReviewTask(null)}
          task={reviewTask}
          onReviewed={() => {
            reload();
            setReviewTask(null);
          }}
        />
      )}
    </AppShell>
  );
}
