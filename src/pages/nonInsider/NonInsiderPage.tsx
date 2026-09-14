import { useState } from 'react';
import { Users2, CarFront } from 'lucide-react';
import { useNonInsiderData } from '../../lib/nonInsider';
import NonInsiderDriversPage from './NonInsiderDriversPage';
import NonInsiderVehiclesPage from './NonInsiderVehiclesPage';

// Drivers and vehicles get their own sub-tabs here, rather than being
// mixed into one list, so this stays clearly separate from the managed
// (insider) Fleet pages instead of reading like a variant of them.
type Tab = 'drivers' | 'vehicles';

export default function NonInsiderPage() {
  const [tab, setTab] = useState<Tab>('drivers');
  const data = useNonInsiderData();

  const noCarCount = data.drivers.filter((d) => !d.car_id).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Non-Insider Fleet</h2>
        <p className="text-[12px] text-gray-400 mt-0.5">
          Drivers live on the platform whose car isn't part of our managed fleet - onboarded early to build up visible fleet size. Driver and car are tracked separately so a swap or repossession never needs touching the driver's login.
        </p>
      </div>

      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <TabButton active={tab === 'drivers'} onClick={() => setTab('drivers')} icon={Users2} label="Drivers" badge={noCarCount} />
        <TabButton active={tab === 'vehicles'} onClick={() => setTab('vehicles')} icon={CarFront} label="Vehicles" />
      </div>

      {tab === 'drivers' && <NonInsiderDriversPage data={data} />}
      {tab === 'vehicles' && <NonInsiderVehiclesPage data={data} />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof Users2; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {!!badge && <span className="text-[9px] font-bold text-white bg-orange-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}
