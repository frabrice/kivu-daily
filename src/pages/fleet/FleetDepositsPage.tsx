import { useState, useMemo, ReactNode } from 'react';
import { Search, Wallet, PhoneCall, KeyRound, Info, ChevronDown, AlertOctagon, PhoneMissed, Clock, Handshake, Ban, CarFront, Banknote, X, FileText, Loader2, HandCoins } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, canEditFleet, computeDepositStanding, contractSettlement, fineAmountPaid, nextPaymentText, PAUSE_REASON_LABEL, driverShiftShort, formatDateLabelSafe } from '../../lib/fleet';
import { Driver } from '../../lib/supabase';
import { useDuties } from '../../lib/callTickets';
import { kigaliToday } from '../../lib/kigali';
import { usePaymentCalls, callsOf, latestCall, carTaken, promiseState, callLine, lastPayment, canTakeCar, kigaliDayOf } from '../../lib/paymentCalls';
import LogDepositDrawer from '../../components/fleet/LogDepositDrawer';
import LogCallDrawer from '../../components/fleet/LogCallDrawer';
import ReportAdditionsModal from '../../components/fleet/ReportAdditionsModal';
import { useOtherMoney } from '../../lib/otherMoney';
import { moneyStatus, MoneyStatus, MoneyStatusKey, STATUS_STYLE, StatusPill, DriverAvatar, PlateChip, Amount, Field, CallChip, NotCalledChip, HoverCard, CardLines } from '../../components/fleet/driverUi';
import { EntityLink } from '../../os/EntityLink';
import ExportButton from '../../components/fleet/ExportButton';

interface FleetDepositsPageProps { data?: ReturnType<typeof useFleetData> }

export default function FleetDepositsPage({ data }: FleetDepositsPageProps = {}) {
  return data ? <FleetDepositsPageView data={data} /> : <FleetDepositsPageWithData />;
}

function FleetDepositsPageWithData() {
  return <FleetDepositsPageView data={useFleetData()} />;
}

// Deposits (redesigned MD, 26 Nov 2026): today's follow-up numbers on top
// (each one a filter), then every driver grouped by what they need - the
// most urgent first - with their money, last payment and latest call on one row.
type Filter = 'all' | 'late' | 'not_called' | 'pay_today' | 'promised' | 'broken' | 'car_taken';

const SECTIONS: { key: MoneyStatusKey; title: string; hint: string }[] = [
  { key: 'taken', title: 'Car taken back', hint: 'Give it back once they have paid' },
  { key: 'late', title: 'Not paid', hint: 'A day went unpaid — call them; take the car back if needed' },
  { key: 'pay_today', title: 'Pay today', hint: "Today isn't paid yet — tolerated until tonight" },
  { key: 'due_soon', title: 'Pay today or tomorrow', hint: 'Remind them to pay for the next day' },
  { key: 'paid', title: 'Paid up', hint: 'Nothing to do' },
  { key: 'paused', title: 'Day off', hint: 'Not charged while paused' },
  { key: 'not_started', title: 'Not started yet', hint: '' },
  { key: 'ended', title: 'Contract ended', hint: '' },
];

function FleetDepositsPageView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const duties = useDuties();
  const { drivers, deposits, fines, finePayments, loading, reload } = data;
  const { calls, reload: reloadCalls } = usePaymentCalls();
  const canEdit = canEditFleet(profile);
  const isFollowup = duties.driver_payment_followup?.profile_id === profile?.id;
  const canCall = canEdit || profile?.department?.slug === 'finance' || isFollowup;
  const canTake = canTakeCar(profile, isFollowup);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showEnded, setShowEnded] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const [loggingDepositFor, setLoggingDepositFor] = useState<Driver | null>(null);
  const [calling, setCalling] = useState<{ driver: Driver; owes: number; mode: 'call' | 'take' | 'return' } | null>(null);
  const today = kigaliToday();

  // The PDF report reads the database itself when pressed, so it is exact to that moment.
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState('');
  // Other money received (people not in the system yet): recorded with its
  // own button, or when "PDF report" is pressed. Saved, and in every report.
  const otherMoney = useOtherMoney();
  const [otherMode, setOtherMode] = useState<'record' | 'report' | null>(null);
  const makeReport = async () => {
    setReporting(true); setReportError('');
    try {
      const { buildDepositsReport } = await import('../../lib/depositsReportPdf');
      const blob = await buildDepositsReport(profile?.full_name?.trim() ?? 'Kivu Daily');
      setOtherMode(null);
      const stamp = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 16).replace('T', '-').replace(':', 'h');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Kivu-Ride-Deposits-Report-${stamp}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'unknown error');
    } finally { setReporting(false); }
  };

  const allRows = useMemo(() => drivers.filter((d) => d.vehicle_id).map((d) => {
    const mine = deposits.filter((dep) => dep.driver_id === d.id);
    const isEnded = d.contract_status === 'ended';
    const standing = computeDepositStanding(d, mine);
    const taken = isEnded ? null : carTaken(calls, d.id);
    const status = moneyStatus(standing, { ended: isEnded, taken: !!taken, today });
    const call = latestCall(calls, d.id);
    const late = !isEnded && standing.hasStarted && standing.owes > 0;
    const calledToday = callsOf(calls, d.id).some((c) => kigaliDayOf(c.happened_at) === today);
    // If the contract ended today (MD, 27 Nov 2026): the days worked and today itself are owed
    // (no new driver starts the same day), against money paid ahead. Collateral is held apart
    // and never counted as a deposit - it is only shown next to it, as what could cover a debt.
    const settle = isEnded ? null : contractSettlement(d, mine, today);
    const finesUnpaid = isEnded ? 0 : fines.filter((f) => f.driver_id === d.id).reduce((t, f) => t + Math.max(0, f.amount - fineAmountPaid(f.id, finePayments)), 0);
    const collateral = d.collateral_settled_on ? 0 : Number(d.collateral_amount ?? 0);
    const depositsNet = settle ? settle.credit - settle.owes - finesUnpaid : 0;
    const ifEnded = settle ? { cost: settle.cost, paid: settle.paid, days: settle.days, owes: settle.owes, credit: settle.credit, fines: finesUnpaid, collateral, deposits: depositsNet, net: depositsNet + collateral } : null;
    return {
      driver: d, standing, status, taken, call, late, calledToday, isEnded, ifEnded,
      last: lastPayment(d, mine), pendingDeposit: mine.some((x) => x.status === 'pending'),
      promise: call ? promiseState(call, deposits) : null,
    };
  }).sort((a, b) => a.status.rank - b.status.rank || b.standing.owes - a.standing.owes || a.driver.full_name.localeCompare(b.driver.full_name)), [drivers, deposits, calls, today, fines, finePayments]);

  const live = allRows.filter((r) => !r.isEnded);
  const sum = (rs: typeof allRows) => rs.reduce((s, r) => s + r.standing.owes, 0);
  const lateRows = live.filter((r) => r.late);
  const tiles: { key: Filter; label: string; value: number; sub: string; tone: 'danger' | 'attention' | 'muted'; Icon: LucideIcon }[] = [
    { key: 'late', label: 'Owe money now', value: lateRows.length, sub: lateRows.length ? `${sum(lateRows).toLocaleString('en-US')} RWF owed` : 'Nobody owes', tone: 'danger', Icon: AlertOctagon },
    { key: 'not_called', label: 'Not called today', value: lateRows.filter((r) => !r.calledToday).length, sub: `${lateRows.filter((r) => r.calledToday).length} of ${lateRows.length} called`, tone: 'danger', Icon: PhoneMissed },
    { key: 'pay_today', label: 'Pay today', value: live.filter((r) => r.status.key === 'pay_today' || r.status.key === 'due_soon').length, sub: 'For today or tomorrow', tone: 'attention', Icon: Clock },
    { key: 'promised', label: 'Promises waiting', value: live.filter((r) => r.promise === 'pending').length, sub: 'Reminder 30 min before', tone: 'attention', Icon: Handshake },
    { key: 'broken', label: 'Broke promise', value: live.filter((r) => r.promise === 'broken').length, sub: 'Time passed, not paid', tone: 'danger', Icon: Ban },
    { key: 'car_taken', label: 'Car taken back', value: live.filter((r) => r.taken).length, sub: 'Off the road', tone: 'danger', Icon: CarFront },
  ];

  // Money in: the last 7 days, and payments Finance hasn't confirmed yet.
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  // Start deposits count on the day they were paid, like in the PDF report.
  const collected7 = deposits.filter((x) => x.paid_date > weekAgo).reduce((s, x) => s + Number(x.amount), 0)
    + drivers.filter((d) => d.initial_deposit_paid && d.initial_deposit_date && d.initial_deposit_date > weekAgo).reduce((s, d) => s + Number(d.initial_deposit_amount ?? 0), 0);
  const pending = deposits.filter((x) => x.status === 'pending');
  // Other money not connected to a driver yet (connected money is counted on the driver).
  const otherWaiting = otherMoney.items.filter((m) => !m.driver_id);
  // If every contract ended today: what we would lose, and what we would give back.
  const endedNow = live.filter((r) => r.standing.hasStarted && r.ifEnded).map((r) => r.ifEnded!);
  // After each driver's own collateral: what we would still be owed, and what we would return.
  const wouldBeOwed = endedNow.filter((x) => x.net < 0).reduce((t, x) => t - x.net, 0);
  const wouldReturn = endedNow.filter((x) => x.net > 0).reduce((t, x) => t + x.net, 0);
  const owedBeforeCollateral = endedNow.filter((x) => x.deposits < 0).reduce((t, x) => t - x.deposits, 0);
  const collateralHeld = live.reduce((t, r) => t + (r.ifEnded?.collateral ?? 0), 0);
  const paidUp = live.filter((r) => r.standing.hasStarted && r.standing.isCleared).length;
  const onRoad = live.filter((r) => r.standing.hasStarted).length;

  const q = search.trim().toLowerCase();
  const visible = allRows.filter((r) => {
    if (q && !r.driver.full_name.toLowerCase().includes(q) && !(r.driver.vehicle?.plate_number ?? '').toLowerCase().includes(q)) return false;
    switch (filter) {
      case 'late': return r.late;
      case 'not_called': return r.late && !r.calledToday;
      case 'pay_today': return r.status.key === 'pay_today' || r.status.key === 'due_soon';
      case 'promised': return !r.isEnded && r.promise === 'pending';
      case 'broken': return !r.isEnded && r.promise === 'broken';
      case 'car_taken': return !!r.taken;
      default: return true;
    }
  });

  if (loading) return <div className="space-y-3"><div className="h-24 skeleton rounded-card" />{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-card" />)}</div>;

  const activeTile = tiles.find((t) => t.key === filter);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-lg bg-accent-muted text-accent-fg flex items-center justify-center shrink-0"><Wallet size={19} /></span>
          <div>
            <h2 className="text-h2 font-semibold leading-tight">Deposits</h2>
            <p className="text-body text-fg-muted mt-0.5">
              Who owes what, who we called and what they promised.{' '}
              <button onClick={() => setShowRule((v) => !v)} className="link inline-flex items-center gap-0.5 text-caption"><Info size={12} /> The payment rule</button>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search driver or plate" className="input !pl-8 w-full sm:w-60" aria-label="Search" />
          </label>
          {canTake && (
            <button onClick={() => setOtherMode('record')} className="btn-secondary whitespace-nowrap" title="Money received from someone not in Kivu Daily as a driver on a car yet - kept and counted in every report">
              <HandCoins size={14} /> Record other money
            </button>
          )}
          <button onClick={() => (canTake ? setOtherMode('report') : makeReport())} disabled={reporting} className="btn-secondary whitespace-nowrap" title="Download a PDF: payments today and yesterday, and where every driver stands right now">
            {reporting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {reporting ? 'Preparing…' : 'PDF report'}
          </button>
          <ExportButton initial="payments" />
        </div>
      </div>
      {reportError && <p className="text-caption text-danger -mt-3">Couldn't make the report: {reportError}</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-body -mt-2">
        <span className="text-fg-muted">Paid up today <b className="text-fg">{paidUp}/{onRoad}</b></span>
        <span className="text-fg-muted">Collected in 7 days <b className="text-fg tabular-nums">{collected7.toLocaleString('en-US')} RWF</b></span>
        {otherWaiting.length > 0 && (
          <button onClick={() => setOtherMode('record')} disabled={!canTake} className="text-fg-muted hover:text-fg disabled:hover:text-fg-muted" title="Recorded under Other money, not connected to a driver yet - connect it when you add them as a driver">Other money, not connected <b className="text-fg tabular-nums">{otherWaiting.reduce((s, m) => s + Number(m.amount), 0).toLocaleString('en-US')} RWF</b><span className="text-fg-subtle"> · {otherWaiting.length}</span></button>
        )}
        <span className="text-fg-muted">If all ended today{' '}
          <HoverCard width="w-80" card={<CardLines title="If every contract ended today" lines={[
            { label: 'Owed for days driven (today included)', value: `${owedBeforeCollateral.toLocaleString('en-US')} RWF` },
            { label: 'Covered by their own collateral', value: `− ${(owedBeforeCollateral - wouldBeOwed).toLocaleString('en-US')} RWF` },
          ]} total={{ label: 'Still owed to us', value: `${wouldBeOwed.toLocaleString('en-US')} RWF` }}
            note={<>Collateral held: {collateralHeld.toLocaleString('en-US')} RWF. It never pays for days; it only settles a debt when a contract ends. To return: {wouldReturn.toLocaleString('en-US')} RWF (collateral left over and money paid ahead).</>} />}>
            <b className="text-fg tabular-nums">{wouldBeOwed.toLocaleString('en-US')} RWF owed</b>
          </HoverCard>
          <span className="text-fg-subtle"> · {wouldReturn.toLocaleString('en-US')} to return</span>
        </span>
        {collateralHeld > 0 && <span className="text-fg-muted">Collateral held <b className="text-fg tabular-nums">{collateralHeld.toLocaleString('en-US')} RWF</b></span>}
        <span className="text-fg-muted">Waiting for confirmation <b className="text-fg">{pending.length}</b>{pending.length ? <span className="text-fg-subtle"> · {pending.reduce((s, x) => s + Number(x.amount), 0).toLocaleString('en-US')} RWF</span> : null}</span>
      </div>
      {showRule && (
        <div className="card-muted px-4 py-3 text-body text-fg-muted flex items-start gap-2">
          <Info size={15} className="text-accent-fg shrink-0 mt-0.5" />
          <p>Each driver pays for the next day <b className="text-fg">the day before</b> (paying on the morning of that day is tolerated). Any amount counts, so each driver has their own pay day. A working day not paid by the end of that day is lost and <b className="text-fg">the car is taken back</b>.</p>
        </div>
      )}

      {/* Today's numbers - each one filters the list */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map((t) => {
          const on = filter === t.key;
          const hot = t.value > 0;
          const color = hot ? 'text-fg' : 'text-fg-subtle';
          return (
            <button key={t.key} onClick={() => setFilter(on ? 'all' : t.key)}
              className={`card p-3.5 text-left transition-all hover:border-line-strong ${on ? '!border-accent ring-2 ring-accent/30' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption font-medium text-fg-muted truncate flex items-center gap-1.5">{hot && t.tone === 'danger' && <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" aria-hidden />}{t.label}</span>
                <t.Icon size={14} className="text-fg-subtle shrink-0" />
              </div>
              <p className={`text-h2 font-semibold tabular-nums leading-none mt-1.5 ${color}`}>{t.value}</p>
              <p className="text-micro text-fg-subtle mt-1.5 truncate">{t.sub}</p>
            </button>
          );
        })}
      </div>

      {activeTile && (
        <div className="flex items-center gap-2 text-body">
          <span className="text-fg-muted">Showing <b className="text-fg">{activeTile.label.toLowerCase()}</b> · {visible.length} driver{visible.length === 1 ? '' : 's'}</span>
          <button onClick={() => setFilter('all')} className="btn-ghost !py-0.5 !px-1.5 inline-flex items-center gap-1 text-caption"><X size={12} /> Clear</button>
        </div>
      )}

      {/* Drivers by what they need */}
      {SECTIONS.map((sec) => {
        const rows = visible.filter((r) => r.status.key === sec.key);
        if (!rows.length) return null;
        const collapsible = sec.key === 'ended';
        const open = !collapsible || showEnded || !!q;
        const owed = sum(rows);
        const style = STATUS_STYLE[sec.key];
        return (
          <section key={sec.key} className="space-y-2">
            <button onClick={() => collapsible && setShowEnded((v) => !v)} className={`w-full flex items-center gap-2 px-1 text-left ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${style.bar}`} />
              <h3 className="text-ui font-semibold">{sec.title}</h3>
              <span className="counter">{rows.length}</span>
              {owed > 0 && sec.key !== 'ended' && <span className="text-caption font-medium text-fg-muted tabular-nums">{owed.toLocaleString('en-US')} RWF owed</span>}
              {sec.hint && <span className="text-caption text-fg-subtle hidden md:inline">· {sec.hint}</span>}
              {collapsible && <ChevronDown size={15} className={`ml-auto text-fg-subtle transition-transform ${open ? 'rotate-180' : ''}`} />}
            </button>
            {open && (
              <div className="card p-0 divide-y divide-line-muted [&>*:first-child]:rounded-t-card [&>*:last-child]:rounded-b-card">
                {rows.map((row) => (
                  <DepositRow key={row.driver.id} row={row} today={today} deposits={deposits}
                    actions={!row.isEnded && (
                      <>
                        {canCall && <button onClick={() => setCalling({ driver: row.driver, owes: row.standing.owes, mode: 'call' })} className="btn-secondary whitespace-nowrap" title="Log a call, a promise, or take the car back"><PhoneCall size={14} /> Log call</button>}
                        {canTake && row.taken && <button onClick={() => setCalling({ driver: row.driver, owes: row.standing.owes, mode: 'return' })} className="btn-secondary whitespace-nowrap"><KeyRound size={14} /> Give back</button>}
                        {canEdit && <button onClick={() => setLoggingDepositFor(row.driver)} className="btn-primary whitespace-nowrap"><Banknote size={14} /> Log deposit</button>}
                      </>
                    )} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {visible.length === 0 && (
        <div className="card p-10 text-center">
          <Wallet size={26} className="text-fg-subtle mx-auto mb-2" />
          <p className="text-body text-fg-muted">{filter !== 'all' || q ? 'Nobody matches right now.' : 'No drivers with a car yet.'}</p>
        </div>
      )}

      {loggingDepositFor && <LogDepositDrawer driver={loggingDepositFor} deposits={deposits} onClose={() => setLoggingDepositFor(null)} onSaved={reload} />}
      {otherMode && (
        <ReportAdditionsModal mode={otherMode} recorded={otherMoney.items} profileId={profile?.id} isMd={profile?.role === 'managing_director'}
          busy={reporting} onCancel={() => setOtherMode(null)} onSaved={otherMoney.reload} onMake={makeReport} />
      )}
      {calling && <LogCallDrawer driver={calling.driver} owes={calling.owes} mode={calling.mode} canTake={canTake} onClose={() => setCalling(null)} onSaved={reloadCalls} />}
    </div>
  );
}

// No full day paid yet: say whether part of the first day is (e.g. 40,000 of 45,000).
const paidNothingText = (s: ReturnType<typeof computeDepositStanding>) =>
  s.totalPaid + s.adjusted > 0 ? `Part of a day (${(s.totalPaid + s.adjusted).toLocaleString('en-US')})` : 'Nothing paid';

interface Row {
  driver: Driver; standing: ReturnType<typeof computeDepositStanding>; status: MoneyStatus; isEnded: boolean; late: boolean; calledToday: boolean;
  taken: ReturnType<typeof carTaken>; call: ReturnType<typeof latestCall>; last: ReturnType<typeof lastPayment>; pendingDeposit: boolean; promise: ReturnType<typeof promiseState>;
  ifEnded: { cost: number; paid: number; days: number; owes: number; credit: number; fines: number; collateral: number; deposits: number; net: number } | null;
}

const k = (n: number) => `${n.toLocaleString('en-US')}`;
// "If ended today" (MD, 27 Nov 2026): one final amount - what they would still owe us, or what
// we would return - and the whole sum on hover: days driven (today included), paid, fines, then
// the collateral, which is held apart and only settles a debt when the contract ends.
function IfEnded({ x, started }: { x: Row['ifEnded']; started: boolean }) {
  if (!x || !started) return <p className="text-fg-subtle">—</p>;
  const r = (n: number) => `${k(n)} RWF`;
  const lines = [
    { label: `${x.days} day${x.days === 1 ? '' : 's'} driven, today included`, value: r(x.cost) },
    { label: 'Paid', value: `− ${r(x.paid)}` },
    ...(x.fines ? [{ label: 'Unpaid fines', value: r(x.fines) }] : []),
    ...(x.collateral ? [
      { label: x.deposits < 0 ? 'Owed for the days' : 'Paid ahead', value: r(Math.abs(x.deposits)), strong: true },
      { label: 'Collateral held', value: `− ${r(x.collateral)}` },
    ] : []),
  ];
  const label = x.net < 0 ? 'Owes us' : x.net > 0 ? 'We return' : 'Even';
  const note = x.collateral
    ? 'Collateral is held apart: it never pays for days, it only settles what is owed when the contract ends.'
    : x.net > 0 ? 'Money paid ahead — kept as credit if the contract is renewed.' : undefined;
  return (
    <HoverCard width="w-80" card={<CardLines title="If the contract ended today" lines={lines} total={{ label, value: x.net ? r(Math.abs(x.net)) : '0 RWF' }} note={note} />}>
      {x.net < 0 ? <span className="font-semibold tabular-nums text-danger">Owes {k(-x.net)}</span>
        : x.net > 0 ? <span className="font-semibold tabular-nums text-fg">Return {k(x.net)}</span>
        : <span className="font-medium text-fg-muted">Even</span>}
    </HoverCard>
  );
}

// One driver: who and which car | status and what they owe | paid to and next | last payment | latest call | actions.
function DepositRow({ row, today, deposits, actions }: { row: Row; today: string; deposits: Parameters<typeof callLine>[1]; actions: ReactNode }) {
  const { driver: d, standing: s, status } = row;
  const next = !row.isEnded && s.hasStarted ? nextPaymentText(s) : null;
  return (
    <div className={`relative flex flex-col lg:grid lg:grid-cols-[minmax(230px,1.5fr)_minmax(115px,0.6fr)_minmax(135px,0.75fr)_minmax(105px,0.6fr)_minmax(120px,0.65fr)_minmax(170px,1fr)_auto] lg:items-center gap-3 lg:gap-4 pl-5 pr-4 py-3.5 hover:bg-hover/40 transition-colors ${row.isEnded ? 'opacity-60' : ''}`}>

      {/* Who */}
      <div className="flex items-center gap-3 min-w-0">
        <DriverAvatar name={d.full_name} status={status} />
        <div className="min-w-0">
          <p className="text-ui font-semibold leading-snug break-words"><EntityLink type="driver" id={d.id} label={d.full_name} /></p>
          <p className="flex items-center gap-1.5 mt-0.5 text-caption text-fg-subtle min-w-0">
            <PlateChip plate={d.vehicle?.plate_number} />
            <span className="truncate">{driverShiftShort(d)}</span>
          </p>
        </div>
      </div>

      {/* Status and what they owe */}
      <div className="flex lg:flex-col items-center lg:items-start gap-2 lg:gap-1">
        <StatusPill status={status} />
        {s.pausedToday ? <span className="text-caption text-done">{PAUSE_REASON_LABEL[(s.pausedToday.reason ?? 'other') as keyof typeof PAUSE_REASON_LABEL]}</span>
          : s.owes > 0 && !row.isEnded ? <span className="text-caption text-fg-muted">owes <Amount value={s.owes} size="sm" /></span> : null}
        {row.pendingDeposit && <span className="text-micro text-fg-subtle">Payment awaiting confirmation</span>}
      </div>

      {/* Paid to and next */}
      <Field label="Paid to · next" className="hidden lg:block">
        {row.isEnded ? <span className="text-fg-subtle">—</span> : (
          <>
            <p className="font-medium">{s.paidThrough ? formatDateLabelSafe(s.paidThrough) : <span className="text-fg-subtle">{paidNothingText(s)}</span>}</p>
            {next && <p className="text-caption truncate text-fg-muted" title={next.text}>
              {s.nextDueAmount > 0 && s.nextDueDate ? `${s.nextDueAmount.toLocaleString('en-US')} by ${formatDateLabelSafe(s.nextDueDate)}` : next.text}</p>}
          </>
        )}
      </Field>

      {/* Last payment */}
      <Field label="Last paid" className="hidden lg:block">
        {row.last ? (<>
          <p className="font-medium">{formatDateLabelSafe(row.last.date)}</p>
          <p className="text-caption text-fg-muted"><Amount value={row.last.amount} size="sm" />{row.last.pending ? <span className="text-fg-subtle"> · unconfirmed</span> : ''}</p>
        </>) : <p className="text-fg-subtle">Never</p>}
      </Field>

      {/* If the contract ended today */}
      <Field label="If ended today" className="hidden lg:block"><IfEnded x={row.ifEnded} started={s.hasStarted} /></Field>

      {/* Phone-size summary of the columns above */}
      <div className="lg:hidden grid grid-cols-2 gap-3">
        <Field label="Paid to">{s.paidThrough ? formatDateLabelSafe(s.paidThrough) : paidNothingText(s)}{s.nextDueAmount > 0 && s.nextDueDate && !row.isEnded ? <p className="text-caption text-fg-muted">next {s.nextDueAmount.toLocaleString('en-US')} by {formatDateLabelSafe(s.nextDueDate)}</p> : null}</Field>
        <Field label="Last paid">{row.last ? <>{formatDateLabelSafe(row.last.date)}<p className="text-caption text-fg-muted">{row.last.amount.toLocaleString('en-US')} RWF</p></> : 'Never'}</Field>
        {!row.isEnded && s.hasStarted && <Field label="If ended today" className="col-span-2"><IfEnded x={row.ifEnded} started={s.hasStarted} /></Field>}
      </div>

      {/* Latest call */}
      <div className="min-w-0 flex flex-col gap-1">
        {row.taken && <CallChip call={row.taken} line={callLine(row.taken, deposits, today)} />}
        {row.call ? <CallChip call={row.call} line={callLine(row.call, deposits, today)} state={row.promise} />
          : !row.taken && !row.isEnded && <span className="text-caption text-fg-subtle">No call yet</span>}
        {row.late && !row.calledToday && <NotCalledChip />}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 lg:justify-end flex-wrap">{actions}</div>
    </div>
  );
}
