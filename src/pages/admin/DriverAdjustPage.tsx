import { useMemo, useState } from 'react';
import { SlidersHorizontal, CheckCircle2, AlertTriangle, Plus, Wallet, Receipt, HandCoins, Loader2, Search, Ban, Check, CalendarClock, Users2, UserX } from 'lucide-react';
import { supabase, Driver, DriverDeposit, DriverFine, DriverFineKind, DriverFinePayment } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import {
  useFleetData, computeDepositStanding, driverTermsLabel, dailyRateOf, fineAmountPaid, fineKindLabel, FINE_KINDS, AWAITING_MD,
  CONTRACT_END_REASONS, CONTRACT_END_DECIDED_BY, CONTRACT_CAN_RETURN,
} from '../../lib/fleet';
import {
  AdjustRow, PendingItem, PayrollRow, buildAdjustRows, confirmPending, correctionFor, rejectPending, snapOf, useDriverAdjustExtras, withConfirmedStart, withCorrection,
} from '../../lib/driverAdjust';
import { kigaliToday } from '../../lib/kigali';
import { Box, Label, PageHeader, StatCard, StatGrid, Tagged, UnderlineTabs, rwf } from '../../ui/kit';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import DateInput from '../../components/DateInput';
import { EntityLink } from '../../os/EntityLink';
import LogDepositDrawer from '../../components/fleet/LogDepositDrawer';
import LogFinePaymentDrawer from '../../components/fleet/LogFinePaymentDrawer';
import ChangeModelDrawer from '../../components/fleet/ChangeModelDrawer';

// MD Panel -> Driver Adjust (MD, 19 Nov 2026). Every driver whose contract
// isn't ended, car or not. The MD confirms each one's money once; what is
// confirmed is the driver's real balance everywhere (Fleet, the driver's
// page, Finance), because it is recorded in the same payments, fines and
// adjustments those pages read. From then on, anything someone else
// records waits here for the MD.

const short = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const num = (s: string) => Number(String(s).replace(/[^\d.-]/g, '')) || 0;

type Tab = 'todo' | 'awaiting' | 'done' | 'all';

export default function DriverAdjustPage() {
  const fleet = useFleetData();
  const extras = useDriverAdjustExtras();
  const today = kigaliToday();
  const [tab, setTab] = useState<Tab>('todo');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () => buildAdjustRows(fleet.drivers, fleet.deposits, fleet.fines, fleet.finePayments, extras.reviews, extras.payroll, today),
    [fleet.drivers, fleet.deposits, fleet.fines, fleet.finePayments, extras.reviews, extras.payroll, today],
  );
  const reload = () => { fleet.reload(); extras.reload(); };

  const todo = rows.filter((r) => !r.review);
  const done = rows.filter((r) => r.review);
  const awaiting = rows.filter((r) => r.pending.length > 0);
  const pendingCount = rows.reduce((t, r) => t + r.pending.length, 0);
  const owingNow = rows.filter((r) => r.standing.hasStarted && r.standing.owes > 0);
  const owedBesides = rows.reduce((t, r) => t + r.owedBesides, 0);
  // Drivers confirmed terminated here (their contract has ended, so they left the list).
  const terminated = new Set(extras.reviews.filter((r) => r.outcome === 'terminated').map((r) => r.driver_id)).size;

  const shown = (tab === 'todo' ? todo : tab === 'done' ? done : tab === 'awaiting' ? awaiting : rows).filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || r.driver.full_name.toLowerCase().includes(q) || (r.driver.vehicle?.plate_number ?? '').toLowerCase().includes(q.replace(/\s/g, ''));
  });
  const open = rows.find((r) => r.driver.id === openId) ?? null;

  if (fleet.loading || extras.loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={SlidersHorizontal}
        title="Driver Adjust"
        subtitle="Every driver whose contract isn't ended. Confirm each driver's money once; after that, anything someone else records waits here for you."
      />

      <StatGrid cols={4}>
        <StatCard label="Confirmed" icon={CheckCircle2} value={`${done.length} of ${rows.length}`} sub={`${todo.length ? `${todo.length} still to confirm` : 'Every driver is confirmed'}${terminated ? ` · ${terminated} confirmed terminated` : ''}`} tone={todo.length ? undefined : 'success'} onClick={() => setTab('todo')} />
        <StatCard label="Waiting for you" icon={AlertTriangle} value={pendingCount} sub={pendingCount ? `entries from others, ${awaiting.length} driver${awaiting.length === 1 ? '' : 's'}` : 'Nothing waiting'} tone={pendingCount ? 'attention' : undefined} onClick={() => setTab('awaiting')} />
        <StatCard label="Owe us today" icon={Wallet} value={rwf(owingNow.reduce((t, r) => t + r.standing.owes, 0))} sub={`${owingNow.length} driver${owingNow.length === 1 ? '' : 's'} with days driven and not paid`} tone={owingNow.length ? 'danger' : 'success'} />
        <StatCard label="Fines & other money owed" icon={Receipt} value={rwf(owedBesides)} sub="not paid yet" tone={owedBesides ? 'attention' : undefined} />
      </StatGrid>

      <UnderlineTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'todo', label: 'To confirm', count: todo.length },
          { key: 'awaiting', label: 'Waiting for you', count: pendingCount, tone: 'danger' },
          { key: 'done', label: 'Confirmed', count: done.length },
          { key: 'all', label: 'All drivers', count: rows.length },
        ]}
        right={(
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Driver or plate" className="input pl-8 w-full sm:w-48" />
          </div>
        )}
      />

      <DataTable
        rows={shown}
        keyFn={(r) => r.driver.id}
        pageKey="driver-adjust"
        noun="drivers"
        emptyLabel={tab === 'todo' ? 'Every driver is confirmed.' : tab === 'awaiting' ? 'Nothing is waiting for you.' : 'No drivers here.'}
        onRowClick={(r) => setOpenId(r.driver.id)}
        columns={[
          {
            header: 'Driver',
            render: (r) => (
              <Tagged tags={<>
                {r.pending.length > 0 && <Label tone="attention">{r.pending.length} waiting</Label>}
                {r.futurePayments.length > 0 && <Label tone="danger">Payment dated ahead</Label>}
              </>}>
                <EntityLink type="driver" id={r.driver.id} label={r.driver.full_name} />
              </Tagged>
            ),
          },
          { header: 'Car', render: (r) => <span className="whitespace-nowrap">{r.driver.vehicle?.plate_number ?? <span className="text-fg-subtle">No car</span>}<span className="text-fg-subtle"> · {driverTermsLabel(r.driver)}</span></span> },
          { header: 'Started', render: (r) => <span className="whitespace-nowrap">{short(r.driver.start_date)}</span> },
          { header: 'Deposit', className: 'text-right', render: (r) => <span className="tabular-nums whitespace-nowrap">{r.driver.initial_deposit_paid ? rwf(Number(r.driver.initial_deposit_amount ?? 0)) : '—'}</span> },
          { header: 'Last payment', render: (r) => <span className="whitespace-nowrap">{short(r.lastPayment)}</span> },
          { header: 'Paid until', render: (r) => <span className={`whitespace-nowrap ${r.standing.paidThrough && r.standing.paidThrough < today ? 'text-danger font-medium' : ''}`}>{short(r.standing.paidThrough)}</span> },
          { header: 'Today', render: (r) => <Standing row={r} /> },
          { header: 'Fines etc.', className: 'text-right', render: (r) => <span className={`tabular-nums whitespace-nowrap ${r.owedBesides ? 'text-attention font-medium' : 'text-fg-subtle'}`}>{r.owedBesides ? rwf(r.owedBesides) : '—'}</span> },
          { header: 'Confirmed', render: (r) => (r.review ? <Label tone="success" icon={CheckCircle2}>{short(r.review.reviewed_on)}</Label> : <Label>To confirm</Label>) },
        ]}
      />

      {open && (
        <DriverAdjustModal
          key={open.driver.id}
          row={open}
          drivers={fleet.drivers}
          allDeposits={fleet.deposits}
          finePayments={fleet.finePayments}
          vehicles={fleet.vehicles}
          payroll={extras.payroll.filter((p) => p.linked_driver_id === open.driver.id)}
          names={extras.names}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function Standing({ row }: { row: AdjustRow }) {
  const s = row.standing;
  if (!s.hasStarted) return <span className="text-fg-subtle">Not started</span>;
  if (s.owes > 0) return <Label tone="danger">Owes {rwf(s.owes)}</Label>;
  if (s.weekBehind > 0) return <Label tone="attention">Behind {rwf(s.weekBehind)}</Label>;
  return <Label tone="success">Up to date</Label>;
}

// ---------------------------------------------------------------- one driver
function DriverAdjustModal({ row, drivers, allDeposits, finePayments, vehicles, payroll, names, onClose, onChanged }: {
  row: AdjustRow; drivers: Driver[]; allDeposits: DriverDeposit[]; finePayments: import('../../lib/supabase').DriverFinePayment[];
  vehicles: import('../../lib/supabase').Vehicle[]; payroll: PayrollRow[]; names: Map<string, string>; onClose: () => void; onChanged: () => void;
}) {
  const { profile } = useAuth();
  const today = kigaliToday();
  const d = row.driver;
  const [start, setStart] = useState(d.start_date ?? '');
  const [depAmount, setDepAmount] = useState(String(d.initial_deposit_paid ? Number(d.initial_deposit_amount ?? 0) : 0));
  const [depDate, setDepDate] = useState(d.initial_deposit_date ?? d.start_date ?? '');
  const [lastPay, setLastPay] = useState(row.lastPayment ?? '');
  const [untilText, setUntilText] = useState<string | null>(null); // null: follow the payments
  const [weOwe, setWeOwe] = useState('0');
  const [weOweNote, setWeOweNote] = useState('');
  const [agrees, setAgrees] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [rejecting, setRejecting] = useState<PendingItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [addPayment, setAddPayment] = useState(false);
  const [changeModel, setChangeModel] = useState(false);
  const [payFine, setPayFine] = useState<DriverFine | null>(null);
  const [allPayments, setAllPayments] = useState(false);
  // Still working with us, or the contract was terminated (then nothing else is changed).
  const [mode, setMode] = useState<'working' | 'terminated'>('working');
  const [endDate, setEndDate] = useState(today);
  const [endReason, setEndReason] = useState('');
  const [endOther, setEndOther] = useState('');
  const [decidedBy, setDecidedBy] = useState<string>('kivu');
  const [canReturn, setCanReturn] = useState<string>('no');
  const [paidOn, setPaidOn] = useState<{ id: string; date: string } | null>(null);
  const [owedForm, setOwedForm] = useState<{ kind: DriverFineKind; amount: string; date: string; vehicle: string; reason: string } | null>(null);

  const depNum = num(depAmount);
  const confirmedDriver = useMemo(() => withConfirmedStart(d, start, depNum, depDate || null), [d, start, depNum, depDate]);
  const sys = useMemo(() => computeDepositStanding(confirmedDriver, row.deposits, today), [confirmedDriver, row.deposits, today]);
  const until = untilText ?? sys.paidThrough ?? '';
  const adj = useMemo(() => (start ? correctionFor(confirmedDriver, row.deposits, until, today) : 0), [confirmedDriver, row.deposits, until, today, start]);
  const after = useMemo(() => computeDepositStanding(withCorrection(confirmedDriver, adj, today), row.deposits, today), [confirmedDriver, adj, row.deposits, today]);
  const payments = [...row.deposits].sort((a, b) => b.paid_date.localeCompare(a.paid_date) || b.created_at.localeCompare(a.created_at));
  const salary = payroll.reduce((t, p) => t + p.amount, 0);
  const changedStart = (d.start_date ?? '') !== start || Number(d.initial_deposit_paid ? d.initial_deposit_amount ?? 0 : 0) !== depNum || (depNum > 0 && (d.initial_deposit_date ?? '') !== depDate);

  const blocker = !start ? 'Enter the start date.'
    : start > today ? "The start date can't be in the future."
    : depNum > 0 && !depDate ? 'Enter the date the deposit was paid.'
    : row.pending.length ? `Confirm or reject the ${row.pending.length} entr${row.pending.length === 1 ? 'y' : 'ies'} waiting for you first: they change the numbers.`
    : row.futurePayments.length ? `Fix the date of the payment dated ${short(row.futurePayments[0].paid_date)} first (it is in the future).`
    : lastPay && row.lastPayment && lastPay > row.lastPayment ? `The last payment (${short(lastPay)}) isn't recorded yet: add it under Payments first, so it counts and Finance has it.`
    : lastPay && !row.lastPayment ? `No payment is recorded yet: add the one of ${short(lastPay)} under Payments first.`
    : null;

  const run = async (key: string, f: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key); setErr('');
    const { error } = await f();
    setBusy(null);
    if (error) { setErr(error.message); return false; }
    onChanged();
    return true;
  };

  const fixDate = async (dep: DriverDeposit, date: string) => {
    await run(`date-${dep.id}`, async () => {
      const a = await supabase.from('driver_deposits').update({ paid_date: date }).eq('id', dep.id);
      if (a.error) return a;
      return supabase.from('finance_transactions').update({ transaction_date: date, updated_at: new Date().toISOString() }).eq('source_deposit_id', dep.id);
    });
  };

  const addOwed = async () => {
    if (!owedForm) return;
    const ok = await run('owed', () => supabase.from('driver_fines').insert({
      driver_id: d.id, vehicle_id: owedForm.vehicle || null, kind: owedForm.kind, amount: num(owedForm.amount),
      fine_date: owedForm.date, reason: owedForm.reason.trim() || null, created_by: profile!.id,
    }));
    if (ok) setOwedForm(null);
  };

  const endReasonText = endReason === 'other' ? endOther.trim() : CONTRACT_END_REASONS.find((r) => r.key === endReason)?.label ?? '';
  const endBlocker = row.pending.length ? `Confirm or reject the ${row.pending.length} entr${row.pending.length === 1 ? 'y' : 'ies'} waiting for you first: after this, nothing about this driver's money can change.`
    : !endDate ? 'Enter the date the contract was terminated.'
    : endDate > today ? "The termination date can't be in the future."
    : !endReasonText ? 'Say why the contract was terminated.'
    : null;
  const terminate = async () => {
    const ok = await run('terminate', () => supabase.rpc('confirm_driver_terminated', {
      p_driver: d.id,
      p: {
        event_date: endDate, reason_key: endReason, reason: endReasonText, notes,
        meta: { decided_by: decidedBy, can_return: canReturn, owed: row.standing.owes, paid_through: row.standing.paidThrough, fines_unpaid: row.owedBesides },
        before: snapOf(row.standing),
      },
    }));
    if (!ok) return;
    // Off the car and out of the fleet company in the Kivu Ride app, as every
    // ended contract is; if it fails it waits on Under Management > To confirm.
    supabase.functions.invoke('fleet-sync', { body: { action: 'offboard', driver_id: d.id } }).catch(() => null);
    onClose();
  };

  // A fine (or damage, advance...) paid in full: one payment for what is left.
  const markPaid = async (f: DriverFine, date: string) => {
    const left = Math.max(Number(f.amount) - fineAmountPaid(f.id, finePayments), 0);
    const ok = await run(`paid-${f.id}`, () => supabase.from('driver_fine_payments').insert({ fine_id: f.id, amount: left, paid_date: date, created_by: profile!.id }));
    if (ok) setPaidOn(null);
  };

  const confirm = async () => {
    const ok = await run('confirm', () => supabase.rpc('confirm_driver_review', {
      p_driver: d.id,
      p: {
        start_date: start, deposit_amount: depNum, deposit_date: depNum > 0 ? depDate : null,
        last_payment_date: lastPay || null, paid_until: until || null, adjustment: adj, daily_rate: dailyRateOf(confirmedDriver),
        we_owe_amount: num(weOwe), we_owe_note: weOweNote, driver_agrees: agrees, notes,
        before: snapOf(row.standing), after: snapOf(after),
      },
    }));
    if (ok) onClose();
  };

  return (
    <Modal open onClose={onClose} title={d.full_name} subtitle={`${d.vehicle?.plate_number ?? 'No car'} · ${driverTermsLabel(d, true)} · ${rwf(dailyRateOf(d))} a day`} maxWidth="max-w-3xl">
      <div className="space-y-4 text-small">
        {row.review && (
          <p className="rounded-lg bg-success/10 text-success px-3 py-2 text-caption flex items-center gap-1.5">
            <CheckCircle2 size={13} /> You confirmed this driver on {short(row.review.reviewed_on)}: paid until {short(row.review.paid_until)}{row.review.adjustment ? ` (correction ${row.review.adjustment > 0 ? '+' : ''}${rwf(row.review.adjustment)})` : ''}. Confirming again records a new review.
          </p>
        )}

        {row.pending.length > 0 && (
          <Box title={`Waiting for you (${row.pending.length})`} icon={AlertTriangle} padded={false}>
            <ul className="divide-y divide-line-muted">
              {row.pending.map((p) => (
                <li key={`${p.kind}-${p.id}`} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-fg-muted whitespace-nowrap">{short(p.date)}</span>
                    <span className="flex-1 min-w-[160px]">{p.what}<span className="text-fg-subtle"> · by {p.by ? names.get(p.by) ?? 'someone' : 'the system'}</span></span>
                    {p.amount !== 0 && <span className="font-semibold tabular-nums whitespace-nowrap">{rwf(p.amount)}</span>}
                    <button className="btn-ghost text-danger flex items-center gap-1" disabled={!!busy} onClick={() => { setRejecting(p); setRejectReason(''); }}><Ban size={13} /> Reject</button>
                    <button className="btn-primary flex items-center gap-1" disabled={!!busy} onClick={() => run(`c-${p.id}`, () => confirmPending(p))}>
                      {busy === `c-${p.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirm
                    </button>
                  </div>
                  {rejecting?.id === p.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input className="input flex-1 min-w-[200px]" placeholder="Why (optional) — the person who recorded it is told" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
                      <button className="btn-ghost" onClick={() => setRejecting(null)}>Keep it</button>
                      <button className="btn-primary bg-danger" disabled={!!busy} onClick={async () => { if (await run(`r-${p.id}`, () => rejectPending(p, rejectReason.trim() || null))) setRejecting(null); }}>Reject and remove</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Box>
        )}

        <div className="flex gap-0.5 p-0.5 bg-inset rounded-lg w-fit">
          {([['working', 'Still working with us'], ['terminated', 'Contract terminated']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 rounded-md text-small font-medium transition-all ${mode === k ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-muted'}`}>{l}</button>
          ))}
        </div>

        {mode === 'terminated' ? (
          <Box title="The contract was terminated" icon={UserX}>
            <div className="space-y-3">
              <p className="text-caption text-fg-muted">This only confirms the termination. Nothing else changes: the start date, deposit, payments and fines stay exactly as they are recorded, and from then on nobody can add, change or remove any of this driver's money (renewing the contract opens it again).</p>
              <div className="rounded-lg bg-inset p-3 text-caption space-y-0.5">
                <p className="font-semibold text-fg-muted">Kept as recorded today</p>
                <p>Paid until {short(row.standing.paidThrough)} · {row.standing.owes > 0 ? <span className="text-danger font-medium">owes {rwf(row.standing.owes)}</span> : 'owes nothing'}{row.owedBesides ? <> · <span className="text-attention font-medium">{rwf(row.owedBesides)} in fines and other money unpaid</span></> : null}</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Terminated on</span>
                  <DateInput value={endDate} onChange={setEndDate} max={today} /></label>
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Why</span>
                  <select className="input w-full mt-1" value={endReason} onChange={(e) => setEndReason(e.target.value)}>
                    <option value="">Pick a reason</option>
                    {[...new Set(CONTRACT_END_REASONS.map((r) => r.group))].map((g) => (
                      <optgroup key={g} label={g}>{CONTRACT_END_REASONS.filter((r) => r.group === g).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</optgroup>
                    ))}
                  </select></label>
              </div>
              {endReason === 'other' && <input className="input w-full" value={endOther} onChange={(e) => setEndOther(e.target.value)} placeholder="The reason" />}
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Who ended it</span>
                  <select className="input w-full mt-1" value={decidedBy} onChange={(e) => setDecidedBy(e.target.value)}>{CONTRACT_END_DECIDED_BY.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Can they come back?</span>
                  <select className="input w-full mt-1" value={canReturn} onChange={(e) => setCanReturn(e.target.value)}>{CONTRACT_CAN_RETURN.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              </div>
              <textarea className="input w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
              {err && <p className="text-danger">{err}</p>}
              {endBlocker && <p className="text-caption text-attention">{endBlocker}</p>}
              <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
                <button className="btn-ghost" onClick={onClose}>Close</button>
                <button className="btn-primary flex items-center gap-1.5" disabled={!!busy || !!endBlocker} onClick={terminate}>
                  {busy === 'terminate' ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />} Confirm {d.full_name.split(' ')[0]} was terminated
                </button>
              </div>
            </div>
          </Box>
        ) : (<>
        <div className="grid md:grid-cols-2 gap-4">
          <Box title="1 · Start" icon={CalendarClock}>
            <div className="space-y-3">
              <label className="block"><span className="text-caption font-semibold text-fg-muted">Start date</span>
                <DateInput value={start} onChange={setStart} max={today} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Deposit paid at the start</span>
                  <input className="input w-full mt-1" inputMode="numeric" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} /></label>
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Paid on</span>
                  <DateInput value={depDate} onChange={setDepDate} max={today} disabled={depNum <= 0} /></label>
              </div>
              <p className="text-caption text-fg-muted flex flex-wrap items-center gap-x-2">
                <span>{driverTermsLabel(d, true)} · {rwf(dailyRateOf(d))} a day{d.rest_day ? ` · rests on ${d.rest_day[0].toUpperCase()}${d.rest_day.slice(1)}` : ' · no rest day'}</span>
                <button className="text-accent hover:underline" onClick={() => setChangeModel(true)}>Change model</button>
              </p>
              {changedStart && <p className="text-caption text-attention">Changed from what's on file ({short(d.start_date)}, {d.initial_deposit_paid ? `${rwf(Number(d.initial_deposit_amount ?? 0))} on ${short(d.initial_deposit_date)}` : 'no deposit'}). Finance's copy of the deposit follows.</p>}
            </div>
          </Box>

          <Box title="2 · Paid until" icon={Wallet}>
            <div className="space-y-3">
              <p className="text-caption text-fg-muted">The payments on file cover <span className="font-semibold text-fg">{short(sys.paidThrough)}</span>{sys.paidThrough && sys.paidThrough < today ? ' — before today' : ''}.</p>
              <label className="block"><span className="text-caption font-semibold text-fg-muted">The money runs out on (confirmed)</span>
                <DateInput value={until} onChange={(v) => setUntilText(v)} /></label>
              {adj !== 0 ? (
                <p className="rounded-lg border border-accent/40 bg-accent/5 p-2.5 text-caption">
                  {adj > 0 ? `A credit of ${rwf(adj)}` : `A charge of ${rwf(-adj)}`} will be recorded to make this right. It is not money received: Finance's cash doesn't change.
                </p>
              ) : <p className="text-caption text-success">Matches the payments on file: no correction.</p>}
              <p className="text-caption text-fg-muted">After: {after.owes > 0 ? <span className="text-danger font-medium">owes {rwf(after.owes)}</span> : 'owes nothing'} · {after.weekBehind > 0 ? `behind ${rwf(after.weekBehind)}` : 'not behind'} · next payment {short(after.nextDueDate)}</p>
            </div>
          </Box>
        </div>

        <Box title="3 · Payments" icon={HandCoins} right={<button className="btn-secondary flex items-center gap-1" onClick={() => setAddPayment(true)}><Plus size={13} /> Add a payment</button>}>
          <div className="space-y-3">
            <label className="block max-w-xs"><span className="text-caption font-semibold text-fg-muted">Last payment date (confirmed)</span>
              <DateInput value={lastPay} onChange={setLastPay} max={today} /></label>
            {payments.length === 0 ? <p className="text-fg-subtle">No weekly payments recorded{d.initial_deposit_paid ? ' (only the start deposit)' : ''}.</p> : (
              <ul className="divide-y divide-line-muted">
                {(allPayments ? payments : payments.slice(0, 6)).map((p) => (
                  <PaymentLine key={p.id} p={p} today={today} busy={busy} onFix={fixDate} />
                ))}
              </ul>
            )}
            {payments.length > 6 && <button className="text-caption text-accent hover:underline" onClick={() => setAllPayments(!allPayments)}>{allPayments ? 'Show the latest 6' : `Show all ${payments.length}`}</button>}
          </div>
        </Box>

        <Box title="4 · Fines and other money owed" icon={Receipt} right={!owedForm && <button className="btn-secondary flex items-center gap-1" onClick={() => setOwedForm({ kind: 'fine', amount: '', date: today, vehicle: d.vehicle_id ?? '', reason: '' })}><Plus size={13} /> Add</button>}>
          <div className="space-y-3">
            {owedForm && (
              <div className="rounded-lg border border-line p-3 grid sm:grid-cols-2 gap-2">
                <label className="block"><span className="text-caption font-semibold text-fg-muted">What</span>
                  <select className="input w-full mt-1" value={owedForm.kind} onChange={(e) => setOwedForm({ ...owedForm, kind: e.target.value as DriverFineKind })}>
                    {FINE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select></label>
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Amount (RWF)</span>
                  <input className="input w-full mt-1" inputMode="numeric" value={owedForm.amount} onChange={(e) => setOwedForm({ ...owedForm, amount: e.target.value })} autoFocus /></label>
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Date</span>
                  <DateInput value={owedForm.date} onChange={(v) => setOwedForm({ ...owedForm, date: v })} max={today} /></label>
                <label className="block"><span className="text-caption font-semibold text-fg-muted">Car {owedForm.kind === 'fine' ? '' : '(optional)'}</span>
                  <select className="input w-full mt-1" value={owedForm.vehicle} onChange={(e) => setOwedForm({ ...owedForm, vehicle: e.target.value })}>
                    <option value="">No car</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                  </select></label>
                <label className="block sm:col-span-2"><span className="text-caption font-semibold text-fg-muted">What for</span>
                  <input className="input w-full mt-1" value={owedForm.reason} onChange={(e) => setOwedForm({ ...owedForm, reason: e.target.value })} placeholder="e.g. speeding on 12 Nov · broken mirror · advance on salary" /></label>
                <div className="sm:col-span-2 flex justify-end gap-2">
                  <button className="btn-ghost" onClick={() => setOwedForm(null)}>Cancel</button>
                  <button className="btn-primary" disabled={!!busy || num(owedForm.amount) <= 0 || !owedForm.date || (owedForm.kind === 'fine' && !owedForm.vehicle)} onClick={addOwed}>{busy === 'owed' && <Loader2 size={13} className="animate-spin" />} Record it</button>
                </div>
              </div>
            )}
            {row.fines.length === 0 ? <p className="text-fg-subtle">Nothing recorded.</p> : (
              <ul className="divide-y divide-line-muted">
                {row.fines.map((f) => {
                  const paid = fineAmountPaid(f.id, finePayments);
                  const left = Math.max(Number(f.amount) - paid, 0);
                  return (
                    <li key={f.id} className="py-2 flex flex-wrap items-center gap-2">
                      <span className="text-fg-muted whitespace-nowrap">{short(f.fine_date)}</span>
                      <span className="flex-1 min-w-[160px]">{fineKindLabel(f.kind)}{f.reason ? ` · ${f.reason}` : ''}{f.vehicle?.plate_number ? <span className="text-fg-subtle"> · {f.vehicle.plate_number}</span> : null}</span>
                      {f.status === 'pending' && <Label tone="attention">{AWAITING_MD}</Label>}
                      <span className="tabular-nums whitespace-nowrap">{rwf(Number(f.amount))}</span>
                      {left > 0
                        ? <><Label tone="danger">{rwf(left)} left</Label>
                            <button className="btn-secondary" disabled={!!busy} onClick={() => setPaidOn({ id: f.id, date: today })}>Paid in full</button>
                            <button className="btn-ghost" onClick={() => setPayFine(f)}>Part payment</button></>
                        : <Label tone="success">Paid</Label>}
                      {paidOn?.id === f.id && (
                        <div className="basis-full flex flex-wrap items-center gap-2 pl-1">
                          <span className="text-caption text-fg-muted">{rwf(left)} paid on</span>
                          <DateInput value={paidOn.date} onChange={(v) => setPaidOn({ id: f.id, date: v })} max={today} />
                          <button className="btn-ghost" onClick={() => setPaidOn(null)}>Cancel</button>
                          <button className="btn-primary" disabled={!!busy || !paidOn.date || paidOn.date > today} onClick={() => markPaid(f, paidOn.date)}>
                            {busy === `paid-${f.id}` && <Loader2 size={13} className="animate-spin" />} Confirm paid
                          </button>
                        </div>
                      )}
                      <FinePaymentLines payments={finePayments.filter((p) => p.fine_id === f.id)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Box>

        <Box title="5 · What we owe them" icon={Users2}>
          <div className="space-y-3">
            {payroll.length === 0 ? <p className="text-fg-muted">No unpaid salary in Finance.</p> : (
              <div>
                <p className="font-medium text-attention">Salary Finance hasn't marked paid: {rwf(salary)}</p>
                <ul className="text-caption text-fg-muted mt-1">
                  {payroll.map((p) => <li key={p.id}>{short(p.transaction_date)} · {rwf(p.amount)}{p.description ? ` · ${p.description}` : ''}</li>)}
                </ul>
                <p className="text-caption text-fg-subtle mt-1">If it was paid, Finance marks it paid in Finance → Payroll.</p>
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-2">
              <label className="block"><span className="text-caption font-semibold text-fg-muted">Anything else we owe (RWF)</span>
                <input className="input w-full mt-1" inputMode="numeric" value={weOwe} onChange={(e) => setWeOwe(e.target.value)} /></label>
              <label className="block sm:col-span-2"><span className="text-caption font-semibold text-fg-muted">What it is</span>
                <input className="input w-full mt-1" value={weOweNote} onChange={(e) => setWeOweNote(e.target.value)} placeholder="Leave empty if we owe nothing" /></label>
            </div>
          </div>
        </Box>

        <div className="space-y-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={agrees} onChange={(e) => setAgrees(e.target.checked)} /> The driver agrees with these numbers</label>
          <textarea className="input w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional) — e.g. paid cash to Bertrand on 3 Nov" />
        </div>

        {err && <p className="text-danger">{err}</p>}
        {blocker && <p className="text-caption text-attention">{blocker}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary flex items-center gap-1.5" disabled={!!busy || !!blocker} onClick={confirm}>
            {busy === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirm {d.full_name.split(' ')[0]}'s numbers
          </button>
        </div>
        </>)}
      </div>

      {addPayment && <LogDepositDrawer driver={confirmedDriver} deposits={allDeposits} onClose={() => setAddPayment(false)} onSaved={onChanged} />}
      {changeModel && <ChangeModelDrawer driver={d} drivers={drivers} deposits={allDeposits} onClose={() => setChangeModel(false)} onSaved={onChanged} />}
      {payFine && <LogFinePaymentDrawer fine={{ ...payFine, driver: d }} remaining={Math.max(Number(payFine.amount) - fineAmountPaid(payFine.id, finePayments), 0)} onClose={() => setPayFine(null)} onSaved={onChanged} />}
    </Modal>
  );
}

function FinePaymentLines({ payments }: { payments: DriverFinePayment[] }) {
  if (!payments.length) return null;
  return (
    <ul className="basis-full pl-4 text-caption text-fg-muted space-y-0.5">
      {[...payments].sort((a, b) => a.paid_date.localeCompare(b.paid_date)).map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-2">
          <span>Paid {rwf(Number(p.amount))} on {short(p.paid_date)}</span>
          {p.status === 'pending' ? <Label tone="attention">{AWAITING_MD}</Label> : <Label tone="success" icon={Check}>Confirmed</Label>}
        </li>
      ))}
    </ul>
  );
}

function PaymentLine({ p, today, busy, onFix }: { p: DriverDeposit; today: string; busy: string | null; onFix: (p: DriverDeposit, date: string) => void }) {
  const ahead = p.paid_date > today;
  const [date, setDate] = useState(p.paid_date);
  return (
    <li className="py-2 flex flex-wrap items-center gap-2">
      {ahead ? (
        <span className="flex items-center gap-2">
          <DateInput value={date} onChange={setDate} max={today} />
          <button className="btn-secondary" disabled={!!busy || date === p.paid_date || date > today} onClick={() => onFix(p, date)}>Fix the date</button>
        </span>
      ) : <span className="text-fg-muted whitespace-nowrap">{short(p.paid_date)}</span>}
      <span className="flex-1 min-w-[100px] text-fg-subtle">{p.payment_method === 'momo' ? 'MoMo' : p.bank_name ?? 'Bank'}</span>
      {ahead && <Label tone="danger">Dated in the future</Label>}
      {p.status === 'pending' && <Label tone="attention">{AWAITING_MD}</Label>}
      <span className="font-medium tabular-nums whitespace-nowrap">{rwf(Number(p.amount))}</span>
    </li>
  );
}

