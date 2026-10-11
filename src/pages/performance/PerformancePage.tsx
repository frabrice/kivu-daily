import { useState } from 'react';
import { Activity, Car, Gauge, PhoneCall, RefreshCw, Users, Wallet, UserRound } from 'lucide-react';
import { NavKey } from '../../components/AppShell';
import { RangeTabs } from '../../components/charts/kit';
import { periodOf, usePerformanceData } from '../../lib/performance';
import CallAnalyticsPage from '../callCenter/CallAnalyticsPage';
import OverviewTab from './OverviewTab';
import TeamTab from './TeamTab';
import DriversTab from './DriversTab';
import FleetTab from './FleetTab';
import MoneyTab from './MoneyTab';

type Tab = 'overview' | 'team' | 'drivers' | 'fleet' | 'money' | 'calls';
const TABS: { key: Tab; label: string; icon: typeof Gauge }[] = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'drivers', label: 'Drivers', icon: UserRound },
  { key: 'fleet', label: 'Fleet & cars', icon: Car },
  { key: 'money', label: 'Money', icon: Wallet },
  { key: 'calls', label: 'Call Center & outreach', icon: PhoneCall },
];
const RANGES = [{ v: 7, label: '7 days' }, { v: 30, label: '30 days' }, { v: 90, label: '90 days' }];

// MD: how the company is performing - people, drivers, cars, money and the
// Call Center - with trends and comparisons to the period before.
export default function PerformancePage({ onNavigate }: { onNavigate: (key: NavKey) => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('kivu-performance-tab') as Tab) || 'overview'; } catch { return 'overview'; }
  });
  const [days, setDays] = useState(30);
  const { data, error, reload } = usePerformanceData();
  const period = periodOf(days);
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('kivu-performance-tab', t); } catch { /* ignore */ } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Activity size={16} className="text-brand-600 dark:text-brand-300" /> Performance</h2>
          <p className="text-caption text-fg-muted mt-0.5">Every number is rebuilt from what is recorded in Kivu Daily, day by day. Changes compare with the {days} days before.</p>
        </div>
        <div className="flex items-center gap-2">
          {tab !== 'calls' && <RangeTabs value={days} onChange={setDays} options={RANGES} />}
          <button onClick={reload} className="btn-ghost p-2" aria-label="Refresh" title="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-0.5 p-0.5 bg-inset rounded-lg w-fit max-w-full" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => pick(t.key)}
            className={`px-3 py-1.5 rounded-md text-small font-medium flex items-center gap-1.5 ${tab === t.key ? 'bg-surface-2 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-fg-muted'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'calls' ? <CallAnalyticsPage /> : error ? <div className="card p-6 text-small text-red-600">{error}</div> : !data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>
      ) : (
        <>
          {tab === 'overview' && <OverviewTab data={data} period={period} onNavigate={onNavigate} onTab={pick} />}
          {tab === 'team' && <TeamTab data={data} period={period} />}
          {tab === 'drivers' && <DriversTab data={data} period={period} />}
          {tab === 'fleet' && <FleetTab data={data} period={period} />}
          {tab === 'money' && <MoneyTab data={data} period={period} />}
        </>
      )}
    </div>
  );
}
