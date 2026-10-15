import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Download, Hourglass, Plus, Scale, ScrollText, Search, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFinanceData, TYPE_META, STATUS_META } from '../../lib/finance';
import { FinanceTransaction, FinanceTransactionType } from '../../lib/supabase';
import { EntityLink } from '../../os/EntityLink';
import { Pager, usePaged } from '../../ui/Pager';
import { Label, PageHeader, StatCard, StatGrid, Tone, UnderlineTabs, rwf, rwfShort } from '../../ui/kit';
import FinanceTransactionDrawer from '../../components/finance/FinanceTransactionDrawer';
import { addDays, today } from '../../lib/performance';

type View = 'all' | 'waiting' | 'approved' | 'posted' | 'rejected';
type Period = 'all' | 'month' | 'last_month' | '30d' | '7d';
const STATUS_TONE: Record<string, Tone> = { pending: 'attention', checked: 'info', approved: 'accent', posted: 'success', rejected: 'danger' };
const PAGE = 50;

// Finance's one ledger: every transaction (revenue, collections, owners,
// payroll, suppliers, transfers, expense claims...) with filters, totals
// and the same drawer to view, check, approve or edit.
export default function FinanceLedger() {
  const { profile } = useAuth();
  const { accounts, transactions, drivers, vehicles, documents, loading, reload } = useFinanceData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  const [view, setView] = useState<View>('all');
  const [params] = useSearchParams();
  const [type, setType] = useState<FinanceTransactionType | ''>(() => ((params.get('type') ?? '') in TYPE_META ? (params.get('type') as FinanceTransactionType) : ''));
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [account, setAccount] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState<{ tx: FinanceTransaction | null; editing: boolean } | null>(null);
  const t = today();

  const range = useMemo((): [string, string] | null => {
    if (period === 'month') return [`${t.slice(0, 8)}01`, t];
    if (period === 'last_month') { const d = new Date(`${t.slice(0, 8)}01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); const s = d.toISOString().slice(0, 10); return [s, addDays(`${t.slice(0, 8)}01`, -1)]; }
    if (period === '30d') return [addDays(t, -29), t];
    if (period === '7d') return [addDays(t, -6), t];
    return null;
  }, [period, t]);

  const base = useMemo(() => {
    const term = q.trim().toLowerCase();
    return transactions.filter((x) => {
      if (type && x.type !== type) return false;
      if (direction && x.direction !== direction) return false;
      if (account && x.account_id !== account) return false;
      if (range && (x.transaction_date < range[0] || x.transaction_date > range[1])) return false;
      if (term && ![x.reference, x.description, x.counterparty, TYPE_META[x.type]?.label].some((v) => v?.toLowerCase().includes(term))) return false;
      return true;
    }).sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at));
  }, [transactions, type, direction, account, range, q]);

  const inView = (x: FinanceTransaction, v: View) => v === 'all' || (v === 'waiting' ? x.status === 'pending' || x.status === 'checked' : x.status === v);
  const rows = base.filter((x) => inView(x, view));
  const { rows: shown, pager } = usePaged(rows, { key: 'ledger', size: PAGE, reset: `${view}|${type}|${direction}|${account}|${period}|${q}` });

  const counted = base.filter((x) => (x.status === 'posted' || x.status === 'approved') && x.type !== 'transfer' && x.type !== 'management_margin');
  const totalIn = counted.filter((x) => x.direction === 'in').reduce((s, x) => s + x.amount, 0);
  const totalOut = counted.filter((x) => x.direction === 'out').reduce((s, x) => s + x.amount, 0);
  const waiting = base.filter((x) => inView(x, 'waiting'));
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '—';
  const active = [type, direction, account, q].filter(Boolean).length + (period !== 'all' ? 1 : 0);

  const csv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = rows.map((x) => [x.transaction_date, x.reference, TYPE_META[x.type]?.label ?? x.type, x.direction, x.amount, x.status, accName(x.account_id), x.counterparty ?? '', x.description ?? ''].map((v) => esc(String(v))).join(','));
    const blob = new Blob([['Date,Reference,Type,Direction,Amount,Status,Account,Counterparty,Description', ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kivu-ledger-${t}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;

  const sel = 'input py-1 text-small w-auto';
  return (
    <div className="animate-fade-in">
      <PageHeader icon={ScrollText} title="Ledger" subtitle="Every transaction in one place. Click a row to view, check, approve or edit it."
        actions={<>
          <button onClick={csv} className="btn-secondary"><Download size={14} /> CSV</button>
          {canEdit && <button onClick={() => setDrawer({ tx: null, editing: true })} className="btn-primary"><Plus size={14} /> New transaction</button>}
        </>} />

      <StatGrid cols={4}>
        <StatCard icon={ArrowDownLeft} label="Money in" value={rwfShort(totalIn)} sub={`${rwf(totalIn)} · approved and posted`} tone="success" />
        <StatCard icon={ArrowUpRight} label="Money out" value={rwfShort(totalOut)} sub={rwf(totalOut)} />
        <StatCard icon={Scale} label="Net" value={rwfShort(totalIn - totalOut)} tone={totalIn - totalOut < 0 ? 'danger' : undefined} sub="Transfers and margin entries left out" />
        <StatCard icon={Hourglass} label="Waiting for approval" value={waiting.length} tone={waiting.length ? 'attention' : undefined} sub={rwf(waiting.reduce((s, x) => s + x.amount, 0))} onClick={() => setView('waiting')} />
      </StatGrid>

      <div className="card">
        <div className="px-3 pt-1">
          <UnderlineTabs value={view} onChange={setView} tabs={[
            { key: 'all', label: 'All', count: base.length },
            { key: 'waiting', label: 'Waiting', count: base.filter((x) => inView(x, 'waiting')).length, tone: 'danger' },
            { key: 'approved', label: 'Approved', count: base.filter((x) => x.status === 'approved').length },
            { key: 'posted', label: 'Posted', count: base.filter((x) => x.status === 'posted').length },
            { key: 'rejected', label: 'Rejected', count: base.filter((x) => x.status === 'rejected').length },
          ]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 -mt-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, description, who" className="input pl-8 py-1 text-small" />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value as FinanceTransactionType | '')} className={sel} aria-label="Type">
            <option value="">All types</option>
            {(Object.keys(TYPE_META) as FinanceTransactionType[]).map((k) => <option key={k} value={k}>{TYPE_META[k].label}</option>)}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value as '' | 'in' | 'out')} className={sel} aria-label="Direction">
            <option value="">In and out</option><option value="in">Money in</option><option value="out">Money out</option>
          </select>
          <select value={account} onChange={(e) => setAccount(e.target.value)} className={sel} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={sel} aria-label="Period">
            <option value="all">Any date</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="last_month">Last month</option>
          </select>
          {active > 0 && <button onClick={() => { setType(''); setDirection(''); setAccount(''); setPeriod('all'); setQ(''); }} className="btn-ghost text-small flex items-center gap-1"><X size={12} /> Clear {active}</button>}
          <span className="ml-auto text-caption text-fg-muted tabular-nums">{rows.length} transaction{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto border-t border-line-muted">
          <table className="w-full text-body min-w-[900px]">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Date', 'Reference', 'Type', 'Details', 'Linked to', 'Account', 'Status', 'Amount'].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i === 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((x) => {
                const car = x.linked_vehicle_id ? vehicles.find((v) => v.id === x.linked_vehicle_id) : null;
                const drv = x.linked_driver_id ? drivers.find((d) => d.id === x.linked_driver_id) : null;
                return (
                  <tr key={x.id} onClick={() => setDrawer({ tx: x, editing: false })} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">{new Date(`${x.transaction_date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                    <td className="px-4 py-2 font-mono text-small text-fg-muted">{x.reference}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{TYPE_META[x.type]?.label ?? x.type}</td>
                    <td className="px-4 py-2 max-w-[280px]"><span className="block truncate">{x.counterparty || x.description || '—'}</span>{x.counterparty && x.description && <span className="block truncate text-caption text-fg-muted">{x.description}</span>}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{car ? <EntityLink type="car" id={car.id} label={car.plate_number} className="font-mono" /> : drv ? <EntityLink type="driver" id={drv.id} label={drv.full_name} /> : <span className="text-fg-subtle">—</span>}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-fg-muted">{accName(x.account_id)}</td>
                    <td className="px-4 py-2"><Label tone={STATUS_TONE[x.status] ?? 'neutral'}>{STATUS_META[x.status as keyof typeof STATUS_META]?.label ?? x.status}</Label></td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap ${x.direction === 'in' ? 'text-success' : ''}`}>{x.direction === 'in' ? '+' : '−'}{rwf(x.amount)}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-fg-muted">No transactions match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager pager={pager} noun="transactions" className="px-4 border-t border-line-muted" />
      </div>

      {drawer && (
        <FinanceTransactionDrawer tx={drawer.tx} startEditing={drawer.editing} accounts={accounts} drivers={drivers} vehicles={vehicles} documents={documents}
          canEdit={canEdit} onClose={() => setDrawer(null)} onSaved={reload} />
      )}
    </div>
  );
}
