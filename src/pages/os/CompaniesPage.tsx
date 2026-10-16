import { ReactNode, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, Building2, CalendarRange, History, CircleDollarSign, Download, FileText, Hourglass, LayoutGrid, Pencil, Plus, Receipt, Route, Search, Trash2, Users, Wallet,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  BILLING_LABEL, BusinessClient, ClientTrip, INVOICE_STATUS, LOG_ACTION, billingOf, clientStats, dayLabel, isOverdue, lastWeek, outstandingOf, statementOf, thisMonth, thisWeek, todayK, useBusinessData,
} from '../../lib/business';
import { statementPdfBlob, downloadBlob } from '../../lib/invoicePdf';
import { kigaliTime, shortAddress } from '../../lib/trips';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { EntityLink } from '../../os/EntityLink';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs, rwf } from '../../ui/kit';
import { Pager, usePaged } from '../../ui/Pager';
import { ChartCard, DailyBars, RangeTabs, usePalette } from '../../components/charts/kit';
import { AddTripsModal, CompanyFormModal, NewInvoiceModal, RidersEditor, VerifyTripsModal } from '../../components/business/BusinessModals';
import InvoicePanel from '../../components/business/InvoicePanel';

// Companies that ride with Kivu Ride and are invoiced for their trips:
// the list, and one company's workspace (analytics, trips, invoices,
// statement, riders) at /trips/companies?c=<id>.

const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';

export default function CompaniesPage() {
  usePageTitle('Companies');
  const a = useAccess();
  const canBill = a.in('finance');
  const canTag = a.in('finance', 'call_center') || a.duties.has('company_trips');
  const data = useBusinessData();
  const [verifying, setVerifying] = useState(false);
  const pendingAll = data.clientTrips.filter((x) => x.status === 'pending' && !x.invoice_id);
  const [params, setParams] = useSearchParams();
  const open = params.get('c');
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const week = thisWeek(), month = thisMonth();

  const rows = useMemo(() => data.clients.map((c) => {
    const mine = data.clientTrips.filter((x) => x.client_id === c.id);
    const unbilled = mine.filter((x) => billingOf(x, data.invoices) === 'unbilled');
    const invs = data.invoices.filter((i) => i.client_id === c.id);
    return {
      c,
      weekTrips: clientStats(mine, week.from, week.to).trips,
      monthAmount: clientStats(mine, month.from, month.to).amount,
      pending: mine.filter((x) => x.status === 'pending' && !x.invoice_id).length,
      unbilled: unbilled.length, unbilledAmount: unbilled.reduce((s, x) => s + Number(x.trip?.total_fare ?? 0), 0),
      outstanding: invs.reduce((s, i) => s + outstandingOf(i), 0), overdue: invs.filter(isOverdue).length,
      last: invs.filter((i) => i.status !== 'void')[0] ?? null,
    };
  }), [data.clients, data.clientTrips, data.invoices, week.from, week.to, month.from, month.to]);

  if (data.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
  const client = open ? data.clients.find((c) => c.id === open) : null;
  if (open && client) return <CompanyWorkspace client={client} data={data} canBill={canBill} canTag={canTag} onBack={() => setParams({})} />;

  const shown = rows.filter((r) => !q.trim() || r.c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const totals = rows.reduce((s, r) => ({ week: s.week + r.weekTrips, unbilled: s.unbilled + r.unbilledAmount, outstanding: s.outstanding + r.outstanding, overdue: s.overdue + r.overdue }), { week: 0, unbilled: 0, outstanding: 0, overdue: 0 });

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Building2} title="Companies" subtitle="Companies whose people ride with Kivu Ride and are invoiced weekly for their trips."
        actions={<>
          {canBill && pendingAll.length > 0 && <button onClick={() => setVerifying(true)} className="btn-primary"><BadgeCheck size={14} /> Verify {pendingAll.length} trip{pendingAll.length === 1 ? '' : 's'}</button>}
          {canBill && <button onClick={() => setCreating(true)} className={pendingAll.length ? 'btn-secondary' : 'btn-primary'}><Plus size={14} /> New company</button>}
        </>} />
      <StatGrid cols={5}>
        <StatCard icon={Building2} label="Companies" value={rows.filter((r) => r.c.status === 'active').length} sub={`${rows.length} in total`} />
        <StatCard icon={BadgeCheck} label="Waiting for verification" value={pendingAll.length} tone={pendingAll.length ? 'attention' : undefined} sub={canBill ? (pendingAll.length ? 'Check and verify them' : 'All verified') : 'Finance or the MD verifies'} onClick={canBill && pendingAll.length ? () => setVerifying(true) : undefined} />
        <StatCard icon={Route} label="Their trips this week" value={totals.week} sub={`${dayLabel(week.from)} – ${dayLabel(week.to)}`} />
        <StatCard icon={Hourglass} label="Verified, not invoiced" value={rwf(totals.unbilled)} tone={totals.unbilled ? 'attention' : undefined} sub="Completed trips, before VAT" />
        <StatCard icon={Wallet} label="Unpaid invoices" value={rwf(totals.outstanding)} tone={totals.overdue ? 'danger' : totals.outstanding ? 'attention' : undefined} sub={totals.overdue ? `${totals.overdue} overdue` : 'Nothing overdue'} />
      </StatGrid>
      {rows.length ? (
        <>
          <label className="relative block max-w-xs mb-3"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search companies" /></label>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-body min-w-[860px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Company', 'To verify', 'Trips this week', 'This month', 'Not invoiced', 'Unpaid', 'Last invoice', ''].map((h, i) => <th key={h + i} className={`${th} ${i >= 1 && i <= 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.c.id} onClick={() => setParams({ c: r.c.id })} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                    <td className={td}><span className="font-medium">{r.c.name}</span><span className="block text-caption text-fg-muted">{r.c.contact_name ?? r.c.billing_emails[0] ?? r.c.agreement ?? ''}</span></td>
                    <td className={`${td} text-right tabular-nums`}>{r.pending ? <span className="text-attention font-medium">{r.pending}</span> : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.weekTrips}</td>
                    <td className={`${td} text-right tabular-nums`}>{rwf(r.monthAmount)}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.unbilled ? <span className="text-attention">{r.unbilled} · {rwf(r.unbilledAmount)}</span> : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.outstanding ? <span className={r.overdue ? 'text-danger font-medium' : ''}>{rwf(r.outstanding)}</span> : '—'}</td>
                    <td className={`${td} text-caption`}>{r.last ? <>{r.last.number} · {dayLabel(r.last.issue_date)}</> : <span className="text-fg-subtle">None yet</span>}</td>
                    <td className={td}>{r.c.status !== 'active' && <Label>{r.c.status === 'paused' ? 'Paused' : 'Ended'}</Label>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <EmptyState icon={Building2} title="No companies yet" body={canBill ? 'Create the first company, then add its trips from Trips or from the company page.' : 'Finance or the MD adds companies here.'} action={canBill && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> New company</button>} />}
      {creating && <CompanyFormModal client={null} onClose={() => setCreating(false)} onSaved={(id) => { data.reload(); setParams({ c: id }); }} />}
      {verifying && <VerifyTripsModal items={pendingAll} clients={data.clients} nameOf={data.nameOf} onClose={() => setVerifying(false)} onDone={data.reload} />}
    </div>
  );
}

type Tab = 'overview' | 'trips' | 'invoices' | 'statement' | 'activity' | 'details';
type Period = 'this_week' | 'last_week' | 'this_month' | 'custom';

function CompanyWorkspace({ client, data, canBill, canTag, onBack }: { client: BusinessClient; data: ReturnType<typeof useBusinessData>; canBill: boolean; canTag: boolean; onBack: () => void }) {
  usePageTitle(client.name);
  const c = usePalette();
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>('this_week');
  const [custom, setCustom] = useState(lastWeek());
  const range = period === 'this_week' ? thisWeek() : period === 'last_week' ? lastWeek() : period === 'this_month' ? thisMonth() : custom;
  const [adding, setAdding] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'unbilled' | 'invoiced' | 'paid' | 'live'>('all');
  const [verifying, setVerifying] = useState(false);
  const [q, setQ] = useState('');

  const mine = useMemo(() => data.clientTrips.filter((x) => x.client_id === client.id), [data.clientTrips, client.id]);
  const invoices = data.invoices.filter((i) => i.client_id === client.id);
  const payments = data.payments.filter((p) => invoices.some((i) => i.id === p.invoice_id));
  const riders = data.riders.filter((r) => r.client_id === client.id);
  const stats = useMemo(() => clientStats(mine, range.from, range.to), [mine, range.from, range.to]);
  const pending = mine.filter((x) => x.status === 'pending' && !x.invoice_id);
  const unbilled = mine.filter((x) => billingOf(x, data.invoices) === 'unbilled');
  const unbilledAmount = unbilled.reduce((s, x) => s + Number(x.trip?.total_fare ?? 0), 0);
  const outstanding = invoices.reduce((s, i) => s + outstandingOf(i), 0);
  const statement = useMemo(() => statementOf(invoices, payments), [invoices, payments]);
  const tagged = useMemo(() => new Set(data.clientTrips.map((x) => x.trip_id)), [data.clientTrips]);
  const vat = Number(data.settings?.vat_rate ?? 0.18);

  const tripRows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return mine
      .filter((x) => filter === 'all' || billingOf(x, data.invoices) === filter)
      .filter((x) => !n || [x.trip?.rider_name, x.trip?.driver_name, x.trip?.vehicle_plate, x.trip?.pickup_address, x.trip?.destination_address, String(x.trip_id)].join(' ').toLowerCase().includes(n))
      .sort((a, b) => (b.trip?.started_at ?? b.trip?.created_at ?? '').localeCompare(a.trip?.started_at ?? a.trip?.created_at ?? ''));
  }, [mine, filter, q, data.invoices]);
  const pagedTrips = usePaged(tripRows, { key: 'company-trips', reset: `${filter}${q}` });
  const pagedInvoices = usePaged(invoices, { key: 'company-invoices' });

  const remove = async (x: ClientTrip) => { await supabase.from('business_client_trips').delete().eq('trip_id', x.trip_id); data.reload(); };
  const downloadStatement = async () => {
    if (!data.settings) return;
    downloadBlob(await statementPdfBlob(client, data.settings, statement, { trips: unbilled.length, amount: unbilledAmount }), `Statement - ${client.name} - ${todayK()}.pdf`);
  };
  const inv = openInvoice ? data.invoices.find((i) => i.id === openInvoice) : null;
  const table = (head: string[], right: number[], body: ReactNode) => (
    <div className="overflow-x-auto"><table className="w-full text-small"><thead><tr className="text-caption text-fg-muted text-left">{head.map((h, i) => <th key={h} className={`py-1.5 pr-3 font-medium ${right.includes(i) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead><tbody>{body}</tbody></table></div>
  );

  return (
    <div className="animate-fade-in">
      <button onClick={onBack} className="text-caption text-fg-muted hover:text-fg flex items-center gap-1 mb-2"><ArrowLeft size={12} /> All companies</button>
      <PageHeader icon={Building2} title={client.name}
        subtitle={[client.legal_name && client.legal_name !== client.name ? client.legal_name : null, client.tin ? `TIN ${client.tin}` : null, client.agreement].filter(Boolean).join(' · ') || undefined}
        labels={client.status !== 'active' ? <Label>{client.status === 'paused' ? 'Paused' : 'Ended'}</Label> : undefined}
        actions={<>
          {canTag && <button onClick={() => setAdding(true)} className="btn-secondary"><Plus size={14} /> Add trips</button>}
          {canBill && pending.length > 0 && <button onClick={() => setVerifying(true)} className="btn-secondary"><BadgeCheck size={14} /> Verify {pending.length}</button>}
          {canBill && <button onClick={() => setInvoicing(true)} className="btn-primary"><Receipt size={14} /> New invoice</button>}
          {canBill && <button onClick={() => setEditing(true)} className="btn-ghost" aria-label="Edit company"><Pencil size={14} /></button>}
        </>} />

      <StatGrid cols={4}>
        <StatCard icon={BadgeCheck} label="Waiting for verification" value={pending.length} tone={pending.length ? 'attention' : undefined} sub={pending.length ? `${rwf(pending.reduce((s, x) => s + Number(x.trip?.total_fare ?? 0), 0))} · ${canBill ? 'verify to invoice' : 'Finance or the MD verifies'}` : 'All trips verified'} onClick={() => { if (canBill && pending.length) setVerifying(true); else { setTab('trips'); setFilter('pending'); } }} />
        <StatCard icon={Hourglass} label="Verified, not invoiced" value={rwf(unbilledAmount)} tone={unbilledAmount ? 'attention' : undefined} sub={`${unbilled.length} completed trip${unbilled.length === 1 ? '' : 's'} · ${rwf(Math.round(unbilledAmount * (1 + vat)))} with VAT`} onClick={() => { setTab('trips'); setFilter('unbilled'); }} />
        <StatCard icon={Wallet} label="Unpaid invoices" value={rwf(outstanding)} tone={invoices.some(isOverdue) ? 'danger' : outstanding ? 'attention' : 'success'} sub={invoices.some(isOverdue) ? `${invoices.filter(isOverdue).length} overdue` : outstanding ? 'Nothing overdue' : 'All paid'} onClick={() => setTab('invoices')} />
        <StatCard icon={CircleDollarSign} label="Paid to date" value={rwf(payments.reduce((s, p) => s + Number(p.amount), 0))} sub={`${invoices.filter((i) => i.status !== 'void').length} invoice${invoices.length === 1 ? '' : 's'}`} onClick={() => setTab('statement')} />
      </StatGrid>

      <UnderlineTabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview', icon: LayoutGrid },
        { key: 'trips', label: 'Trips', icon: Route, count: mine.length },
        { key: 'invoices', label: 'Invoices', icon: Receipt, count: invoices.length },
        { key: 'statement', label: 'Statement', icon: FileText },
        { key: 'activity', label: 'Activity', icon: History },
        { key: 'details', label: 'Details & riders', icon: Users },
      ]} />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <RangeTabs<Period> value={period} onChange={setPeriod} options={[{ v: 'this_week', label: 'This week' }, { v: 'last_week', label: 'Last week' }, { v: 'this_month', label: 'This month' }, { v: 'custom', label: 'Dates' }]} />
            {period === 'custom' && <>
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((x) => ({ ...x, from: e.target.value }))} className="input !w-auto" aria-label="From" />
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((x) => ({ ...x, to: e.target.value }))} className="input !w-auto" aria-label="To" />
            </>}
            <span className="text-caption text-fg-muted flex items-center gap-1"><CalendarRange size={12} /> {dayLabel(range.from)} – {dayLabel(range.to, true)} · completed trips</span>
          </div>
          <StatGrid cols={5}>
            <StatCard label="Trips" value={stats.trips} sub={`${stats.byDay.filter((d) => d.trips).length} days with trips`} />
            <StatCard label="Fares" value={rwf(stats.amount)} sub={`${rwf(Math.round(stats.amount * (1 + vat)))} with VAT`} />
            <StatCard label="Distance" value={`${Math.round(stats.km).toLocaleString()} km`} sub={`${Math.round(stats.minutes / 60)} h on the road`} />
            <StatCard label="Average fare" value={rwf(stats.avgFare)} sub={stats.trips ? `${(stats.km / stats.trips).toFixed(1)} km a trip` : '—'} />
            <StatCard label="Waiting & extras" value={rwf(stats.waitingFees + stats.extras)} sub={`${rwf(stats.waitingFees)} waiting · ${rwf(stats.extras)} extras`} />
          </StatGrid>
          <ChartCard title="Trips per day" subtitle="Bars show the fares of each day"
            table={table(['Day', 'Trips', 'Fares'], [1, 2], stats.byDay.map((d) => <tr key={d.day} className="border-t border-line-muted"><td className="py-1.5 pr-3">{dayLabel(d.day)}</td><td className="py-1.5 pr-3 text-right">{d.trips}</td><td className="py-1.5 pr-3 text-right">{rwf(d.amount)}</td></tr>))}>
            <DailyBars data={stats.byDay as unknown as Record<string, number | string>[]} series={[{ key: 'amount', label: 'Fares', color: c.blue }]} c={c} height={220} format={(n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))} />
          </ChartCard>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Box title="By driver" icon={Users}>{stats.byDriver.length ? table(['Driver', 'Trips', 'Fares'], [1, 2], stats.byDriver.map((d) => <tr key={d.name} className="border-t border-line-muted"><td className="py-1.5 pr-3">{d.name}</td><td className="py-1.5 pr-3 text-right">{d.trips}</td><td className="py-1.5 pr-3 text-right tabular-nums">{rwf(d.amount)}</td></tr>)) : <p className="text-small text-fg-muted">No trips in this period.</p>}</Box>
            <Box title="By rider" icon={Users}>{stats.riders.length ? table(['Rider', 'Trips', 'Fares'], [1, 2], stats.riders.map((d) => <tr key={d.name} className="border-t border-line-muted"><td className="py-1.5 pr-3">{d.name}</td><td className="py-1.5 pr-3 text-right">{d.trips}</td><td className="py-1.5 pr-3 text-right tabular-nums">{rwf(d.amount)}</td></tr>)) : <p className="text-small text-fg-muted">No trips in this period.</p>}</Box>
            <Box title="Most frequent routes" icon={Route}>{stats.routes.length ? table(['Route', 'Trips', 'Fares'], [1, 2], stats.routes.map((d) => <tr key={d.route} className="border-t border-line-muted"><td className="py-1.5 pr-3 max-w-[220px]"><span className="block truncate" title={d.route}>{d.route}</span></td><td className="py-1.5 pr-3 text-right">{d.trips}</td><td className="py-1.5 pr-3 text-right tabular-nums">{rwf(d.amount)}</td></tr>)) : <p className="text-small text-fg-muted">No trips in this period.</p>}</Box>
          </div>
        </div>
      )}

      {tab === 'trips' && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(['all', 'pending', 'unbilled', 'invoiced', 'paid', 'live'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`px-2.5 py-1.5 rounded-md text-caption border ${filter === k ? 'border-accent bg-accent/10' : 'border-line text-fg-muted'}`}>
                {k === 'all' ? 'All' : BILLING_LABEL[k].label} ({k === 'all' ? mine.length : mine.filter((x) => billingOf(x, data.invoices) === k).length})
              </button>
            ))}
            <label className="relative block ml-auto w-60"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Rider, driver, place, #trip" /></label>
          </div>
          {tripRows.length ? (
            <>
              <div className="card overflow-x-auto p-0">
                <table className="w-full text-body min-w-[900px]">
                  <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['When', 'Rider', 'Route', 'Driver & car', 'Km', 'Fare', 'Status', 'Added by', ''].map((h, i) => <th key={h + i} className={`${th} ${i === 4 || i === 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {pagedTrips.rows.map((x) => {
                      const t = x.trip;
                      const b = billingOf(x, data.invoices);
                      const invOf = x.invoice_id ? data.invoices.find((i) => i.id === x.invoice_id) : null;
                      return (
                        <tr key={x.trip_id} className="border-t border-line-muted">
                          <td className={`${td} whitespace-nowrap`}>{t ? kigaliTime(t.started_at ?? t.created_at) : '—'}<span className="block font-mono text-caption text-fg-muted">#{x.trip_id}</span></td>
                          <td className={td}>{t?.rider_name ?? '—'}</td>
                          <td className={`${td} max-w-[260px]`}><span className="block truncate">{shortAddress(t?.pickup_address)}</span><span className="block truncate text-fg-muted">→ {shortAddress(t?.destination_address)}</span></td>
                          <td className={td}>{t?.kivu_driver_id ? <EntityLink type="driver" id={t.kivu_driver_id} label={t.driver_name ?? ''} /> : t?.driver_name ?? '—'}<span className="block font-mono text-caption text-fg-muted">{t?.vehicle_plate}</span></td>
                          <td className={`${td} text-right tabular-nums`}>{t ? Number(t.actual_distance_km ?? t.estimated_distance_km ?? 0).toFixed(1) : '—'}</td>
                          <td className={`${td} text-right tabular-nums font-medium`}>{t?.total_fare !== null && t?.total_fare !== undefined ? rwf(Number(t.total_fare)) : '—'}</td>
                          <td className={td}>
                            {invOf ? <button onClick={() => setOpenInvoice(invOf.id)}><Label tone={BILLING_LABEL[b].tone}>{BILLING_LABEL[b].label} · {invOf.number}</Label></button> : <Label tone={BILLING_LABEL[b].tone}>{BILLING_LABEL[b].label}</Label>}
                            {x.verified_by && <span className="block text-caption text-fg-muted mt-0.5">Verified by {data.nameOf(x.verified_by)}</span>}
                          </td>
                          <td className={`${td} text-caption`}><span className="block font-medium text-fg">{data.nameOf(x.added_by)}</span><span className="text-fg-muted">{kigaliTime(x.added_at)}</span></td>
                          <td className={`${td} text-right`}>{!x.invoice_id && (canBill || (canTag && x.status === 'pending')) && <button onClick={() => remove(x)} className="btn-ghost p-1.5 text-fg-subtle hover:text-danger" aria-label="Take off this company" title="Take off this company"><Trash2 size={14} /></button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager pager={pagedTrips.pager} noun="trips" />
            </>
          ) : <EmptyState icon={Route} title={mine.length ? 'No trip matches' : 'No trips yet'} body={mine.length ? undefined : `Add ${client.name}'s trips here, or tick them on the Trips page and choose "Add to company".`} action={canTag && !mine.length && <button onClick={() => setAdding(true)} className="btn-primary"><Plus size={14} /> Add trips</button>} />}
        </div>
      )}

      {tab === 'invoices' && (
        invoices.length ? (
          <>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-body min-w-[820px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Invoice', 'Period', 'Trips', 'Total', 'Paid', 'Due', 'Status', 'Sent'].map((h, i) => <th key={h} className={`${th} ${i >= 2 && i <= 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {pagedInvoices.rows.map((i) => (
                    <tr key={i.id} onClick={() => setOpenInvoice(i.id)} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                      <td className={`${td} font-medium`}>{i.number}<span className="block text-caption text-fg-muted">issued {dayLabel(i.issue_date)}</span></td>
                      <td className={td}>{dayLabel(i.period_from)} – {dayLabel(i.period_to, true)}</td>
                      <td className={`${td} text-right`}>{i.trip_count}</td>
                      <td className={`${td} text-right tabular-nums font-medium`}>{rwf(Number(i.total))}</td>
                      <td className={`${td} text-right tabular-nums`}>{Number(i.amount_paid) ? rwf(Number(i.amount_paid)) : '—'}</td>
                      <td className={`${td} whitespace-nowrap`}>{dayLabel(i.due_date)}</td>
                      <td className={td}><Label tone={isOverdue(i) ? 'danger' : INVOICE_STATUS[i.status].tone}>{isOverdue(i) ? 'Overdue' : INVOICE_STATUS[i.status].label}</Label></td>
                      <td className={`${td} text-caption text-fg-muted`}>{i.sent_at ? kigaliTime(i.sent_at) : 'Not sent'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager pager={pagedInvoices.pager} noun="invoices" />
          </>
        ) : <EmptyState icon={Receipt} title="No invoices yet" body={unbilled.length ? `${unbilled.length} completed trips are waiting to be invoiced.` : 'Add trips first, then issue an invoice.'} action={canBill && unbilled.length > 0 && <button onClick={() => setInvoicing(true)} className="btn-primary"><Receipt size={14} /> New invoice</button>} />
      )}

      {tab === 'statement' && (
        <Box title="Statement of account" icon={FileText} padded={false} right={canBill && <button onClick={downloadStatement} className="btn-secondary text-caption"><Download size={13} /> PDF</button>}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-line-muted">
            <div><p className="text-caption text-fg-muted">Invoiced</p><p className="text-h3 font-semibold tabular-nums">{rwf(invoices.filter((i) => i.status !== 'void').reduce((s, i) => s + Number(i.total), 0))}</p></div>
            <div><p className="text-caption text-fg-muted">Paid</p><p className="text-h3 font-semibold tabular-nums text-success">{rwf(payments.reduce((s, p) => s + Number(p.amount), 0))}</p></div>
            <div><p className="text-caption text-fg-muted">Balance due</p><p className={`text-h3 font-semibold tabular-nums ${outstanding ? 'text-accent-fg' : ''}`}>{rwf(outstanding)}</p></div>
            <div><p className="text-caption text-fg-muted">Not invoiced yet</p><p className="text-h3 font-semibold tabular-nums text-attention">{rwf(unbilledAmount)}</p><p className="text-caption text-fg-muted">{unbilled.length} trips, before VAT</p></div>
          </div>
          {statement.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-body min-w-[680px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Date', 'Reference', 'Details', 'Charges', 'Payments', 'Balance'].map((h, i) => <th key={h} className={`${th} ${i >= 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {statement.map((r, i) => (
                    <tr key={i} className="border-t border-line-muted">
                      <td className={`${td} whitespace-nowrap`}>{dayLabel(r.date, true)}</td>
                      <td className={`${td} font-medium`}>{r.ref}</td>
                      <td className={`${td} ${r.kind === 'void' ? 'text-fg-muted' : ''}`}>{r.detail}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.debit ? rwf(r.debit) : ''}</td>
                      <td className={`${td} text-right tabular-nums text-success`}>{r.credit ? rwf(r.credit) : ''}</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{rwf(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="p-6 text-center text-body text-fg-muted">No invoices or payments yet.</p>}
        </Box>
      )}

      {tab === 'activity' && (
        <Box title="Who did what" icon={History} padded={false}>
          {(() => {
            const entries = data.log.filter((l) => l.client_id === client.id);
            return entries.length ? (
              <ul className="divide-y divide-line-muted">
                {entries.slice(0, 300).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-body">
                    <span className="tabular-nums text-caption text-fg-muted w-28">{kigaliTime(l.at)}</span>
                    <b>{data.nameOf(l.actor)}</b>
                    <span className={l.action === 'rejected' || l.action === 'removed' ? 'text-danger' : l.action === 'verified' ? 'text-success' : ''}>{LOG_ACTION[l.action]}</span>
                    <span className="font-mono text-caption">trip #{l.trip_id}</span>
                    {l.note && <span className="text-caption text-fg-muted">· {l.note}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="p-6 text-center text-body text-fg-muted">Nothing yet.</p>;
          })()}
        </Box>
      )}

      {tab === 'details' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Box title="Company" icon={Building2} right={canBill && <button onClick={() => setEditing(true)} className="btn-ghost text-caption"><Pencil size={13} /> Edit</button>}>
            <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-small">
              {([['Registered name', client.legal_name], ['TIN', client.tin], ['Contact', [client.contact_name, client.contact_phone].filter(Boolean).join(' · ')], ['Billing emails', client.billing_emails.join(', ')], ['Address', client.address],
                ['Invoiced every', client.billing_cycle === 'weekly' ? 'Week (Monday–Sunday)' : 'Month'], ['Pays within', `${client.payment_terms_days} days`], ['Agreement', client.agreement], ['Notes', client.notes]] as [string, string | null][]).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-fg-muted">{k}</dt><dd>{v || <span className="text-fg-subtle">—</span>}</dd></div>
              ))}
            </dl>
            {!client.billing_emails.length && <p className="mt-2 text-caption text-attention">Add a billing email so invoices can be sent from here.</p>}
          </Box>
          <Box title="Their riders" icon={Users}><RidersEditor client={client} riders={riders} canEdit={canTag} onChanged={data.reload} /></Box>
        </div>
      )}

      {adding && <AddTripsModal client={client} riders={riders} tagged={tagged} canBill={canBill} onClose={() => setAdding(false)} onSaved={data.reload} />}
      {verifying && <VerifyTripsModal items={pending} clients={data.clients} nameOf={data.nameOf} onClose={() => setVerifying(false)} onDone={data.reload} />}
      {invoicing && <NewInvoiceModal client={client} clientTrips={mine} settings={data.settings} onClose={() => setInvoicing(false)} onIssued={(id) => { setInvoicing(false); data.reload(); setTab('invoices'); setOpenInvoice(id); }} />}
      {editing && <CompanyFormModal client={client} onClose={() => setEditing(false)} onSaved={data.reload} />}
      {inv && <InvoicePanel invoice={inv} client={client} payments={data.payments} canBill={canBill} onClose={() => setOpenInvoice(null)} onChanged={data.reload} />}
    </div>
  );
}

