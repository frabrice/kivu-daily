import { useEffect, useState } from 'react';
import { Ban, Download, Mail, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { BusinessClient, BusinessInvoice, INVOICE_STATUS, InvoicePayment, InvoiceSnapshot, PAYMENT_METHODS, dayLabel, isOverdue, loadInvoiceSnapshot, outstandingOf } from '../../lib/business';
import { invoicePdfBlob, downloadBlob } from '../../lib/invoicePdf';
import { kigaliTime, shortAddress } from '../../lib/trips';
import Modal from '../Modal';
import { Label, rwf } from '../../ui/kit';
import { PaymentModal, SendInvoiceModal } from './BusinessModals';

// One invoice: what's on it, its payments, and everything Finance does with it.
export default function InvoicePanel({ invoice, client, payments, canBill, onClose, onChanged }: {
  invoice: BusinessInvoice; client: BusinessClient | undefined; payments: InvoicePayment[]; canBill: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [snap, setSnap] = useState<InvoiceSnapshot | null>(null);
  const [paying, setPaying] = useState(false);
  const [sending, setSending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { loadInvoiceSnapshot(invoice.id).then(setSnap); }, [invoice.id]);
  const st = INVOICE_STATUS[invoice.status];
  const due = outstandingOf(invoice);
  const mine = payments.filter((p) => p.invoice_id === invoice.id);

  const download = async () => {
    if (!snap) return;
    setBusy(true); setError('');
    try { downloadBlob(await invoicePdfBlob(invoice, snap), `${invoice.number}.pdf`); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const doVoid = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('void_business_invoice', { p_invoice: invoice.id, p_reason: reason });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setVoiding(false); onChanged();
  };

  return (
    <Modal open onClose={onClose} title={invoice.number} subtitle={`${client?.name ?? ''} · ${dayLabel(invoice.period_from)} – ${dayLabel(invoice.period_to, true)}`} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Label tone={isOverdue(invoice) ? 'danger' : st.tone}>{isOverdue(invoice) ? 'Overdue' : st.label}</Label>
          {invoice.sent_at ? <Label tone="info">Sent {kigaliTime(invoice.sent_at)}</Label> : invoice.status !== 'void' && <Label>Not sent yet</Label>}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button onClick={download} disabled={!snap || busy} className="btn-secondary disabled:opacity-50"><Download size={14} /> PDF</button>
            {canBill && invoice.status !== 'void' && client && <button onClick={() => setSending(true)} className="btn-secondary"><Mail size={14} /> {invoice.sent_at ? 'Send again' : 'Send'}</button>}
            {canBill && due > 0 && <button onClick={() => setPaying(true)} className="btn-primary"><Wallet size={14} /> Record payment</button>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-inset p-3">
          <div><p className="text-caption text-fg-muted">Trips</p><p className="text-h3 font-semibold">{invoice.trip_count} <span className="text-caption font-normal text-fg-muted">· {Number(invoice.distance_km)} km</span></p></div>
          <div><p className="text-caption text-fg-muted">Fares + VAT {Math.round(Number(invoice.vat_rate) * 100)}%</p><p className="text-small tabular-nums">{rwf(Number(invoice.subtotal))} + {rwf(Number(invoice.vat_amount))}</p></div>
          <div><p className="text-caption text-fg-muted">Total</p><p className="text-h3 font-semibold tabular-nums">{rwf(Number(invoice.total))}</p></div>
          <div><p className="text-caption text-fg-muted">{due > 0 ? `Due ${dayLabel(invoice.due_date)}` : invoice.status === 'void' ? 'Cancelled' : 'Paid'}</p><p className={`text-h3 font-semibold tabular-nums ${due > 0 ? (isOverdue(invoice) ? 'text-danger' : 'text-accent-fg') : 'text-success'}`}>{rwf(due)}</p></div>
        </div>

        {mine.length > 0 && (
          <section>
            <h3 className="text-body font-semibold mb-1.5">Payments</h3>
            <ul className="divide-y divide-line-muted rounded-lg border border-line">
              {mine.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-body">
                  <span className="tabular-nums">{dayLabel(p.paid_on, true)}</span>
                  <span className="text-fg-muted">{PAYMENT_METHODS.find((m) => m.key === p.method)?.label ?? p.method}{p.reference ? ` · ${p.reference}` : ''}{p.notes ? ` · ${p.notes}` : ''}</span>
                  <span className="ml-auto tabular-nums font-medium text-success">{rwf(Number(p.amount))}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="text-body font-semibold mb-1.5">Trips on this invoice</h3>
          {snap ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-small min-w-[620px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['When', 'Rider', 'Route', 'Driver', 'Km', 'Fare'].map((h, i) => <th key={h} className={`px-3 py-1.5 font-medium ${i >= 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {snap.lines.map((l) => (
                    <tr key={l.trip_id} className="border-t border-line-muted">
                      <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{kigaliTime(l.date)}</td>
                      <td className="px-3 py-1.5">{l.rider ?? '—'}</td>
                      <td className="px-3 py-1.5 max-w-[240px]"><span className="block truncate">{shortAddress(l.from)} → {shortAddress(l.to)}</span></td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{l.driver ?? '—'} <span className="text-fg-muted font-mono text-caption">{l.plate}</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.km !== null ? Number(l.km).toFixed(1) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{rwf(Number(l.fare ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="h-24 skeleton rounded-card" />}
        </section>

        {invoice.notes && <p className="text-small"><span className="text-fg-muted">Note: </span>{invoice.notes}</p>}
        {invoice.status === 'void' && <p className="text-small text-danger">Cancelled {invoice.voided_at ? kigaliTime(invoice.voided_at) : ''}{invoice.void_reason ? ` — ${invoice.void_reason}` : ''}. Its trips went back to "not invoiced".</p>}

        {canBill && invoice.status === 'issued' && Number(invoice.amount_paid) === 0 && (
          voiding ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-danger/40 p-3">
              <label className="block flex-1 min-w-[220px]"><span className="block text-caption text-fg-muted mb-1">Why cancel it? Its trips go back to "not invoiced".</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Wrong week, re-issued" /></label>
              <button onClick={() => setVoiding(false)} className="btn-ghost">Back</button>
              <button onClick={doVoid} disabled={busy || !reason.trim()} className="btn-danger disabled:opacity-50">Cancel invoice</button>
            </div>
          ) : <button onClick={() => setVoiding(true)} className="btn-ghost text-caption text-fg-muted"><Ban size={13} /> Cancel this invoice</button>
        )}
        {error && <p className="text-caption text-danger">{error}</p>}
      </div>
      {paying && <PaymentModal invoice={invoice} onClose={() => setPaying(false)} onSaved={onChanged} />}
      {sending && client && <SendInvoiceModal invoice={invoice} client={client} onClose={() => setSending(false)} onSent={onChanged} />}
    </Modal>
  );
}
