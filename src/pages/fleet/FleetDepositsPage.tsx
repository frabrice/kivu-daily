import { useState, useMemo } from 'react';
import { Search, Wallet, Car } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, canEditFleet, computeDepositWaterfall, depositDaysSince, depositTier, depositStatusLabel, DEPOSIT_TIER_STYLE } from '../../lib/fleet';
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

  const TIER_PRIORITY = { red: 0, yellow: 1, green: 2, neutral: 3 } as const;

  const depositQueue = useMemo(() => {
    const assigned = drivers.filter((d) => d.vehicle_id);
    const rows = assigned.map((d) => {
      const history = depositsForDriver(d.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date));
      const lastDeposit = history[0] ?? null;
      const isEnded = d.contract_status === 'ended';
      const wf = computeDepositWaterfall(d.initial_deposit_paid, d.initial_deposit_date, depositsForDriver(d.id));
      const daysSince = depositDaysSince(wf.currentAnchor);
      const tier = depositTier(daysSince);
      const label = depositStatusLabel(daysSince);
      return { driver: d, daysSince, tier, priority: isEnded ? 4 : TIER_PRIORITY[tier], label, lastDeposit, remaining: wf.currentRemaining, isEnded };
    });
    return rows
      .filter((r) => {
        const q = search.trim().toLowerCase();
        return !q || r.driver.full_name.toLowerCase().includes(q);
      })
      .sort((a, b) => a.priority - b.priority || (b.daysSince ?? 999) - (a.daysSince ?? 999));
  }, [drivers, deposits, search]);

  const overdueCount = depositQueue.filter((r) => !r.isEnded && r.tier === 'red').length;

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
          const style = DEPOSIT_TIER_STYLE[row.tier];
          return (
            <div key={row.driver.id} className="card p-3 flex items-center gap-3">
              <div className={`w-1.5 h-8 rounded-full shrink-0 ${row.isEnded ? 'bg-gray-300 dark:bg-white/10' : style.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate">{row.driver.full_name}</p>
                <p className="text-[10px] text-gray-400 flex items-center gap-1">
                  <Car size={10} /> {row.driver.vehicle?.plate_number}
                  {row.driver.shift && <span>· {row.driver.shift === 'day' ? 'Day shift' : 'Night shift'}</span>}
                </p>
                {!row.isEnded && row.remaining > 0 && (
                  <p className="text-[10px] text-red-500 font-medium mt-0.5">{row.remaining.toLocaleString()} RWF remaining this week</p>
                )}
              </div>
              {row.lastDeposit?.status === 'pending' && (
                <span className="text-[9px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                  Pending
                </span>
              )}
              {row.isEnded ? (
                <span className="text-[10px] font-bold shrink-0 px-2 py-0.5 rounded-full text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-500/10">
                  CONTRACT TERMINATED
                </span>
              ) : (
                <span className={`text-[10px] font-medium shrink-0 px-2 py-0.5 rounded-full ${style.badge}`}>
                  {row.label}
                </span>
              )}
              {canEdit && !row.isEnded && (
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
          currentRemaining={computeDepositWaterfall(loggingDepositFor.initial_deposit_paid, loggingDepositFor.initial_deposit_date, depositsForDriver(loggingDepositFor.id)).currentRemaining}
          onClose={() => setLoggingDepositFor(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
