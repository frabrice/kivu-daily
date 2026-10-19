import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import Modal from '../Modal';
import { useAuth } from '../../lib/auth';
import { BusinessClient, BusinessInvoice, ClientTrip, InvoiceSettings, addDaysK, billingOf, mondayOfK, todayK } from '../../lib/business';
import { downloadBlob, reportPdfBlob } from '../../lib/invoicePdf';
import { shortAddress } from '../../lib/trips';

// The report (a pre-invoice) for one company: the trips so far in a period
// the person chooses - by default this week, Monday 00:00 until now. Trips
// already paid are left out; the rest can be put in order and unticked
// before exporting. Same look as the invoice, without VAT.

type Order = 'oldest' | 'newest' | 'rider' | 'driver';
const ORDERS: { key: Order; label: string }[] = [
  { key: 'oldest', label: 'Oldest first' }, { key: 'newest', label: 'Newest first' }, { key: 'rider', label: 'By rider' }, { key: 'driver', label: 'By driver' },
];
const nowTimeK = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' });
const isoK = (d: string, t: string) => new Date(`${d}T${t || '00:00'}:00+02:00`).toISOString();
const whenK = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const startOf = (x: ClientTrip) => x.trip?.started_at ?? x.trip?.created_at ?? '';
const ms = (iso: string) => (iso ? Date.parse(iso) : 0);

export default function ReportModal({ client, trips, invoices, settings, onClose }: {
  client: BusinessClient; trips: ClientTrip[]; invoices: BusinessInvoice[]; settings: InvoiceSettings | null; onClose: () => void;
}) {
  const { profile } = useAuth();
  const today = todayK();
  const [p, setP] = useState({ fromDay: mondayOfK(today), fromTime: '00:00', toDay: today, toTime: nowTimeK() });
  const [order, setOrder] = useState<Order>('oldest');
  const [out, setOut] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const from = isoK(p.fromDay, p.fromTime), to = isoK(p.toDay, p.toTime);
  const preset = (k: 'week' | 'last' | 'today') => {
    const mon = mondayOfK(today);
    setP(k === 'week' ? { fromDay: mon, fromTime: '00:00', toDay: today, toTime: nowTimeK() }
      : k === 'last' ? { fromDay: addDaysK(mon, -7), fromTime: '00:00', toDay: addDaysK(mon, -1), toTime: '23:59' }
      : { fromDay: today, fromTime: '00:00', toDay: today, toTime: nowTimeK() });
  };

  // Completed trips of this company in the period; the paid ones are left out.
  const { rows, paid } = useMemo(() => {
    const f = ms(from), e = ms(to);
    const inPeriod = trips.filter((x) => x.trip?.status === 'completed' && ms(startOf(x)) >= f && ms(startOf(x)) <= e);
    const paid = inPeriod.filter((x) => billingOf(x, invoices) === 'paid');
    const rows = inPeriod.filter((x) => billingOf(x, invoices) !== 'paid');
    const by = (f: (x: ClientTrip) => string) => (a: ClientTrip, b: ClientTrip) => f(a).localeCompare(f(b)) || startOf(a).localeCompare(startOf(b));
    rows.sort(order === 'newest' ? (a, b) => startOf(b).localeCompare(startOf(a)) : order === 'rider' ? by((x) => x.trip?.rider_name ?? '') : order === 'driver' ? by((x) => x.trip?.driver_name ?? '') : by(() => ''));
    return { rows, paid };
  }, [trips, invoices, from, to, order]);
  const chosen = rows.filter((x) => !out.has(x.trip_id));
  const total = chosen.reduce((s, x) => s + Number(x.trip?.total_fare ?? 0), 0);
  const markOf = (x: ClientTrip) => (x.status === 'pending' ? 'to verify' : x.invoice_id ? `on ${invoices.find((i) => i.id === x.invoice_id)?.number ?? 'an invoice'}` : null);
  const toggle = (id: number) => setOut((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const exportPdf = async () => {
    if (!settings) { setError('The company details for documents could not be loaded. Ask Finance.'); return; }
    if (ms(to) <= ms(from)) { setError('The end is before the start.'); return; }
    setBusy(true); setError('');
    try {
      const marks = new Map<number, string>();
      for (const x of chosen) { const m = markOf(x); if (m) marks.set(x.trip_id, m); }
      const blob = await reportPdfBlob({
        client, issuer: settings, from, to, preparedBy: profile?.full_name?.trim() ?? null, notes: notes.trim() || null, marks, leftOutPaid: paid.length,
        lines: chosen.map((x) => {
          const t = x.trip!;
          return {
            trip_id: t.id, date: t.started_at ?? t.created_at ?? '', completed_at: t.completed_at, rider: t.rider_name, rider_phone: t.rider_phone,
            from: t.pickup_address, to: t.destination_address, driver: t.driver_name, plate: t.vehicle_plate, vehicle_type: t.vehicle_type,
            km: t.actual_distance_km ?? t.estimated_distance_km, minutes: t.actual_duration_minutes ?? t.estimated_duration_minutes,
            waiting_minutes: t.waiting_minutes, waiting_fee: t.waiting_fee, extras: t.extras_total, extra_items: [], fare: Number(t.total_fare ?? 0),
          };
        }),
      });
      downloadBlob(blob, `Report - ${client.name} - ${p.fromDay} to ${p.toDay}.pdf`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Report — ${client.name}`} subtitle="The trips so far, like the invoice but without VAT. Trips already paid are left out." maxWidth="max-w-3xl">
      <div className="space-y-4">
        <section>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button onClick={() => preset('week')} className="btn-secondary h-7 text-caption">This week so far</button>
            <button onClick={() => preset('today')} className="btn-secondary h-7 text-caption">Today</button>
            <button onClick={() => preset('last')} className="btn-secondary h-7 text-caption">Last week</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="block"><span className="text-caption text-fg-muted">From (day)</span><input type="date" value={p.fromDay} max={p.toDay} onChange={(e) => setP({ ...p, fromDay: e.target.value })} className="input" /></label>
            <label className="block"><span className="text-caption text-fg-muted">From (time)</span><input type="time" value={p.fromTime} onChange={(e) => setP({ ...p, fromTime: e.target.value })} className="input" /></label>
            <label className="block"><span className="text-caption text-fg-muted">To (day)</span><input type="date" value={p.toDay} min={p.fromDay} onChange={(e) => setP({ ...p, toDay: e.target.value })} className="input" /></label>
            <label className="block"><span className="text-caption text-fg-muted">To (time)</span><input type="time" value={p.toTime} onChange={(e) => setP({ ...p, toTime: e.target.value })} className="input" /></label>
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <p className="text-small flex-1"><b>{chosen.length}</b> trip{chosen.length === 1 ? '' : 's'} · <b>{rwf(total)}</b> before VAT{out.size ? <span className="text-fg-muted"> · {out.size} left out by you</span> : null}{paid.length ? <span className="text-fg-muted"> · {paid.length} already paid, not listed</span> : null}</p>
            <select value={order} onChange={(e) => setOrder(e.target.value as Order)} className="input !w-auto !py-1 text-small" aria-label="Order">{ORDERS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
          </div>
          {rows.length ? (
            <div className="max-h-[320px] overflow-y-auto rounded-md border border-line-muted divide-y divide-line-muted">
              {rows.map((x) => {
                const t = x.trip!; const m = markOf(x); const on = !out.has(x.trip_id);
                return (
                  <label key={x.trip_id} className={`flex items-center gap-3 px-3 py-2 text-small cursor-pointer hover:bg-hover ${on ? '' : 'opacity-50'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(x.trip_id)} />
                    <span className="w-32 shrink-0 tabular-nums text-fg-muted">{whenK(startOf(x))}</span>
                    <span className="flex-1 min-w-0 truncate"><b>{t.rider_name ?? '—'}</b> · {shortAddress(t.pickup_address)} → {shortAddress(t.destination_address)}<span className="text-caption text-fg-muted"> · {t.driver_name ?? '—'}</span>{m && <span className="ml-1 text-caption text-attention">· {m}</span>}</span>
                    <span className="tabular-nums font-medium">{Math.round(Number(t.total_fare ?? 0)).toLocaleString('en-US')}</span>
                  </label>
                );
              })}
            </div>
          ) : <p className="text-small text-fg-muted rounded-md bg-inset px-3 py-2">No completed trip for this company in this period.</p>}
        </section>

        <label className="block"><span className="text-caption text-fg-muted">Note on the report (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" placeholder="e.g. Report for the week so far, the invoice follows on Monday." /></label>
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={exportPdf} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? <FileText size={14} /> : <Download size={14} />} {busy ? 'Making the PDF…' : 'Export PDF'}</button>
        </div>
      </div>
    </Modal>
  );
}
