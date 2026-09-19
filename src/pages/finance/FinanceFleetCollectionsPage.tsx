import { useMemo, useState } from 'react';
import { Wallet, Plus, ListChecks, Clock3, Users2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFinanceData, STATUS_META, fmt, sumWhere } from '../../lib/finance';
import { todayStr, startOfWeek, addDays, dateStr, formatDateLabel } from '../../lib/utils';
import { FinanceTransaction, FinanceTransactionStatus } from '../../lib/supabase';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import KpiTile from '../../components/KpiTile';
import SearchableSelect from '../../components/SearchableSelect';
import FinanceTransactionDrawer from '../../components/finance/FinanceTransactionDrawer';

interface TxDrawerState { tx: FinanceTransaction | null; startEditing: boolean }

const STATUS_FILTERS: { key: FinanceTransactionStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All statuses' },
  { key: 'pending', label: 'Pending' },
  { key: 'checked', label: 'Checked' },
  { key: 'approved', label: 'Approved' },
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

// A dedicated page rather than the generic TransactionTypePage every other
// transaction type uses - fleet collections are weekly by nature (one row
// per driver deposit Fleet logs) and Finance needs to reason about them
// week by week, not just as a flat ledger list.
export default function FinanceFleetCollectionsPage() {
  const { profile } = useAuth();
  const { accounts, transactions, drivers, vehicles, documents, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const [drawer, setDrawer] = useState<TxDrawerState | null>(null);
  const [driverFilter, setDriverFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<FinanceTransactionStatus | 'all'>('all');
  const [weekFilter, setWeekFilter] = useState<string | null>(null); // null = all time, grouped by week

  const rows = useMemo(() => transactions.filter((t) => t.type === 'fleet_collection'), [transactions]);
  const selectedDriver = driverFilter ? drivers.find((d) => d.id === driverFilter) ?? null : null;
  const driverOptions = useMemo(
    () => [...drivers].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((d) => ({ id: d.id, label: d.full_name, sublabel: d.vehicle?.plate_number })),
    [drivers]
  );

  const thisWeekStart = dateStr(startOfWeek(new Date()));
  const thisMonth = todayStr().slice(0, 7);
  const weekTotal = sumWhere(rows.filter((t) => weekStartOf(t.transaction_date) === thisWeekStart), 'fleet_collection', 'in');
  const monthTotal = sumWhere(rows.filter((t) => t.transaction_date.slice(0, 7) === thisMonth), 'fleet_collection', 'in');
  const pendingCount = rows.filter((t) => t.status === 'pending' || t.status === 'checked').length;
  const driverCount = new Set(rows.map((t) => t.linked_driver_id).filter(Boolean)).size;

  const filteredRows = useMemo(() => {
    return rows.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (weekFilter && weekStartOf(t.transaction_date) !== weekFilter) return false;
      if (driverFilter && t.linked_driver_id !== driverFilter) return false;
      return true;
    });
  }, [rows, driverFilter, statusFilter, weekFilter]);

  // A quick at-a-glance summary the moment Finance picks one driver -
  // total collected, how many payments, and the span of dates - on top
  // of the itemized week-by-week list below, which already narrows to
  // just this driver once selected.
  const driverSummary = useMemo(() => {
    if (!selectedDriver) return null;
    const driverRows = rows.filter((t) => t.linked_driver_id === selectedDriver.id).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    if (driverRows.length === 0) return { count: 0, total: 0, firstDate: null as string | null, lastDate: null as string | null };
    return {
      count: driverRows.length,
      total: driverRows.reduce((s, t) => s + t.amount, 0),
      firstDate: driverRows[0].transaction_date,
      lastDate: driverRows[driverRows.length - 1].transaction_date,
    };
  }, [rows, selectedDriver]);

  // Grouped week-by-week, most recent first - when weekFilter narrows to
  // one week this naturally collapses to a single section.
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
        txs: [...txs].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at)),
        total: sumWhere(txs, 'fleet_collection', 'in'),
      }));
  }, [filteredRows]);

  const shiftWeek = (dir: 1 | -1) => {
    const base = weekFilter ?? thisWeekStart;
    setWeekFilter(dateStr(addDays(new Date(`${base}T00:00:00`), dir * 7)));
  };

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Wallet size={16} className="text-amber-600 dark:text-amber-300" /> Fleet Collections</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">The two shift drivers' weekly remittance per car, collected into Bank of Kigali — funds each owner's payout and Kivu's management margin, not a refundable deposit.</p>
        </div>
        {canEdit && (
          <button onClick={() => setDrawer({ tx: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> New Fleet Collection
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Wallet} label="This Week" value={fmt(weekTotal)} tone="positive" color="amber" />
        <KpiTile icon={Wallet} label="This Month" value={fmt(monthTotal)} tone="positive" color="amber" />
        <KpiTile icon={ListChecks} label="Total Logged" value={String(rows.length)} color="amber" />
        <KpiTile icon={Clock3} label="Awaiting Approval" value={String(pendingCount)} tone={pendingCount > 0 ? 'negative' : undefined} color="amber" />
      </div>

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

        <div className="w-52">
          <SearchableSelect
            options={driverOptions}
            value={driverFilter}
            onChange={setDriverFilter}
            placeholder="Choose a driver…"
            emptyLabel="No drivers found"
          />
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FinanceTransactionStatus | 'all')} className="input w-auto">
          {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>

        <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-1"><Users2 size={11} /> {driverCount} drivers ever collected from</span>
      </div>

      {selectedDriver && driverSummary && (
        <div className="card p-3.5 flex items-center gap-3 flex-wrap bg-brand/5 border border-brand/20">
          <div className="flex-1 min-w-[160px]">
            <p className="text-[12px] font-medium">{selectedDriver.full_name}</p>
            <p className="text-[10px] text-gray-400">{selectedDriver.vehicle?.plate_number ?? 'No vehicle assigned'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400">Total Collected</p>
            <p className="text-[12px] font-semibold text-positive">{fmt(driverSummary.total)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400">Payments Logged</p>
            <p className="text-[12px] font-semibold">{driverSummary.count}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400">First Payment</p>
            <p className="text-[12px] font-semibold">{driverSummary.firstDate ? formatDateLabel(driverSummary.firstDate) : '—'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400">Most Recent</p>
            <p className="text-[12px] font-semibold">{driverSummary.lastDate ? formatDateLabel(driverSummary.lastDate) : '—'}</p>
          </div>
          <button onClick={() => setDriverFilter('')} className="btn-ghost p-1.5 shrink-0" title="Clear driver filter">
            <X size={14} />
          </button>
        </div>
      )}

      {filteredRows.length === 0 && (
        <div className="card p-12 text-center">
          <Wallet size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">
            {rows.length === 0 ? 'No fleet collections logged yet.' : selectedDriver ? `${selectedDriver.full_name} has no collections matching this filter.` : 'No collections match this filter.'}
          </p>
        </div>
      )}

      {weeks.map((week) => (
        <div key={week.weekStart} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{weekLabel(week.weekStart)}</p>
            <p className="text-[11px] text-gray-400">{week.txs.length} collection{week.txs.length === 1 ? '' : 's'} · <span className="font-medium text-positive">{fmt(week.total)}</span></p>
          </div>
          <DataTable
            rows={week.txs}
            keyFn={(t) => t.id}
            onRowClick={(t) => setDrawer({ tx: t, startEditing: false })}
            columns={[
              { header: 'Date', render: (t) => t.transaction_date },
              { header: 'Driver', render: (t) => t.linked_driver?.full_name ?? t.counterparty ?? '—' },
              { header: 'Reference', render: (t) => <span className="font-mono text-[10px]">{t.reference}</span> },
              {
                header: 'Amount',
                render: (t) => <span className="text-positive font-medium">+{fmt(t.amount)}</span>,
              },
              {
                header: 'Status',
                render: (t) => (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_META[t.status].color}20`, color: STATUS_META[t.status].color }}>
                    {STATUS_META[t.status].label}
                  </span>
                ),
              },
              { header: '', render: (t) => (t.system_generated ? <span className="text-[9px] text-brand-600 dark:text-brand-300">Auto-posted</span> : null) },
              {
                header: '',
                className: 'text-right',
                render: (t) => <EntryActions onView={() => setDrawer({ tx: t, startEditing: false })} onEdit={() => setDrawer({ tx: t, startEditing: true })} canEdit={canEdit && !t.system_generated} />,
              },
            ]}
          />
        </div>
      ))}

      {drawer && (
        <FinanceTransactionDrawer
          tx={drawer.tx}
          startEditing={drawer.startEditing}
          fixedType="fleet_collection"
          accounts={accounts}
          drivers={drivers}
          vehicles={vehicles}
          documents={documents}
          canEdit={canEdit}
          onClose={() => setDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
