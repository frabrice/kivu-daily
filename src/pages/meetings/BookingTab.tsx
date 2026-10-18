import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, CheckCircle2, Clock, Plus, Settings2, Trash2, UserCheck, Users2, X, XCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { DAY_NAMES, MeetingsData, kigaliToday } from '../../lib/meetings';
import { useAccess } from '../../os/access';
import { Box, Label } from '../../ui/kit';
import Modal from '../../components/Modal';
import { ScheduleModal, ScheduledMeetings } from './ScheduleWithAnyone';

// Booking meetings with the MD (migration 20261028100000): staff see what
// they can book and pick a free time; the MD answers requests, sees who has
// booked (and who hasn't) and sets availability and the kinds of meetings.

export interface BookingType {
  id: string; key: string | null; name: string; description: string | null; host_id: string; duration_min: number; audience: 'everyone' | 'departments'; departments: string[];
  kind: 'one_off' | 'weekly'; once_per_person: boolean; needs_approval: boolean; topic_required: boolean; max_per_day: number | null; window_start: string | null; window_end: string | null;
  days: number[] | null; deadline: string | null; agenda: string[]; active: boolean; sort: number;
}
export interface Booking { id: string; type_id: string; booked_by: string; starts_at: string; duration_min: number; topic: string | null; notes: string | null; status: 'requested' | 'confirmed' | 'declined' | 'cancelled'; occurrence_id: string | null; series_id: string | null; decision_note: string | null; created_at: string }
interface Avail { id: string; host_id: string; weekday: number; start_time: string; end_time: string }
interface Blocked { id: string; host_id: string; starts_at: string; ends_at: string; reason: string | null }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' });
const kDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const dowOf = (iso: string) => { const d = new Date(`${kDay(iso)}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const STATUS = { requested: { label: 'Waiting for the MD', tone: 'attention' }, confirmed: { label: 'Confirmed', tone: 'success' }, declined: { label: 'Declined', tone: 'danger' }, cancelled: { label: 'Cancelled', tone: 'neutral' } } as const;

export function useBookings() {
  const [types, setTypes] = useState<BookingType[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [avail, setAvail] = useState<Avail[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [doneOcc, setDoneOcc] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    const [t, b, a, bl] = await Promise.all([
      supabase.from('booking_types').select('*').order('sort'),
      supabase.from('bookings').select('*').order('starts_at'),
      supabase.from('host_availability').select('*').order('weekday').order('start_time'),
      supabase.from('host_blocked').select('*').gte('ends_at', new Date().toISOString()).order('starts_at'),
    ]);
    const bk = (b.data as Booking[]) ?? [];
    setTypes((t.data as BookingType[]) ?? []); setBookings(bk); setAvail((a.data as Avail[]) ?? []); setBlocked((bl.data as Blocked[]) ?? []);
    const occ = bk.map((x) => x.occurrence_id).filter(Boolean) as string[];
    if (occ.length) { const { data } = await supabase.from('meeting_occurrences').select('id, status').in('id', occ); setDoneOcc(new Set(((data ?? []) as { id: string; status: string }[]).filter((x) => x.status === 'done').map((x) => x.id))); }
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel('bookings-tab').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { types, bookings, avail, blocked, doneOcc, reload: load };
}

export function BookTab({ data, open }: { data: MeetingsData; open: (id: string) => void }) {
  const a = useAccess();
  const bk = useBookings();
  const [scheduling, setScheduling] = useState(false);
  const [hours, setHours] = useState(false);
  return (
    <>
      <ScheduledMeetings data={data} open={open} onSchedule={() => setScheduling(true)} onHours={() => setHours(true)} />
      {a.isMd ? <HostView data={data} bk={bk} open={open} /> : <><h2 className="section-title mb-2">Meetings with the MD</h2><StaffView bk={bk} open={open} /></>}
      {scheduling && <ScheduleModal data={data} onClose={() => setScheduling(false)} onDone={(id) => { data.reload(); open(id); }} />}
      {hours && <SettingsModal bk={bk} types={a.isMd} onClose={() => setHours(false)} />}
    </>
  );
}

// ------------------------------------------------------------ staff
function StaffView({ bk, open }: { bk: ReturnType<typeof useBookings>; open: (id: string) => void }) {
  const { profile } = useAuth();
  const a = useAccess();
  const [picking, setPicking] = useState<BookingType | null>(null);
  const [error, setError] = useState('');
  const mine = (t: BookingType) => bk.bookings.filter((b) => b.type_id === t.id && b.booked_by === profile?.id && (b.status === 'requested' || b.status === 'confirmed'));
  const types = bk.types.filter((t) => t.active && t.host_id !== profile?.id && (t.audience === 'everyone' || t.departments.includes(a.dept ?? '')));
  const cancel = async (b: Booking) => { if (!confirm('Cancel this booking?')) return; const { error: err } = await supabase.rpc('cancel_booking', { p_id: b.id }); if (err) setError(err.message); bk.reload(); };
  return (
    <>
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        {types.map((t) => {
          const my = mine(t);
          const had = bk.bookings.some((b) => b.type_id === t.id && b.booked_by === profile?.id && b.occurrence_id && bk.doneOcc.has(b.occurrence_id));
          return (
            <section key={t.id} className={`card p-4 flex flex-col ${!my.length && !had && (t.once_per_person || t.kind === 'weekly') ? 'border-accent/50' : ''}`}>
              <p className="text-body font-semibold">{t.name}</p>
              <p className="text-small text-fg-muted mt-1 flex-1">{t.description}</p>
              <p className="text-caption text-fg-muted mt-2">{t.duration_min} min{t.kind === 'weekly' ? ' · every week' : ''}{t.needs_approval ? ' · the MD confirms' : ''}{t.deadline ? ` · before ${t.deadline}` : ''}</p>
              {had && t.kind === 'one_off' && t.once_per_person ? <p className="mt-3 text-small text-success flex items-center gap-1"><CheckCircle2 size={14} /> Done</p>
                : my.length ? my.map((b) => (
                  <div key={b.id} className="mt-3 rounded-md bg-inset px-3 py-2 text-small">
                    <p className="font-medium">{t.kind === 'weekly' ? `Every ${DAY_NAMES[dowOf(b.starts_at)]} at ${time(b.starts_at)}` : when(b.starts_at)}</p>
                    <Label tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Label>
                    <div className="flex gap-2 mt-2">{b.occurrence_id && <button onClick={() => open(b.occurrence_id!)} className="btn-ghost text-caption">Open</button>}<button onClick={() => setPicking(t)} className="btn-ghost text-caption">Change</button><button onClick={() => cancel(b)} className="btn-ghost text-caption text-danger">Cancel</button></div>
                  </div>
                )) : <button onClick={() => setPicking(t)} className="btn-primary mt-3"><CalendarPlus size={14} /> {t.kind === 'weekly' ? 'Choose my day' : t.needs_approval ? 'Ask for a meeting' : 'Choose a time'}</button>}
            </section>
          );
        })}
        {!types.length && <p className="text-small text-fg-muted">Nothing to book right now.</p>}
      </div>
      {bk.bookings.filter((b) => b.booked_by === profile?.id && (b.status === 'declined')).slice(-3).map((b) => (
        <p key={b.id} className="text-caption text-fg-muted">Declined: {bk.types.find((t) => t.id === b.type_id)?.name} on {when(b.starts_at)}{b.decision_note ? ` — “${b.decision_note}”` : ''}</p>
      ))}
      {picking && <PickTimeModal type={picking} onClose={() => setPicking(null)} onDone={bk.reload} />}
    </>
  );
}

function PickTimeModal({ type, onClose, onDone }: { type: BookingType; onClose: () => void; onDone: () => void }) {
  const [times, setTimes] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { supabase.rpc('booking_free_times', { p_type: type.id, p_days: type.kind === 'weekly' ? 13 : 14 }).then(({ data, error: err }) => { if (err) setError(err.message); setTimes(((data ?? []) as { starts_at: string }[]).map((x) => x.starts_at)); }); }, [type.id, type.kind]);
  // Weekly: one choice per weekday/time (the first date it happens).
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of times ?? []) {
      const k = type.kind === 'weekly' ? `w${dowOf(t)}` : kDay(t);
      if (type.kind === 'weekly' && (m.get(k) ?? []).some((x) => time(x) === time(t))) continue;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()].sort((x, y) => (type.kind === 'weekly' ? x[0].localeCompare(y[0]) : x[0].localeCompare(y[0])));
  }, [times, type.kind]);
  const book = async () => {
    if (!chosen) { setError('Choose a time.'); return; }
    if (type.topic_required && !topic.trim()) { setError('Say what the meeting is about.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('book_meeting', { p_type: type.id, p_starts_at: chosen, p_topic: topic.trim() || null, p_notes: notes.trim() || null });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={type.name} subtitle={type.kind === 'weekly' ? 'Choose your day and time — it repeats every week. One person per day.' : `Choose a free time (${type.duration_min} min).`} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {times === null ? <div className="h-24 skeleton rounded" /> : !groups.length ? <p className="text-small text-fg-muted">No free time in the next two weeks. Ask the MD directly.</p> : (
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">{groups.map(([k, list]) => (
            <div key={k}>
              <p className="text-caption font-semibold text-fg-muted mb-1">{type.kind === 'weekly' ? `Every ${DAY_NAMES[Number(k.slice(1))]}` : new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
              <div className="flex flex-wrap gap-1.5">{list.map((t) => <button key={t} onClick={() => setChosen(t)} className={`px-3 py-1.5 rounded-md text-small border tabular-nums ${chosen === t ? 'border-accent bg-accent text-white' : 'border-line hover:bg-hover'}`}>{time(t)}</button>)}</div>
            </div>
          ))}</div>
        )}
        {(type.topic_required || type.needs_approval) && <label className="block"><span className="text-caption text-fg-muted">What is it about?{type.topic_required ? ' *' : ''}</span><input value={topic} onChange={(e) => setTopic(e.target.value)} className="input" placeholder="e.g. A problem with a car owner" /></label>}
        <label className="block"><span className="text-caption text-fg-muted">Anything the MD should know before (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" /></label>
        {chosen && <p className="text-small"><b>{type.kind === 'weekly' ? `Every ${DAY_NAMES[dowOf(chosen)]} at ${time(chosen)}, starting ${when(chosen)}` : when(chosen)}</b>{type.needs_approval ? ' — the MD will confirm.' : ''}</p>}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={book} disabled={busy || !chosen} className="btn-primary disabled:opacity-50"><Check size={14} /> {type.needs_approval ? 'Send the request' : 'Book'}</button></div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ the MD
function HostView({ data, bk, open }: { data: MeetingsData; bk: ReturnType<typeof useBookings>; open: (id: string) => void }) {
  const { profile } = useAuth();
  const [deciding, setDeciding] = useState<{ b: Booking; accept: boolean } | null>(null);
  const [settings, setSettings] = useState(false);
  const live = bk.bookings.filter((b) => b.status === 'confirmed' || b.status === 'requested');
  const requests = bk.bookings.filter((b) => b.status === 'requested');
  const today = kigaliToday();
  const audience = (t: BookingType) => data.people.filter((p) => p.id !== profile?.id && (t.audience === 'everyone' || t.departments.includes(p.dept ?? '')));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3"><h2 className="section-title flex-1">Meetings people book with you</h2><button onClick={() => setSettings(true)} className="btn-secondary"><Settings2 size={14} /> My availability & meeting types</button></div>
      <Box title={`Requests to answer (${requests.length})`} icon={Clock} padded={false} className="mb-4">
        {requests.length ? <ul className="divide-y divide-line-muted">{requests.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-small">
            <span className="flex-1 min-w-[220px]"><b>{data.nameOf(b.booked_by)}</b> · {when(b.starts_at)}<span className="block text-caption text-fg-muted">{b.topic}{b.notes ? ` — ${b.notes}` : ''}</span></span>
            <button onClick={() => setDeciding({ b, accept: true })} className="btn-primary h-7"><Check size={13} /> Accept</button>
            <button onClick={() => setDeciding({ b, accept: false })} className="btn-ghost h-7 text-danger"><XCircle size={13} /> Decline</button>
          </li>
        ))}</ul> : <p className="p-5 text-small text-fg-muted">No request waiting.</p>}
      </Box>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {bk.types.filter((t) => t.active).map((t) => {
          const list = live.filter((b) => b.type_id === t.id);
          const who = audience(t);
          const booked = new Set(list.map((b) => b.booked_by));
          const notYet = (t.once_per_person || t.kind === 'weekly') ? who.filter((p) => !booked.has(p.id) && !bk.bookings.some((b) => b.type_id === t.id && b.booked_by === p.id && b.occurrence_id && bk.doneOcc.has(b.occurrence_id))) : [];
          const seen = bk.bookings.filter((b) => b.type_id === t.id && b.occurrence_id && bk.doneOcc.has(b.occurrence_id)).length;
          return (
            <Box key={t.id} title={t.name} icon={t.kind === 'weekly' ? Users2 : UserCheck} padded={false}>
              <p className="px-4 pt-3 text-small text-fg-muted">
                {t.once_per_person || t.kind === 'weekly' ? <><b className="text-fg">{who.length - notYet.length} of {who.length}</b> booked{seen ? ` · ${seen} done` : ''}{t.deadline ? ` · deadline ${t.deadline}` : ''}</> : <>{list.filter((b) => b.starts_at >= new Date().toISOString()).length} coming</>}
              </p>
              {t.kind === 'weekly' ? (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 p-4">{[1, 2, 3, 4, 5, 6].map((d) => {
                  const b = list.find((x) => x.status === 'confirmed' && dowOf(x.starts_at) === d);
                  return <div key={d} className={`rounded-md border px-2 py-1.5 text-caption ${b ? 'border-accent/40 bg-accent/5' : 'border-dashed border-line'}`}><p className="font-semibold">{DAY_NAMES[d]}</p><p className="truncate">{b ? `${data.nameOf(b.booked_by).split(' ')[0]} · ${time(b.starts_at)}` : 'free'}</p></div>;
                })}</div>
              ) : (
                <ul className="divide-y divide-line-muted mt-2">{list.filter((b) => kDay(b.starts_at) >= today).slice(0, 12).map((b) => (
                  <li key={b.id} className="flex items-center gap-2 px-4 py-2 text-small"><span className="w-36 tabular-nums text-fg-muted">{when(b.starts_at)}</span><span className="flex-1">{data.nameOf(b.booked_by)}{b.topic ? <span className="text-caption text-fg-muted"> · {b.topic}</span> : null}</span>
                    {b.status === 'requested' && <Label tone="attention">to answer</Label>}{b.occurrence_id && <button onClick={() => open(b.occurrence_id!)} className="btn-ghost text-caption">Open</button>}</li>
                ))}</ul>
              )}
              {notYet.length > 0 && <p className="px-4 py-2 text-caption text-fg-muted border-t border-line-muted">Not booked yet: {notYet.map((p) => p.name.split(' ')[0]).join(', ')} — they are reminded every morning.</p>}
            </Box>
          );
        })}
      </div>
      {deciding && <DecideModal b={deciding.b} accept={deciding.accept} onClose={() => setDeciding(null)} onDone={bk.reload} />}
      {settings && <SettingsModal bk={bk} onClose={() => setSettings(false)} />}
    </>
  );
}

function DecideModal({ b, accept, onClose, onDone }: { b: Booking; accept: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const go = async () => { const { error: err } = await supabase.rpc('decide_booking', { p_id: b.id, p_accept: accept, p_note: note || null }); if (err) { setError(err.message); return; } onDone(); onClose(); };
  return (
    <Modal open onClose={onClose} title={accept ? 'Accept the meeting' : 'Decline the meeting'} subtitle={`${when(b.starts_at)}${b.topic ? ` · ${b.topic}` : ''}`} maxWidth="max-w-sm">
      <div className="space-y-3">
        <label className="block"><span className="text-caption text-fg-muted">Note to them (optional{accept ? '' : ' — e.g. propose another time'})</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input resize-none" /></label>
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Back</button><button onClick={go} className={accept ? 'btn-primary' : 'btn-danger'}>{accept ? 'Accept' : 'Decline'}</button></div>
      </div>
    </Modal>
  );
}

function SettingsModal({ bk, types = true, onClose }: { bk: ReturnType<typeof useBookings>; types?: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const [row, setRow] = useState({ weekday: 1, start: '09:00', end: '12:00' });
  const [block, setBlock] = useState({ from: kigaliToday(), to: kigaliToday(), reason: '' });
  const [error, setError] = useState('');
  const act = async (p: PromiseLike<{ error: { message: string } | null }>) => { const { error: err } = await p; if (err) setError(err.message); bk.reload(); };
  const mine = bk.avail.filter((x) => x.host_id === profile?.id);
  const blocked = bk.blocked.filter((x) => x.host_id === profile?.id);
  return (
    <Modal open onClose={onClose} title={types ? 'My availability & meeting types' : 'My working hours'} subtitle="People can only book you inside these hours, and never over your meetings, bookings or days off." maxWidth="max-w-2xl">
      <div className="space-y-5">
        <section>
          <p className="text-small font-semibold mb-2">When people can book you</p>
          {!mine.length && <p className="text-caption text-fg-muted mb-2 rounded-md bg-inset px-2 py-1.5">You haven't set hours, so the usual ones apply: Mon–Fri 08:00–17:00, Sat 08:00–12:00. Add your own hours to replace them.</p>}
          <div className="space-y-1">{[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <div key={d} className="flex flex-wrap items-center gap-2 text-small"><span className="w-10 font-medium">{DAY_NAMES[d]}</span>
              {mine.filter((x) => x.weekday === d).map((x) => <span key={x.id} className="inline-flex items-center gap-1 rounded-md bg-inset px-2 py-0.5 tabular-nums">{x.start_time.slice(0, 5)}–{x.end_time.slice(0, 5)}<button onClick={() => act(supabase.from('host_availability').delete().eq('id', x.id))} className="text-fg-muted hover:text-danger" aria-label="Remove"><X size={11} /></button></span>)}
              {!mine.some((x) => x.weekday === d) && <span className="text-caption text-fg-subtle">{mine.length ? 'not available' : d <= 5 ? '08:00–17:00 (usual)' : d === 6 ? '08:00–12:00 (usual)' : 'not available'}</span>}
            </div>
          ))}</div>
          <div className="flex flex-wrap items-end gap-2 mt-2">
            <select value={row.weekday} onChange={(e) => setRow({ ...row, weekday: Number(e.target.value) })} className="input !w-auto !py-1 text-small">{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}</select>
            <input type="time" value={row.start} onChange={(e) => setRow({ ...row, start: e.target.value })} className="input !w-auto !py-1 text-small" />
            <input type="time" value={row.end} onChange={(e) => setRow({ ...row, end: e.target.value })} className="input !w-auto !py-1 text-small" />
            <button onClick={() => act(supabase.from('host_availability').insert({ host_id: profile?.id, weekday: row.weekday, start_time: row.start, end_time: row.end }))} className="btn-secondary h-8"><Plus size={13} /> Add hours</button>
          </div>
        </section>
        <section>
          <p className="text-small font-semibold mb-2">Days off / blocked</p>
          {blocked.map((b) => <p key={b.id} className="text-small flex items-center gap-2">{kDay(b.starts_at)} → {kDay(new Date(Date.parse(b.ends_at) - 1).toISOString())}{b.reason ? ` · ${b.reason}` : ''}<button onClick={() => act(supabase.from('host_blocked').delete().eq('id', b.id))} className="btn-ghost p-1" aria-label="Remove"><Trash2 size={12} /></button></p>)}
          <div className="flex flex-wrap items-end gap-2 mt-1">
            <input type="date" value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} className="input !w-auto !py-1 text-small" />
            <input type="date" value={block.to} onChange={(e) => setBlock({ ...block, to: e.target.value })} className="input !w-auto !py-1 text-small" />
            <input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} className="input !w-48 !py-1 text-small" placeholder="Reason (optional)" />
            <button onClick={() => act(supabase.from('host_blocked').insert({ host_id: profile?.id, starts_at: `${block.from}T00:00:00+02:00`, ends_at: new Date(Date.parse(`${block.to}T00:00:00+02:00`) + 86400000).toISOString(), reason: block.reason || null }))} className="btn-secondary h-8"><Plus size={13} /> Block</button>
          </div>
        </section>
        {types && (
        <section>
          <p className="text-small font-semibold mb-2">Kinds of meetings people can book</p>
          <div className="space-y-2">{bk.types.map((t) => (
            <div key={t.id} className="rounded-md border border-line-muted p-2 text-small flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[200px] font-medium">{t.name}</span>
              <label className="flex items-center gap-1 text-caption">min <input type="number" defaultValue={t.duration_min} onBlur={(e) => Number(e.target.value) !== t.duration_min && act(supabase.from('booking_types').update({ duration_min: Number(e.target.value) || 30 }).eq('id', t.id))} className="input !w-16 !py-0.5 text-caption" /></label>
              {t.once_per_person && <label className="flex items-center gap-1 text-caption">by <input type="date" defaultValue={t.deadline ?? ''} onBlur={(e) => e.target.value !== (t.deadline ?? '') && act(supabase.from('booking_types').update({ deadline: e.target.value || null }).eq('id', t.id))} className="input !w-36 !py-0.5 text-caption" /></label>}
              <label className="flex items-center gap-1 text-caption"><input type="checkbox" checked={t.needs_approval} onChange={(e) => act(supabase.from('booking_types').update({ needs_approval: e.target.checked }).eq('id', t.id))} /> I confirm</label>
              <label className="flex items-center gap-1 text-caption"><input type="checkbox" checked={t.active} onChange={(e) => act(supabase.from('booking_types').update({ active: e.target.checked }).eq('id', t.id))} /> Open</label>
            </div>
          ))}</div>
        </section>
        )}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-primary">Done</button></div>
      </div>
    </Modal>
  );
}
