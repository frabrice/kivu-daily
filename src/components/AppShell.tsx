import { ReactNode, useState, useEffect } from 'react';
import {
  Home,
  Moon,
  Sun,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import Avatar from './Avatar';

export type NavKey =
  | 'home'
  | 'calendar'
  | 'comments'
  | 'analytics'
  | 'dashboard'
  | 'departments'
  | 'leaderboard'
  | 'search'
  | 'admin'
  | 'settings'
  | 'tasks'
  | 'meetings'
  | 'documents'
  | 'announcements'
  | 'fleet'
  | 'call_center'
  | 'marketing'
  | 'social'
  | 'it_hub'
  | 'help'
  | 'activity_log'
  | 'finance'
  | 'finance_dashboard'
  | 'finance_revenue'
  | 'finance_fleet_collections'
  | 'finance_vehicle_owners'
  | 'finance_newsletters'
  | 'finance_payroll'
  | 'finance_driver_payroll'
  | 'finance_suppliers'
  | 'finance_transfers'
  | 'finance_expense_claims'
  | 'finance_accounts'
  | 'finance_reconciliation'
  | 'finance_deposit_confirmations'
  | 'fleet_pipeline'
  | 'fleet_vehicles'
  | 'fleet_deposits'
  | 'fleet_fines'
  | 'call_center_queue'
  | 'call_center_directory'
  | 'call_center_scripts'
  | 'marketing_campaigns'
  | 'marketing_followups'
  | 'it_hub_products'
  | 'it_hub_issues'
  | 'non_insider';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: typeof Home;
  badge?: number;
}

interface ShellProps {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  children: ReactNode;
  notifications?: ReactNode;
  navItems: NavItem[];
  title: string;
}

export default function AppShell({ active, onNavigate, children, notifications, navItems, title }: ShellProps) {
  const { profile, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('kivu-sidebar-collapsed') === '1');

  useEffect(() => {
    localStorage.setItem('kivu-sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  const nav = (compact: boolean) => (
    <nav className="space-y-0.5">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            onClick={() => {
              onNavigate(item.key);
              setMobileOpen(false);
            }}
            title={compact ? item.label : undefined}
            className={`nav-item w-full text-left ${compact ? 'justify-center px-0' : ''} ${active === item.key ? 'nav-item-active' : ''}`}
          >
            <div className="relative shrink-0">
              <Icon size={17} />
              {(item.badge ?? 0) > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                  {item.badge! > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>
            {!compact && <span className="text-[12px]">{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-navy-950">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-gray-100 dark:border-white/5 bg-white dark:bg-navy-900 p-3 fixed h-screen transition-all duration-200 ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
      >
        <div className={`flex items-center mb-6 px-1.5 ${collapsed ? 'flex-col gap-2' : 'justify-between gap-2'}`}>
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 dark:border-white/10 flex items-center justify-center overflow-hidden shrink-0">
              <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-6 h-6 object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="font-bold text-[12px] leading-tight truncate">Kivu Daily</p>
                <p className="text-[9px] text-gray-400 leading-tight truncate">Kivu Ride Ltd</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">{nav(collapsed)}</div>

        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/5 space-y-0.5">
          <button
            onClick={toggle}
            title={collapsed ? (theme === 'light' ? 'Dark Mode' : 'Light Mode') : undefined}
            className={`nav-item w-full text-left ${collapsed ? 'justify-center px-0' : ''}`}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            {!collapsed && <span className="text-[12px]">{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>}
          </button>
          <button
            onClick={signOut}
            title={collapsed ? 'Sign Out' : undefined}
            className={`nav-item w-full text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 ${collapsed ? 'justify-center px-0' : ''}`}
          >
            <LogOut size={17} />
            {!collapsed && <span className="text-[12px]">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-30 bg-white dark:bg-navy-900 border-b border-gray-100 dark:border-white/5 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 dark:border-white/10 flex items-center justify-center overflow-hidden">
            <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-6 h-6 object-contain" />
          </div>
          <span className="font-bold text-sm">Kivu Daily</span>
        </div>
        <button onClick={() => setMobileOpen(true)} className="text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl p-2 transition-colors">
          <Menu size={20} />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white dark:bg-navy-900 p-4 animate-slide-up overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 dark:border-white/10 flex items-center justify-center overflow-hidden">
                  <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-6 h-6 object-contain" />
                </div>
                <p className="font-bold text-sm">Kivu Daily</p>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl p-2 transition-colors">
                <X size={20} />
              </button>
            </div>
            {nav(false)}
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 space-y-0.5">
              <button onClick={toggle} className="nav-item w-full text-left">
                {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
                <span className="text-[12px]">{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
              </button>
              <button onClick={signOut} className="nav-item w-full text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                <LogOut size={17} />
                <span className="text-[12px]">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className={`flex-1 pt-14 md:pt-0 min-h-screen transition-all duration-200 ${collapsed ? 'md:ml-[68px]' : 'md:ml-60'}`}>
        <div className="hidden md:flex items-center justify-between px-6 h-14 border-b border-gray-100 dark:border-white/5 bg-white dark:bg-navy-900 sticky top-0 z-20">
          <h1 className="text-[14px] font-semibold">{title}</h1>
          <div className="flex items-center gap-3">
            {notifications}
            <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100 dark:border-white/10">
              <Avatar name={profile?.full_name ?? ''} url={profile?.avatar_url} size="sm" />
              <div className="text-right">
                <p className="text-[12px] font-medium leading-tight">{profile?.full_name}</p>
                <p className="text-[10px] text-gray-400 leading-tight">
                  {profile?.role === 'managing_director' ? 'Managing Director' : profile?.department?.name ?? 'Employee'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
