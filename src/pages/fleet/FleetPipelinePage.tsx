import { useState, useMemo } from 'react';
import { Search, Plus, Phone, Car, Truck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, STAGES, effectiveStage, canEditFleet, canSeeDriverPayments, PAUSE_REASON_LABEL, driverShiftShort, driverTermsLabel, DRIVER_MODELS, computeDepositStanding, depositStandingTier, depositStandingLabel, DEPOSIT_TIER_STYLE, formatDateLabelSafe, DepositTier } from '../../lib/fleet';
import { usePaymentCalls, latestCall, carTaken, callLine, promiseState, lastPayment, toneClass } from '../../lib/paymentCalls';
import { driverDay, addDays } from '../../lib/performance';
import { isPausedOn } from '../../components/fleet/PauseList';

const kigaliToday = kTodayFast();
import { Driver } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import DriverDrawer from '../../components/fleet/DriverDrawer';
import DriverProfilePage from './DriverProfilePage';
import { EntityLink } from '../../os/EntityLink';
import { usePeek } from '../../os/peek';
import { LEGAL_KIND, missingForDriver, useLegalDocs } from '../../lib/legalDocs';
import { Label, Tagged } from '../../ui/kit';
import ExportButton from '../../components/fleet/ExportButton';
import { kigaliToday as kTodayFast } from '../../lib/kigali';

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

function FleetPipelinePageView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const peek = usePeek();
  const { drivers, vehicles, deposits, fines, finePayments, contractEvents, driverDocuments, loading, reload } = data;
  const canEdit = canEditFleet(profile);
  const legal = useLegalDocs();
  const missingDoc = (d: Driver) => (legal.loading ? null : missingForDriver(d, legal.docs));
  const [view, setView] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  // All models, or one (One shift, Both shifts, Solo car).
  const [modelFilter, setModelFilter] = useState<string>('');
  const [driverDrawer, setDriverDrawer] = useState<DriverDrawerState | null>(null);
  // Keyed by id (not the object itself) so the profile page stays live -
  // e.g. reflects an edit made from it, or a new deposit - instead of
  // freezing on the snapshot that was current when it was opened.
  const [viewingDriverId, setViewingDriverId] = useState<string | null>(null);
  const viewingDriver = viewingDriverId ? drivers.find((d) => d.id === viewingDriverId) ?? null : null;

  // Each driver's money in one line per column (drivers on contract who have started).
  const showMoney = canSeeDriverPayments(profile);
  const { calls } = usePaymentCalls();
  const today = kTodayFast();
  const money = useMemo(() => {
    const out = new Map<string, { tier: DepositTier; label: string; owes: number; next: string | null; last: ReturnType<typeof lastPayment>; call: { text: string; tone: 'danger' | 'attention' | 'good' | 'muted' } | null; taken: boolean; lost30: number; promiseDue: string | null }>();
    if (!showMoney) return out;
    for (const d of drivers) {
      if (d.contract_status === 'ended' || !d.start_date) continue;
      const mine = deposits.filter((x) => x.driver_id === d.id);
      const s = computeDepositStanding(d, mine);
      const c = latestCall(calls, d.id);
      let lost30 = 0;
      for (let i = 1; i <= 30; i++) { const day = addDays(today, -i); if (day >= d.start_date && driverDay(d, mine, day) === 'unpaid') lost30++; }
      out.set(d.id, {
        tier: depositStandingTier(s), label: depositStandingLabel(s), owes: s.owes,
        next: s.hasStarted && s.nextDueDate && s.nextDueAmount > 0 ? `${s.nextDueAmount.toLocaleString()} by ${formatDateLabelSafe(s.nextDueDate)}` : null,
        last: lastPayment(d, mine), call: c ? callLine(c, deposits, today) : null, taken: !!carTaken(calls, d.id), lost30,
        promiseDue: c && promiseState(c, deposits) === 'pending' ? c.promised_at : null,
      });
    }
    return out;
  }, [drivers, deposits, calls, showMoney, today]);

  // Sort: by name, by who owes most, or by the earliest promise due.
  const [sortBy, setSortBy] = useState<'name' | 'owes' | 'promise'>('name');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = drivers.filter((d) => (!modelFilter || d.model === modelFilter) && (!q || d.full_name.toLowerCase().includes(q) || d.phone.includes(q)));
    if (sortBy === 'owes') return [...rows].sort((a, b) => (money.get(b.id)?.owes ?? -1) - (money.get(a.id)?.owes ?? -1));
    if (sortBy === 'promise') return [...rows].sort((a, b) => (money.get(a.id)?.promiseDue ?? '9').localeCompare(money.get(b.id)?.promiseDue ?? '9'));
    return rows;
  }, [drivers, search, modelFilter, sortBy, money]);

  const byStage = useMemo(() => {
    const map: Record<string, Driver[]> = { applying: [], raw: [], ready: [], active: [], flagged: [], inactive: [] };
    for (const d of filtered) map[effectiveStage(d)].push(d);
    return map;
  }, [filtered]);

  if (loading) return <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-6 gap-3">{STAGES.map((s) => <div key={s.key} className="h-40 skeleton rounded-xl" />)}</div>;

  if (viewingDriver) {
    return (
      <>
        <DriverProfilePage
          driver={viewingDriver}
          drivers={drivers}
          deposits={deposits}
          fines={fines}
          finePayments={finePayments}
          contractEvents={contractEvents}
          vehicles={vehicles}
          canEdit={canEdit}
          onBack={() => setViewingDriverId(null)}
          onEdit={() => setDriverDrawer({ driver: viewingDriver, startEditing: true })}
          reload={reload}
        />
        {driverDrawer && (
          <DriverDrawer
            driver={driverDrawer.driver}
            startEditing={driverDrawer.startEditing}
            vehicles={vehicles}
            drivers={drivers}
            driverDocuments={driverDocuments}
            canEdit={canEdit}
            onClose={() => setDriverDrawer(null)}
            onSaved={reload}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Truck size={16} className="text-blue-600 dark:text-blue-300" /> Driver Pipeline</h2>
          <p className="text-caption text-fg-subtle mt-0.5">Every driver from application through active service.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showMoney && view === 'table' && (
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="input !w-auto !py-1.5" aria-label="Sort">
              <option value="name">Sort: name</option>
              <option value="owes">Sort: owes most</option>
              <option value="promise">Sort: promise due first</option>
            </select>
          )}
          <ViewToggle value={view} onChange={setView} />
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="input pl-8 w-full sm:w-52" />
          </div>
          <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className="input w-auto" aria-label="Model">
            <option value="">All models</option>
            {Object.entries(DRIVER_MODELS).map(([k, m]) => <option key={k} value={k}>{m.label} ({drivers.filter((d) => d.model === k && d.contract_status === 'active').length})</option>)}
          </select>
          <ExportButton initial="drivers" />
          {canEdit && (
            <button onClick={() => setDriverDrawer({ driver: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Driver
            </button>
          )}
        </div>
      </div>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          {STAGES.map((stage) => (
            <div key={stage.key} className="space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <p className="text-micro font-semibold uppercase tracking-wide text-fg-muted">{stage.label}</p>
                <span className="text-micro text-fg-subtle">{byStage[stage.key].length}</span>
              </div>
              <div className="space-y-1.5 min-h-[40px]">
                {byStage[stage.key].map((d) => (
                  <div
                    key={d.id}
                    onClick={() => peek.open({ type: 'driver', id: d.id, label: d.full_name })}
                    className="w-full card p-2.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <p className="text-caption font-medium truncate">{d.full_name}</p>
                      <EntryActions
                        onView={() => peek.open({ type: 'driver', id: d.id, label: d.full_name })}
                        onEdit={() => setDriverDrawer({ driver: d, startEditing: true })}
                        canEdit={canEdit}
                      />
                    </div>
                    {missingDoc(d) && <p className="text-micro text-danger font-medium mt-0.5">{LEGAL_KIND[missingDoc(d)!].missing}</p>}
                    <p className="text-micro text-fg-subtle flex items-center gap-1 mt-0.5">
                      <Phone size={10} /> {d.phone}
                    </p>
                    {(() => {
                      const p = (d.pauses ?? []).find((x) => isPausedOn(x, kigaliToday));
                      return p ? <p className="text-micro font-semibold text-amber-700 dark:text-amber-300 mt-1">Paused · {PAUSE_REASON_LABEL[p.reason]}</p> : null;
                    })()}
                    {d.vehicle ? (
                      <p className="text-micro text-brand-600 dark:text-brand-300 flex items-center gap-1 mt-1">
                        <Car size={10} /> {d.vehicle.plate_number}
                        {d.shift && <span className="text-fg-subtle">· {driverShiftShort(d)}</span>}
                      </p>
                    ) : (
                      <p className="text-micro text-fg-subtle mt-1">
                        {d.initial_deposit_paid && canSeeDriverPayments(profile) ? 'Deposit paid · no vehicle' : 'No vehicle'}
                      </p>
                    )}
                  </div>
                ))}
                {byStage[stage.key].length === 0 && (
                  <div className="h-12 rounded-lg border border-dashed border-line flex items-center justify-center">
                    <p className="text-micro text-fg-subtle ">Empty</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          pageKey="fleet-drivers"
          noun="drivers"
          rows={filtered}
          keyFn={(d) => d.id}
          emptyLabel="No drivers yet."
          onRowClick={(d) => peek.open({ type: 'driver', id: d.id, label: d.full_name })}
          columns={[
            { header: 'Name', render: (d) => { const m = missingDoc(d); return <Tagged tags={m && <Label tone="danger">{LEGAL_KIND[m].missing}</Label>}><EntityLink type="driver" id={d.id} label={d.full_name} /></Tagged>; } },
            { header: 'Phone', render: (d) => d.phone },
            {
              header: 'Stage',
              render: (d) => {
                const s = STAGES.find((st) => st.key === effectiveStage(d))!;
                return (
                  <span className="text-micro font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
                    {s.label}
                  </span>
                );
              },
            },
            { header: 'Vehicle', render: (d) => d.vehicle ? <EntityLink type="car" id={d.vehicle.id} label={d.vehicle.plate_number} className="font-mono" /> : '—' },
            { header: 'Model', render: (d) => (d.shift || d.model !== 'one_shift' ? driverTermsLabel(d) : 'One shift') },
            // Money at a glance (MD, 26 Nov 2026) - never shown to the Call Center.
            ...(showMoney ? [
              { header: 'Payment', render: (d: Driver) => { const m = money.get(d.id); if (!m) return <span className="text-fg-subtle">—</span>;
                return <span className="flex flex-col gap-0.5"><span className={`text-micro font-medium px-1.5 py-0.5 rounded-full w-fit ${DEPOSIT_TIER_STYLE[m.tier].badge}`}>{m.taken ? 'Car taken back' : m.label}</span>{m.owes > 0 && <span className="text-micro font-semibold text-red-600 dark:text-red-400">Owes {m.owes.toLocaleString()}</span>}</span>; } },
              { header: 'Next payment', render: (d: Driver) => { const m = money.get(d.id); return m?.next ? <span className="text-caption whitespace-nowrap">{m.next}</span> : <span className="text-fg-subtle">—</span>; } },
              { header: 'Last paid', render: (d: Driver) => { const m = money.get(d.id); return m?.last ? <span className="text-caption whitespace-nowrap">{formatDateLabelSafe(m.last.date)} · <b>{m.last.amount.toLocaleString()}</b>{m.last.pending ? <span className="text-amber-600"> · unconfirmed</span> : ''}</span> : <span className="text-fg-subtle text-caption">{m ? 'Never' : '—'}</span>; } },
              { header: 'Pay day', render: (d: Driver) => <span className="text-caption">{d.payment_day ? d.payment_day[0].toUpperCase() + d.payment_day.slice(1, 3) : '—'}</span> },
              { header: 'Latest call', render: (d: Driver) => { const m = money.get(d.id); return m?.call ? <span className={`text-caption block max-w-[260px] truncate ${toneClass(m.call.tone)}`} title={m.call.text}>{m.call.text}</span> : <span className="text-fg-subtle text-caption">—</span>; } },
              { header: 'Lost (30d)', className: 'text-right', render: (d: Driver) => { const m = money.get(d.id); return m && m.lost30 ? <span className="text-caption font-semibold text-red-600 dark:text-red-400 tabular-nums">{m.lost30}</span> : <span className="text-fg-subtle text-caption">{m ? '0' : '—'}</span>; } },
            ] : []),
            {
              header: '',
              className: 'text-right',
              render: (d) => (
                <EntryActions
                  onView={() => peek.open({ type: 'driver', id: d.id, label: d.full_name })}
                  onEdit={() => setDriverDrawer({ driver: d, startEditing: true })}
                  canEdit={canEdit}
                />
              ),
            },
          ]}
        />
      )}

      {drivers.length === 0 && (
        <div className="card p-12 text-center">
          <Truck size={26} className="text-fg-subtle mx-auto mb-2" />
          <p className="text-small text-fg-subtle">No drivers yet.</p>
        </div>
      )}

      {driverDrawer && (
        <DriverDrawer
          driver={driverDrawer.driver}
          startEditing={driverDrawer.startEditing}
          vehicles={vehicles}
          drivers={drivers}
          driverDocuments={driverDocuments}
          canEdit={canEdit}
          onClose={() => setDriverDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
