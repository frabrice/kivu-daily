import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Clock, Phone, Radio, RefreshCw, Settings2, Wifi, WifiOff, HelpCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { APP_STATUS, Presence, RosterRow, ShiftKey, needsCall, onlineMinutes, presenceOf, shiftLabelOf, stateOf, toExpected, useOnShift, OFFLINE_GRACE_MIN } from '../../lib/onShift';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs } from '../../ui/kit';
import Modal from '../../components/Modal';

// Ours On Shift: every one of our drivers (and freelancers) who should be
// driving, and whether they are online in the Kivu Ride app. Fleet and the
// Call Center check it all day; a driver offline during their shift gets
// a call. Shown under Fleet and under Call Center.

type View = 'now' | 'day' | 'night';
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' });
const dur = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`);
const ago = (iso: string | null, now: number) => { if (!iso) return '—'; const m = Math.round((now - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : `${dur(m)} ago`; };
const ORDER: Record<Presence, number> = { offline: 0, stale: 1, not_in_app: 2, online: 3, blocked: 4 };

export default function OnShiftPage() {
  usePageTitle('Ours On Shift');
  const a = useAccess();
  const d = useOnShift();
  const [view, setView] = useState<View>('now');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const canEditHours = a.isMd || a.dept === 'fleet';
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

  const refresh = async () => { setBusy(true); setError(''); const err = await d.refresh(); setBusy(false); if (err) setError(err); };

  if (d.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Radio} title="Ours On Shift"
        subtitle="Our drivers who should be driving, and whether they are online in the Kivu Ride app. Anyone offline during their shift gets a call."
        meta={<><span className={late ? 'text-danger' : ''}>App checked {ago(lastOk, d.now)}{late ? ' — the check is late' : ' · every 2 minutes'}</span><span>{shiftLabelOf(d.hours, 'day')} · {shiftLabelOf(d.hours, 'night')}</span></>}
        actions={<>
          {canEditHours && <button onClick={() => setEditing(true)} className="btn-ghost"><Settings2 size={14} /> Shift hours</button>}
          <button onClick={refresh} disabled={busy} className="btn-secondary"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Checking…' : 'Check now'}</button>
        </>} />
      {(error || d.sync?.last_error) && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">Couldn't read the app: {error || d.sync?.last_error}</p>}

      <UnderlineTabs<View> value={view} onChange={setView} tabs={[
        { key: 'now', label: 'On shift now', icon: Radio },
        { key: 'day', label: shiftLabelOf(d.hours, 'day'), icon: Clock },
        { key: 'night', label: shiftLabelOf(d.hours, 'night'), icon: Clock },
      ]} />

      <StatGrid cols={4}>
        <StatCard icon={Radio} label={view === 'now' ? 'Should be driving now' : 'On this shift'} value={driving.length} sub={kept.length ? `+ ${kept.length} kept off the road` : 'Drivers and freelancers'} />
        <StatCard icon={Wifi} label="Online in the app" value={onlineN} tone={driving.length && onlineN === driving.length ? 'success' : undefined} sub={driving.length ? `${Math.round((onlineN / driving.length) * 100)}% of them` : '—'} />
        <StatCard icon={WifiOff} label="Offline — call them" value={toCall.length} tone={toCall.length ? 'danger' : 'success'} sub={toCall.length ? `Offline ${OFFLINE_GRACE_MIN}+ min during their shift` : 'Nobody to call'} />
        <StatCard icon={HelpCircle} label="Not found in the app" value={missing.length} tone={missing.length ? 'attention' : undefined} sub={missing.length ? 'Phone in Kivu Daily ≠ phone in the app' : 'Everyone matched'} />
      </StatGrid>

      <Box title={view === 'now' ? 'Who should be driving now' : `${shiftLabelOf(d.hours, view as ShiftKey)} · ${rows[0] ? new Date(rows[0].e.start).toLocaleDateString('en-GB', { timeZone: 'Africa/Kigali', weekday: 'long', day: 'numeric', month: 'short' }) : ''}`} icon={Radio} padded={false} className="mb-4">
        {driving.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-small min-w-[760px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">
                <th className="px-3 py-2">Driver</th><th className="px-3 py-2">Car · shift</th><th className="px-3 py-2">In the app</th><th className="px-3 py-2">Online this shift</th><th className="px-3 py-2">Last seen</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody>{driving.map((x) => <Row key={x.r.key} x={x} now={d.now} inFleet={inFleet} />)}</tbody>
            </table>
          </div>
        ) : <EmptyState icon={Radio} title={view === 'now' ? 'Nobody should be driving right now' : 'Nobody on this shift'} body="Drivers appear here from their car, shift, rest day and approved days off, plus freelancers covering a seat." />}
      </Box>

      {kept.length > 0 && (
        <Box title={`Kept off the road (${kept.length})`} icon={Ban} padded={false} className="mb-4">
          <p className="px-4 pt-3 text-caption text-fg-muted">Not cleared to drive until they pay — they are not expected online, so don't ask them to go online.</p>
          <ul className="divide-y divide-line-muted mt-2">{kept.map((x) => (
            <li key={x.r.key} className="flex flex-wrap items-center gap-3 px-4 py-2 text-small">
              <span className="flex-1 min-w-[180px] font-medium">{x.r.name}</span>
              <span className="text-fg-muted">{x.r.plate ?? '—'} · {x.r.shift === 'day' ? 'Day' : 'Night'}</span>
              <Label tone="neutral">{x.r.blocked}</Label>
              {x.s?.is_online && <Label tone="attention">Online anyway</Label>}
            </li>
          ))}</ul>
        </Box>
      )}

      <p className="text-caption text-fg-muted">
        Online = the driver switched themselves online in the Kivu Ride driver app. Someone offline less than {OFFLINE_GRACE_MIN} minutes isn't flagged yet (between trips, a phone restarting).
        "No sign of the app" = shown online, but the phone hasn't reached the app for 15+ minutes (phone off, no data).
        {missing.length > 0 && inFleet && <> To match someone not found, make their phone in <Link to="/fleet/drivers" className="link">Drivers</Link> the same as in the app.</>}
      </p>
      {editing && <HoursModal hours={d.hours} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await refresh(); }} />}
    </div>
  );
}

function Row({ x, now, inFleet }: { x: { r: RosterRow; s: ReturnType<typeof stateOf>; p: { presence: Presence; minutes: number }; online: number; length: number; started: boolean; call: boolean }; now: number; inFleet: boolean }) {
  const { r, s, p } = x;
  const pct = x.length ? Math.min(100, Math.round((x.online / x.length) * 100)) : 0;
  const chip = !x.started ? <Label tone="neutral">Starts {clock(Date.parse(r.starts_at))}</Label>
    : p.presence === 'online' ? <Label tone="success" icon={Wifi}>{APP_STATUS[s?.driver_status ?? 'online'] ?? 'Online'}{p.minutes >= 1 ? ` · ${dur(p.minutes)}` : ''}</Label>
    : p.presence === 'stale' ? <Label tone="attention" icon={WifiOff}>No sign of the app for {dur(p.minutes)}</Label>
    : p.presence === 'offline' ? <Label tone={x.call ? 'danger' : 'attention'} icon={WifiOff}>Offline · {dur(p.minutes)}</Label>
    : <Label tone="neutral" icon={HelpCircle}>Not found in the app</Label>;
  return (
    <tr className={`border-t border-line-muted ${x.call ? 'bg-danger-muted/30' : ''}`}>
      <td className="px-3 py-2">
        <span className="font-medium">{r.name}</span>{r.kind === 'freelancer' && <span className="ml-1.5"><Label tone="info">Freelancer</Label></span>}
        {r.phone && <span className="block text-caption text-fg-muted tabular-nums">{r.phone}</span>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{inFleet && r.vehicle_id ? <Link to={`/fleet/cars`} className="link">{r.plate ?? '—'}</Link> : r.plate ?? '—'}<span className="block text-caption text-fg-muted">{r.shift === 'day' ? 'Day' : 'Night'} {clock(Date.parse(r.starts_at))}–{clock(Date.parse(r.ends_at))}</span></td>
      <td className="px-3 py-2">{chip}</td>
      <td className="px-3 py-2 w-48">{x.started && s ? (
        <div>
          <div className="h-1.5 rounded-full bg-inset overflow-hidden"><div className={`h-full rounded-full ${pct >= 90 ? 'bg-success' : pct >= 60 ? 'bg-attention' : 'bg-danger'}`} style={{ width: `${pct}%` }} /></div>
          <span className="text-caption text-fg-muted tabular-nums">{dur(x.online)} of {dur(x.length)} · {pct}%</span>
        </div>
      ) : <span className="text-caption text-fg-subtle">—</span>}</td>
      <td className="px-3 py-2 text-caption text-fg-muted whitespace-nowrap">{s ? ago(s.last_seen_at, now) : '—'}{s?.app_version && <span className="block text-fg-subtle">app {s.app_version}</span>}</td>
      <td className="px-3 py-2 text-right">{r.phone && <a href={`tel:${r.phone.replace(/\s/g, '')}`} className={`${x.call ? 'btn-primary' : 'btn-ghost'} h-8 inline-flex items-center gap-1 whitespace-nowrap`}><Phone size={13} /> Call</a>}</td>
    </tr>
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
