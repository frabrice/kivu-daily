import { useState } from 'react';
import { Users2, CarFront, RefreshCw } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { canEditFleet } from '../../lib/fleet';
import { supabase } from '../../lib/supabase';
import { useNonInsiderData } from '../../lib/nonInsider';
import NonInsiderDriversPage from './NonInsiderDriversPage';
import NonInsiderVehiclesPage from './NonInsiderVehiclesPage';

// Drivers and vehicles get their own sub-tabs here, rather than being
// mixed into one list, so this stays clearly separate from the managed
// (insider) Fleet pages instead of reading like a variant of them.
type Tab = 'drivers' | 'vehicles';

interface SyncResult {
  fetched: number;
  drivers: { created: number; updated: number };
  cars: { created: number; updated: number };
}

export default function NonInsiderPage() {
  const { profile } = useAuth();
  const canEdit = canEditFleet(profile);
  const [tab, setTab] = useState<Tab>('drivers');
  const data = useNonInsiderData();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState('');

  const noCarCount = data.drivers.filter((d) => !d.car_id).length;

  const runSync = async () => {
    setSyncing(true);
    setSyncError('');
    setSyncResult(null);
    const { data: result, error } = await supabase.functions.invoke('sync-independent-drivers');
    setSyncing(false);
    if (error || result?.error) {
      setSyncError(result?.error ?? error?.message ?? 'Sync failed.');
      return;
    }
    setSyncResult(result as SyncResult);
    data.reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold">Non-Insider Fleet</h2>
          <p className="text-[12px] text-gray-400 mt-0.5">
            Drivers live on the platform whose car isn't part of our managed fleet - onboarded early to build up visible fleet size. Driver and car are tracked separately so a swap or repossession never needs touching the driver's login.
          </p>
        </div>
        {canEdit && (
          <button onClick={runSync} disabled={syncing} className="btn-ghost flex items-center gap-1.5 shrink-0 whitespace-nowrap disabled:opacity-60">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync from Platform'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card p-3.5">
          <p className="stat-label mb-0.5">Drivers</p>
          <p className="text-xl font-bold leading-none">{data.drivers.length}</p>
        </div>
        <div className="card p-3.5">
          <p className="stat-label mb-0.5">Vehicles</p>
          <p className="text-xl font-bold leading-none">{data.cars.length}</p>
        </div>
        <div className="card p-3.5">
          <p className="stat-label mb-0.5">No Car Assigned</p>
          <p className={`text-xl font-bold leading-none ${noCarCount > 0 ? 'text-orange-500' : ''}`}>{noCarCount}</p>
        </div>
      </div>

      {syncResult && (
        <div className="text-[12px] text-positive bg-positive/10 rounded-lg px-3 py-2">
          Synced {syncResult.fetched} platform drivers - {syncResult.drivers.created} new / {syncResult.drivers.updated} updated,{' '}
          {syncResult.cars.created} new / {syncResult.cars.updated} updated {syncResult.cars.created + syncResult.cars.updated === 1 ? 'vehicle' : 'vehicles'}.
        </div>
      )}
      {syncError && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{syncError}</div>}

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
