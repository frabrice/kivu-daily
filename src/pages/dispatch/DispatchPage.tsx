import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Car, CheckCircle2, Crosshair, History, Link2, Loader2, MapPin, Navigation, RefreshCw, Send, Users, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, UnderlineTabs } from '../../ui/kit';
import Modal from '../../components/Modal';
import DispatchMap from '../../components/dispatch/DispatchMap';
import LiveTrip from '../../components/dispatch/LiveTrip';
import {
  Dispatch, FOR_KINDS, FOR_LABEL, ForKind, NearDriver, PAY_LABEL, Place, TypeQuote, callDispatch, fmtRwf, kDayTime, kTime, localPhone, statusOf,
} from '../../lib/dispatch';

// Dispatch (/dispatch): anyone on the team books a Kivu Ride trip for a
// hotline caller, a friend or family member. Name and phone, where from and
// where to, Economy or Comfort with the estimated fare and the drivers near
// the pickup; then the app offers the trip to the nearest drivers and the
// page follows it live: who accepted, the car, the trip code to give the
// client. If nobody takes it, book again in one click.

const todayK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayStart = (day: string) => `${day}T00:00:00+02:00`;

interface Form {
  for_kind: ForKind; client_name: string; client_phone: string; client_email: string; showEmail: boolean;
  pickup: Place | null; destination: Place | null; vehicle_type: string | null;
  when: 'now' | 'later'; at: string; payment_method: 'cash' | 'mobile_money'; note: string; test: boolean;
}
const EMPTY: Form = {
  for_kind: 'hotline', client_name: '', client_phone: '', client_email: '', showEmail: false,
  pickup: null, destination: null, vehicle_type: null, when: 'now', at: '', payment_method: 'cash', note: '', test: false,
};

export default function DispatchPage() {
  usePageTitle('Dispatch');
  const { profile } = useAuth();
  const a = useAccess();
  const seesAll = a.isMd || a.dept === 'call_center';
  const [config, setConfig] = useState<{ live: boolean; test: boolean } | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [picking, setPicking] = useState<'pickup' | 'destination' | null>(null);
  const [quote, setQuote] = useState<{ types: TypeQuote[]; at: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ again?: string } | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Dispatch | null>(null);
  const [open, setOpen] = useState<Dispatch | null>(null);

  useEffect(() => { callDispatch<{ live: boolean; test: boolean }>({ action: 'config' }).then((r) => r.ok && setConfig({ live: r.live, test: r.test })); }, []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Fares and nearby drivers as soon as both places are known.
  const loadQuote = useCallback(async (pu: Place, de: Place) => {
    setQuoting(true); setQuoteError(null);
    const r = await callDispatch<{ types: TypeQuote[] }>({ action: 'quote', pickup: pu, destination: de });
    setQuoting(false);
    if (!r.ok) { setQuoteError(r.error ?? 'Could not get the fare.'); setQuote(null); return; }
    setQuote({ types: r.types, at: Date.now() });
    setForm((f) => ({ ...f, vehicle_type: f.vehicle_type && r.types.some((t) => t.slug === f.vehicle_type) ? f.vehicle_type : r.types[0]?.slug ?? null }));
  }, []);
  useEffect(() => {
    if (form.pickup && form.destination) loadQuote(form.pickup, form.destination);
    else setQuote(null);
  }, [form.pickup, form.destination, loadQuote]);

  const chosen = quote?.types.find((t) => t.slug === form.vehicle_type) ?? null;
  const mapDrivers: NearDriver[] = chosen?.drivers ?? quote?.types.flatMap((t) => t.drivers) ?? [];

  const onPick = async (which: 'pickup' | 'destination', lat: number, lng: number) => {
    setPicking(null);
    set(which, { address: 'Finding the address…', lat, lng, source: 'pin' });
    const r = await callDispatch<{ place: Place }>({ action: 'reverse', lat, lng });
    set(which, r.ok ? r.place : { address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng, source: 'pin' });
  };

  const missing = !form.client_name.trim() ? 'the client\'s name' : form.client_phone.replace(/\D/g, '').length < 9 ? 'the client\'s phone' : !form.pickup ? 'the pickup' : !form.destination ? 'the destination'
    : !form.vehicle_type ? 'the car type' : form.when === 'later' && !form.at ? 'the pickup time' : null;

  const book = async (again = false) => {
    if (!form.pickup || !form.destination || !form.vehicle_type) return;
    setBooking(true); setBookError(null);
    const r = await callDispatch<{ dispatch?: Dispatch; again?: boolean }>({
      action: 'book', confirm_again: again, test: form.test, for_kind: form.for_kind,
      client_name: form.client_name, client_phone: form.client_phone, client_email: form.showEmail ? form.client_email : '',
      pickup: form.pickup, destination: form.destination, vehicle_type: form.vehicle_type, payment_method: form.payment_method,
      scheduled_pickup_time: form.when === 'later' ? form.at : null, note: form.note,
      estimate: chosen ? { fare: chosen.fare, distance_km: chosen.distance_km, duration_minutes: chosen.duration_minutes } : null,
      nearby_drivers: chosen?.drivers.length ?? null,
    });
    setBooking(false);
    if (r.again) { setConfirm({ again: r.error }); return; }
    setConfirm(null);
    if (r.dispatch) setCurrent(r.dispatch);
    if (!r.ok) { setBookError(r.error ?? 'The booking did not go through.'); return; }
    setForm({ ...EMPTY, test: form.test });
    setQuote(null);
  };

  // Book again: the same client and route, after a cancellation or no driver.
  const bookAgain = (d: Dispatch) => {
    setForm({
      ...EMPTY, for_kind: d.for_kind, client_name: d.client_name, client_phone: localPhone(d.client_phone), client_email: d.client_email ?? '', showEmail: !!d.client_email,
      pickup: { address: d.pickup_address, lat: d.pickup_lat, lng: d.pickup_lng, source: 'ours' },
      destination: { address: d.destination_address, lat: d.destination_lat, lng: d.destination_lng, source: 'ours' },
      vehicle_type: d.vehicle_type, payment_method: d.payment_method, note: d.note ?? '', test: d.sandbox,
    });
    setCurrent(null); setOpen(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={Send} title="Dispatch" subtitle="Book a Kivu Ride for a caller, a friend or family: the app sends the nearest driver."
        labels={config && !config.live ? <Label tone="danger">Bookings are off: the live key is not set</Label> : undefined} />

      {current && <LiveTrip d={current} onChange={setCurrent} onBookAgain={bookAgain} onClose={() => setCurrent(null)} canCancel={current.created_by === profile?.id || seesAll} />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <Box title="1. The client">
            <div className="space-y-3">
              <Chips value={form.for_kind} onChange={(v) => set('for_kind', v)} options={FOR_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Name"><input className="input w-full" value={form.client_name} onChange={(e) => set('client_name', e.target.value)} placeholder="e.g. Aline Uwase" autoComplete="off" /></Field>
                <Field label="Phone"><input className="input w-full" type="tel" inputMode="tel" value={form.client_phone} onChange={(e) => set('client_phone', e.target.value)} placeholder="0788 123 456" autoComplete="off" /></Field>
              </div>
              {form.showEmail ? (
                <Field label="Email (optional)" hint="The app emails them the driver and the receipt.">
                  <input className="input w-full" type="email" value={form.client_email} onChange={(e) => set('client_email', e.target.value)} placeholder="name@example.com" />
                </Field>
              ) : <button className="text-caption text-brand hover:underline" onClick={() => set('showEmail', true)}>+ Add their email so the app sends them the driver and receipt</button>}
            </div>
          </Box>

          <Box title="2. Where from and where to">
            <div className="space-y-3">
              <PlaceField which="pickup" label="Pickup" letter="A" color="#2563eb" value={form.pickup} onChange={(p) => set('pickup', p)} picking={picking === 'pickup'} onPickMap={() => setPicking(picking === 'pickup' ? null : 'pickup')} />
              <PlaceField which="destination" label="Destination" letter="B" color="#ea580c" value={form.destination} onChange={(p) => set('destination', p)} picking={picking === 'destination'} onPickMap={() => setPicking(picking === 'destination' ? null : 'destination')} />
            </div>
          </Box>

          <Box title="3. Car, fare and time" right={quote && <button className="btn-ghost text-caption" onClick={() => form.pickup && form.destination && loadQuote(form.pickup, form.destination)} disabled={quoting}><RefreshCw size={12} className={quoting ? 'animate-spin' : ''} /> Refresh</button>}>
            {!form.pickup || !form.destination ? <p className="text-small text-fg-muted">Choose the pickup and the destination to see the fare and the drivers nearby.</p>
              : quoting && !quote ? <div className="grid sm:grid-cols-2 gap-2">{[0, 1].map((i) => <div key={i} className="h-24 skeleton rounded-lg" />)}</div>
              : quoteError ? <p className="text-small text-danger">{quoteError}</p>
              : quote && (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-2">
                    {quote.types.map((t) => (
                      <button key={t.slug} onClick={() => set('vehicle_type', t.slug)}
                        className={`text-left rounded-lg border p-3 transition-colors ${form.vehicle_type === t.slug ? 'border-brand ring-2 ring-brand/30 bg-brand/5' : 'border-line hover:border-brand/40'}`}>
                        <div className="flex items-center justify-between gap-2"><span className="text-ui font-semibold">{t.name}</span>{form.vehicle_type === t.slug && <CheckCircle2 size={16} className="text-brand" />}</div>
                        <p className="text-h3 font-bold mt-1 tabular-nums">{t.fare != null ? fmtRwf(t.fare) : '—'}</p>
                        <p className="text-caption text-fg-muted">{t.error ? t.error : `${t.distance_km ?? '—'} km · about ${t.duration_minutes ?? '—'} min`}</p>
                        <p className={`text-caption mt-1 flex items-center gap-1 ${t.drivers.length ? 'text-success' : 'text-danger'}`}><Users size={12} />{!t.drivers_ok ? 'Drivers unknown' : t.drivers.length ? `${t.drivers.length} driver${t.drivers.length === 1 ? '' : 's'} within 5 km` : 'No driver within 5 km now'}</p>
                      </button>
                    ))}
                  </div>
                  <p className="text-micro text-fg-subtle">Estimate from the app. The final fare adds waiting time and extras.</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="When">
                      <Chips value={form.when} onChange={(v) => set('when', v)} options={[{ value: 'now', label: 'Now' }, { value: 'later', label: 'Later' }]} />
                      {form.when === 'later' && <input type="datetime-local" className="input w-full mt-2" value={form.at} min={new Date(Date.now() + 15 * 60_000 + 7_200_000).toISOString().slice(0, 16)} onChange={(e) => set('at', e.target.value)} />}
                    </Field>
                    <Field label="The client pays the driver">
                      <Chips value={form.payment_method} onChange={(v) => set('payment_method', v)} options={[{ value: 'cash', label: 'Cash' }, { value: 'mobile_money', label: 'Mobile Money' }]} />
                    </Field>
                  </div>
                  <Field label="Note for the report (optional, not sent to the driver)">
                    <input className="input w-full" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. elderly client, waits at the gate" />
                  </Field>
                </div>
              )}
          </Box>

          <div className="card p-4 space-y-2">
            {config?.test && (
              <label className="flex items-center gap-2 text-small"><input type="checkbox" checked={form.test} onChange={(e) => set('test', e.target.checked)} /> Test booking (sandbox: a test driver plays it, nobody is sent)</label>
            )}
            {bookError && <p className="text-small text-danger">{bookError}</p>}
            <button className="btn-primary w-full justify-center py-2.5 text-ui" disabled={!!missing || booking || (!config?.live && !form.test)} onClick={() => setConfirm({})}>
              {booking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {missing ? `Add ${missing}` : `Book ${chosen?.name ?? ''} ${form.when === 'now' ? 'now' : 'for later'}${chosen?.fare != null ? ` · about ${fmtRwf(chosen.fare)}` : ''}`}
            </button>
          </div>
        </div>

        <div className="space-y-4 min-w-0 lg:sticky lg:top-2">
          <Box padded={false}>
            {picking && <p className="px-3 py-2 text-small bg-brand/10 text-brand flex items-center gap-1.5 rounded-t-lg"><Crosshair size={14} /> Click the map where the {picking} is. <button className="ml-auto underline" onClick={() => setPicking(null)}>Stop</button></p>}
            <div className="p-2"><DispatchMap pickup={form.pickup} destination={form.destination} drivers={mapDrivers} picking={picking} onPick={onPick} height={320} /></div>
          </Box>
          {chosen && (
            <Box title={`${chosen.name} drivers near the pickup`} icon={Car}>
              {chosen.drivers.length === 0 ? <p className="text-small text-fg-muted">No {chosen.name} driver is online within 5 km right now. You can still book: the app keeps looking further out, or try the other car type.</p> : (
                <>
                  <ul className="divide-y divide-line-muted">
                    {chosen.drivers.slice(0, 8).map((d) => (
                      <li key={d.id} className="py-1.5 flex items-center gap-2 text-small">
                        <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                        <span className="font-medium truncate">{d.name ?? `Driver #${d.id}`}</span>
                        {d.ours && <Label tone="accent">Ours</Label>}
                        <span className="text-fg-muted truncate">{[d.car, d.plate].filter(Boolean).join(' · ')}</span>
                        <span className="ml-auto tabular-nums text-fg-muted shrink-0">{d.distance_km != null ? `${d.distance_km} km` : ''}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-micro text-fg-subtle mt-2">The app offers the trip to the nearest drivers first, a few at a time; the first to accept takes it.</p>
                </>
              )}
            </Box>
          )}
        </div>
      </div>

      <DispatchList seesAll={seesAll} me={profile?.id ?? null} onOpen={setOpen} />

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title={confirm.again ? 'Book another one?' : 'Book this ride?'} subtitle={form.test ? 'Test booking: nobody is sent' : 'This is a real booking: the app sends it to drivers now'}>
          <div className="space-y-3 text-small">
            {confirm.again && <p className="rounded-lg bg-attention/10 text-attention p-2">{confirm.again}</p>}
            <Summary rows={[
              ['Client', `${form.client_name} · ${form.client_phone}`],
              ['From', form.pickup?.address], ['To', form.destination?.address],
              ['Car', `${chosen?.name ?? form.vehicle_type} · about ${fmtRwf(chosen?.fare)}`],
              ['When', form.when === 'now' ? 'Now' : form.at.replace('T', ' ')],
              ['Payment', PAY_LABEL[form.payment_method]],
            ]} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirm(null)}>Back</button>
              <button className="btn-primary" disabled={booking} onClick={() => book(!!confirm.again)}>{booking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {confirm.again ? 'Book anyway' : 'Book'}</button>
            </div>
          </div>
        </Modal>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.client_name} subtitle={`Booked ${kDayTime(open.created_at)}`} maxWidth="max-w-lg">
          <LiveTrip d={open} onChange={setOpen} onBookAgain={bookAgain} canCancel={open.created_by === profile?.id || seesAll} bare />
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the list
function DispatchList({ seesAll, me, onOpen }: { seesAll: boolean; me: string | null; onOpen: (d: Dispatch) => void }) {
  const [scope, setScope] = useState<'mine' | 'all'>(seesAll ? 'all' : 'mine');
  const [from, setFrom] = useState(todayK());
  const [to, setTo] = useState(todayK());
  const [rows, setRows] = useState<Dispatch[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('dispatches').select('*').gte('created_at', dayStart(from)).lt('created_at', dayStart(addDays(to, 1))).order('created_at', { ascending: false }).limit(1000);
    if (scope === 'mine' && me) q = q.eq('created_by', me);
    const { data } = await q;
    setRows((data as Dispatch[]) ?? []);
    setLoading(false);
  }, [from, to, scope, me]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = supabase.channel(`dispatch-list-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatches' }, () => { clearTimeout(t); t = setTimeout(load, 600); })
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [load]);
  useEffect(() => {
    if (!seesAll) return;
    supabase.from('profiles').select('id, full_name').then(({ data }) => setNames(Object.fromEntries(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name.trim()]))));
  }, [seesAll]);

  const real = rows.filter((r) => !r.sandbox);
  const done = real.filter((r) => r.status === 'completed');
  const quick = (f: string, t: string) => { setFrom(f); setTo(t); };
  const today = todayK();

  return (
    <Box title="Dispatches" icon={History} padded={false}
      right={<span className="text-caption text-fg-muted">{real.length} booked · {done.length} completed · {fmtRwf(done.reduce((s, r) => s + Number(r.fare ?? 0), 0))}</span>}>
      <div className="px-4 pt-3 space-y-2">
        {seesAll && <UnderlineTabs tabs={[{ key: 'all', label: 'Everyone' }, { key: 'mine', label: 'Mine' }]} value={scope} onChange={setScope} />}
        <div className="flex flex-wrap items-center gap-2 text-small">
          {[['Today', today, today], ['Yesterday', addDays(today, -1), addDays(today, -1)], ['Last 7 days', addDays(today, -6), today]].map(([l, f, t]) => (
            <button key={l} className={`px-2 py-1 rounded-md border ${from === f && to === t ? 'border-brand text-brand bg-brand/5' : 'border-line text-fg-muted'}`} onClick={() => quick(f, t)}>{l}</button>
          ))}
          <input type="date" className="input py-1" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <span className="text-fg-subtle">to</span>
          <input type="date" className="input py-1" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>
      </div>
      <div className="p-2">
        {loading ? <div className="h-24 skeleton rounded-lg" /> : rows.length === 0 ? <EmptyState icon={Send} title="No dispatches in these days" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-small min-w-[720px]">
              <thead><tr className="text-caption text-fg-subtle text-left border-b border-line-muted">
                {['Time', 'Client', 'From → to', 'Car', 'Status', 'Driver', 'Fare', ...(scope === 'all' ? ['Booked by'] : [])].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line-muted">
                {rows.map((r) => {
                  const st = statusOf(r.status);
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(r)}>
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums">{from === to ? kTime(r.created_at) : kDayTime(r.created_at)}</td>
                      <td className="px-2 py-2"><p className="font-medium">{r.client_name}</p><p className="text-caption text-fg-muted">{FOR_LABEL[r.for_kind]}</p></td>
                      <td className="px-2 py-2 max-w-[260px]"><p className="truncate">{r.pickup_address}</p><p className="truncate text-fg-muted">→ {r.destination_address}</p></td>
                      <td className="px-2 py-2 capitalize">{r.vehicle_type}</td>
                      <td className="px-2 py-2 whitespace-nowrap"><Label tone={st.tone}>{st.label}</Label>{r.sandbox && <span className="ml-1"><Label tone="info">Test</Label></span>}</td>
                      <td className="px-2 py-2">{r.driver_name ?? '—'}{r.vehicle_plate && <p className="text-caption text-fg-muted">{r.vehicle_plate}</p>}</td>
                      <td className="px-2 py-2 tabular-nums whitespace-nowrap">{fmtRwf(r.fare ?? r.estimated_fare)}</td>
                      {scope === 'all' && <td className="px-2 py-2 text-fg-muted">{names[r.created_by] ?? '—'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Box>
  );
}

// ------------------------------------------------------------------ a place
function PlaceField({ which, label, letter, color, value, onChange, picking, onPickMap }: {
  which: 'pickup' | 'destination'; label: string; letter: string; color: string; value: Place | null; onChange: (p: Place | null) => void; picking: boolean; onPickMap: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<'search' | 'link'>('search');
  const [link, setLink] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (mode !== 'search' || q.trim().length < 2) { setResults([]); return; }
    const n = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await callDispatch<{ places: Place[] }>({ action: 'places', q });
      if (n !== seq.current) return;
      setSearching(false);
      setResults(r.ok ? r.places : []);
    }, 350);
    return () => clearTimeout(t);
  }, [q, mode]);

  const choose = (p: Place) => { onChange(p); setQ(''); setResults([]); setErr(null); };
  const readLink = async () => {
    setBusy(true); setErr(null);
    const r = await callDispatch<{ place: Place }>({ action: 'link', text: link });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Could not read it.'); return; }
    choose(r.place); setLink(''); setMode('search');
  };
  const myLocation = () => {
    if (!navigator.geolocation) { setErr('This device cannot share its location.'); return; }
    setBusy(true); setErr(null);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const r = await callDispatch<{ place: Place }>({ action: 'reverse', lat: pos.coords.latitude, lng: pos.coords.longitude });
      setBusy(false);
      if (!r.ok) { setErr(r.error ?? 'Could not read the location.'); return; }
      choose({ ...r.place, source: 'gps' });
    }, () => { setBusy(false); setErr('The location was not shared. Allow location for this site, or search the place.'); }, { enableHighAccuracy: true, timeout: 15000 });
  };

  return (
    <div>
      <p className="text-caption font-semibold text-fg-muted mb-1 flex items-center gap-1.5"><span className="w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center" style={{ background: color }}>{letter}</span>{label}</p>
      {value ? (
        <div className="flex items-start gap-2 rounded-lg border border-line p-2">
          <MapPin size={15} className="mt-0.5 shrink-0" style={{ color }} />
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium">{value.address}</p>
            <p className="text-micro text-fg-subtle">{{ ours: 'From our trips', map: 'From the map search', link: 'From a link', pin: 'Pin on the map', gps: 'This device\'s location' }[value.source]} · {value.lat.toFixed(5)}, {value.lng.toFixed(5)}</p>
          </div>
          <button className="btn-ghost p-1" onClick={() => onChange(null)} aria-label={`Change the ${label.toLowerCase()}`}><X size={14} /></button>
        </div>
      ) : mode === 'link' ? (
        <div className="space-y-1.5">
          <textarea className="input w-full" rows={2} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a Google Maps / WhatsApp location link, or coordinates like -1.9536, 30.0606" autoFocus />
          <div className="flex gap-2">
            <button className="btn-primary text-caption" disabled={!link.trim() || busy} onClick={readLink}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Read the location</button>
            <button className="btn-ghost text-caption" onClick={() => { setMode('search'); setErr(null); }}>Search by name instead</button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <input className="input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder={which === 'pickup' ? 'Where is the client? e.g. Kigali Heights, Kimironko market' : 'Where are they going?'} autoComplete="off" />
          {searching && <Loader2 size={14} className="animate-spin absolute right-2.5 top-2.5 text-fg-subtle" />}
          {results.length > 0 && (
            <ul className="absolute z-30 left-0 right-0 mt-1 card p-1 max-h-72 overflow-y-auto shadow-lg">
              {results.map((p, i) => (
                <li key={i}>
                  <button className="w-full text-left px-2 py-1.5 rounded-md hover:bg-hover flex items-start gap-2" onClick={() => choose(p)}>
                    {p.source === 'ours' ? <History size={14} className="mt-0.5 text-brand shrink-0" /> : <MapPin size={14} className="mt-0.5 text-fg-subtle shrink-0" />}
                    <span className="min-w-0"><span className="text-small block">{p.address}</span>
                      <span className="text-micro text-fg-subtle">{p.source === 'ours' ? `Used in ${p.uses} trip${p.uses === 1 ? '' : 's'}` : p.detail ?? 'Map'}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && !searching && results.length === 0 && <p className="text-caption text-fg-muted mt-1">Nothing found. Try another name, paste a location link, or pick it on the map.</p>}
        </div>
      )}
      {!value && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {mode === 'search' && <button className="btn-ghost text-caption" onClick={() => { setMode('link'); setErr(null); }}><Link2 size={12} /> Paste a location link</button>}
          <button className={`btn-ghost text-caption ${picking ? 'text-brand' : ''}`} onClick={onPickMap}><Crosshair size={12} /> {picking ? 'Click the map…' : 'Pick on the map'}</button>
          {which === 'pickup' && <button className="btn-ghost text-caption" disabled={busy} onClick={myLocation}><Navigation size={12} /> I am with the client</button>}
        </div>
      )}
      {err && <p className="text-caption text-danger mt-1">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ small pieces
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block"><span className="text-caption font-semibold text-fg-muted">{label}</span><div className="mt-1">{children}</div>{hint && <span className="text-micro text-fg-subtle">{hint}</span>}</label>;
}
function Chips<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-full border text-small ${value === o.value ? 'border-brand bg-brand text-white' : 'border-line text-fg-muted hover:border-brand/40'}`}>{o.label}</button>
      ))}
    </div>
  );
}
function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-fg-muted">{k}</dt><dd className="font-medium">{v ?? '—'}</dd></div>)}
    </dl>
  );
}

