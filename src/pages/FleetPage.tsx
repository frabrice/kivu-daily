import { useState } from 'react';
import { Truck, Car, Wallet, Receipt, Users2 } from 'lucide-react';
import { useFleetData } from '../lib/fleet';
import { todayStr } from '../lib/utils';
import FleetPipelinePage from './fleet/FleetPipelinePage';
import FleetVehiclesPage from './fleet/FleetVehiclesPage';
import FleetDepositsPage from './fleet/FleetDepositsPage';
import FleetFinesPage from './fleet/FleetFinesPage';
import NonInsiderPage from './nonInsider/NonInsiderPage';

// Fleet's own employees see these four areas as separate sidebar pages
// (src/pages/fleet/*) instead, since a fully expanded sidebar for every
// department would be unmanageable for a role that already sees
// everything. This bundled version is for the MD, and identically -
// full edit rights included, see canEditFleet() in lib/fleet.ts - for
// Call Center and IT, who both need the same full picture without yet
// another fragmented sidebar stacked on top of their own.
type Tab = 'pipeline' | 'vehicles' | 'deposits' | 'fines' | 'non_insider';

export default function FleetPage() {
  const [tab, setTab] = useState<Tab>('pipeline');
  const data = useFleetData();
  const { drivers, deposits } = data;

  const overdueCount = drivers.filter((d) => d.vehicle_id).filter((d) => {
    const history = deposits.filter((dep) => dep.driver_id === d.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date));
    const last = history[0];
    if (!last) return true;
    const daysSince = Math.floor((new Date(todayStr()).getTime() - new Date(last.paid_date).getTime()) / 86400000);
    return daysSince >= 7;
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit flex-wrap">
        <TabButton active={tab === 'pipeline'} onClick={() => setTab('pipeline')} icon={Truck} label="Driver Pipeline" />
        <TabButton active={tab === 'vehicles'} onClick={() => setTab('vehicles')} icon={Car} label="Vehicles" />
        <TabButton active={tab === 'deposits'} onClick={() => setTab('deposits')} icon={Wallet} label="Deposits" badge={overdueCount} />
        <TabButton active={tab === 'fines'} onClick={() => setTab('fines')} icon={Receipt} label="Fines" />
        <TabButton active={tab === 'non_insider'} onClick={() => setTab('non_insider')} icon={Users2} label="Non-Insider" />
      </div>

      {tab === 'pipeline' && <FleetPipelinePage data={data} />}
      {tab === 'vehicles' && <FleetVehiclesPage data={data} />}
      {tab === 'deposits' && <FleetDepositsPage data={data} />}
      {tab === 'fines' && <FleetFinesPage data={data} />}
      {tab === 'non_insider' && <NonInsiderPage />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof Truck; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {!!badge && <span className="text-[9px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}
