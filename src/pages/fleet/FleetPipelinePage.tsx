import { useState, useMemo } from 'react';
import { Search, Plus, Phone, Truck, FileSignature, ArrowDownWideNarrow, PauseCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, STAGES, effectiveStage, canEditFleet, canSeeDriverPayments, PAUSE_REASON_LABEL, driverShiftShort, DRIVER_MODELS, computeDepositStanding, formatDateLabelSafe, DepositStanding } from '../../lib/fleet';
import { usePaymentCalls, latestCall, carTaken, callLine, promiseState, lastPayment, PaymentCall } from '../../lib/paymentCalls';
import { driverDay, addDays } from '../../lib/performance';
import { isPausedOn } from '../../components/fleet/PauseList';
import { Driver } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import EntryActions from '../../components/EntryActions';
import DriverDrawer from '../../components/fleet/DriverDrawer';
import DriverProfilePage from './DriverProfilePage';
import { EntityLink } from '../../os/EntityLink';
import { usePeek } from '../../os/peek';
import { LEGAL_KIND, missingForDriver, useLegalDocs } from '../../lib/legalDocs';
import { Pager, usePaged } from '../../ui/Pager';
import ExportButton from '../../components/fleet/ExportButton';
import { kigaliToday } from '../../lib/kigali';
import { moneyStatus, MoneyStatus, StatusPill, DriverAvatar, PlateChip, Amount, CallChip, STATUS_STYLE } from '../../components/fleet/driverUi';

interface DriverDrawerState { driver: Driver | null; startEditing: boolean }

interface FleetPipelinePageProps { data?: ReturnType<typeof useFleetData> }

// Accepts pre-fetched data from the MD's FleetPage tab wrapper (which
// already calls useFleetData() once for its badge counts) so this page
// doesn't open a second realtime subscription under the same channel
// name - Supabase throws if two instances subscribe to it at once.
// Rendered directly by employees with no data prop, so it fetches its
// own in that case.
export default function FleetPipelinePage({ data }: FleetPipelinePageProps = {}) {
  return data ? <FleetPipelinePageView data={data} /> : <FleetPipelinePageWithData />;
}

function FleetPipelinePageWithData() {
  return <FleetPipelinePageView data={useFleetData()} />;
}

// Which drivers to show: everyone on a contract (the default), or one stage.
type Scope = 'contract' | 'all' | 'applying' | 'raw' | 'ready' | 'active' | 'flagged' | 'inactive';

interface Money { standing: DepositStanding; status: MoneyStatus; last: ReturnType<typeof lastPayment>; call: PaymentCall | null; taken: PaymentCall | null; lost30: number; promiseDue: string | null }

// Drivers (redesigned MD, 26 Nov 2026): find anyone fast, and see each
// driver's car, money, last payment and latest call on one line.
function FleetPipelinePageView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const peek = usePeek();
  const { drivers, vehicles, deposits, fines, finePayments, contractEvents, driverDocuments, loading, reload } = data;
  const canEdit = canEditFleet(profile);
  const legal = useLegalDocs();
  const missingDoc = (d: Driver) => (legal.loading ? null : missingForDriver(d, legal.docs));
  const [view, setView] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<Scope>('contract');
  // All models, or one (One shift, Both shifts, Solo car).
  const [modelFilter, setModelFilter] = useState<string>('');
  const [driverDrawer, setDriverDrawer] = useState<DriverDrawerState | null>(null);
  // Keyed by id (not the object itself) so the profile page stays live -
  // e.g. reflects an edit made from it, or a new deposit - instead of
  // freezing on the snapshot that was current when it was opened.
  const [viewingDriverId, setViewingDriverId] = useState<string | null>(null);
  const viewingDriver = viewingDriverId ? drivers.find((d) => d.id === viewingDriverId) ?? null : null;

  // Each driver's money (never shown to the Call Center).
  const showMoney = canSeeDriverPayments(profile);
  const { calls } = usePaymentCalls();
  const today = kigaliToday();
  const money = useMemo(() => {
    const out = new Map<string, Money>();
    if (!showMoney) return out;
    for (const d of drivers) {
      if (!d.start_date) continue;
      const ended = d.contract_status === 'ended';
      const mine = deposits.filter((x) => x.driver_id === d.id);
      const standing = computeDepositStanding(d, mine);
      const taken = ended ? null : carTaken(calls, d.id);
      const call = latestCall(calls, d.id);
      let lost30 = 0;
      if (!ended) for (let i = 1; i <= 30; i++) { const day = addDays(today, -i); if (day >= d.start_date && driverDay(d, mine, day) === 'unpaid') lost30++; }
      out.set(d.id, {
        standing, status: moneyStatus(standing, { ended, taken: !!taken, today }), last: lastPayment(d, mine), call, taken, lost30,
        promiseDue: call && promiseState(call, deposits) === 'pending' ? call.promised_at : null,
      });
    }
    return out;
  }, [drivers, deposits, calls, showMoney, today]);

  // Sort: by name, by who owes most, or by the earliest promise due.
  const [sortBy, setSortBy] = useState<'name' | 'owes' | 'promise'>('name');
  const inScope = (d: Driver, s: Scope) => s === 'all' || (s === 'contract' ? d.contract_status === 'active' : effectiveStage(d) === s);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = drivers.filter((d) => inScope(d, scope) && (!modelFilter || d.model === modelFilter)
      && (!q || d.full_name.toLowerCase().includes(q) || d.phone.includes(q) || (d.vehicle?.plate_number ?? '').toLowerCase().includes(q)));
    const byName = (a: Driver, b: Driver) => a.full_name.localeCompare(b.full_name);
    if (sortBy === 'owes') return [...rows].sort((a, b) => (money.get(b.id)?.standing.owes ?? -1) - (money.get(a.id)?.standing.owes ?? -1) || byName(a, b));
    if (sortBy === 'promise') return [...rows].sort((a, b) => (money.get(a.id)?.promiseDue ?? '9').localeCompare(money.get(b.id)?.promiseDue ?? '9') || byName(a, b));
    return [...rows].sort(byName);
  }, [drivers, search, scope, modelFilter, sortBy, money]);

  const byStage = useMemo(() => {
    const map: Record<string, Driver[]> = { applying: [], raw: [], ready: [], active: [], flagged: [], inactive: [] };
    for (const d of filtered) map[effectiveStage(d)].push(d);
    return map;
  }, [filtered]);

  const paged = usePaged(filtered, { key: 'fleet-drivers', reset: `${search}${scope}${modelFilter}${sortBy}` });

  if (loading) return <div className="space-y-3"><div className="h-16 skeleton rounded-card" />{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 skeleton rounded-card" />)}</div>;

  if (viewingDriver) {
    return (
      <>
        <DriverProfilePage driver={viewingDriver} drivers={drivers} deposits={deposits} fines={fines} finePayments={finePayments} contractEvents={contractEvents} vehicles={vehicles}
          canEdit={canEdit} onBack={() => setViewingDriverId(null)} onEdit={() => setDriverDrawer({ driver: viewingDriver, startEditing: true })} reload={reload} />
        {driverDrawer && <DriverDrawer driver={driverDrawer.driver} startEditing={driverDrawer.startEditing} vehicles={vehicles} drivers={drivers} driverDocuments={driverDocuments} canEdit={canEdit} onClose={() => setDriverDrawer(null)} onSaved={reload} />}
      </>
    );
  }

  const scopes: { key: Scope; label: string; color?: string }[] = [
    { key: 'contract', label: 'On contract' },
    ...STAGES.map((s) => ({ key: s.key as Scope, label: s.label, color: s.color })),
    { key: 'all', label: 'Everyone' },
  ];
  const countOf = (s: Scope) => drivers.filter((d) => inScope(d, s) && (!modelFilter || d.model === modelFilter)).length;
  const open = (d: Driver) => peek.open({ type: 'driver', id: d.id, label: d.full_name });
  const pausedReason = (d: Driver) => { const p = (d.pauses ?? []).find((x) => isPausedOn(x, today)); return p ? PAUSE_REASON_LABEL[p.reason] : null; };
  const stageOf = (d: Driver) => STAGES.find((st) => st.key === effectiveStage(d))!;
  const th = 'text-micro font-semibold uppercase tracking-wide text-fg-subtle px-3 py-2.5 text-left whitespace-nowrap bg-inset/60';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-lg bg-accent-muted text-accent-fg flex items-center justify-center shrink-0"><Truck size={19} /></span>
          <div>
            <h2 className="text-h2 font-semibold leading-tight">Drivers</h2>
            <p className="text-body text-fg-muted mt-0.5">Every driver from application to the road — their car, money and latest call.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton initial="drivers" />
          {canEdit && <button onClick={() => setDriverDrawer({ driver: null, startEditing: true })} className="btn-primary"><Plus size={14} /> Add driver</button>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone or plate" className="input !pl-8" aria-label="Search" />
          </label>
          <div className="flex gap-0.5 p-0.5 bg-inset rounded-md border border-line-muted" role="group" aria-label="Model">
            {[['', 'All models'] as const, ...Object.entries(DRIVER_MODELS).map(([k, m]) => [k, m.label] as const)].map(([k, l]) => (
              <button key={k} onClick={() => setModelFilter(k)} className={`px-2.5 h-7 rounded text-caption font-medium whitespace-nowrap ${modelFilter === k ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>{l}</button>
            ))}
          </div>
          {showMoney && view === 'table' && (
            <label className="relative">
              <ArrowDownWideNarrow size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="input !w-auto !pl-8" aria-label="Sort">
                <option value="name">Name</option>
                <option value="owes">Owes most</option>
                <option value="promise">Promise due first</option>
              </select>
            </label>
          )}
          <ViewToggle value={view} onChange={setView} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => {
            const on = scope === s.key;
            return (
              <button key={s.key} onClick={() => setScope(s.key)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-caption font-medium transition-colors ${on ? 'border-accent bg-accent-muted text-accent-fg' : 'border-line text-fg-muted hover:bg-hover hover:text-fg'}`}>
                {s.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />}
                {s.label}
                <span className={`tabular-nums ${on ? '' : 'text-fg-subtle'}`}>{countOf(s.key)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Board by stage */}
      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
          {STAGES.map((stage) => (
            <div key={stage.key} className="rounded-card bg-inset/60 border border-line-muted p-2 space-y-2">
              <div className="flex items-center gap-2 px-1 pt-0.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <p className="text-body font-semibold">{stage.label}</p>
                <span className="counter ml-auto">{byStage[stage.key].length}</span>
              </div>
              {byStage[stage.key].map((d) => {
                const m = money.get(d.id);
                const paused = pausedReason(d);
                const miss = missingDoc(d);
                return (
                  <div key={d.id} onClick={() => open(d)} className="card p-3 cursor-pointer hover:border-line-strong hover:shadow-md transition-all space-y-2">
                    <div className="flex items-start gap-2.5">
                      <DriverAvatar name={d.full_name} status={m?.status} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="text-body font-semibold truncate">{d.full_name}</p>
                        <p className="text-caption text-fg-subtle flex items-center gap-1"><Phone size={11} /> {d.phone}</p>
                      </div>
                      <span onClick={(e) => e.stopPropagation()}><EntryActions onView={() => open(d)} onEdit={() => setDriverDrawer({ driver: d, startEditing: true })} canEdit={canEdit} /></span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PlateChip plate={d.vehicle?.plate_number} />
                      {d.vehicle && <span className="text-caption text-fg-subtle">{driverShiftShort(d)}</span>}
                    </div>
                    {(m || paused || miss) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {m && <StatusPill status={m.status} size="sm" />}
                        {m && m.standing.owes > 0 && m.status.key !== 'ended' && <span className="text-caption font-semibold text-danger">{m.standing.owes.toLocaleString('en-US')}</span>}
                        {paused && <span className="label border-done/30 bg-done-muted text-done !h-5 !text-micro"><PauseCircle size={11} /> {paused}</span>}
                        {miss && <span className="label border-danger/30 bg-danger-muted text-danger !h-5 !text-micro"><FileSignature size={11} /> {LEGAL_KIND[miss].missing}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              {byStage[stage.key].length === 0 && <p className="text-caption text-fg-subtle text-center py-4">Nobody</p>}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {view === 'table' && filtered.length > 0 && (
        <>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full border-collapse min-w-[980px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Driver</th>
                  <th className={th}>Car</th>
                  {showMoney && <><th className={th}>Payment</th><th className={th}>Next payment</th><th className={th}>Last paid</th><th className={th}>Collateral</th><th className={th}>Latest call</th><th className={`${th} text-right`}>Lost · 30d</th></>}
                  <th className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-muted">
                {paged.rows.map((d) => {
                  const m = money.get(d.id);
                  const stage = stageOf(d);
                  const miss = missingDoc(d);
                  const paused = pausedReason(d);
                  const ended = d.contract_status === 'ended';
                  return (
                    <tr key={d.id} onClick={() => open(d)} className={`cursor-pointer hover:bg-hover/60 transition-colors ${ended ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-[220px]">
                          <DriverAvatar name={d.full_name} status={m?.status} size={34} />
                          <div className="min-w-0">
                            <p className="text-body font-semibold truncate" onClick={(e) => e.stopPropagation()}><EntityLink type="driver" id={d.id} label={d.full_name} /></p>
                            <p className="text-caption text-fg-subtle flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />{stage.label}</span>
                              <span className="tabular-nums">{d.phone}</span>
                            </p>
                            {(miss || paused) && (
                              <p className="flex gap-1 mt-1 flex-wrap">
                                {paused && <span className="label border-done/30 bg-done-muted text-done !h-5 !text-micro"><PauseCircle size={11} /> {paused}</span>}
                                {miss && <span className="label border-danger/30 bg-danger-muted text-danger !h-5 !text-micro"><FileSignature size={11} /> {LEGAL_KIND[miss].missing}</span>}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <PlateChip plate={d.vehicle?.plate_number} />
                        <p className="text-caption text-fg-subtle mt-1">{driverShiftShort(d) || 'One shift'}</p>
                      </td>
                      {showMoney && (
                        <>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {m ? (<>
                              <StatusPill status={m.status} size="sm" />
                              {m.standing.owes > 0 && !ended && <p className="text-caption mt-1">owes <Amount value={m.standing.owes} size="sm" tone="text-danger" /></p>}
                              {m.standing.owes === 0 && m.standing.paidThrough && !ended && <p className="text-caption text-fg-subtle mt-1">paid to {formatDateLabelSafe(m.standing.paidThrough)}</p>}
                            </>) : <span className="text-caption text-fg-subtle">Not started</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {m && !ended && m.standing.hasStarted && m.standing.nextDueDate && m.standing.nextDueAmount > 0 ? (<>
                              <p className="text-body font-medium tabular-nums">{m.standing.nextDueAmount.toLocaleString('en-US')} <span className="text-micro text-fg-subtle">RWF</span></p>
                              <p className={`text-caption ${m.standing.nextDueDate <= today ? 'text-attention font-medium' : 'text-fg-subtle'}`}>by {formatDateLabelSafe(m.standing.nextDueDate)}{d.payment_day ? ` · usually ${d.payment_day.slice(0, 3)}` : ''}</p>
                            </>) : <span className="text-caption text-fg-subtle">—</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {m?.last ? (<>
                              <p className="text-body font-medium">{formatDateLabelSafe(m.last.date)}</p>
                              <p className="text-caption text-fg-subtle tabular-nums">{m.last.amount.toLocaleString('en-US')} RWF{m.last.pending ? <span className="text-attention"> · unconfirmed</span> : ''}</p>
                            </>) : <span className="text-caption text-fg-subtle">{m ? 'Never' : '—'}</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {Number(d.collateral_amount ?? 0) > 0 ? (<>
                              <p className="text-body font-medium tabular-nums">{Number(d.collateral_amount).toLocaleString('en-US')} <span className="text-micro text-fg-subtle">RWF</span></p>
                              <p className="text-caption text-fg-subtle">{d.collateral_settled_on ? (Number(d.collateral_kept ?? 0) > 0 ? `${Number(d.collateral_kept).toLocaleString('en-US')} kept` : 'Given back') : d.collateral_date ? `Held · ${formatDateLabelSafe(d.collateral_date)}` : 'Held'}</p>
                            </>) : <span className="text-caption text-fg-subtle">—</span>}
                          </td>
                          <td className="px-3 py-2.5 max-w-[280px]">
                            {m?.taken ? <CallChip call={m.taken} line={callLine(m.taken, deposits, today)} />
                              : m?.call ? <CallChip call={m.call} line={callLine(m.call, deposits, today)} />
                              : <span className="text-caption text-fg-subtle">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {m && !ended ? <LostBar n={m.lost30} /> : <span className="text-caption text-fg-subtle">—</span>}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <EntryActions onView={() => open(d)} onEdit={() => setDriverDrawer({ driver: d, startEditing: true })} canEdit={canEdit} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager pager={paged.pager} noun="drivers" />
        </>
      )}

      {filtered.length === 0 && (
        <div className="card p-12 text-center">
          <Truck size={26} className="text-fg-subtle mx-auto mb-2" />
          <p className="text-body text-fg-muted">{drivers.length ? 'No driver matches.' : 'No drivers yet.'}</p>
        </div>
      )}

      {driverDrawer && <DriverDrawer driver={driverDrawer.driver} startEditing={driverDrawer.startEditing} vehicles={vehicles} drivers={drivers} driverDocuments={driverDocuments} canEdit={canEdit} onClose={() => setDriverDrawer(null)} onSaved={reload} />}
    </div>
  );
}

// Working days lost in the last 30: the number and a small bar out of 30.
function LostBar({ n }: { n: number }) {
  const tone = n === 0 ? STATUS_STYLE.paid : n <= 3 ? STATUS_STYLE.pay_today : STATUS_STYLE.late;
  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className="w-14 h-1.5 rounded-full bg-inset overflow-hidden"><span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(n ? 8 : 0, Math.min(100, (n / 30) * 100))}%` }} /></span>
      <span className={`text-body font-semibold tabular-nums w-5 text-right ${n ? tone.text : 'text-fg-subtle'}`}>{n}</span>
    </span>
  );
}
