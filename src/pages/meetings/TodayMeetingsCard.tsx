import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Play } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { Occurrence, hhmm, kigaliToday } from '../../lib/meetings';
import { Label } from '../../ui/kit';

// Its own small file so Home doesn't load the whole Meetings page.
const STATUS_TONE = { scheduled: 'neutral', running: 'accent', done: 'success', cancelled: 'neutral' } as const;
const STATUS_LABEL = { scheduled: 'Not started', running: 'In progress', done: 'Done', cancelled: 'Cancelled' } as const;

// ------------------------------------------------------------ today's meetings on Home
// Always shown, so nobody misses the daily meetings: today's meetings with
// a button to open (or start) each, or a clear "none today".
export function TodayMeetingsCard() {
  const { profile } = useAuth();
  const today = kigaliToday();
  const [list, setList] = useState<Occurrence[] | null>(null);
  const [toBook, setToBook] = useState<{ name: string; deadline: string | null; weekly: boolean }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!profile) return;
    (async () => {
      await supabase.rpc('ensure_meeting_occurrences', { p_day: today });
      const [o, ty, bk] = await Promise.all([
        supabase.from('meeting_occurrences').select('*').eq('day', today).neq('status', 'cancelled').order('scheduled_start'),
        supabase.from('booking_types').select('id, name, deadline, kind, once_per_person, audience, departments, host_id, active'),
        supabase.from('bookings').select('type_id, status').eq('booked_by', profile.id),
      ]);
      if (o.error) { setError(o.error.message); setList([]); return; }
      setList(((o.data as Occurrence[]) ?? []).filter((x) => x.expected.includes(profile.id) || x.note_taker_id === profile.id || x.host_id === profile.id));
      // Meetings this person still has to book (the walkthrough, the weekly one-to-one).
      const dept = (profile as unknown as { department?: { slug?: string } | null }).department?.slug ?? '';
      const mine = ((bk.data ?? []) as { type_id: string; status: string }[]);
      setToBook(((ty.data ?? []) as { id: string; name: string; deadline: string | null; kind: string; once_per_person: boolean; audience: string; departments: string[]; host_id: string; active: boolean }[])
        .filter((t) => t.active && t.host_id !== profile.id && (t.once_per_person || t.kind === 'weekly') && (!t.deadline || t.deadline >= today) && (t.audience === 'everyone' || t.departments.includes(dept)))
        .filter((t) => !mine.some((b) => b.type_id === t.id && b.status !== 'declined' && b.status !== 'cancelled'))
        .map((t) => ({ name: t.name, deadline: t.deadline, weekly: t.kind === 'weekly' })));
    })();
  }, [profile, today]);
  if (!profile) return null;
  return (
    <section className="card p-4 border-accent/40">
      <div className="flex items-center gap-2 mb-2">
        <CalendarClock size={18} className="text-accent-fg" />
        <p className="text-body font-semibold flex-1">Your meetings today</p>
        <Link to="/meetings" className="btn-ghost text-caption">All meetings</Link>
      </div>
      {list === null ? <div className="h-8 skeleton rounded" /> : list.length ? (
        <ul className="divide-y divide-line-muted">{list.map((o) => {
          const runs = o.note_taker_id === profile.id || o.host_id === profile.id;
          return (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-mono text-body font-semibold w-14">{hhmm(o.scheduled_start)}</span>
              <span className="flex-1 min-w-[160px] text-body">{o.title}</span>
              <Label tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Label>
              <Link to={`/meetings?m=${o.id}`} className={runs && o.status !== 'done' ? 'btn-primary h-8' : 'btn-secondary h-8'}>{runs && o.status === 'scheduled' ? <><Play size={13} /> Open to start</> : 'Open'}</Link>
            </li>
          );
        })}</ul>
      ) : <p className="text-small text-fg-muted">{error ? `Couldn't load meetings: ${error}` : 'No meeting for you today.'}</p>}
      {toBook.length > 0 && (
        <div className="mt-3 rounded-md bg-attention-muted px-3 py-2 text-small flex flex-wrap items-center gap-2">
          <span className="flex-1">To book: {toBook.map((t) => <b key={t.name} className="mr-1">{t.name}{t.deadline ? ` (before ${t.deadline.slice(5)})` : ''}{t.weekly ? ' — choose your day' : ''}</b>)}</span>
          <Link to="/meetings?tab=book" className="btn-primary h-8">Book now</Link>
        </div>
      )}
      <p className="mt-2 text-caption text-fg-muted">Need the MD? <Link to="/meetings?tab=book" className="link">Ask for a meeting</Link>.</p>
    </section>
  );
}
