import { useState, useMemo } from 'react';
import { Search, Wallet, Car } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, canEditFleet, depositDaysSince } from '../../lib/fleet';
import { Driver } from '../../lib/supabase';
import LogDepositDrawer from '../../components/fleet/LogDepositDrawer';

interface FleetDepositsPageProps { data?: ReturnType<typeof useFleetData> }

export default function FleetDepositsPage({ data }: FleetDepositsPageProps = {}) {
  return data ? <FleetDepositsPageView data={data} /> : <FleetDepositsPageWithData />;
}

function FleetDepositsPageWithData() {
  return <FleetDepositsPageView data={useFleetData()} />;
}

function FleetDepositsPageView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const { drivers, deposits, loading, reload } = data;
  const canEdit = canEditFleet(profile);
  const [search, setSearch] = useState('');
  const [loggingDepositFor, setLoggingDepositFor] = useState<Driver | null>(null);

  const depositsForDriver = (driverId: string) => deposits.filter((dep) => dep.driver_id === driverId);

  const depositQueue = useMemo(() => {
    const assigned = drivers.filter((d) => d.vehicle_id);
    const rows = assigned.map((d) => {
      const history = depositsForDriver(d.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date));
      const lastLogged = history[0]?.paid_date ?? null;
      const daysSince = depositDaysSince(lastLogged, d.initial_deposit_paid, d.initial_deposit_date);
      let priority: number;
      let label: string;
      if (daysSince === null) {
        priority = 0;
        label = 'Never paid';
      } else if (daysSince >= 7) {
        priority = 1;
        label = `Overdue by ${daysSince - 6}d`;
      } else if (daysSince === 6) {
        priority = 2;
        label = 'Due tomorrow';
      } else {
        priority = 3;
        label = `Paid ${daysSince} d ago`;
      }
      return { driver: d, daysSince, priority, label };
    });
    return rows
      .filter((r) => {
        const q = search.trim().toLowerCase();
        return !q || r.driver.full_name.toLowerCase().includes(q);
      })
      .sort((a, b) => a.priority - b.priority || (b.daysSince ?? 999) - (a.daysSince ?? 999));
  }, [drivers, deposits, search]);

  const overdueCount = depositQueue.filter((r) => r.priority <= 1).length;

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Wallet size={16} className="text-blue-600 dark:text-blue-300" /> Deposits
            {overdueCount > 0 && <span className="text-[8px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{overdueCount}</span>}
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Weekly RWF 180,000 driver deposit, tracked on a rolling 7-day cycle.</p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name" className="input pl-8 w-52" />
        </div>
      </div>

      <div className="space-y-1.5">
        {depositQueue.map((row) => {
          const urgent = row.priority <= 1;
          return (
            <div key={row.driver.id} className="card p-3 flex items-center gap-3">
              <div className={`w-1.5 h-8 rounded-full shrink-0 ${
                row.priority === 0 ? 'bg-red-500' : row.priority === 1 ? 'bg-red-500' : row.priority === 2 ? 'bg-orange-500' : 'bg-gray-200 dark:bg-white/10'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate">{row.driver.full_name}</p>
                <p className="text-[10px] text-gray-400 flex items-center gap-1">
                  <Car size={10} /> {row.driver.vehicle?.plate_number}
                  {row.driver.shift && <span>· {row.driver.shift === 'day' ? 'Day shift' : 'Night shift'}</span>}
                </p>
              </div>
              <span className={`text-[10px] font-medium shrink-0 ${urgent ? 'text-red-500' : row.priority === 2 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`}>
                {row.label}
              </span>
              {canEdit && (
                <button onClick={() => setLoggingDepositFor(row.driver)} className="btn-primary shrink-0 whitespace-nowrap">
                  Log Deposit
                </button>
              )}
            </div>
          );
        })}
        {depositQueue.length === 0 && (
          <div className="card p-10 text-center">
            <Wallet size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No drivers with a vehicle assigned yet.</p>
          </div>
        )}
      </div>

      {loggingDepositFor && (
        <LogDepositDrawer
          driver={loggingDepositFor}
          onClose={() => setLoggingDepositFor(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
