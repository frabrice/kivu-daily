import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleDollarSign, Receipt, Search, Settings, Wallet } from 'lucide-react';
import { INVOICE_STATUS, dayLabel, isOverdue, outstandingOf, thisMonth, useBusinessData } from '../../lib/business';
import { kigaliTime } from '../../lib/trips';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs, rwf } from '../../ui/kit';
import { Pager, usePaged } from '../../ui/Pager';
import InvoicePanel from '../../components/business/InvoicePanel';
import { InvoiceSettingsModal } from '../../components/business/BusinessModals';

// Every company invoice: what's unpaid or overdue first, what was
// collected, and the issuer details printed on invoices (Settings).

type View = 'unpaid' | 'overdue' | 'paid' | 'void' | 'all';
const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';

export default function InvoicesPage() {
  usePageTitle('Invoices');
  const a = useAccess();
  const canBill = a.in('finance');
  const data = useBusinessData();
  const [view, setView] = useState<View>('unpaid');
  const [clientId, setClientId] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const month = thisMonth();

  const list = useMemo(() => data.invoices.filter((i) => {
    if (clientId && i.client_id !== clientId) return false;
    if (q.trim() && !`${i.number} ${data.clients.find((c) => c.id === i.client_id)?.name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (view === 'unpaid') return outstandingOf(i) > 0;
    if (view === 'overdue') return isOverdue(i);
    if (view === 'paid') return i.status === 'paid';
    if (view === 'void') return i.status === 'void';
    return true;
  }).sort((x, y) => (view === 'unpaid' || view === 'overdue' ? x.due_date.localeCompare(y.due_date) : 0)), [data.invoices, data.clients, view, clientId, q]);
  const { rows, pager } = usePaged(list, { key: 'invoices', reset: `${view}${clientId}${q}` });

  if (data.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
  const live = data.invoices.filter((i) => i.status !== 'void');
  const outstanding = live.reduce((s, i) => s + outstandingOf(i), 0);
  const overdue = live.filter(isOverdue);
  const monthInvoiced = live.filter((i) => i.issue_date >= month.from).reduce((s, i) => s + Number(i.total), 0);
  const monthCollected = data.payments.filter((p) => p.paid_on >= month.from).reduce((s, p) => s + Number(p.amount), 0);
  const count = (v: View) => data.invoices.filter((i) => (v === 'unpaid' ? outstandingOf(i) > 0 : v === 'overdue' ? isOverdue(i) : v === 'paid' ? i.status === 'paid' : v === 'void' ? i.status === 'void' : true)).length;
  const inv = open ? data.invoices.find((i) => i.id === open) : null;
  const missingPay = !data.settings?.bank_account_number && !data.settings?.momo_number;

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Receipt} title="Invoices" subtitle="Invoices to companies for their trips: app fares + VAT."
        actions={<>
          <Link to="/trips/companies" className="btn-secondary">Companies</Link>
          {canBill && <button onClick={() => setSettings(true)} className="btn-ghost"><Settings size={14} /> Settings</button>}
        </>} />
      {canBill && missingPay && (
        <button onClick={() => setSettings(true)} className="mb-4 w-full text-left flex items-center gap-2 rounded-lg border border-attention/40 bg-attention-muted px-3 py-2 text-small">
          <AlertTriangle size={14} className="text-attention" /> Add Kivu Ride's bank account and/or Mobile Money number so they print on every invoice.
        </button>
      )}
      <StatGrid cols={4}>
        <StatCard icon={Wallet} label="Unpaid" value={rwf(outstanding)} tone={outstanding ? 'attention' : 'success'} sub={(() => { const n = live.filter((i) => outstandingOf(i) > 0).length; return `${n} invoice${n === 1 ? '' : 's'}`; })()} onClick={() => setView('unpaid')} />
        <StatCard icon={AlertTriangle} label="Overdue" value={rwf(overdue.reduce((s, i) => s + outstandingOf(i), 0))} tone={overdue.length ? 'danger' : undefined} sub={overdue.length ? `${overdue.length} past their due date` : 'Nothing overdue'} onClick={() => setView('overdue')} />
        <StatCard icon={Receipt} label="Invoiced this month" value={rwf(monthInvoiced)} sub={`Since ${dayLabel(month.from)}`} />
        <StatCard icon={CircleDollarSign} label="Collected this month" value={rwf(monthCollected)} tone="success" sub={(() => { const n = data.payments.filter((p) => p.paid_on >= month.from).length; return `${n} payment${n === 1 ? '' : 's'}`; })()} />
      </StatGrid>

      <UnderlineTabs<View> value={view} onChange={setView} tabs={[
        { key: 'unpaid', label: 'Unpaid', count: count('unpaid') }, { key: 'overdue', label: 'Overdue', count: count('overdue'), tone: 'danger' },
        { key: 'paid', label: 'Paid', count: count('paid') }, { key: 'void', label: 'Cancelled', count: count('void') }, { key: 'all', label: 'All', count: data.invoices.length },
      ]} />
      <div className="flex flex-wrap gap-2 mb-3">
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="input !w-auto" aria-label="Company">
          <option value="">All companies</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="relative block w-60"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Invoice number or company" /></label>
      </div>

      {list.length ? (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-body min-w-[900px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Invoice', 'Company', 'Period', 'Total', 'Paid', 'Still due', 'Due date', 'Status', 'Sent'].map((h, i) => <th key={h} className={`${th} ${i >= 3 && i <= 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} onClick={() => setOpen(i.id)} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                    <td className={`${td} font-medium whitespace-nowrap`}>{i.number}<span className="block text-caption text-fg-muted font-normal">issued {dayLabel(i.issue_date)}</span></td>
                    <td className={td}><Link to={`/trips/companies?c=${i.client_id}`} onClick={(e) => e.stopPropagation()} className="link">{data.clients.find((c) => c.id === i.client_id)?.name ?? '—'}</Link></td>
                    <td className={`${td} whitespace-nowrap`}>{dayLabel(i.period_from)} – {dayLabel(i.period_to, true)}<span className="block text-caption text-fg-muted">{i.trip_count} trips</span></td>
                    <td className={`${td} text-right tabular-nums`}>{rwf(Number(i.total))}</td>
                    <td className={`${td} text-right tabular-nums text-success`}>{Number(i.amount_paid) ? rwf(Number(i.amount_paid)) : '—'}</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{outstandingOf(i) ? rwf(outstandingOf(i)) : '—'}</td>
                    <td className={`${td} whitespace-nowrap ${isOverdue(i) ? 'text-danger font-medium' : ''}`}>{dayLabel(i.due_date, true)}</td>
                    <td className={td}><Label tone={isOverdue(i) ? 'danger' : INVOICE_STATUS[i.status].tone}>{isOverdue(i) ? 'Overdue' : INVOICE_STATUS[i.status].label}</Label></td>
                    <td className={`${td} text-caption text-fg-muted whitespace-nowrap`}>{i.sent_at ? kigaliTime(i.sent_at) : 'Not sent'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager pager={pager} noun="invoices" />
        </>
      ) : <EmptyState icon={Receipt} title={data.invoices.length ? 'Nothing here' : 'No invoices yet'} body={data.invoices.length ? undefined : 'Open a company and choose "New invoice".'} />}

      {inv && <InvoicePanel invoice={inv} client={data.clients.find((c) => c.id === inv.client_id)} payments={data.payments} canBill={canBill} onClose={() => setOpen(null)} onChanged={data.reload} />}
      {settings && <InvoiceSettingsModal settings={data.settings} onClose={() => setSettings(false)} onSaved={data.reload} />}
    </div>
  );
}
