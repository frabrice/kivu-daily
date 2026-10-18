import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, Clock, Search, Users2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { MeetingsData, Occurrence, hhmm, kigaliToday } from '../../lib/meetings';
import { Box, Label } from '../../ui/kit';
import Modal from '../../components/Modal';

// Anyone books a meeting with anyone (migration 20261028110000): choose the
// people, see only the times when you and all of them are free (their
// working hours minus every meeting, booking and day off), book - they are
// invited. The server checks again at booking time, so nothing collides.

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' });
const kDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const LENGTHS = [15, 30, 45, 60, 90, 120];

export const isScheduled = (o: Occurrence) => o.kind === 'other' && !o.series_id;

export function ScheduledMeetings({ data, open, onSchedule, onHours }: { data: MeetingsData; open: (id: string) => void; onSchedule: () => void; onHours: () => void }) {
  const { profile } = useAuth();
  const today = kigaliToday();
  const [declining, setDeclining] = useState<Occurrence | null>(null);
  const [error, setError] = useState('');
  const me = profile?.id ?? '';
  const list = data.occurrences
    .filter((o) => isScheduled(o) && o.status === 'scheduled' && o.day >= today && (o.host_id === me || o.expected.includes(me)))
    .sort((x, y) => `${x.day}${x.scheduled_start}`.localeCompare(`${y.day}${y.scheduled_start}`));
  const statusOf = (o: Occurrence, pid: string) => data.attendance.find((x) => x.occurrence_id === o.id && x.profile_id === pid);
  const cancel = async (o: Occurrence) => {
    if (!confirm(`Cancel "${o.title}"? Everyone invited is told and the time is free again.`)) return;
    const { error: err } = await supabase.rpc('cancel_meeting', { p_occ: o.id });
    if (err) setError(err.message); else data.reload();
  };
  return (
    <Box title="Meetings with anyone" icon={Users2} padded={false} className="mb-5"
      right={<div className="flex gap-2"><button onClick={onHours} className="btn-ghost text-caption"><Clock size={13} /> My working hours</button><button onClick={onSchedule} className="btn-primary h-8"><CalendarPlus size={14} /> Schedule a meeting</button></div>}>
      <p className="px-4 pt-3 text-small text-fg-muted">Choose the people — Kivu Daily shows only the times when you and all of them are free (no meeting, booking or day off). Nobody can ever be booked twice.</p>
      {error && <p className="mx-4 mt-2 text-caption text-danger">{error}</p>}
      {list.length ? <ul className="divide-y divide-line-muted mt-2">{list.map((o) => {
        const host = o.host_id === me;
        const mine = statusOf(o, me);
        const out = o.expected.filter((x) => statusOf(o, x)?.status === 'excused');
        return (
          <li key={o.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-small">
            <span className="w-40 tabular-nums text-fg-muted">{o.day === today ? 'Today' : dayLabel(o.day).split(' ').slice(0, 3).join(' ')} · {hhmm(o.scheduled_start)}</span>
            <span className="flex-1 min-w-[220px]"><b>{o.title}</b>
              <span className="block text-caption text-fg-muted">{host ? 'You organised' : `By ${data.nameOf(o.host_id).split(' ')[0]}`} · with {o.expected.filter((x) => x !== me).map((x) => data.nameOf(x).split(' ')[0]).join(', ')}{out.length ? ` · can't come: ${out.map((x) => data.nameOf(x).split(' ')[0]).join(', ')}` : ''}</span></span>
            {!host && mine?.status === 'excused' && <Label tone="neutral">You can't come</Label>}
            <button onClick={() => open(o.id)} className="btn-ghost text-caption">Open</button>
            {host ? <button onClick={() => cancel(o)} className="btn-ghost text-caption text-danger">Cancel</button>
              : mine?.status !== 'excused' && <button onClick={() => setDeclining(o)} className="btn-ghost text-caption text-danger">I can't make it</button>}
          </li>
        );
      })}</ul> : <p className="px-4 py-3 text-small text-fg-muted">No meeting scheduled with you yet.</p>}
      {declining && <DeclineModal o={declining} onClose={() => setDeclining(null)} onDone={data.reload} />}
    </Box>
  );
}

export function DeclineModal({ o, onClose, onDone }: { o: Occurrence; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const go = async () => {
    const { error: err } = await supabase.rpc('decline_meeting', { p_occ: o.id, p_reason: reason.trim() || null });
    if (err) { setError(err.message); return; }
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="I can't make it" subtitle={`${o.title} · ${dayLabel(o.day)} at ${hhmm(o.scheduled_start)}`} maxWidth="max-w-sm">
      <div className="space-y-3">
        <label className="block"><span className="text-caption text-fg-muted">Why? (the organiser sees it)</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input resize-none" placeholder="e.g. I am at the garage with car RAH 123" /></label>
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Back</button><button onClick={go} className="btn-danger">Tell the organiser</button></div>
      </div>
    </Modal>
  );
}

export function ScheduleModal({ data, onClose, onDone }: { data: MeetingsData; onClose: () => void; onDone: (id: string) => void }) {
  const { profile } = useAuth();
  const [ids, setIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [times, setTimes] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const people = data.people.filter((p) => p.id !== profile?.id);
  const found = people.filter((p) => !ids.includes(p.id) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
  const key = `${[...ids].sort().join(',')}|${minutes}|${refresh}`;
  useEffect(() => {
    setChosen(''); setTimes(null);
    if (!ids.length) return;
    let live = true;
    supabase.rpc('free_times_for', { p_people: ids, p_minutes: minutes, p_days: 14 }).then(({ data: rows, error: err }) => {
      if (!live) return;
      if (err) setError(err.message);
      setTimes(((rows ?? []) as { starts_at: string }[]).map((x) => x.starts_at));
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of times ?? []) m.set(kDay(t), [...(m.get(kDay(t)) ?? []), t]);
    return [...m.entries()];
  }, [times]);
  const book = async () => {
    if (!title.trim()) { setError('Say what the meeting is about.'); return; }
    if (!chosen) { setError('Choose a time.'); return; }
    setBusy(true); setError('');
    const { data: id, error: err } = await supabase.rpc('schedule_meeting', { p_people: ids, p_starts_at: chosen, p_minutes: minutes, p_title: title.trim(), p_agenda: agenda.trim() || null });
    setBusy(false);
    if (err) {
      setError(err.message);
      // Someone took that time a moment ago: show the times again.
      if (/not free/i.test(err.message)) setRefresh((n) => n + 1);
      return;
    }
    onDone(id as string); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Schedule a meeting" subtitle="Only the times when you and everyone you invite are free are shown." maxWidth="max-w-2xl">
      <div className="space-y-4">
        <section>
          <p className="text-caption text-fg-muted mb-1">With whom?</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {ids.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent/10 text-accent-fg px-2.5 py-1 text-small">{data.nameOf(id)}<button onClick={() => setIds(ids.filter((x) => x !== id))} aria-label="Remove"><X size={12} /></button></span>)}
            {!ids.length && <span className="text-small text-fg-subtle">Nobody chosen yet</span>}
          </div>
          <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search a name…" /></div>
          {(q.trim() || !ids.length) && <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line-muted divide-y divide-line-muted">{found.slice(0, 30).map((p) => (
            <button key={p.id} onClick={() => { setIds([...ids, p.id]); setQ(''); }} className="w-full text-left px-3 py-1.5 text-small hover:bg-hover flex items-center gap-2"><span className="flex-1">{p.name}</span>{p.dept && <span className="text-caption text-fg-muted">{p.dept.replace(/_/g, ' ')}</span>}</button>
          ))}{!found.length && <p className="px-3 py-2 text-caption text-fg-muted">No one found.</p>}</div>}
        </section>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block sm:col-span-2"><span className="text-caption text-fg-muted">What is it about? *</span><input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="e.g. Plan the corporate visits" /></label>
          <label className="block"><span className="text-caption text-fg-muted">How long?</span><select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="input">{LENGTHS.map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`}</option>)}</select></label>
        </div>
        {ids.length > 0 && (
          <section>
            <p className="text-caption text-fg-muted mb-1">When everyone is free (next 2 weeks)</p>
            {times === null ? <div className="h-20 skeleton rounded" /> : !groups.length ? <p className="text-small text-fg-muted rounded-md bg-inset px-3 py-2">No time when all of you are free. Try a shorter meeting or fewer people.</p> : (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">{groups.map(([d, list]) => (
                <div key={d}>
                  <p className="text-caption font-semibold text-fg-muted mb-1">{dayLabel(d)}</p>
                  <div className="flex flex-wrap gap-1.5">{list.map((t) => <button key={t} onClick={() => setChosen(t)} className={`px-3 py-1.5 rounded-md text-small border tabular-nums ${chosen === t ? 'border-accent bg-accent text-white' : 'border-line hover:bg-hover'}`}>{time(t)}</button>)}</div>
                </div>
              ))}</div>
            )}
          </section>
        )}
        <label className="block"><span className="text-caption text-fg-muted">Agenda (optional, one point per line)</span><textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={2} className="input resize-none" /></label>
        {chosen && <p className="text-small"><b>{dayLabel(kDay(chosen))} at {time(chosen)}</b> · {minutes} min · with {ids.map((x) => data.nameOf(x).split(' ')[0]).join(', ')} — they are invited and notified.</p>}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={book} disabled={busy || !chosen || !ids.length} className="btn-primary disabled:opacity-50"><Check size={14} /> Schedule</button></div>
      </div>
    </Modal>
  );
}
