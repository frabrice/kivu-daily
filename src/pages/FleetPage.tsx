import { useState } from 'react';
import { Truck, Car, Wallet, Receipt, Users2, Trophy, Eye, Paintbrush, CalendarOff } from 'lucide-react';
import { useFleetData, computeDepositStanding, canEditFleet } from '../lib/fleet';
import { useAuth } from '../lib/auth';
import FleetPipelinePage from './fleet/FleetPipelinePage';
import FleetVehiclesPage from './fleet/FleetVehiclesPage';
import FleetDepositsPage from './fleet/FleetDepositsPage';
import FleetFinesPage from './fleet/FleetFinesPage';
import DepositLeaderboardPage from './fleet/DepositLeaderboardPage';
import NonInsiderPage from './nonInsider/NonInsiderPage';
import BrandingDevicesPage from './fleet/BrandingDevicesPage';
import DriverPausesPage from './fleet/DriverPausesPage';

// Fleet's own employees see these areas as separate sidebar pages
// (src/pages/fleet/*) instead, since a fully expanded sidebar for every
// department would be unmanageable for a role that already sees
// everything. This bundled version is for the MD and IT (full edit
// rights) and for Call Center, read-only - see canEditFleet() in
// lib/fleet.ts.
type Tab = 'pipeline' | 'vehicles' | 'deposits' | 'leaderboard' | 'fines' | 'non_insider' | 'branding' | 'days_off';

// Money pages stay with Fleet, Finance, IT and the MD - Call Center sees
// drivers and vehicles only.
const NOT_FOR_VIEW_ONLY: Tab[] = ['deposits', 'leaderboard', 'fines', 'branding', 'days_off'];

export default function FleetPage() {
  const [savedTab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem('kivu-active-nav-fleet-tab');
      if (saved) return saved as Tab;
    } catch { /* ignore */ }
    return 'pipeline';
  });
  const selectTab = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem('kivu-active-nav-fleet-tab', t); } catch { /* ignore */ }
  };
  const { profile } = useAuth();
  const readOnly = !canEditFleet(profile);
  const tab: Tab = readOnly && NOT_FOR_VIEW_ONLY.includes(savedTab) ? 'pipeline' : savedTab;
  const data = useFleetData();
  const { drivers, deposits } = data;

  const overdueCount = drivers
    .filter((d) => d.vehicle_id && d.contract_status !== 'ended')
    .filter((d) => !computeDepositStanding(d, deposits.filter((dep) => dep.driver_id === d.id)).isCleared).length;

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-lg bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300 w-fit">
          <Eye size={13} /> View only — Fleet makes changes here. On Non-Insider cars you can update branding and device answers.
        </div>
      )}
      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit flex-wrap">
        <TabButton active={tab === 'pipeline'} onClick={() => selectTab('pipeline')} icon={Truck} label="Driver Pipeline" />
        <TabButton active={tab === 'vehicles'} onClick={() => selectTab('vehicles')} icon={Car} label="Vehicles" />
        {!readOnly && <>
          <TabButton active={tab === 'deposits'} onClick={() => selectTab('deposits')} icon={Wallet} label="Deposits" badge={overdueCount} />
          <TabButton active={tab === 'leaderboard'} onClick={() => selectTab('leaderboard')} icon={Trophy} label="Leaderboard" />
          <TabButton active={tab === 'fines'} onClick={() => selectTab('fines')} icon={Receipt} label="Fines" />
        </>}
        {!readOnly && <TabButton active={tab === 'days_off'} onClick={() => selectTab('days_off')} icon={CalendarOff} label="Days off" />}
        <TabButton active={tab === 'non_insider'} onClick={() => selectTab('non_insider')} icon={Users2} label="Non-Insider" />
        {!readOnly && <TabButton active={tab === 'branding'} onClick={() => selectTab('branding')} icon={Paintbrush} label="Branding & Devices" />}
      </div>

      {tab === 'pipeline' && <FleetPipelinePage data={data} />}
      {tab === 'vehicles' && <FleetVehiclesPage data={data} />}
      {tab === 'deposits' && !readOnly && <FleetDepositsPage data={data} />}
      {tab === 'leaderboard' && !readOnly && <DepositLeaderboardPage data={data} />}
      {tab === 'fines' && !readOnly && <FleetFinesPage data={data} />}
      {tab === 'days_off' && !readOnly && <DriverPausesPage data={data} />}
      {tab === 'non_insider' && <NonInsiderPage />}
      {tab === 'branding' && !readOnly && <BrandingDevicesPage />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof Truck; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {!!badge && <span className="text-[8px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}
