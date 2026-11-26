import { useState, useMemo } from 'react';
import { Pager, usePaged } from '../../ui/Pager';
import { Search, Wallet, Car, PhoneCall, CarFront, KeyRound } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, canEditFleet, computeDepositStanding, depositStandingTier, depositStandingLabel, depositOwesLabel, nextPaymentText, foldDepositTier, DEPOSIT_TIER_STYLE, PAUSE_REASON_LABEL, driverShiftShort, formatDateLabelSafe } from '../../lib/fleet';
import { Driver } from '../../lib/supabase';
import { useDuties } from '../../lib/callTickets';
import { kigaliToday } from '../../lib/kigali';
import { usePaymentCalls, callsOf, latestCall, carTaken, promiseState, callLine, toneClass, lastPayment, canTakeCar, kigaliDayOf, PaymentCall } from '../../lib/paymentCalls';
import LogDepositDrawer from '../../components/fleet/LogDepositDrawer';
import LogCallDrawer from '../../components/fleet/LogCallDrawer';
import { EntityLink } from '../../os/EntityLink';
import ExportButton from '../../components/fleet/ExportButton';

interface FleetDepositsPageProps { data?: ReturnType<typeof useFleetData> }

export default function FleetDepositsPage({ data }: FleetDepositsPageProps = {}) {
  return data ? <FleetDepositsPageView data={data} /> : <FleetDepositsPageWithData />;
}

function FleetDepositsPageWithData() {
  return <FleetDepositsPageView data={useFleetData()} />;
}

// Today's follow-up of late drivers (MD, 26 Nov 2026): who is late, who was
// called, who promised, who broke a promise, whose car was taken back.
type Filter = 'all' | 'late' | 'not_called' | 'promised' | 'broken' | 'car_taken';
const TIER_PRIORITY = { red: 0, yellow: 1, green: 2, neutral: 3 } as const;

function FleetDepositsPageView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const duties = useDuties();
  const { drivers, deposits, loading, reload } = data;
  const { calls, reload: reloadCalls } = usePaymentCalls();
  const canEdit = canEditFleet(profile);
  const canCall = canEdit || profile?.department?.slug === 'finance' || duties.driver_payment_followup?.profile_id === profile?.id;
  const canTake = canTakeCar(profile, duties.driver_payment_followup?.profile_id === profile?.id);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loggingDepositFor, setLoggingDepositFor] = useState<Driver | null>(null);
  const [calling, setCalling] = useState<{ driver: Driver; owes: number; mode: 'call' | 'take' | 'return' } | null>(null);
  const today = kigaliToday();

  const allRows = useMemo(() => {
    const assigned = drivers.filter((d) => d.vehicle_id);
    return assigned.map((d) => {
      const mine = deposits.filter((dep) => dep.driver_id === d.id);
      const isEnded = d.contract_status === 'ended';
      const standing = computeDepositStanding(d, mine);
      const tier = depositStandingTier(standing);
      const label = depositStandingLabel(standing);
      const last = lastPayment(d, mine);
      const pendingDeposit = mine.some((x) => x.status === 'pending');
      const call = latestCall(calls, d.id);
      const taken = carTaken(calls, d.id);
      const late = !isEnded && standing.hasStarted && standing.owes > 0;
      const calledToday = callsOf(calls, d.id).some((c) => kigaliDayOf(c.happened_at) === today);
      const promise = call ? promiseState(call, deposits) : null;
      return { driver: d, standing, tier, priority: isEnded ? 4 : TIER_PRIORITY[tier], label, last, pendingDeposit, isEnded, call, taken, late, calledToday, promise };
    }).sort((a, b) => a.priority - b.priority || b.standing.owes - a.standing.owes || b.standing.weekBehind - a.standing.weekBehind);
  }, [drivers, deposits, calls, today]);

  const counts = {
    late: allRows.filter((r) => r.late).length,
    not_called: allRows.filter((r) => r.late && !r.calledToday).length,
    promised: allRows.filter((r) => r.promise === 'pending').length,
    broken: allRows.filter((r) => !r.isEnded && r.promise === 'broken').length,
    car_taken: allRows.filter((r) => !r.isEnded && r.taken).length,
    called: allRows.filter((r) => r.late && r.calledToday).length,
  };

  const depositQueue = allRows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (q && !r.driver.full_name.toLowerCase().includes(q) && !(r.driver.vehicle?.plate_number ?? '').toLowerCase().includes(q)) return false;
    if (filter === 'late') return r.late;
    if (filter === 'not_called') return r.late && !r.calledToday;
    if (filter === 'promised') return r.promise === 'pending';
    if (filter === 'broken') return !r.isEnded && r.promise === 'broken';
    if (filter === 'car_taken') return !r.isEnded && !!r.taken;
    return true;
  });

  const overdueCount = depositQueue.filter((r) => !r.isEnded && r.tier === 'red').length;
  const pgDepositQueue = usePaged(depositQueue, { key: 'fleet-deposits', reset: `${search}${filter}` });
  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  const chip = (k: Filter, label: string, n: number | null, tone: string) => (
    <button key={k} onClick={() => setFilter(filter === k ? 'all' : k)}
      className={`card px-3 py-2 text-left min-w-[110px] transition-colors ${filter === k ? 'border-brand ring-1 ring-brand/40' : 'hover:bg-hover/40'}`}>
      <p className="text-micro text-fg-muted">{label}</p>
      <p className={`text-title font-semibold tabular-nums ${n ? tone : ''}`}>{n ?? '—'}</p>
    </button>
  );
  const line = (c: PaymentCall) => { const l = callLine(c, deposits, today); return <p className={`text-micro font-medium mt-0.5 flex items-center gap-1 ${toneClass(l.tone)}`}><PhoneCall size={10} className="shrink-0" /> <span className="truncate">{l.text}</span></p>; };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Wallet size={16} className="text-blue-600 dark:text-blue-300" /> Deposits
            {overdueCount > 0 && <span className="text-micro font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{overdueCount}</span>}
          </h2>
          <p className="text-caption text-fg-subtle mt-0.5">Each driver pays for the next day the day before (the same day is tolerated) — any amount, so each has their own pay day. A day not paid by the end of that day is lost and the car is taken back.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or plate" className="input pl-8 w-full sm:w-52" />
          </div>
          <ExportButton initial="payments" />
        </div>
      </div>

      {/* Today's follow-up: click a number to see only those drivers. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {chip('late', 'Owe money now', counts.late, 'text-red-600 dark:text-red-400')}
        {chip('not_called', 'Late, not called today', counts.not_called, 'text-red-600 dark:text-red-400')}
        <div className="card px-3 py-2 min-w-[110px]"><p className="text-micro text-fg-muted">Late, called today</p><p className="text-title font-semibold tabular-nums">{counts.called}</p></div>
        {chip('promised', 'Promises waiting', counts.promised, 'text-amber-700 dark:text-amber-300')}
        {chip('broken', 'Broke promise', counts.broken, 'text-red-600 dark:text-red-400')}
        {chip('car_taken', 'Car taken back', counts.car_taken, 'text-red-600 dark:text-red-400')}
      </div>
      {filter !== 'all' && <p className="text-caption text-fg-muted -mt-2">Showing {depositQueue.length} driver{depositQueue.length === 1 ? '' : 's'} · <button className="link" onClick={() => setFilter('all')}>show all</button></p>}

      <div className="space-y-1.5">
        {pgDepositQueue.rows.map((row) => {
          const style = DEPOSIT_TIER_STYLE[row.tier];
          const dotColor = DEPOSIT_TIER_STYLE[foldDepositTier(row.tier)].dot;
          return (
            <div key={row.driver.id} className={`card p-3 flex items-center gap-3 flex-wrap sm:flex-nowrap ${row.isEnded ? 'opacity-50 blur-[1.5px] hover:blur-none hover:opacity-100 transition-[filter,opacity] duration-200' : ''}`}>
              <div className={`w-1.5 h-8 rounded-full shrink-0 ${row.isEnded ? 'bg-gray-300 dark:bg-white/10' : row.taken ? 'bg-red-600' : dotColor}`} />
              <div className="flex-1 min-w-0">
                <p className="text-small font-medium truncate">
                  <EntityLink type="driver" id={row.driver.id} label={row.driver.full_name} />
                  {row.standing.pausedToday && <span className="ml-1.5 text-micro font-semibold text-amber-700 dark:text-amber-300">Paused · {PAUSE_REASON_LABEL[(row.standing.pausedToday.reason ?? 'other') as keyof typeof PAUSE_REASON_LABEL]}</span>}
                  {!row.isEnded && row.taken && <span className="ml-1.5 text-micro font-bold text-white bg-red-600 px-1.5 py-0.5 rounded-full">CAR TAKEN BACK</span>}
                </p>
                <p className="text-micro text-fg-subtle flex items-center gap-1 flex-wrap">
                  <Car size={10} /> {row.driver.vehicle?.plate_number}
                  {row.driver.shift && <span>· {driverShiftShort(row.driver, true)}</span>}
                  <span>· {row.last ? <>Last paid <b className="text-fg-muted">{formatDateLabelSafe(row.last.date)} · {row.last.amount.toLocaleString()} RWF</b>{row.last.pending ? ' (not confirmed)' : ''}</> : 'Never paid'}</span>
                </p>
                {!row.isEnded && depositOwesLabel(row.standing) && (
                  <p className="text-micro font-semibold mt-0.5 text-red-600 dark:text-red-400">{depositOwesLabel(row.standing)} for days already worked</p>
                )}
                {!row.isEnded && (() => {
                  const next = nextPaymentText(row.standing);
                  return next && <p className={`text-micro font-medium mt-0.5 ${next.tone === 'danger' ? 'text-red-600 dark:text-red-400' : next.tone === 'attention' ? 'text-amber-700 dark:text-amber-300' : next.tone === 'good' ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg-muted'}`}>{next.text}</p>;
                })()}
                {!row.isEnded && row.taken && line(row.taken)}
                {!row.isEnded && row.call && line(row.call)}
                {!row.isEnded && row.late && !row.calledToday && <p className="text-micro font-semibold mt-0.5 text-red-600 dark:text-red-400 flex items-center gap-1"><PhoneCall size={10} /> Not called today</p>}
              </div>
              {row.pendingDeposit && (
                <span className="text-micro font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                  Awaiting MD
                </span>
              )}
              {row.isEnded ? (
                <span className="text-micro font-bold shrink-0 px-2 py-0.5 rounded-full text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-500/10">
                  CONTRACT TERMINATED
                </span>
              ) : (
                <span className={`text-micro font-medium shrink-0 px-2 py-0.5 rounded-full ${style.badge}`}>
                  {row.label}
                </span>
              )}
              {!row.isEnded && (
                <div className="flex gap-1.5 shrink-0">
                  {canCall && (
                    <button onClick={() => setCalling({ driver: row.driver, owes: row.standing.owes, mode: 'call' })} className="btn-secondary whitespace-nowrap" title="Log a call or take the car back">
                      <PhoneCall size={13} /> Log call
                    </button>
                  )}
                  {canTake && row.taken && (
                    <button onClick={() => setCalling({ driver: row.driver, owes: row.standing.owes, mode: 'return' })} className="btn-secondary whitespace-nowrap">
                      <KeyRound size={13} /> Give car back
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setLoggingDepositFor(row.driver)} className="btn-primary whitespace-nowrap">
                      Log Deposit
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <Pager pager={pgDepositQueue.pager} noun="drivers" />
        {depositQueue.length === 0 && (
          <div className="card p-10 text-center">
            {filter === 'all' ? <Wallet size={26} className="text-fg-subtle mx-auto mb-2" /> : <CarFront size={26} className="text-fg-subtle mx-auto mb-2" />}
            <p className="text-small text-fg-subtle">{filter === 'all' ? 'No drivers with a vehicle assigned yet.' : 'Nobody here right now.'}</p>
          </div>
        )}
      </div>

      {loggingDepositFor && (
        <LogDepositDrawer
          driver={loggingDepositFor}
          deposits={deposits}
          onClose={() => setLoggingDepositFor(null)}
          onSaved={reload}
        />
      )}
      {calling && (
        <LogCallDrawer driver={calling.driver} owes={calling.owes} mode={calling.mode} canTake={canTake}
          onClose={() => setCalling(null)} onSaved={reloadCalls} />
      )}
    </div>
  );
}
