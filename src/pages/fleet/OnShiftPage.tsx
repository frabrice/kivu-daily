import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Clock, Link2, Navigation, Phone, Radio, RefreshCw, Search, Settings2, Wifi, WifiOff, HelpCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { APP_STATUS, Presence, RosterRow, ShiftKey, kigaliDay, needsCall, onlineMinutes, presenceOf, shiftLabelOf, stateOf, toExpected, useOnShift, OFFLINE_GRACE_MIN } from '../../lib/onShift';
import { Offer, Trip, loadActivity } from '../../lib/driverPerformance';
import { DriverAvatar } from '../../components/fleet/driverUi';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { EmptyState, Label, PageHeader, UnderlineTabs } from '../../ui/kit';
import Modal from '../../components/Modal';
import { kFormat } from '../../lib/kigali';

// Ours On Shift: every one of our drivers (and freelancers) who should be
// driving, and whether they are online in the Kivu Ride app. Fleet and the
// Call Center check it all day; a driver offline during their shift gets
// a call. Shown under Call Center, and as the "On shift now" tab of Fleet ->
// Under Management (embedded: no page header of its own).

type View = 'now' | 'day' | 'night';
const clock = (ms: number) => kFormat(ms, 'en-GB', { hour: '2-digit', minute: '2-digit' });
const dur = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`);
const ago = (iso: string | null, now: number) => { if (!iso) return '—'; const m = Math.round((now - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : `${dur(m)} ago`; };
const ORDER: Record<Presence, number> = { offline: 0, stale: 1, not_in_app: 2, online: 3, blocked: 4 };

export default function OnShiftPage({ embedded = false }: { embedded?: boolean }) {
  usePageTitle(embedded ? 'Under Management' : 'Ours On Shift');
  const a = useAccess();
  const d = useOnShift();
  const [view, setView] = useState<View>('now');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const canEditHours = a.isMd || a.dept === 'fleet';
  // Linking a driver to their app account by hand: Fleet, IT and the MD.
  const canLink = a.isMd || a.dept === 'fleet' || a.dept === 'it';
  const [linking, setLinking] = useState<RosterRow | null>(null);
  const inFleet = a.in('fleet', 'it', 'finance');

  const rows = useMemo(() => {
    const list = d.roster.filter((r) => (view === 'now' ? Date.parse(r.starts_at) <= d.now && d.now < Date.parse(r.ends_at) : r.shift === view));
    // A driver on both shifts appears once in "Now".
    const unique = view === 'now' ? [...new Map(list.map((r) => [r.driver_id ?? r.key, r])).values()] : list;
    return unique.map((r) => {
      const e = toExpected(r);
      const s = stateOf(e, d.states);
      const started = e.start <= d.now;
      const p = started ? presenceOf(e, s, d.now) : { presence: (e.blocked ? 'blocked' : s ? (s.is_online ? 'online' : 'offline') : 'not_in_app') as Presence, minutes: 0 };
      const online = s && started ? onlineMinutes(s.platform_driver_id, d.log, s.is_online, e.start, Math.min(d.now, e.end)) : 0;
      const length = started ? Math.round((Math.min(d.now, e.end) - e.start) / 60000) : 0;
      return { r, e, s, p, online, length, started, call: started && needsCall(p) };
    }).sort((x, y) => Number(y.call) - Number(x.call) || ORDER[x.p.presence] - ORDER[y.p.presence] || y.p.minutes - x.p.minutes || x.r.name.localeCompare(y.r.name));
  }, [d.roster, d.states, d.log, d.now, view]);

  const driving = rows.filter((x) => x.p.presence !== 'blocked');
  const kept = rows.filter((x) => x.p.presence === 'blocked');
  const onlineN = driving.filter((x) => x.p.presence === 'online').length;
  const toCall = driving.filter((x) => x.call);
  const missing = driving.filter((x) => x.p.presence === 'not_in_app');
  const lastOk = d.sync?.last_ok_at ?? null;
  const late = !lastOk || d.now - Date.parse(lastOk) > 6 * 60000;

  // Today's trips and offers for everyone here (Driver performance has the full record).
  const [today, setToday] = useState<{ trips: Trip[]; offers: Offer[] } | null>(null);
  const pidKey = d.states.map((s) => s.platform_driver_id).sort().join(',');
  useEffect(() => {
    const pids = pidKey ? pidKey.split(',').map(Number) : [];
    const start = Date.parse(`${kigaliDay(Date.now())}T00:00:00+02:00`);
    let live = true;
    loadActivity(pids, start, Date.now() + 60_000).then((x) => { if (live) setToday(x); }).catch(() => { if (live) setToday({ trips: [], offers: [] }); });
    return () => { live = false; };
  }, [pidKey, d.sync?.last_ok_at]);
  const todayOf = (s: ReturnType<typeof stateOf>) => {
    if (!s || !today) return null;
    const pid = s.platform_driver_id;
    const trips = today.trips.filter((t) => t.platform_driver_id === pid);
    const offers = today.offers.filter((o) => o.platform_driver_id === pid);
    return { trips: trips.length, fare: trips.reduce((a, t) => a + Number(t.total_fare ?? 0), 0), ignored: offers.filter((o) => o.outcome === 'ignored').length, refused: offers.filter((o) => o.outcome === 'refused').length, accepted: offers.filter((o) => o.outcome === 'accepted' || o.outcome === 'dropped').length };
  };
  const tripsToday = driving.reduce((a, x) => a + (todayOf(x.s)?.trips ?? 0), 0);

  const refresh = async () => { setBusy(true); setError(''); const err = await d.refresh(); setBusy(false); if (err) setError(err); };

  if (d.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
  const actions = <>
    {canEditHours && <button onClick={() => setEditing(true)} className="btn-ghost whitespace-nowrap"><Settings2 size={14} /> Shift hours</button>}
    <button onClick={refresh} disabled={busy} className="btn-secondary"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Checking…' : 'Check now'}</button>
  </>;
  const checked = <span className={late ? 'text-danger' : ''}>App checked {ago(lastOk, d.now)}{late ? ' — the check is late' : ' · every 2 minutes'}</span>;
  return (
    <div className="animate-fade-in">
      {embedded ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3 text-caption text-fg-muted">
          {checked}<span>{shiftLabelOf(d.hours, 'day')} · {shiftLabelOf(d.hours, 'night')}</span>
          <span className="ml-auto flex gap-2">{actions}</span>
        </div>
      ) : <PageHeader icon={Radio} title="Ours On Shift"
        subtitle="Our drivers who should be driving now, and whether they are online in the Kivu Ride app. Anyone offline during their shift gets a call."
        meta={<>{checked}<span>{shiftLabelOf(d.hours, 'day')} · {shiftLabelOf(d.hours, 'night')}</span>{inFleet && <Link to="/fleet/performance" className="link">Driver performance →</Link>}</>}
        actions={actions} />}
      {(error || d.sync?.last_error) && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">Couldn't read the app: {error || d.sync?.last_error}</p>}

      <UnderlineTabs<View> value={view} onChange={setView} tabs={[
        { key: 'now', label: 'On shift now', icon: Radio },
        { key: 'day', label: shiftLabelOf(d.hours, 'day'), icon: Clock },
        { key: 'night', label: shiftLabelOf(d.hours, 'night'), icon: Clock },
      ]} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Tile label={view === 'now' ? 'Should be driving now' : 'On this shift'} icon={Radio} value={driving.length} sub={kept.length ? `+ ${kept.length} kept off the road` : 'Drivers and freelancers'} />
        <Tile label="Online in the app" icon={Wifi} value={onlineN} sub={driving.length ? `${Math.round((onlineN / driving.length) * 100)}% of them` : '—'} />
        <Tile label="Offline — call them" icon={WifiOff} value={toCall.length} alarm={toCall.length > 0} sub={toCall.length ? `Offline ${OFFLINE_GRACE_MIN}+ min in their shift` : 'Nobody to call'} />
        <Tile label="Not found in the app" icon={HelpCircle} value={missing.length} alarm={missing.length > 0} sub={missing.length ? 'Phone differs from the app' : 'Everyone matched'} />
        <Tile label="Trips today" icon={Navigation} value={today ? tripsToday : '…'} sub="By the drivers listed here" />
      </div>

      <div className="card p-0 mb-4">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line-muted">
          <h2 className="text-small font-semibold mr-auto">{view === 'now' ? 'Who should be driving now' : `${shiftLabelOf(d.hours, view as ShiftKey)} · ${rows[0] ? kFormat(rows[0].e.start, 'en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) : ''}`}
            <span className="text-fg-muted font-normal"> · {driving.length}</span></h2>
          {toCall.length > 0 && <span className="text-caption text-fg-muted flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-danger" aria-hidden />{toCall.length} to call, at the top</span>}
        </div>
        {driving.length ? (<>
          <div className={`hidden lg:grid ${ROW_GRID} gap-4 px-4 py-2 text-micro font-medium uppercase tracking-wide text-fg-subtle border-b border-line-muted bg-surface-2`}>
            <span>Driver</span><span>Car · shift</span><span>In the app</span><span>Online this shift</span><span>Today</span><span />
          </div>
          <ul className="divide-y divide-line-muted">{driving.map((x) => <Row key={x.r.key} x={x} now={d.now} inFleet={inFleet} today={todayOf(x.s)} onLink={canLink ? () => setLinking(x.r) : undefined} />)}</ul>
        </>) : <EmptyState icon={Radio} title={view === 'now' ? 'Nobody should be driving right now' : 'Nobody on this shift'} body="Drivers appear here from their car, shift, rest day and approved days off, plus freelancers covering a seat." />}
      </div>

      {kept.length > 0 && (
        <div className="card p-0 mb-4">
          <div className="px-4 py-3 border-b border-line-muted">
            <h2 className="text-small font-semibold flex items-center gap-2"><Ban size={14} className="text-fg-subtle" /> Kept off the road <span className="text-fg-muted font-normal">· {kept.length}</span></h2>
            <p className="text-caption text-fg-muted mt-0.5">Not cleared to drive until they pay — they are not expected online, so don't ask them to go online.</p>
          </div>
          <ul className="divide-y divide-line-muted">{kept.map((x) => (
            <li key={x.r.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-small">
              <DriverAvatar name={x.r.name} size={28} />
              <span className="flex-1 min-w-[180px] font-medium">{x.r.name}</span>
              <span className="text-caption text-fg-muted">{x.r.plate ?? '—'} · {x.r.shift === 'day' ? 'Day' : 'Night'}</span>
              <span className="text-caption text-fg-muted">{x.r.blocked}</span>
              {x.s?.is_online && <span className="text-caption text-fg flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-attention" aria-hidden />Online anyway</span>}
            </li>
          ))}</ul>
        </div>
      )}

      <p className="text-caption text-fg-muted">
        Online = the driver switched themselves online in the Kivu Ride driver app. Someone offline less than {OFFLINE_GRACE_MIN} minutes isn't flagged yet (between trips, a phone restarting).
        "No sign of the app" = shown online, but the phone hasn't reached the app for 15+ minutes (phone off, no data). Today = completed trips, and offers they let run out without answering.
        {missing.length > 0 && inFleet && <> To match someone not found, make their phone in <Link to="/fleet/drivers" className="link">Drivers</Link> the same as in the app.</>}
      </p>
      {linking && <LinkModal row={linking} onClose={() => setLinking(null)} onLinked={async () => { setLinking(null); await refresh(); }} />}
      {editing && <HoursModal hours={d.hours} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await refresh(); }} />}
    </div>
  );
}

const ROW_GRID = 'lg:grid-cols-[minmax(220px,1.4fr)_minmax(130px,0.8fr)_minmax(190px,1.1fr)_minmax(150px,0.9fr)_minmax(130px,0.8fr)_auto]';

function Tile({ label, value, sub, icon: Icon, alarm }: { label: string; value: ReactNode; sub: ReactNode; icon: typeof Wifi; alarm?: boolean }) {
  return (
    <div className="card p-3.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-medium text-fg-muted truncate flex items-center gap-1.5">{alarm && <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" aria-hidden />}{label}</span>
        <Icon size={14} className="text-fg-subtle shrink-0" />
      </div>
      <p className="mt-2 text-h2 font-semibold leading-none tabular-nums text-fg">{value}</p>
      <p className="text-caption text-fg-muted mt-1.5 truncate">{sub}</p>
    </div>
  );
}

type TodayNums = { trips: number; fare: number; ignored: number; refused: number; accepted: number } | null;
function Row({ x, now, inFleet, today, onLink }: { x: { r: RosterRow; s: ReturnType<typeof stateOf>; p: { presence: Presence; minutes: number }; online: number; length: number; started: boolean; call: boolean }; now: number; inFleet: boolean; today: TodayNums; onLink?: () => void }) {
  const { r, s, p } = x;
  const pct = x.length ? Math.min(100, Math.round((x.online / x.length) * 100)) : 0;
  // One dot carries the state; the words say it.
  const state: { dot: string; text: string } = !s ? { dot: 'bg-line-strong', text: 'Not found in the app' }
    : !x.started ? { dot: 'bg-line-strong', text: `Starts ${clock(Date.parse(r.starts_at))}` }
    : p.presence === 'online' ? { dot: 'bg-success', text: `${APP_STATUS[s.driver_status ?? 'online'] ?? 'Online'}${p.minutes >= 1 ? ` · ${dur(p.minutes)}` : ''}` }
    : p.presence === 'stale' ? { dot: 'bg-attention', text: `No sign of the app for ${dur(p.minutes)}` }
    : p.presence === 'offline' ? { dot: x.call ? 'bg-danger' : 'bg-attention', text: `Offline · ${dur(p.minutes)}` }
    : { dot: 'bg-line-strong', text: 'Not found in the app' };
  return (
    <li className={`grid grid-cols-2 ${ROW_GRID} gap-x-4 gap-y-2 px-4 py-3 items-center`}>
      <div className="col-span-2 lg:col-span-1 flex items-center gap-3 min-w-0">
        <DriverAvatar name={r.name} size={34} />
        <div className="min-w-0">
          <p className="font-medium leading-snug break-words">{r.name}{r.kind === 'freelancer' && <span className="ml-1.5 text-micro font-medium text-fg-muted border border-line rounded-full px-1.5 py-px align-middle">Freelancer</span>}</p>
          {r.phone && <p className="text-caption text-fg-muted tabular-nums">{r.phone}</p>}
        </div>
      </div>
      <div className="min-w-0 text-small">
        {inFleet && r.vehicle_id ? <Link to="/fleet/cars" className="link">{r.plate ?? '—'}</Link> : <span>{r.plate ?? '—'}</span>}
        <p className="text-caption text-fg-muted">{r.shift === 'day' ? 'Day' : 'Night'} {clock(Date.parse(r.starts_at))}–{clock(Date.parse(r.ends_at))}</p>
      </div>
      <div className="min-w-0">
        <p className={`text-small flex items-center gap-1.5 ${x.call ? 'text-danger font-medium' : 'text-fg'}`}><span className={`w-2 h-2 rounded-full shrink-0 ${state.dot}`} aria-hidden />{state.text}</p>
        <p className="text-caption text-fg-muted truncate">
          {s ? <>Seen {ago(s.last_seen_at, now)}{s.app_version ? ` · app ${s.app_version}` : ''}</> : null}
          {!s && onLink && <button onClick={onLink} className="link inline-flex items-center gap-1"><Link2 size={11} /> Link to the app</button>}
        </p>
        {s?.match_method === 'plate_name' && <p className="text-caption text-fg-muted" title={`Phone in the app: ${s.phone ?? '—'}`}>Found by car &amp; name — phone differs ({s.phone ?? '—'}){onLink && <> · <button onClick={onLink} className="link">check</button></>}</p>}
        {s?.match_method === 'link' && <p className="text-caption text-fg-subtle">Linked by hand{onLink && <> · <button onClick={onLink} className="link">change</button></>}</p>}
      </div>
      <div className="min-w-0">
        {x.started && s ? (<>
          <div className="flex items-baseline justify-between gap-2 text-caption"><span className="text-fg font-medium tabular-nums">{dur(x.online)}</span><span className="text-fg-muted tabular-nums">{pct}% of {dur(x.length)}</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-inset overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
        </>) : <span className="text-caption text-fg-subtle">—</span>}
      </div>
      <div className="min-w-0 text-caption">
        {today ? (<>
          <p><span className="text-small font-semibold tabular-nums">{today.trips}</span> <span className="text-fg-muted">trip{today.trips === 1 ? '' : 's'}{today.fare ? ` · ${Math.round(today.fare / 1000)}k` : ''}</span></p>
          <p className="text-fg-muted">{today.ignored ? <span className="text-fg">{today.ignored} ignored</span> : 'none ignored'}{today.refused ? ` · ${today.refused} refused` : ''}</p>
        </>) : <span className="text-fg-subtle">—</span>}
      </div>
      <div className="col-span-2 lg:col-span-1 flex lg:justify-end">
        {r.phone && <a href={`tel:${r.phone.replace(/\s/g, '')}`} className={`${x.call ? 'btn-primary' : 'btn-ghost'} h-8 inline-flex items-center gap-1 whitespace-nowrap`}><Phone size={13} /> Call</a>}
      </div>
    </li>
  );
}

function HoursModal({ hours, onClose, onSaved }: { hours: ReturnType<typeof useOnShift>['hours']; onClose: () => void; onSaved: () => void }) {
  const [h, setH] = useState(hours);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    for (const s of ['day', 'night'] as ShiftKey[]) {
      const { error: err } = await supabase.from('fleet_shift_hours').update({ starts: h[s].starts, ends: h[s].ends, updated_at: new Date().toISOString() }).eq('shift', s);
      if (err) { setError(err.message); return; }
    }
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Shift hours" subtitle="When the day and the night shift start and end. A driver on both shifts is expected all day." maxWidth="max-w-sm">
      <div className="space-y-3">
        {(['day', 'night'] as ShiftKey[]).map((s) => (
          <div key={s} className="grid grid-cols-3 items-end gap-2">
            <span className="text-small font-medium pb-2">{s === 'day' ? 'Day shift' : 'Night shift'}</span>
            <label className="block"><span className="text-caption text-fg-muted">Starts</span><input type="time" value={h[s].starts} onChange={(e) => setH({ ...h, [s]: { ...h[s], starts: e.target.value } })} className="input" /></label>
            <label className="block"><span className="text-caption text-fg-muted">Ends</span><input type="time" value={h[s].ends} onChange={(e) => setH({ ...h, [s]: { ...h[s], ends: e.target.value } })} className="input" /></label>
          </div>
        ))}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={save} className="btn-primary">Save</button></div>
      </div>
    </Modal>
  );
}

// Link a driver (or freelancer) to their account in the Kivu Ride app, when
// the phone doesn't match. Accounts on the same car, with the same name or
// the same phone come first.
interface Account { platform_driver_id: number; full_name: string | null; phone: string | null; vehicle_plate: string | null; is_online: boolean; driver_status: string | null; kivu_driver_id: string | null; freelancer_id: string | null; match_method: string | null }
const words = (n: string | null | undefined) => new Set((n ?? '').toLowerCase().normalize('NFD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3));
const digits9 = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-9);
const plateK = (p: string | null | undefined) => (p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function LinkModal({ row, onClose, onLinked }: { row: RosterRow; onClose: () => void; onLinked: () => void }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const who = row.driver_id ? { driver_id: row.driver_id } : { freelancer_id: row.freelancer_id };
  useEffect(() => {
    (async () => {
      const [acc, link] = await Promise.all([
        supabase.from('platform_driver_status').select('platform_driver_id, full_name, phone, vehicle_plate, is_online, driver_status, kivu_driver_id, freelancer_id, match_method').order('full_name'),
        row.driver_id ? supabase.from('driver_app_links').select('platform_driver_id').eq('driver_id', row.driver_id).maybeSingle() : supabase.from('driver_app_links').select('platform_driver_id').eq('freelancer_id', row.freelancer_id ?? '').maybeSingle(),
      ]);
      setAccounts((acc.data as Account[]) ?? []);
      setCurrent((link.data as { platform_driver_id: number } | null)?.platform_driver_id ?? null);
    })();
  }, [row.driver_id, row.freelancer_id]);
  const mine = words(row.name);
  const score = (x: Account) => (digits9(x.phone) && digits9(x.phone) === digits9(row.phone) ? 4 : 0) + (row.plate && plateK(x.vehicle_plate) === plateK(row.plate) ? 2 : 0) + 2 * [...words(x.full_name)].filter((w) => mine.has(w)).length;
  const list = (accounts ?? [])
    .filter((x) => { const n = q.trim().toLowerCase(); return n ? [x.full_name, x.phone, x.vehicle_plate].join(' ').toLowerCase().includes(n) : score(x) > 0; })
    .sort((a, b) => score(b) - score(a) || Number(b.is_online) - Number(a.is_online) || (a.full_name ?? '').localeCompare(b.full_name ?? ''))
    .slice(0, 30);
  const link = async (x: Account) => {
    setBusy(true); setError('');
    // One link per person: replace any earlier one.
    const del = row.driver_id ? await supabase.from('driver_app_links').delete().eq('driver_id', row.driver_id) : await supabase.from('driver_app_links').delete().eq('freelancer_id', row.freelancer_id ?? '');
    const res = del.error ? del : await supabase.from('driver_app_links').insert({ ...who, platform_driver_id: x.platform_driver_id });
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onLinked();
  };
  const unlink = async () => {
    setBusy(true); setError('');
    const res = row.driver_id ? await supabase.from('driver_app_links').delete().eq('driver_id', row.driver_id) : await supabase.from('driver_app_links').delete().eq('freelancer_id', row.freelancer_id ?? '');
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onLinked();
  };
  return (
    <Modal open onClose={onClose} title={`Link ${row.name} to the app`} subtitle={`Choose their account in the Kivu Ride app. Phone in Kivu Daily: ${row.phone ?? '—'} · car ${row.plate ?? '—'}.`} maxWidth="max-w-xl">
      <div className="space-y-3">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search the app: name, phone or plate" /></div>
        {accounts === null ? <div className="h-24 skeleton rounded" /> : list.length ? (
          <ul className="max-h-[340px] overflow-y-auto rounded-md border border-line-muted divide-y divide-line-muted">{list.map((x) => {
            const taken = (x.kivu_driver_id && x.kivu_driver_id !== row.driver_id) || (x.freelancer_id && x.freelancer_id !== row.freelancer_id);
            return (
              <li key={x.platform_driver_id} className="flex items-center gap-3 px-3 py-2 text-small">
                <span className="flex-1 min-w-0"><b>{x.full_name ?? '—'}</b> <span className="text-caption text-fg-muted">#{x.platform_driver_id}</span>
                  <span className="block text-caption text-fg-muted">{x.phone ?? 'no phone'} · {x.vehicle_plate ?? 'no car'}{taken ? ' · linked to someone else in Kivu Daily' : ''}</span></span>
                {x.is_online ? <Label tone="success" icon={Wifi}>{APP_STATUS[x.driver_status ?? 'online'] ?? 'Online'}</Label> : <Label tone="neutral">Offline</Label>}
                {current === x.platform_driver_id ? <Label tone="accent">Linked</Label> : <button onClick={() => link(x)} disabled={busy} className="btn-secondary h-8 disabled:opacity-50"><Link2 size={13} /> Link</button>}
              </li>
            );
          })}</ul>
        ) : <p className="text-small text-fg-muted rounded-md bg-inset px-3 py-2">{q ? 'No account in the app matches.' : 'No account on the same car, with the same name or phone. Search by name, phone or plate.'}</p>}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-between gap-2 pt-3 border-t border-line-muted">
          {current !== null ? <button onClick={unlink} disabled={busy} className="btn-ghost text-danger">Remove the link</button> : <span />}
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      </div>
    </Modal>
  );
}
