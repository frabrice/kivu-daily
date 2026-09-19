import { useMemo, useState } from 'react';
import {
  Car, UserPlus, Wallet, Users2, Landmark, TrendingUp, Clock3, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFinanceData, STATUS_META, fmt, sumWhere } from '../../lib/finance';
import { supabase, Vehicle, VehicleOwner, FinanceTransaction, FinanceTransactionStatus } from '../../lib/supabase';
import { todayStr, startOfWeek, addDays, dateStr } from '../../lib/utils';
import { formatDateLabelSafe } from '../../lib/fleet';
import KpiTile from '../../components/KpiTile';
import DataTable from '../../components/DataTable';
import SearchableSelect from '../../components/SearchableSelect';
import VehicleOwnerDrawer from '../../components/finance/VehicleOwnerDrawer';
import AssignVehicleOwnerDrawer from '../../components/finance/AssignVehicleOwnerDrawer';
import OnboardVehicleDrawer from '../../components/finance/OnboardVehicleDrawer';

type Tab = 'owners' | 'payments';

const STATUS_FILTERS: { key: FinanceTransactionStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All statuses' },
  { key: 'pending', label: 'Pending' },
  { key: 'posted', label: 'Posted' },
  { key: 'rejected', label: 'Rejected' },
];

function weekStartOf(dateISO: string): string {
  return dateStr(startOfWeek(new Date(`${dateISO}T00:00:00`)));
}

function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  return `Week of ${startLabel} – ${endLabel}, ${end.getFullYear()}`;
}

const PAYMENT_DAY_LABEL: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

// Car-management money, per car: two shift drivers pay 360,000/week into
// BK (the existing driver_deposits system), of which the owner gets a
// flat 240,000/week from I&M and Kivu keeps 120,000/week margin in
// Equity, plus a separate 30,000/month management fee. Both the margin
// and the fee are schedule-driven (sync_vehicle_obligations, called on
// every Finance load). Two tabs: Owners (who they are, their bank and
// contract details) and Payments (the weekly payout queue - logged
// automatically, confirmed by hand once Finance has actually sent it).
export default function FinanceVehicleOwnersPage() {
  const { profile } = useAuth();
  const { accounts, vehicles, owners, transactions, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const bkAccountId = accounts.find((a) => a.key === 'bank_of_kigali')?.id ?? '';

  const [tab, setTab] = useState<Tab>('owners');
  const [ownerDrawer, setOwnerDrawer] = useState<{ owner: VehicleOwner | null; startEditing: boolean } | null>(null);
  const [assignVehicle, setAssignVehicle] = useState<Vehicle | null>(null);
  const [onboardVehicle, setOnboardVehicle] = useState<Vehicle | null>(null);

  const onboardedVehicleIds = useMemo(() => new Set(transactions.filter((t) => t.type === 'onboarding_fee').map((t) => t.linked_vehicle_id)), [transactions]);
  const managedVehicles = useMemo(() => vehicles.filter((v) => v.owner_id), [vehicles]);
  const unassignedVehicles = useMemo(() => vehicles.filter((v) => !v.owner_id), [vehicles]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Car size={16} className="text-amber-600 dark:text-amber-300" /> Vehicle Owners</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Who owns each managed car, and their weekly payout (I&M) plus Kivu's management margin (Equity).</p>
        </div>
        {canEdit && (
          <button onClick={() => setOwnerDrawer({ owner: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <UserPlus size={14} /> Add Owner
          </button>
        )}
      </div>

      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <button
          onClick={() => setTab('owners')}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${tab === 'owners' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
        >
          Owners
        </button>
        <button
          onClick={() => setTab('payments')}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${tab === 'payments' ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
        >
          Payments
        </button>
      </div>

      {tab === 'owners' && (
        <OwnersTab
          owners={owners}
          vehicles={vehicles}
          managedVehicles={managedVehicles}
          unassignedVehicles={unassignedVehicles}
          onboardedVehicleIds={onboardedVehicleIds}
          canEdit={canEdit}
          bkAccountId={bkAccountId}
          onEditOwner={(o) => setOwnerDrawer({ owner: o, startEditing: false })}
          onAssignVehicle={setAssignVehicle}
          onOnboardVehicle={setOnboardVehicle}
        />
      )}

      {tab === 'payments' && (
        <PaymentsTab
          owners={owners}
          managedVehicles={managedVehicles}
          transactions={transactions}
          canEdit={canEdit}
          reload={reload}
        />
      )}

      {ownerDrawer && (
        <VehicleOwnerDrawer
          owner={ownerDrawer.owner}
          startEditing={ownerDrawer.startEditing}
          canEdit={canEdit}
          onClose={() => setOwnerDrawer(null)}
          onSaved={reload}
        />
      )}

      {assignVehicle && (
        <AssignVehicleOwnerDrawer
          vehicle={assignVehicle}
          owners={owners}
          onClose={() => setAssignVehicle(null)}
          onSaved={reload}
        />
      )}

      {onboardVehicle && (
        <OnboardVehicleDrawer
          vehicle={onboardVehicle}
          bkAccountId={bkAccountId}
          onClose={() => setOnboardVehicle(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function OwnersTab({
  owners, vehicles, managedVehicles, unassignedVehicles, onboardedVehicleIds, canEdit, bkAccountId,
  onEditOwner, onAssignVehicle, onOnboardVehicle,
}: {
  owners: VehicleOwner[];
  vehicles: Vehicle[];
  managedVehicles: Vehicle[];
  unassignedVehicles: Vehicle[];
  onboardedVehicleIds: Set<string | null>;
  canEdit: boolean;
  bkAccountId: string;
  onEditOwner: (o: VehicleOwner) => void;
  onAssignVehicle: (v: Vehicle) => void;
  onOnboardVehicle: (v: Vehicle) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiTile icon={Users2} label="Owners On File" value={String(owners.length)} color="amber" />
        <KpiTile icon={Car} label="Managed Cars" value={String(managedVehicles.length)} color="amber" />
        <KpiTile icon={Car} label="Needs An Owner" value={String(unassignedVehicles.length)} tone={unassignedVehicles.length > 0 ? 'negative' : undefined} color="amber" />
      </div>

      {unassignedVehicles.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Needs an Owner</p>
          <div className="space-y-1.5">
            {unassignedVehicles.map((v) => (
              <div key={v.id} className="card p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium">{v.plate_number}</p>
                  <p className="text-[10px] text-gray-400">{v.make} {v.model}</p>
                </div>
                {canEdit && (
                  <>
                    {onboardedVehicleIds.has(v.id) ? (
                      <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-full shrink-0">Onboarded</span>
                    ) : (
                      <button onClick={() => onOnboardVehicle(v)} disabled={!bkAccountId} className="btn-ghost shrink-0 whitespace-nowrap disabled:opacity-50">
                        Log Onboarding
                      </button>
                    )}
                    <button onClick={() => onAssignVehicle(v)} className="btn-primary shrink-0 whitespace-nowrap">
                      Assign Owner
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Owners Directory</p>
        <DataTable
          rows={owners}
          keyFn={(o) => o.id}
          emptyLabel="No vehicle owners on file yet."
          onRowClick={onEditOwner}
          columns={[
            { header: 'Name', render: (o) => o.full_name },
            { header: 'Phone', render: (o) => o.phone },
            { header: 'Email', render: (o) => o.email ?? '—' },
            {
              header: 'Bank Account',
              render: (o) => (
                <span className="flex items-center gap-1">
                  {o.bank_name && <Landmark size={11} className="text-gray-400 shrink-0" />}
                  {o.bank_name ? `${o.bank_name}${o.account_number ? ` · ${o.account_number}` : ''}` : '—'}
                </span>
              ),
            },
            { header: 'Payment Day', render: (o) => (o.payment_day ? PAYMENT_DAY_LABEL[o.payment_day] : '—') },
            {
              header: 'Vehicle(s)',
              render: (o) => {
                const owned = vehicles.filter((v) => v.owner_id === o.id);
                if (owned.length === 0) return '—';
                return (
                  <div className="space-y-0.5">
                    {owned.map((v) => (
                      <div key={v.id}>
                        {v.plate_number}
                        {v.operation_start_date && <span className="text-gray-400"> · since {formatDateLabelSafe(v.operation_start_date)}</span>}
                      </div>
                    ))}
                  </div>
                );
              },
            },
          ]}
        />
      </div>
    </div>
  );
}

function PaymentsTab({
  owners, managedVehicles, transactions, canEdit, reload,
}: {
  owners: VehicleOwner[];
  managedVehicles: Vehicle[];
  transactions: FinanceTransaction[];
  canEdit: boolean;
  reload: () => void;
}) {
  const [ownerFilter, setOwnerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<FinanceTransactionStatus | 'all'>('all');
  const [weekFilter, setWeekFilter] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const rows = useMemo(() => transactions.filter((t) => t.type === 'vehicle_owner_payment'), [transactions]);
  const ownerOptions = useMemo(() => [...owners].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((o) => ({ id: o.id, label: o.full_name })), [owners]);
  const vehicleOwnerId = (t: FinanceTransaction) => managedVehicles.find((v) => v.id === t.linked_vehicle_id)?.owner_id ?? '';

  const thisWeekStart = dateStr(startOfWeek(new Date()));
  const thisMonth = todayStr().slice(0, 7);
  const pendingTotal = sumWhere(rows.filter((t) => t.status === 'pending'), 'vehicle_owner_payment', 'out');
  const paidThisMonth = sumWhere(rows.filter((t) => t.status === 'posted' && t.transaction_date.slice(0, 7) === thisMonth), 'vehicle_owner_payment', 'out');
  const marginThisWeek = transactions
    .filter((t) => t.type === 'management_margin' && weekStartOf(t.transaction_date) === thisWeekStart)
    .reduce((s, t) => s + t.amount, 0);

  const filteredRows = useMemo(() => rows.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (weekFilter && weekStartOf(t.transaction_date) !== weekFilter) return false;
    if (ownerFilter && vehicleOwnerId(t) !== ownerFilter) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, statusFilter, weekFilter, ownerFilter, managedVehicles]);

  const weeks = useMemo(() => {
    const map = new Map<string, FinanceTransaction[]>();
    for (const t of filteredRows) {
      const wk = weekStartOf(t.transaction_date);
      if (!map.has(wk)) map.set(wk, []);
      map.get(wk)!.push(t);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([weekStart, txs]) => ({
        weekStart,
        txs: [...txs].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)),
        total: sumWhere(txs, 'vehicle_owner_payment', 'out'),
      }));
  }, [filteredRows]);

  const shiftWeek = (dir: 1 | -1) => {
    const base = weekFilter ?? thisWeekStart;
    setWeekFilter(dateStr(addDays(new Date(`${base}T00:00:00`), dir * 7)));
  };

  const payOwner = async (txId: string) => {
    setPayingId(txId);
    setError('');
    const { error: err } = await supabase.rpc('mark_vehicle_owner_payment_paid', { p_transaction_id: txId });
    setPayingId(null);
    if (err) { setError(err.message); return; }
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Wallet} label="Pending Payouts" value={fmt(pendingTotal)} tone={pendingTotal > 0 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={Clock3} label="Paid This Month" value={fmt(paidThisMonth)} tone="positive" color="amber" />
        <KpiTile icon={TrendingUp} label="This Week's Margin" value={fmt(marginThisWeek)} tone="positive" color="amber" />
        <KpiTile icon={Car} label="Managed Cars" value={String(managedVehicles.length)} color="amber" />
      </div>

      {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
          <button
            onClick={() => setWeekFilter(null)}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${!weekFilter ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
          >
            All Time
          </button>
          <button
            onClick={() => setWeekFilter(weekFilter ?? thisWeekStart)}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${weekFilter ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
          >
            By Week
          </button>
        </div>

        {weekFilter && (
          <div className="flex items-center gap-1">
            <button onClick={() => shiftWeek(-1)} className="btn-ghost p-1.5"><ChevronLeft size={14} /></button>
            <span className="text-[11px] font-medium whitespace-nowrap px-1">{weekLabel(weekFilter)}</span>
            <button onClick={() => shiftWeek(1)} className="btn-ghost p-1.5"><ChevronRight size={14} /></button>
            {weekFilter !== thisWeekStart && (
              <button onClick={() => setWeekFilter(thisWeekStart)} className="text-[10px] text-brand-600 dark:text-brand-300 underline underline-offset-2 ml-1">This week</button>
            )}
          </div>
        )}

        <div className="w-48">
          <SearchableSelect options={ownerOptions} value={ownerFilter} onChange={setOwnerFilter} placeholder="Choose an owner…" emptyLabel="No owners found" />
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FinanceTransactionStatus | 'all')} className="input w-auto">
          {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>

        {ownerFilter && (
          <button onClick={() => setOwnerFilter('')} className="btn-ghost p-1.5" title="Clear owner filter"><X size={14} /></button>
        )}
      </div>

      {filteredRows.length === 0 && (
        <div className="card p-12 text-center">
          <Wallet size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">{rows.length === 0 ? 'No owner payments logged yet.' : 'No payments match this filter.'}</p>
        </div>
      )}

      {weeks.map((week) => (
        <div key={week.weekStart} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{weekLabel(week.weekStart)}</p>
            <p className="text-[11px] text-gray-400">{week.txs.length} payment{week.txs.length === 1 ? '' : 's'} · <span className="font-medium">{fmt(week.total)}</span></p>
          </div>
          <DataTable
            rows={week.txs}
            keyFn={(t) => t.id}
            columns={[
              { header: 'Date', render: (t) => t.transaction_date },
              { header: 'Owner', render: (t) => owners.find((o) => o.id === vehicleOwnerId(t))?.full_name ?? '—' },
              { header: 'Vehicle', render: (t) => t.linked_vehicle?.plate_number ?? '—' },
              { header: 'Amount', render: (t) => <span className="font-medium">−{fmt(t.amount)}</span> },
              {
                header: 'Status',
                render: (t) => (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_META[t.status].color}20`, color: STATUS_META[t.status].color }}>
                    {STATUS_META[t.status].label}
                  </span>
                ),
              },
              {
                header: '',
                className: 'text-right',
                render: (t) => (
                  canEdit && t.status === 'pending' ? (
                    <button onClick={() => payOwner(t.id)} disabled={payingId === t.id} className="btn-primary text-[11px] px-2.5 py-1.5 disabled:opacity-50">
                      {payingId === t.id ? 'Confirming…' : 'Confirm Paid'}
                    </button>
                  ) : null
                ),
              },
            ]}
          />
        </div>
      ))}
    </div>
  );
}
