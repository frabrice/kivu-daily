import { useMemo, useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Trophy,
  Search,
  Shield,
  Settings,
  Users2,
  ListTodo,
  AlertCircle,
  ArrowDownUp,
  MessageSquare,
  UserPlus,
  Megaphone,
  CalendarPlus,
  ClipboardCheck,
  MoonStar,
  Radio,
  FileText,
  Calendar as CalendarIcon,
  Truck,
  Wallet,
  PhoneCall,
  Target,
  Image as ImageIcon,
  Package,
  HelpCircle,
  TrendingUp as TrendingUpIcon,
  ChevronRight,
} from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, BarChart, Bar, Cell } from 'recharts';
import AppShell, { NavKey, NavItem } from '../components/AppShell';
import { useCompanyData, buildEmployeeStats, departmentStats, EmployeeWithStats } from '../lib/company';
import { useActivityFeed } from '../lib/activity';
import { useCompanySnapshot } from '../lib/dashboardSnapshot';
import { fmt } from '../lib/finance';
import { completionColor, dateStr, addDays, greeting, formatDateFull } from '../lib/utils';
import { completionPct } from '../lib/hooks';
import { supabase, Task } from '../lib/supabase';
import Avatar from '../components/Avatar';
import ActivityFeed from '../components/ActivityFeed';
import AssignTaskModal from '../components/AssignTaskModal';
import CreateAnnouncementModal from '../components/CreateAnnouncementModal';
import CreateMeetingModal from '../components/CreateMeetingModal';
import TaskReviewModal from '../components/TaskReviewModal';
import NotificationBell from '../components/NotificationBell';
import EmployeeProfilePage from '../components/EmployeeProfilePage';
import Leaderboard from './Leaderboard';
import SearchPage from './SearchPage';
import AdminPanel from './AdminPanel';
import SettingsPage from './SettingsPage';
import MDTasksPage from './MDTasksPage';
import MDCommentsPage from './MDCommentsPage';
import ActivityLogPage from './ActivityLogPage';
import DocumentsPage from './DocumentsPage';
import AnnouncementsPage from './AnnouncementsPage';
import MeetingsPage from './MeetingsPage';
import FleetPage from './FleetPage';
import FinanceDeptPage from './FinanceDeptPage';
import CallCenterPage from './CallCenterPage';
import MarketingPage from './MarketingPage';
import SocialMediaPage from './SocialMediaPage';
import ITHubPage from './ITHubPage';
import HowToUsePage from './HowToUsePage';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

type SortMode = 'completion' | 'name' | 'tasks';

// A small named palette (on top of brand/positive) so the dashboard's
// recurring "icon in a tinted circle" tiles can read as distinct areas
// at a glance instead of everything sharing the one brand teal.
const ACCENT_COLORS = {
  brand: { bg: 'bg-brand/10', text: 'text-brand-600 dark:text-brand-300' },
  positive: { bg: 'bg-positive/10', text: 'text-positive' },
  blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-600 dark:text-blue-300' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-600 dark:text-amber-300' },
  violet: { bg: 'bg-violet-50 dark:bg-violet-500/10', text: 'text-violet-600 dark:text-violet-300' },
  rose: { bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-600 dark:text-rose-300' },
  cyan: { bg: 'bg-cyan-50 dark:bg-cyan-500/10', text: 'text-cyan-600 dark:text-cyan-300' },
} as const;
type AccentColor = keyof typeof ACCENT_COLORS;

export default function ManagingDirectorApp() {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const tooltipStyle = {
    borderRadius: 10,
    border: theme === 'dark' ? '1px solid rgba(255,255,255,0.08)' : '1px solid #f1f5f9',
    background: theme === 'dark' ? '#1d2f43' : '#fff',
    color: theme === 'dark' ? '#fff' : '#111827',
    fontSize: 12,
    padding: '6px 10px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  };
  const axisColor = theme === 'dark' ? '#5d7791' : '#9ca3af';
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.05)' : '#f1f5f9';
  const [active, setActiveRaw] = useState<NavKey>(() => {
    try {
      const saved = localStorage.getItem('kivu-active-nav-md');
      if (saved) return saved as NavKey;
    } catch { /* ignore */ }
    return 'dashboard';
  });
  const setActive = (key: NavKey) => {
    setActiveRaw(key);
    try { localStorage.setItem('kivu-active-nav-md', key); } catch { /* ignore */ }
  };
  const { profiles, departments, allTasks, loading, reload } = useCompanyData();
  const { entries: activity, loading: activityLoading } = useActivityFeed(15);
  const snapshot = useCompanySnapshot();
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeWithStats | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('completion');
  const [unreadComments, setUnreadComments] = useState(0);
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);

  useEffect(() => {
    if (!profile) return;

    const loadUnread = async () => {
      // For MD, count replies to their comments (where MD is target_user_id)
      const lastSeen = profile.last_comment_seen_at;
      let query = supabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('target_user_id', profile.id);

      if (lastSeen) {
        query = query.gt('created_at', lastSeen);
      }

      const { count } = await query;
      setUnreadComments(count ?? 0);
    };

    loadUnread();

    const channel = supabase
      .channel('md-unread-comments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, (payload) => {
        if (payload.new && 'target_user_id' in payload.new) {
          const newComment = payload.new as { target_user_id: string; created_at: string };
          if (newComment.target_user_id === profile.id) {
            const lastSeen = profile.last_comment_seen_at;
            if (!lastSeen || newComment.created_at > lastSeen) {
              setUnreadComments((prev) => prev + 1);
            }
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const NAV: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'tasks', label: 'My Tasks', icon: ListTodo },
    { key: 'fleet', label: 'Fleet', icon: Truck },
    { key: 'finance', label: 'Finance', icon: Wallet },
    { key: 'call_center', label: 'Call Center', icon: PhoneCall },
    { key: 'marketing', label: 'Campaigns', icon: Target },
    { key: 'social', label: 'Content Calendar', icon: ImageIcon },
    { key: 'it_hub', label: 'Product Hub', icon: Package },
    { key: 'meetings', label: 'Meetings', icon: CalendarIcon },
    { key: 'documents', label: 'Documents', icon: FileText },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'comments', label: 'Comments', icon: MessageSquare, badge: unreadComments },
    { key: 'activity_log', label: 'Activity Log', icon: Radio },
    { key: 'departments', label: 'Departments', icon: Users2 },
    { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { key: 'search', label: 'Search', icon: Search },
    { key: 'admin', label: 'Admin Panel', icon: Shield },
    { key: 'help', label: 'How to Use', icon: HelpCircle },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  const employees = useMemo(() => profiles.map((p) => buildEmployeeStats(p, allTasks)), [profiles, allTasks]);
  const activeEmployees = useMemo(() => profiles.filter((p) => p.role === 'employee' && p.is_active), [profiles]);

  const activeToday = employees.filter((e) => e.todayTotal > 0).length;
  const totalTasks = employees.reduce((s, e) => s + e.todayTotal, 0);
  const completedTasks = employees.reduce((s, e) => s + e.todayCompleted, 0);
  const overallPct = totalTasks === 0 ? 0 : (completedTasks / totalTasks) * 100;

  const silentEmployees = useMemo(
    () => employees.filter((e) => e.role === 'employee' && e.is_active && e.todayTotal === 0),
    [employees]
  );

  const pendingReviews = useMemo(
    () =>
      allTasks
        .filter((t) => t.completed && !t.review_status)
        .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
        .slice(0, 5),
    [allTasks]
  );

  const attentionCount = silentEmployees.length + pendingReviews.length + unreadComments;

  const weeklyData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const ds = dateStr(d);
      const dayTasks = allTasks.filter((t) => t.date === ds);
      days.push({
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        pct: Math.round(completionPct(dayTasks)),
        total: dayTasks.length,
      });
    }
    return days;
  }, [allTasks]);

  const departmentPerf = useMemo(() => {
    return departments
      .map((d) => {
        const stats = departmentStats(d.id, employees);
        return { name: d.name, pct: Math.round(stats.pct), employees: stats.deptEmployees.length };
      })
      .filter((d) => d.employees > 0)
      .sort((a, b) => b.pct - a.pct);
  }, [departments, employees]);

  const sortedEmployees = useMemo(() => {
    const sorted = [...employees];
    if (sortMode === 'completion') sorted.sort((a, b) => b.todayPct - a.todayPct);
    else if (sortMode === 'name') sorted.sort((a, b) => a.full_name.localeCompare(b.full_name));
    else if (sortMode === 'tasks') sorted.sort((a, b) => b.todayTotal - a.todayTotal);
    return sorted;
  }, [employees, sortMode]);

  const title = NAV.find((n) => n.key === active)?.label ?? 'Dashboard';

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;

  return (
    <AppShell active={active} onNavigate={setActive} navItems={NAV} title={title} notifications={<NotificationBell />}>
      {active === 'dashboard' && selectedEmployee && (
        <EmployeeProfilePage
          employee={selectedEmployee}
          allTasks={allTasks}
          onBack={() => setSelectedEmployee(null)}
          canComment={profile?.role === 'managing_director'}
        />
      )}

      {active === 'dashboard' && !selectedEmployee && (
        <div className="space-y-6">
          {/* Hero */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white p-6">
            <div className="absolute -top-24 -right-16 w-64 h-64 bg-brand/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-16 w-64 h-64 bg-positive/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <p className="text-[10px] font-semibold text-brand-200 uppercase tracking-[0.15em] mb-1.5">{formatDateFull(new Date())}</p>
              <h2 className="text-xl font-bold mb-1.5">{greeting()}, {profile?.full_name?.split(' ')[0]}</h2>
              <p className="text-[12px] text-white/60">
                {activeToday} of {employees.filter((e) => e.role === 'employee').length} employees active today
                {totalTasks > 0 && <> · <span style={{ color: completionColor(overallPct) }}>{Math.round(overallPct)}%</span> company completion</>}
                {silentEmployees.length > 0 && <> · {silentEmployees.length} silent</>}
              </p>
            </div>
          </div>

          {/* Departments at a glance */}
          <div>
            <h3 className="section-title mb-2.5">Departments at a Glance</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <DeptSnapshotCard
                icon={Truck}
                label="Fleet"
                color="blue"
                onClick={() => setActive('fleet')}
                stats={[
                  { label: 'Active drivers', value: `${snapshot.fleet.activeDrivers}/${snapshot.fleet.totalDrivers}` },
                  { label: 'Vehicles', value: snapshot.fleet.totalVehicles },
                ]}
                alert={snapshot.fleet.overdueDeposits > 0 ? `${snapshot.fleet.overdueDeposits} deposit${snapshot.fleet.overdueDeposits === 1 ? '' : 's'} overdue` : undefined}
              />
              <DeptSnapshotCard
                icon={Wallet}
                label="Finance"
                color="amber"
                onClick={() => setActive('finance')}
                stats={[
                  { label: 'Revenue MTD', value: fmt(snapshot.finance.monthRevenue) },
                  { label: 'Expenses MTD', value: fmt(snapshot.finance.monthExpenses) },
                ]}
                alert={snapshot.finance.pendingTransactions > 0 ? `${snapshot.finance.pendingTransactions} pending` : undefined}
              />
              <DeptSnapshotCard
                icon={PhoneCall}
                label="Call Center"
                color="violet"
                onClick={() => setActive('call_center')}
                stats={[
                  { label: 'Follow-ups flagged', value: snapshot.callCenter.followUpsNeeded },
                ]}
                alert={snapshot.callCenter.followUpsNeeded > 0 ? `${snapshot.callCenter.followUpsNeeded} need a call` : undefined}
              />
              <DeptSnapshotCard
                icon={Target}
                label="Marketing"
                color="rose"
                onClick={() => setActive('marketing')}
                stats={[
                  { label: 'Active campaigns', value: snapshot.marketing.activeCampaigns },
                ]}
                alert={snapshot.marketing.overdueFollowUps > 0 ? `${snapshot.marketing.overdueFollowUps} follow-up${snapshot.marketing.overdueFollowUps === 1 ? '' : 's'} overdue` : undefined}
              />
              <DeptSnapshotCard
                icon={Package}
                label="Product Hub"
                color="cyan"
                onClick={() => setActive('it_hub')}
                stats={[
                  { label: 'Products', value: snapshot.itHub.totalProducts },
                ]}
                alert={snapshot.itHub.openIssues > 0 ? `${snapshot.itHub.openIssues} open issue${snapshot.itHub.openIssues === 1 ? '' : 's'}` : undefined}
              />
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                  <TrendingUpIcon size={12} className="text-brand-600 dark:text-brand-300" />
                </div>
                <p className="stat-label">Completion</p>
              </div>
              <p className="text-2xl font-bold leading-none" style={{ color: completionColor(overallPct) }}>{Math.round(overallPct)}%</p>
              <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mt-2.5">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${overallPct}%`, backgroundColor: completionColor(overallPct) }} />
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Users2 size={12} className="text-blue-600 dark:text-blue-300" />
                </div>
                <p className="stat-label">Active Today</p>
              </div>
              <p className="text-2xl font-bold leading-none">{activeToday}<span className="text-xs font-normal text-gray-400 ml-1">/ {employees.filter((e) => e.role === 'employee').length}</span></p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center shrink-0">
                  <ListTodo size={12} className="text-violet-600 dark:text-violet-300" />
                </div>
                <p className="stat-label">Tasks Set</p>
              </div>
              <p className="text-2xl font-bold leading-none">{totalTasks}</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-lg bg-positive/10 flex items-center justify-center shrink-0">
                  <ClipboardCheck size={12} className="text-positive" />
                </div>
                <p className="stat-label">Completed</p>
              </div>
              <p className="text-2xl font-bold leading-none text-positive">{completedTasks}</p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            <div className="card p-4 lg:col-span-3">
              <h3 className="section-title mb-3">Weekly Completion Trend</h3>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={weeklyData} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2F8C86" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#2F8C86" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: axisColor }} width={32} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => [`${v}%`, 'Completion']} />
                  <Area type="monotone" dataKey="pct" stroke="#2F8C86" strokeWidth={2} fill="url(#trendFill)" dot={{ r: 2.5, fill: '#2F8C86', strokeWidth: 0 }} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4 lg:col-span-2">
              <h3 className="section-title mb-3">Department Performance</h3>
              {departmentPerf.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-8 text-center">No departments with active staff yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, departmentPerf.length * 30)}>
                  <BarChart data={departmentPerf} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={{ fontSize: 11, fill: axisColor }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => [`${v}%`, 'Completion']} cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.03)' : '#f8fafc' }} />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={14}>
                      {departmentPerf.map((d, i) => (
                        <Cell key={i} fill={completionColor(d.pct)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button onClick={() => setAssignOpen(true)} className="card p-3.5 flex items-center gap-3 text-left hover:shadow-md transition-all hover:border-brand/30">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                <UserPlus size={15} className="text-blue-600 dark:text-blue-300" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium">Assign a Task</p>
                <p className="text-[10px] text-gray-400">Push work to anyone</p>
              </div>
            </button>
            <button onClick={() => setAnnounceOpen(true)} className="card p-3.5 flex items-center gap-3 text-left hover:shadow-md transition-all hover:border-brand/30">
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center shrink-0">
                <Megaphone size={15} className="text-amber-600 dark:text-amber-300" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium">Broadcast</p>
                <p className="text-[10px] text-gray-400">Company-wide announcement</p>
              </div>
            </button>
            <button onClick={() => setMeetingOpen(true)} className="card p-3.5 flex items-center gap-3 text-left hover:shadow-md transition-all hover:border-brand/30">
              <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center shrink-0">
                <CalendarPlus size={15} className="text-violet-600 dark:text-violet-300" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium">New Meeting Note</p>
                <p className="text-[10px] text-gray-400">Log minutes, share, or link tasks</p>
              </div>
            </button>
          </div>

          {/* Needs attention + Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="card p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <AlertCircle size={14} className="text-orange-500" />
                <h3 className="section-title">Needs Your Attention</h3>
                {attentionCount > 0 && (
                  <span className="text-[8px] font-bold text-white bg-orange-500 px-1.5 py-0.5 rounded-full">{attentionCount}</span>
                )}
              </div>

              {attentionCount === 0 && (
                <p className="text-[12px] text-gray-400 py-4 text-center">All clear — nothing waiting on you.</p>
              )}

              <div className="space-y-3">
                {pendingReviews.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 mb-1.5 flex items-center gap-1.5">
                      <ClipboardCheck size={11} /> Awaiting review
                    </p>
                    <div className="space-y-1">
                      {pendingReviews.map((t) => {
                        const owner = profiles.find((p) => p.id === t.user_id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => setReviewTask(t)}
                            className="w-full flex items-center justify-between p-2 rounded-lg border border-gray-100 dark:border-white/5 hover:border-brand/30 transition-colors text-left"
                          >
                            <span className="text-[11px] truncate">
                              <span className="font-medium">{owner?.full_name ?? 'Unknown'}</span>
                              <span className="text-gray-400"> · {t.title}</span>
                            </span>
                            <span className="text-[10px] text-brand-600 dark:text-brand-300 shrink-0 ml-2">Review</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {unreadComments > 0 && (
                  <button
                    onClick={() => setActive('comments')}
                    className="w-full flex items-center justify-between p-2 rounded-lg border border-gray-100 dark:border-white/5 hover:border-brand/30 transition-colors text-left"
                  >
                    <span className="text-[11px] flex items-center gap-1.5">
                      <MessageSquare size={12} className="text-gray-400" /> {unreadComments} unread {unreadComments === 1 ? 'reply' : 'replies'}
                    </span>
                    <span className="text-[10px] text-brand-600 dark:text-brand-300">Open</span>
                  </button>
                )}

                {silentEmployees.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 mb-1.5 flex items-center gap-1.5">
                      <MoonStar size={11} /> Silent today ({silentEmployees.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {silentEmployees.slice(0, 8).map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setSelectedEmployee(e)}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                        >
                          {e.full_name.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Radio size={14} className="text-brand-500" />
                  <h3 className="section-title">Live Activity</h3>
                </div>
                <button onClick={() => setActive('activity_log')} className="text-[10px] text-brand-600 dark:text-brand-300 hover:underline">
                  View full log
                </button>
              </div>
              <ActivityFeed entries={activity} loading={activityLoading} />
            </div>
          </div>

          {/* Employee cards */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="section-title">Employees</h3>
              <div className="flex items-center gap-1">
                <ArrowDownUp size={12} className="text-gray-400 mr-0.5" />
                {(['completion', 'name', 'tasks'] as SortMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSortMode(m)}
                    className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                      sortMode === m ? 'bg-brand/10 text-brand-600 dark:text-brand-300 font-medium' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {m === 'completion' ? 'Completion' : m === 'name' ? 'Name' : 'Tasks'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {sortedEmployees.map((e) => (
                <EmployeeCard key={e.id} employee={e} onClick={() => setSelectedEmployee(e)} />
              ))}
              {sortedEmployees.length === 0 && <p className="text-[12px] text-gray-400 col-span-full">No employees found.</p>}
            </div>
          </div>
        </div>
      )}

      {active === 'departments' && (
        <DepartmentsView employees={employees} departments={departments} allTasks={allTasks} onSelect={setSelectedEmployee} />
      )}
      {active === 'tasks' && <MDTasksPage />}
      {active === 'fleet' && <FleetPage />}
      {active === 'finance' && <FinanceDeptPage />}
      {active === 'call_center' && <CallCenterPage />}
      {active === 'marketing' && <MarketingPage />}
      {active === 'social' && <SocialMediaPage />}
      {active === 'it_hub' && <ITHubPage />}
      {active === 'help' && <HowToUsePage navItems={NAV} />}
      {active === 'meetings' && <MeetingsPage />}
      {active === 'documents' && <DocumentsPage />}
      {active === 'announcements' && <AnnouncementsPage />}
      {active === 'comments' && <MDCommentsPage />}
      {active === 'activity_log' && <ActivityLogPage profiles={profiles} />}
      {active === 'leaderboard' && <Leaderboard employees={employees} allTasks={allTasks} onSelect={setSelectedEmployee} />}
      {active === 'search' && <SearchPage employees={employees} allTasks={allTasks} onSelect={setSelectedEmployee} />}
      {active === 'admin' && <AdminPanel />}
      {active === 'settings' && <SettingsPage />}

      <AssignTaskModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        employees={activeEmployees}
        onAssigned={reload}
      />
      <CreateAnnouncementModal open={announceOpen} onClose={() => setAnnounceOpen(false)} />
      <CreateMeetingModal open={meetingOpen} onClose={() => setMeetingOpen(false)} />
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

function DeptSnapshotCard({
  icon: Icon,
  label,
  color,
  stats,
  alert,
  onClick,
}: {
  icon: typeof Truck;
  label: string;
  color: AccentColor;
  stats: { label: string; value: string | number }[];
  alert?: string;
  onClick: () => void;
}) {
  const c = ACCENT_COLORS[color];
  return (
    <button onClick={onClick} className="card p-3.5 text-left hover:shadow-md hover:border-brand/30 transition-all flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`w-6 h-6 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}>
            <Icon size={12} className={c.text} />
          </div>
          <p className="text-[11px] font-semibold">{label}</p>
        </div>
        <ChevronRight size={13} className="text-gray-300 dark:text-white/20" />
      </div>
      <div className="space-y-1">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400">{s.label}</span>
            <span className="text-[11px] font-semibold tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
      {alert && (
        <span className="text-[9px] font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded-full w-fit">
          {alert}
        </span>
      )}
    </button>
  );
}

function EmployeeCard({ employee: e, onClick }: { employee: EmployeeWithStats; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card p-3.5 text-left hover:shadow-md transition-all group"
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="relative shrink-0">
          <Avatar name={e.full_name} url={e.avatar_url} size="md" />
          {e.todayTotal > 0 && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-positive border-2 border-white dark:border-navy-800 rounded-full" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium truncate">{e.full_name}</p>
          <p className="text-[10px] text-gray-400 truncate">{e.department?.name ?? 'No department'}</p>
        </div>
        <span className="text-base font-bold shrink-0" style={{ color: completionColor(e.todayPct) }}>
          {Math.round(e.todayPct)}%
        </span>
      </div>

      <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mb-2.5">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${e.todayPct}%`, backgroundColor: completionColor(e.todayPct) }} />
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-400">{e.todayTotal} tasks today</span>
        <span className="text-positive font-medium">{e.todayCompleted} completed</span>
      </div>
    </button>
  );
}

function DepartmentsView({
  employees,
  departments,
  allTasks: _allTasks,
  onSelect,
}: {
  employees: EmployeeWithStats[];
  departments: { id: string; name: string }[];
  allTasks: Task[];
  onSelect: (e: EmployeeWithStats) => void;
}) {
  const [openDept, setOpenDept] = useState<string | null>(null);

  return (
    <div className="space-y-2.5">
      {departments.map((d) => {
        const stats = departmentStats(d.id, employees);
        const isOpen = openDept === d.id;
        return (
          <div key={d.id} className="card overflow-hidden">
            <button
              onClick={() => setOpenDept(isOpen ? null : d.id)}
              className="w-full flex items-center justify-between p-3.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              <div>
                <p className="text-[12px] font-medium">{d.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{stats.deptEmployees.length} employees · {stats.activeToday} active today</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-lg font-bold leading-tight" style={{ color: completionColor(stats.pct) }}>{stats.pct}%</p>
                  <p className="text-[10px] text-gray-400">{stats.completedTasks}/{stats.totalTasks} tasks</p>
                </div>
              </div>
            </button>
            {isOpen && (
              <div className="p-3.5 pt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 animate-fade-in">
                {stats.deptEmployees.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onSelect(e)}
                    className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100 dark:border-white/5 hover:shadow-sm transition-all text-left"
                  >
                    <Avatar name={e.full_name} url={e.avatar_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{e.full_name}</p>
                      <p className="text-[10px] text-gray-400">{e.todayCompleted}/{e.todayTotal} · {e.streak} day streak</p>
                    </div>
                    <span className="text-[11px] font-bold" style={{ color: completionColor(e.todayPct) }}>{Math.round(e.todayPct)}%</span>
                  </button>
                ))}
                {stats.deptEmployees.length === 0 && <p className="text-[11px] text-gray-400 col-span-full">No employees in this department.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
