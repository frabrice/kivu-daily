import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Car, CircleDollarSign, Clock, ExternalLink, Flag, MapPin, Navigation, RefreshCw, Route, Search, Star, Timer, User, XCircle,
} from 'lucide-react';
import {
  DISPATCH_LABEL, FINAL_STATUSES, PAYMENT_LABEL, PlatformTrip, kigaliDayOf, kigaliTime, loadTripDetail, mapsRoute, minutesBetween, shortAddress, statusOf, useTrips,
} from '../../lib/trips';
import { usePageTitle } from '../../os/workspace';
import { EntityLink } from '../../os/EntityLink';
import { Label, PageHeader, StatCard, StatGrid, UnderlineTabs, rwf } from '../../ui/kit';
import { Pager, usePaged } from '../../ui/Pager';
import { RangeTabs } from '../../components/charts/kit';
import Modal from '../../components/Modal';

// Every KivuRide trip, synced from the platform every 2 minutes: live
// status, rider, driver and car (linked to ours when it's our fleet),
// route, fare and payment - the base the dispatch and finance features
// will build on.

type Period = 'today' | '7d' | '30d' | 'all';
type View = 'live' | 'completed' | 'cancelled' | 'all';
const todayK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const daysAgo = (n: number) => { const d = new Date(`${todayK()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5 align-top';

export default function TripsPage() {
  usePageTitle('Trips');
  const [period, setPeriod] = useState<Period>('all');
  const fromDay = period === 'today' ? todayK() : period === '7d' ? daysAgo(6) : period === '30d' ? daysAgo(29) : null;
  const { trips, sync, loading, error, syncNow } = useTrips(fromDay);
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [payment, setPayment] = useState('');
  const [dispatch, setDispatch] = useState('');
  const [ours, setOurs] = useState(false);
  const [open, setOpen] = useState<PlatformTrip | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const isLive = (t: PlatformTrip) => !FINAL_STATUSES.includes(t.status);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const digits = n.replace(/\D/g, '');
    return trips.filter((t) => {
      if (ours && !t.kivu_driver_id && !t.kivu_vehicle_id) return false;
      if (vehicleType && t.vehicle_type !== vehicleType) return false;
      if (payment && t.payment_method !== payment) return false;
      if (dispatch && t.dispatch_method !== dispatch) return false;
      if (!n) return true;
      if (String(t.id) === n.replace('#', '')) return true;
      const text = [t.rider_name, t.driver_name, t.vehicle_plate, t.pickup_address, t.destination_address].join(' ').toLowerCase();
      if (text.includes(n) || text.replace(/\s/g, '').includes(n.replace(/\s/g, ''))) return true;
      return digits.length >= 4 && [t.rider_phone, t.driver_phone].some((p) => (p ?? '').replace(/\D/g, '').includes(digits));
    });
  }, [trips, q, vehicleType, payment, dispatch, ours]);
  const counts = {
    live: filtered.filter(isLive).length,
    completed: filtered.filter((t) => t.status === 'completed').length,
    cancelled: filtered.filter((t) => t.status === 'cancelled').length,
    all: filtered.length,
  };
  const shown = useMemo(() => {
    const list = view === 'all' ? filtered : view === 'live' ? filtered.filter(isLive) : filtered.filter((t) => t.status === view);
    return view === 'live' ? [...list].sort((a, b) => statusOf(a.status).order - statusOf(b.status).order || (b.created_at ?? '').localeCompare(a.created_at ?? '')) : list;
  }, [filtered, view]);
  const { rows, pager } = usePaged(shown, { key: 'trips', reset: `${view}|${q}|${vehicleType}|${payment}|${dispatch}|${ours}|${period}` });

  // Numbers for the period and filters.
  const done = filtered.filter((t) => t.status === 'completed');
  const fares = done.reduce((s, t) => s + Number(t.total_fare ?? 0), 0);
  // Only rider-app bookings wait for a driver (driver-started and manual trips are accepted at once).
  const waits = filtered.filter((t) => t.dispatch_method === 'app' && t.requested_at && t.accepted_at).map((t) => (Date.parse(t.accepted_at!) - Date.parse(t.requested_at!)) / 1000).filter((x) => x >= 0 && x < 7200).sort((a, b) => a - b);
  const medianWait = waits.length ? waits[Math.floor(waits.length / 2)] : null;
  const cashShare = done.length ? Math.round((done.filter((t) => t.payment_method === 'cash').length / done.length) * 100) : null;
  const decided = counts.completed + counts.cancelled;
  const types = [...new Set(trips.map((t) => t.vehicle_type).filter(Boolean))] as string[];
  const methods = [...new Set(trips.map((t) => t.dispatch_method).filter(Boolean))] as string[];
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of filtered) { const d = kigaliDayOf(t.created_at); m.set(d, (m.get(d) ?? 0) + 1); }
    return Array.from({ length: 14 }, (_, i) => m.get(daysAgo(13 - i)) ?? 0);
  }, [filtered]);

  const runSync = async () => {
    setSyncing(true); setSyncMsg('');
    const err = await syncNow();
    setSyncing(false);
    setSyncMsg(err ? `Sync failed: ${err}` : 'Up to date.');
  };

  if (loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Route} title="Trips" subtitle="Every KivuRide trip and its status, from the platform."
        meta={<>
          <span className="flex items-center gap-1"><RefreshCw size={12} /> Synced {ago(sync?.last_ok_at ?? null)} · every 2 minutes</span>
          {sync?.last_error && <span className="text-danger flex items-center gap-1"><AlertTriangle size={12} /> Last sync failed: {sync.last_error.slice(0, 120)}</span>}
          {syncMsg && <span className={syncMsg.startsWith('Sync failed') ? 'text-danger' : 'text-success'}>{syncMsg}</span>}
        </>}
        actions={<button onClick={runSync} disabled={syncing} className="btn-secondary"><RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}</button>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <RangeTabs<Period> value={period} onChange={setPeriod} options={[{ v: 'all', label: 'All time' }, { v: 'today', label: 'Today' }, { v: '7d', label: '7 days' }, { v: '30d', label: '30 days' }]} />
      </div>

      <StatGrid cols={5}>
        <StatCard icon={Route} label="Trips" value={filtered.length.toLocaleString()} spark={perDay} sub={period === 'all' ? `Since ${trips.length ? kigaliTime(trips[trips.length - 1].created_at).split(',')[0] : '—'}` : 'Last 14 days on the right'} />
        <StatCard icon={Navigation} label="Live now" value={counts.live} tone={counts.live ? 'attention' : undefined} onClick={() => setView('live')} sub="Not completed or cancelled yet" />
        <StatCard icon={BadgeCheck} label="Completed" value={counts.completed} tone="success" onClick={() => setView('completed')} sub={decided ? `${Math.round((counts.completed / decided) * 100)}% of finished trips` : '—'} />
        <StatCard icon={XCircle} label="Cancelled" value={counts.cancelled} tone={counts.cancelled ? 'danger' : undefined} onClick={() => setView('cancelled')} sub={decided ? `${Math.round((counts.cancelled / decided) * 100)}% of finished trips` : '—'} />
        <StatCard icon={CircleDollarSign} label="Fares (completed)" value={rwf(fares)} sub={`${medianWait !== null ? `Typical wait for a driver ${medianWait < 120 ? `${Math.round(medianWait)} s` : `${Math.round(medianWait / 60)} min`}` : 'No waits yet'}${cashShare !== null ? ` · ${cashShare}% cash` : ''}`} />
      </StatGrid>

      <UnderlineTabs<View> value={view} onChange={setView}
        tabs={[{ key: 'all', label: 'All', count: counts.all }, { key: 'live', label: 'Live', count: counts.live }, { key: 'completed', label: 'Completed', count: counts.completed }, { key: 'cancelled', label: 'Cancelled', count: counts.cancelled }]} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="relative block flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Rider, driver, phone, plate, place or #trip" aria-label="Search trips" />
        </label>
        <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="input !w-auto" aria-label="Car type">
          <option value="">All car types</option>{types.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
        </select>
        <select value={payment} onChange={(e) => setPayment(e.target.value)} className="input !w-auto" aria-label="Payment">
          <option value="">All payments</option>{Object.entries(PAYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={dispatch} onChange={(e) => setDispatch(e.target.value)} className="input !w-auto" aria-label="How it was dispatched">
          <option value="">Any dispatch</option>{methods.map((x) => <option key={x} value={x}>{DISPATCH_LABEL[x] ?? x}</option>)}
        </select>
        <label className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-small cursor-pointer ${ours ? 'border-accent bg-accent/10' : 'border-line text-fg-muted'}`}>
          <input type="checkbox" checked={ours} onChange={(e) => setOurs(e.target.checked)} /> Our fleet only
        </label>
      </div>

      {shown.length ? (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-body min-w-[1040px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">
                {['Trip', 'Status', 'Rider', 'Driver & car', 'Route', 'Distance', 'Fare', 'Payment'].map((h, i) => <th key={h} className={`${th} ${i === 5 || i === 6 ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((t) => {
                  const st = statusOf(t.status);
                  const km = t.actual_distance_km ?? t.estimated_distance_km;
                  return (
                    <tr key={t.id} onClick={() => setOpen(t)} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                      <td className={td}><span className="font-mono text-caption text-fg-muted">#{t.id}</span><span className="block whitespace-nowrap tabular-nums">{kigaliTime(t.created_at)}</span>{t.is_scheduled && <span className="text-caption text-link">Scheduled {kigaliTime(t.scheduled_pickup_time)}</span>}</td>
                      <td className={td}><Label tone={st.tone}>{st.label}</Label>{t.fraud_flag && <span className="block mt-1"><Label tone="danger" icon={Flag}>Flagged</Label></span>}</td>
                      <td className={`${td} max-w-[180px]`}><span className="block truncate">{t.rider_name ?? '—'}</span><span className="block text-caption text-fg-muted">{t.rider_kind === 'guest' ? 'Booked for a guest' : t.rider_kind === 'app' ? 'Rider app' : ''}</span></td>
                      <td className={`${td} max-w-[220px]`} onClick={(e) => e.stopPropagation()}>
                        {t.kivu_driver_id ? <EntityLink type="driver" id={t.kivu_driver_id} label={t.driver_name ?? 'Driver'} /> : <span className="block truncate">{t.driver_name ?? <span className="text-fg-subtle">No driver yet</span>}</span>}
                        <span className="flex items-center gap-1.5 text-caption text-fg-muted">
                          {t.kivu_vehicle_id ? <EntityLink type="car" id={t.kivu_vehicle_id} label={t.vehicle_plate ?? ''} className="font-mono" /> : <span className="font-mono">{t.vehicle_plate}</span>}
                          {(t.kivu_driver_id || t.kivu_vehicle_id) && <Label tone="accent">Our fleet</Label>}
                        </span>
                      </td>
                      <td className={`${td} max-w-[260px]`}><span className="block truncate"><MapPin size={11} className="inline text-success mr-1" />{shortAddress(t.pickup_address)}</span><span className="block truncate text-fg-muted"><MapPin size={11} className="inline text-danger mr-1" />{shortAddress(t.destination_address)}</span></td>
                      <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{km !== null ? `${Number(km).toFixed(1)} km` : '—'}</td>
                      <td className={`${td} text-right tabular-nums whitespace-nowrap font-medium`}>{t.total_fare !== null ? rwf(Number(t.total_fare)) : '—'}</td>
                      <td className={`${td} whitespace-nowrap`}>{PAYMENT_LABEL[t.payment_method ?? ''] ?? t.payment_method ?? '—'}<span className={`block text-caption ${t.payment_status === 'success' ? 'text-success' : 'text-fg-muted'}`}>{t.payment_status === 'success' ? 'Paid' : t.payment_status ?? ''}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager pager={pager} noun="trips" />
        </>
      ) : (
        <div className="card p-10 text-center text-body text-fg-muted">{trips.length ? 'No trip matches.' : 'No trips yet — the first sync may still be running.'}</div>
      )}

      {open && <TripPanel trip={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TripPanel({ trip: t, onClose }: { trip: PlatformTrip; onClose: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadTripDetail>> | null>(null);
  useEffect(() => { loadTripDetail(t.id).then(setDetail); }, [t.id]);
  const st = statusOf(t.status);
  const route = mapsRoute(t);
  const extras = ((detail?.raw?.extra_costs as { amount: number; reason: string }[] | undefined) ?? []);
  const steps: { label: string; at: string | null; note?: string }[] = [
    { label: 'Requested', at: t.requested_at ?? t.created_at },
    ...(t.is_scheduled ? [{ label: 'Pickup booked for', at: t.scheduled_pickup_time }] : []),
    { label: 'Driver accepted', at: t.accepted_at, note: minutesBetween(t.requested_at, t.accepted_at) !== null ? `after ${minutesBetween(t.requested_at, t.accepted_at)} min` : undefined },
    { label: 'Ride started', at: t.started_at, note: minutesBetween(t.accepted_at, t.started_at) !== null ? `${minutesBetween(t.accepted_at, t.started_at)} min to pick up` : undefined },
    t.status === 'cancelled'
      ? { label: 'Cancelled', at: t.cancelled_at }
      : { label: 'Completed', at: t.completed_at, note: minutesBetween(t.started_at, t.completed_at) !== null ? `${minutesBetween(t.started_at, t.completed_at)} min ride` : undefined },
  ];
  const row = (label: ReactNode, value: ReactNode) => <div className="flex justify-between gap-3 py-1 text-small"><span className="text-fg-muted">{label}</span><span className="text-right tabular-nums">{value}</span></div>;
  return (
    <Modal open onClose={onClose} title={`Trip #${t.id}`} subtitle={`${kigaliTime(t.created_at)} · ${t.vehicle_type ?? ''} · ${DISPATCH_LABEL[t.dispatch_method ?? ''] ?? t.dispatch_method ?? ''}`} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Label tone={st.tone}>{st.label}</Label>
          {t.fraud_flag && <Label tone="danger" icon={Flag}>Flagged by the platform</Label>}
          {t.code_verified && <Label tone="success">Trip code checked</Label>}
          {t.rejected_driver_count > 0 && <Label tone="attention">{t.rejected_driver_count} driver{t.rejected_driver_count === 1 ? '' : 's'} declined</Label>}
          {route && <a href={route} target="_blank" rel="noreferrer" className="ml-auto btn-ghost text-caption"><ExternalLink size={13} /> Route on Google Maps</a>}
        </div>

        <section>
          <h3 className="text-body font-semibold mb-2 flex items-center gap-1.5"><Clock size={14} /> Timeline</h3>
          <ol className="space-y-1.5">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2 text-small">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.at ? (s.label === 'Cancelled' ? 'bg-danger' : 'bg-success') : 'bg-line-strong'}`} />
                <span className={`w-36 ${s.at ? '' : 'text-fg-subtle'}`}>{s.label}</span>
                <span className="tabular-nums">{s.at ? kigaliTime(s.at) : '—'}</span>
                {s.note && <span className="text-caption text-fg-muted">· {s.note}</span>}
              </li>
            ))}
          </ol>
          {!!detail?.log.length && <p className="mt-2 text-caption text-fg-muted">Seen by our sync: {detail.log.map((l) => `${statusOf(l.status).label} (${kigaliTime(l.seen_at, false)})`).join(' → ')}</p>}
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <section className="rounded-lg border border-line p-3">
            <h3 className="text-body font-semibold mb-1.5 flex items-center gap-1.5"><MapPin size={14} /> Route</h3>
            <p className="text-small"><span className="text-success font-medium">From</span> {t.pickup_address ?? '—'}</p>
            <p className="text-small mt-1"><span className="text-danger font-medium">To</span> {t.destination_address ?? '—'}</p>
            {row('Distance', (t.actual_distance_km ?? t.estimated_distance_km) !== null ? `${Number(t.actual_distance_km ?? t.estimated_distance_km).toFixed(1)} km${t.actual_distance_km === null ? ' (estimated)' : ''}` : '—')}
            {row('Duration', (t.actual_duration_minutes ?? t.estimated_duration_minutes) !== null ? `${Math.round(Number(t.actual_duration_minutes ?? t.estimated_duration_minutes))} min${t.actual_duration_minutes === null ? ' (estimated)' : ''}` : '—')}
            {row('Passengers', t.passenger_count ?? '—')}
          </section>
          <section className="rounded-lg border border-line p-3">
            <h3 className="text-body font-semibold mb-1.5 flex items-center gap-1.5"><CircleDollarSign size={14} /> Fare</h3>
            {row('Base', t.base_fare !== null ? rwf(Number(t.base_fare)) : '—')}
            {row('Distance', t.distance_fare !== null ? rwf(Number(t.distance_fare)) : '—')}
            {row('Time', t.time_fare !== null ? rwf(Number(t.time_fare)) : '—')}
            {Number(t.waiting_fee) > 0 && row(`Waiting (${t.waiting_minutes} min)`, rwf(Number(t.waiting_fee)))}
            {extras.map((x, i) => <div key={i}>{row(`Extra: ${x.reason}`, rwf(Number(x.amount)))}</div>)}
            {Number(t.surge_multiplier) > 1 && row('Surge', `× ${t.surge_multiplier}`)}
            <div className="border-t border-line-muted mt-1 pt-1">{row(<b>Total</b>, <b>{t.total_fare !== null ? rwf(Number(t.total_fare)) : '—'}</b>)}</div>
            {row('Payment', `${PAYMENT_LABEL[t.payment_method ?? ''] ?? t.payment_method ?? '—'} · ${t.payment_status === 'success' ? 'paid' : t.payment_status ?? '—'}`)}
          </section>
          <section className="rounded-lg border border-line p-3">
            <h3 className="text-body font-semibold mb-1.5 flex items-center gap-1.5"><User size={14} /> Rider</h3>
            <p className="text-small">{t.rider_name ?? '—'} <span className="text-fg-muted">· {t.rider_kind === 'guest' ? 'booked for a guest' : t.rider_kind === 'app' ? 'rider app' : 'unknown'}</span></p>
            {t.rider_phone && <a href={`tel:${t.rider_phone}`} className="link text-small">{t.rider_phone}</a>}
            {t.rider_rating !== null && <p className="text-small mt-1 flex items-center gap-1"><Star size={12} className="text-attention" /> Rated the trip {t.rider_rating}/5</p>}
            {t.rider_feedback && <p className="text-caption text-fg-muted mt-0.5">“{t.rider_feedback}”</p>}
          </section>
          <section className="rounded-lg border border-line p-3">
            <h3 className="text-body font-semibold mb-1.5 flex items-center gap-1.5"><Car size={14} /> Driver & car</h3>
            {t.driver_name ? <>
              <p className="text-small">{t.kivu_driver_id ? <EntityLink type="driver" id={t.kivu_driver_id} label={t.driver_name} /> : t.driver_name}{Number(t.driver_rating) > 0 && <span className="text-fg-muted"> · {Number(t.driver_rating).toFixed(1)}★</span>}</p>
              {t.driver_phone && <a href={`tel:${t.driver_phone}`} className="link text-small">{t.driver_phone}</a>}
              <p className="text-small mt-1">{t.kivu_vehicle_id ? <EntityLink type="car" id={t.kivu_vehicle_id} label={t.vehicle_plate ?? ''} className="font-mono" /> : <span className="font-mono">{t.vehicle_plate}</span>} <span className="text-fg-muted">{t.vehicle_label}</span></p>
              {(t.kivu_driver_id || t.kivu_vehicle_id) && <span className="mt-1 inline-block"><Label tone="accent">Our fleet</Label></span>}
            </> : <p className="text-small text-fg-muted">No driver assigned.</p>}
            {t.driver_rating_of_rider !== null && <p className="text-small mt-1 flex items-center gap-1"><Star size={12} className="text-attention" /> Rated the rider {t.driver_rating_of_rider}/5</p>}
            {t.driver_feedback && <p className="text-caption text-fg-muted mt-0.5">“{t.driver_feedback}”</p>}
          </section>
        </div>
        <p className="text-caption text-fg-muted flex items-center gap-1.5"><Timer size={12} /> Last changed {kigaliTime(t.status_changed_at)} · distance from {t.distance_source?.replace(/_/g, ' ') ?? '—'}</p>
      </div>
    </Modal>
  );
}
