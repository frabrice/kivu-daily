import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Plus, Search, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PlatformTrip, shortAddress, kigaliTime, statusOf } from '../../lib/trips';
import {
  BusinessClient, ClientRider, ClientTrip, InvoiceSettings, PAYMENT_METHODS, addDaysK, dayLabel, lastWeek, loadInvoiceSnapshot, phoneKey, thisMonth, thisWeek, todayK, tripDay,
  BusinessInvoice,
} from '../../lib/business';
import { invoicePdfBlob } from '../../lib/invoicePdf';
import { fetchAll } from '../../lib/fetchAll';
import Modal from '../Modal';
import { Label, rwf } from '../../ui/kit';
import { Pager, usePaged } from '../../ui/Pager';

const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';
const Err = ({ msg }: { msg: string }) => (msg ? <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{msg}</p> : null);
const Foot = ({ onClose, busy, label, onSave, disabled }: { onClose: () => void; busy: boolean; label: string; onSave: () => void; disabled?: boolean }) => (
  <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
    <button onClick={onClose} className="btn-ghost">Cancel</button>
    <button onClick={onSave} disabled={busy || disabled} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : label}</button>
  </div>
);

// ------------------------------------------------------------ company
export function CompanyFormModal({ client, onClose, onSaved }: { client: BusinessClient | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    name: client?.name ?? '', legal_name: client?.legal_name ?? '', tin: client?.tin ?? '', contact_name: client?.contact_name ?? '', contact_phone: client?.contact_phone ?? '',
    billing_emails: (client?.billing_emails ?? []).join(', '), address: client?.address ?? '', billing_cycle: client?.billing_cycle ?? 'weekly',
    payment_terms_days: String(client?.payment_terms_days ?? 7), agreement: client?.agreement ?? '', notes: client?.notes ?? '', status: client?.status ?? 'active',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    const emails = f.billing_emails.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = emails.filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (!f.name.trim()) { setError('Enter the company name.'); return; }
    if (bad.length) { setError(`Not an email address: ${bad.join(', ')}`); return; }
    setBusy(true); setError('');
    const payload = {
      name: f.name.trim(), legal_name: f.legal_name.trim() || null, tin: f.tin.trim() || null, contact_name: f.contact_name.trim() || null, contact_phone: f.contact_phone.trim() || null,
      billing_emails: emails, address: f.address.trim() || null, billing_cycle: f.billing_cycle, payment_terms_days: Number(f.payment_terms_days) || 0,
      agreement: f.agreement.trim() || null, notes: f.notes.trim() || null, status: f.status, updated_at: new Date().toISOString(),
    };
    const res = client
      ? await supabase.from('business_clients').update(payload).eq('id', client.id).select('id').single()
      : await supabase.from('business_clients').insert(payload).select('id').single();
    setBusy(false);
    if (res.error) { setError(res.error.message.includes('business_clients_name') ? 'A company with this name already exists.' : res.error.message); return; }
    onSaved(res.data.id);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={client ? `Edit ${client.name}` : 'New company'} subtitle="A company whose people ride with Kivu Ride and is invoiced for their trips." maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Name *</span><input value={f.name} onChange={set('name')} className="input" placeholder="e.g. CEVR" autoFocus /></label>
          <label className="block"><span className={lbl}>Registered name (on invoices)</span><input value={f.legal_name} onChange={set('legal_name')} className="input" placeholder="Full legal name" /></label>
          <label className="block"><span className={lbl}>TIN</span><input value={f.tin} onChange={set('tin')} className="input" /></label>
          <label className="block"><span className={lbl}>Address</span><input value={f.address} onChange={set('address')} className="input" placeholder="Kigali" /></label>
          <label className="block"><span className={lbl}>Contact person</span><input value={f.contact_name} onChange={set('contact_name')} className="input" /></label>
          <label className="block"><span className={lbl}>Contact phone</span><input value={f.contact_phone} onChange={set('contact_phone')} className="input" /></label>
        </div>
        <label className="block"><span className={lbl}>Billing emails (invoices are sent here)</span><input value={f.billing_emails} onChange={set('billing_emails')} className="input" placeholder="accounts@company.rw, manager@company.rw" /></label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block"><span className={lbl}>Invoice every</span><select value={f.billing_cycle} onChange={set('billing_cycle')} className="input"><option value="weekly">Week</option><option value="monthly">Month</option></select></label>
          <label className="block"><span className={lbl}>Pay within (days)</span><input type="number" min={0} max={120} value={f.payment_terms_days} onChange={set('payment_terms_days')} className="input" /></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={set('status')} className="input"><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option></select></label>
        </div>
        <label className="block"><span className={lbl}>Agreement</span><textarea value={f.agreement} onChange={set('agreement')} rows={2} className="input resize-none" placeholder="e.g. Two cars every day, billed weekly at the app fare + VAT" /></label>
        <label className="block"><span className={lbl}>Notes</span><textarea value={f.notes} onChange={set('notes')} rows={2} className="input resize-none" /></label>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={client ? 'Save' : 'Create company'} onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ riders (their phones suggest new trips)
export function RidersEditor({ client, riders, canEdit, onChanged }: { client: BusinessClient; riders: ClientRider[]; canEdit: boolean; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const add = async () => {
    if (phoneKey(phone).length < 9) { setError('Enter a full phone number.'); return; }
    const { error: err } = await supabase.from('business_client_riders').insert({ client_id: client.id, name: name.trim() || null, phone: phone.trim() });
    if (err) { setError(err.message.includes('duplicate') ? 'This phone is already on the list.' : err.message); return; }
    setName(''); setPhone(''); setError(''); onChanged();
  };
  const remove = async (id: string) => { await supabase.from('business_client_riders').delete().eq('id', id); onChanged(); };
  return (
    <div className="space-y-2">
      <p className="text-caption text-fg-muted">Trips by these phone numbers (rider app or booked for them) are suggested when adding trips to {client.name}.</p>
      {riders.length ? (
        <ul className="divide-y divide-line-muted rounded-lg border border-line">
          {riders.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-body">
              <span className="flex-1">{r.name ?? '—'}</span><span className="tabular-nums text-fg-muted">{r.phone}</span>
              {canEdit && <button onClick={() => remove(r.id)} className="btn-ghost p-1.5 text-fg-subtle hover:text-danger" aria-label="Remove"><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-small text-fg-subtle">No riders listed yet.</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input flex-1 min-w-[140px]" placeholder="Name" aria-label="Rider name" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input w-44" placeholder="07…" aria-label="Rider phone" />
          <button onClick={add} className="btn-secondary"><UserPlus size={14} /> Add rider</button>
        </div>
      )}
      <Err msg={error} />
    </div>
  );
}

// ------------------------------------------------------------ add trips to a company
const PICK_COLS = 'id, status, created_at, started_at, completed_at, pickup_address, destination_address, rider_name, rider_phone, rider_kind, driver_name, vehicle_plate, total_fare, actual_distance_km, estimated_distance_km, payment_method';
type PickTrip = Pick<PlatformTrip, 'id' | 'status' | 'created_at' | 'started_at' | 'completed_at' | 'pickup_address' | 'destination_address' | 'rider_name' | 'rider_phone' | 'rider_kind' | 'driver_name' | 'vehicle_plate' | 'total_fare' | 'actual_distance_km' | 'estimated_distance_km' | 'payment_method'>;

export function AddTripsModal({ client, riders, tagged, onClose, onSaved }: { client: BusinessClient; riders: ClientRider[]; tagged: Set<number>; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState(addDaysK(todayK(), -13));
  const [to, setTo] = useState(todayK());
  const [trips, setTrips] = useState<PickTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useMemo(() => new Set(riders.map((r) => r.phone_key)), [riders]);

  useEffect(() => {
    setLoading(true);
    fetchAll<PickTrip>(() => supabase.from('platform_trips').select(PICK_COLS).neq('status', 'cancelled')
      .gte('created_at', new Date(`${from}T00:00:00+02:00`).toISOString()).lte('created_at', new Date(`${to}T23:59:59+02:00`).toISOString())
      .order('created_at', { ascending: false }).order('id'))
      .then((r) => { setTrips((r.data ?? []).filter((t) => !tagged.has(t.id))); setLoading(false); });
  }, [from, to, tagged]);

  const suggested = trips.filter((t) => keys.has(phoneKey(t.rider_phone)));
  const n = q.trim().toLowerCase();
  const ids = n.match(/\d{2,}/g)?.map(Number) ?? [];
  const list = trips.filter((t) => !n || ids.includes(t.id) || [t.rider_name, t.rider_phone, t.driver_name, t.vehicle_plate, t.pickup_address, t.destination_address].join(' ').toLowerCase().includes(n));
  const { rows, pager } = usePaged(list, { key: 'add-trips', reset: `${q}${from}${to}` });
  const toggle = (id: number) => setPicked((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const pickedAmount = trips.filter((t) => picked.has(t.id)).reduce((s, t) => s + Number(t.total_fare ?? 0), 0);

  const save = async () => {
    if (!picked.size) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.from('business_client_trips').insert([...picked].map((trip_id) => ({ trip_id, client_id: client.id })));
    setBusy(false);
    if (err) { setError(err.message.includes('duplicate') ? 'One of these trips was just added to a company by someone else — reopen the list.' : err.message); return; }
    onSaved(); onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Add trips to ${client.name}`} subtitle="Trips already on a company aren't listed. Cancelled trips can't be billed." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block"><span className={lbl}>From</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="input !w-auto" /></label>
          <label className="block"><span className={lbl}>To</span><input type="date" value={to} min={from} max={todayK()} onChange={(e) => setTo(e.target.value)} className="input !w-auto" /></label>
          <label className="relative block flex-1 min-w-[200px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Rider, phone, driver, plate, place or trip numbers" aria-label="Search trips" /></label>
        </div>
        {suggested.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2">
            <Sparkles size={14} className="text-accent-fg" /><span className="text-small flex-1">{suggested.length} trip{suggested.length === 1 ? '' : 's'} by {client.name}'s riders in these dates.</span>
            <button onClick={() => setPicked((s) => new Set([...s, ...suggested.map((t) => t.id)]))} className="btn-secondary text-caption"><Check size={13} /> Select them</button>
          </div>
        )}
        {loading ? <div className="h-40 skeleton rounded-card" /> : list.length ? (
          <>
            <ul className="divide-y divide-line-muted rounded-lg border border-line max-h-[52vh] overflow-y-auto">
              {rows.map((t) => {
                const on = picked.has(t.id);
                const st = statusOf(t.status);
                return (
                  <li key={t.id}>
                    <label className={`flex items-start gap-3 px-3 py-2 cursor-pointer ${on ? 'bg-accent/10' : 'hover:bg-hover'}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(t.id)} className="mt-1" />
                      <span className="flex-1 min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2 text-body"><b className="font-mono text-caption">#{t.id}</b>{kigaliTime(t.started_at ?? t.created_at)}<span className="text-fg-muted">· {t.rider_name ?? 'Unknown rider'}</span>
                          {keys.has(phoneKey(t.rider_phone)) && <Label tone="accent">Their rider</Label>}{t.status !== 'completed' && <Label tone={st.tone}>{st.label}</Label>}</span>
                        <span className="block text-caption text-fg-muted truncate">{shortAddress(t.pickup_address)} → {shortAddress(t.destination_address)} · {t.driver_name ?? 'no driver'} {t.vehicle_plate ?? ''}</span>
                      </span>
                      <span className="text-body tabular-nums font-medium whitespace-nowrap">{t.total_fare !== null ? rwf(Number(t.total_fare)) : '—'}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <Pager pager={pager} noun="trips" />
          </>
        ) : <p className="text-body text-fg-muted py-6 text-center">No trips in these dates that aren't already on a company.</p>}
        <Err msg={error} />
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line-muted">
          <span className="text-small text-fg-muted">{picked.size ? `${picked.size} selected · ${rwf(pickedAmount)}` : 'Tick the trips to add'}</span>
          <div className="flex gap-2"><button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={busy || !picked.size} className="btn-primary disabled:opacity-50"><Plus size={14} /> {busy ? 'Adding…' : `Add ${picked.size || ''} trip${picked.size === 1 ? '' : 's'}`}</button></div>
        </div>
      </div>
    </Modal>
  );
}

// From the Trips page: put selected trips on a company.
export function AssignToCompanyModal({ tripIds, clients, onClose, onSaved }: { tripIds: number[]; clients: BusinessClient[]; onClose: () => void; onSaved: () => void }) {
  const active = clients.filter((c) => c.status !== 'ended');
  const [clientId, setClientId] = useState(active[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!clientId) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.from('business_client_trips').insert(tripIds.map((trip_id) => ({ trip_id, client_id: clientId })));
    setBusy(false);
    if (err) { setError(err.message.includes('duplicate') ? 'One of these trips is already on a company.' : err.message); return; }
    onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Add ${tripIds.length} trip${tripIds.length === 1 ? '' : 's'} to a company`} subtitle={tripIds.map((x) => `#${x}`).join(', ')} maxWidth="max-w-md">
      <div className="space-y-3">
        {active.length ? (
          <div className="space-y-1.5">
            {active.map((c) => (
              <label key={c.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${clientId === c.id ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
                <input type="radio" checked={clientId === c.id} onChange={() => setClientId(c.id)} /><Building2 size={14} className="text-fg-subtle" /><span className="text-body">{c.name}</span>
              </label>
            ))}
          </div>
        ) : <p className="text-body text-fg-muted">No company yet — Finance or the MD creates them under Trips → Companies.</p>}
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Add to company" onSave={save} disabled={!clientId} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ issue an invoice
export function NewInvoiceModal({ client, clientTrips, settings, onClose, onIssued }: {
  client: BusinessClient; clientTrips: ClientTrip[]; settings: InvoiceSettings | null; onClose: () => void; onIssued: (id: string) => void;
}) {
  const [period, setPeriod] = useState<'last' | 'this' | 'month' | 'custom'>('last');
  const [custom, setCustom] = useState(lastWeek());
  const range = period === 'last' ? lastWeek() : period === 'this' ? thisWeek() : period === 'month' ? thisMonth() : custom;
  const unbilled = clientTrips.filter((c) => c.client_id === client.id && !c.invoice_id && c.trip?.status === 'completed');
  const inPeriod = unbilled.filter((c) => tripDay(c.trip!) >= range.from && tripDay(c.trip!) <= range.to);
  const earlier = unbilled.filter((c) => tripDay(c.trip!) < range.from);
  const [includeEarlier, setIncludeEarlier] = useState(false);
  const candidates = (includeEarlier ? [...earlier, ...inPeriod] : inPeriod).sort((a, b) => tripDay(a.trip!).localeCompare(tripDay(b.trip!)));
  const [off, setOff] = useState<Set<number>>(new Set());
  const chosen = candidates.filter((c) => !off.has(c.trip_id));
  const sub = Math.round(chosen.reduce((s, c) => s + Number(c.trip?.total_fare ?? 0), 0));
  const rate = Number(settings?.vat_rate ?? 0.18);
  const vat = Math.round(sub * rate);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const from = includeEarlier && earlier.length ? [range.from, ...earlier.map((c) => tripDay(c.trip!))].sort()[0] : range.from;

  const issue = async () => {
    if (!chosen.length) return;
    setBusy(true); setError('');
    const { data: id, error: err } = await supabase.rpc('issue_business_invoice', { p_client: client.id, p_from: from, p_to: range.to, p_trip_ids: chosen.map((c) => c.trip_id), p_notes: notes });
    if (err || !id) { setBusy(false); setError(err?.message ?? 'Could not issue the invoice'); return; }
    // Save the PDF with the invoice right away (it can be re-made any time).
    const { data: inv } = await supabase.from('business_invoices').select('*').eq('id', id).single();
    const snap = await loadInvoiceSnapshot(id as string);
    if (inv && snap) await storeInvoicePdf(inv as BusinessInvoice, snap).catch(() => null);
    setBusy(false);
    onIssued(id as string);
  };

  return (
    <Modal open onClose={onClose} title={`New invoice · ${client.name}`} subtitle={`App fares + ${Math.round(rate * 100)}% VAT · payable within ${client.payment_terms_days} days`} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          {([['last', `Last week (${dayLabel(lastWeek().from)} – ${dayLabel(lastWeek().to)})`], ['this', 'This week'], ['month', 'This month'], ['custom', 'Dates…']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setPeriod(k); setOff(new Set()); }} aria-pressed={period === k} className={`px-2.5 py-1.5 rounded-md text-caption border ${period === k ? 'border-accent bg-accent/10' : 'border-line text-fg-muted'}`}>{l}</button>
          ))}
          {period === 'custom' && <>
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((x) => ({ ...x, from: e.target.value }))} className="input !w-auto" aria-label="From" />
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((x) => ({ ...x, to: e.target.value }))} className="input !w-auto" aria-label="To" />
          </>}
        </div>
        {earlier.length > 0 && (
          <label className="flex items-center gap-2 text-small rounded-lg bg-attention-muted px-3 py-2">
            <input type="checkbox" checked={includeEarlier} onChange={(e) => setIncludeEarlier(e.target.checked)} />
            {earlier.length} earlier trip{earlier.length === 1 ? '' : 's'} not invoiced yet ({rwf(earlier.reduce((s, c) => s + Number(c.trip?.total_fare ?? 0), 0))}) — include them
          </label>
        )}
        {candidates.length ? (
          <ul className="divide-y divide-line-muted rounded-lg border border-line max-h-[40vh] overflow-y-auto">
            {candidates.map((c) => {
              const t = c.trip!;
              const on = !off.has(c.trip_id);
              return (
                <li key={c.trip_id}>
                  <label className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-hover">
                    <input type="checkbox" checked={on} onChange={() => setOff((s) => { const x = new Set(s); if (on) x.add(c.trip_id); else x.delete(c.trip_id); return x; })} className="mt-1" />
                    <span className="flex-1 min-w-0"><span className="block text-body">{kigaliTime(t.started_at ?? t.created_at)} · {t.rider_name ?? '—'} <span className="font-mono text-caption text-fg-muted">#{t.id}</span></span>
                      <span className="block text-caption text-fg-muted truncate">{shortAddress(t.pickup_address)} → {shortAddress(t.destination_address)} · {t.driver_name} {t.vehicle_plate}</span></span>
                    <span className="tabular-nums font-medium">{rwf(Number(t.total_fare ?? 0))}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-body text-fg-muted text-center py-6">No completed, un-invoiced {client.name} trips in these dates.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-inset p-3">
          <div><p className="text-caption text-fg-muted">Trips</p><p className="text-h3 font-semibold">{chosen.length}</p></div>
          <div><p className="text-caption text-fg-muted">Fares</p><p className="text-h3 font-semibold tabular-nums">{rwf(sub)}</p></div>
          <div><p className="text-caption text-fg-muted">VAT {Math.round(rate * 100)}%</p><p className="text-h3 font-semibold tabular-nums">{rwf(vat)}</p></div>
          <div><p className="text-caption text-fg-muted">Total</p><p className="text-h3 font-semibold tabular-nums text-accent-fg">{rwf(sub + vat)}</p></div>
        </div>
        <label className="block"><span className={lbl}>Note on the invoice (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" /></label>
        {!settings?.bank_account_number && !settings?.momo_number && <p className="text-caption text-attention">Payment details (bank account, MoMo) aren't set yet — add them in Invoices → Settings so they print on the invoice.</p>}
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={`Issue invoice · ${rwf(sub + vat)}`} onSave={issue} disabled={!chosen.length} />
      </div>
    </Modal>
  );
}

export async function storeInvoicePdf(inv: BusinessInvoice, snap: NonNullable<Awaited<ReturnType<typeof loadInvoiceSnapshot>>>) {
  const blob = await invoicePdfBlob(inv, snap);
  const path = `${inv.client_id}/${inv.number}.pdf`;
  const { error } = await supabase.storage.from('business-invoices').upload(path, blob, { upsert: true, contentType: 'application/pdf' });
  if (error) throw new Error(error.message);
  await supabase.rpc('set_invoice_pdf', { p_invoice: inv.id, p_path: path });
  return { blob, path };
}

// ------------------------------------------------------------ payments, sending, settings
export function PaymentModal({ invoice, onClose, onSaved }: { invoice: BusinessInvoice; onClose: () => void; onSaved: () => void }) {
  const due = Math.max(0, Number(invoice.total) - Number(invoice.amount_paid));
  const [amount, setAmount] = useState(String(due));
  const [paidOn, setPaidOn] = useState(todayK());
  const [method, setMethod] = useState('bank');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('record_invoice_payment', { p_invoice: invoice.id, p_amount: Number(amount.replace(/[^\d.]/g, '')), p_paid_on: paidOn, p_method: method, p_reference: reference, p_notes: notes });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Record a payment · ${invoice.number}`} subtitle={`${rwf(due)} still due`} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Amount received (RWF) *</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="input tabular-nums" /></label>
          <label className="block"><span className={lbl}>Received on *</span><input type="date" value={paidOn} max={todayK()} onChange={(e) => setPaidOn(e.target.value)} className="input" /></label>
          <label className="block"><span className={lbl}>How</span><select value={method} onChange={(e) => setMethod(e.target.value)} className="input">{PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Reference</span><input value={reference} onChange={(e) => setReference(e.target.value)} className="input" placeholder="Bank / MoMo reference" /></label>
        </div>
        <label className="block"><span className={lbl}>Note</span><input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" /></label>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Record payment" onSave={save} />
      </div>
    </Modal>
  );
}

export function SendInvoiceModal({ invoice, client, onClose, onSent }: { invoice: BusinessInvoice; client: BusinessClient; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState((invoice.sent_to?.length ? invoice.sent_to : client.billing_emails).join(', '));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    const list = to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) { setError('Add at least one email address.'); return; }
    setBusy(true); setError('');
    // Always send the PDF as the invoice stands now (e.g. after a part payment).
    const snap = await loadInvoiceSnapshot(invoice.id);
    if (snap) { try { await storeInvoicePdf(invoice, snap); } catch (e) { setBusy(false); setError(`Saving the PDF failed: ${(e as Error).message}`); return; } }
    const { data, error: err } = await supabase.functions.invoke('send-invoice', { body: { invoice_id: invoice.id, to: list, message } });
    setBusy(false);
    const msg = err ? ((await (err as { context?: Response }).context?.json?.().catch(() => null))?.error ?? err.message) : (data as { error?: string } | null)?.error;
    if (msg) { setError(msg); return; }
    onSent(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Send ${invoice.number}`} subtitle="From administration@kivuride.com, with the PDF attached. Replies come back to that address." maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>To *</span><input value={to} onChange={(e) => setTo(e.target.value)} className="input" placeholder="accounts@company.rw" /></label>
        <label className="block"><span className={lbl}>Message (optional)</span><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="input resize-none" placeholder="Added under the standard text" /></label>
        {invoice.sent_at && <p className="text-caption text-fg-muted">Already sent {kigaliTime(invoice.sent_at)} to {invoice.sent_to?.join(', ')}.</p>}
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={busy ? 'Sending…' : 'Send invoice'} onSave={send} />
      </div>
    </Modal>
  );
}

export function InvoiceSettingsModal({ settings, onClose, onSaved }: { settings: InvoiceSettings | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    legal_name: settings?.legal_name ?? 'KIVU RIDE Ltd', tin: settings?.tin ?? '', address: settings?.address ?? '', phone: settings?.phone ?? '', email: settings?.email ?? '', website: settings?.website ?? '',
    bank_name: settings?.bank_name ?? '', bank_account_name: settings?.bank_account_name ?? '', bank_account_number: settings?.bank_account_number ?? '', momo_number: settings?.momo_number ?? '', momo_name: settings?.momo_name ?? '',
    vat: String(Math.round(Number(settings?.vat_rate ?? 0.18) * 100)), footer_note: settings?.footer_note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setError('');
    const n = (v: string) => v.trim() || null;
    const { error: err } = await supabase.from('invoice_settings').update({
      legal_name: f.legal_name.trim() || 'KIVU RIDE Ltd', tin: n(f.tin), address: n(f.address), phone: n(f.phone), email: n(f.email), website: n(f.website),
      bank_name: n(f.bank_name), bank_account_name: n(f.bank_account_name), bank_account_number: n(f.bank_account_number), momo_number: n(f.momo_number), momo_name: n(f.momo_name),
      vat_rate: Math.min(99, Math.max(0, Number(f.vat) || 0)) / 100, footer_note: n(f.footer_note), updated_at: new Date().toISOString(),
    }).eq('id', true);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved(); onClose();
  };
  const field = (k: keyof typeof f, l: string, ph = '') => <label className="block"><span className={lbl}>{l}</span><input value={f[k]} onChange={set(k)} className="input" placeholder={ph} /></label>;
  return (
    <Modal open onClose={onClose} title="Invoice settings" subtitle="Printed on every new invoice. Invoices already issued keep the details they were issued with." maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('legal_name', 'Company name')}{field('tin', 'TIN')}{field('address', 'Address')}{field('phone', 'Phone')}{field('email', 'Email')}{field('website', 'Website')}
        </div>
        <p className="text-caption font-semibold text-fg pt-1">How clients pay</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('bank_name', 'Bank', 'e.g. I&M Bank Rwanda')}{field('bank_account_name', 'Account name', 'KIVU RIDE Ltd')}{field('bank_account_number', 'Account number')}
          {field('momo_number', 'Mobile Money number')}{field('momo_name', 'Mobile Money name')}
          <label className="block"><span className={lbl}>VAT %</span><input type="number" min={0} max={99} value={f.vat} onChange={set('vat')} className="input" /></label>
        </div>
        {field('footer_note', 'Closing line')}
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Save settings" onSave={save} />
      </div>
    </Modal>
  );
}
