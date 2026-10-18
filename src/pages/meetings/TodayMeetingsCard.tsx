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
  const [slot, setSlot] = useState<{ booked: boolean; open: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!profile) return;
    (async () => {
      await supabase.rpc('ensure_meeting_occurrences', { p_day: today });
      const [o, s] = await Promise.all([
        supabase.from('meeting_occurrences').select('*').eq('day', today).neq('status', 'cancelled').order('scheduled_start'),
        supabase.from('meeting_slots').select('booked_by, starts_at'),
      ]);
      if (o.error) { setError(o.error.message); setList([]); return; }
      setList(((o.data as Occurrence[]) ?? []).filter((x) => x.expected.includes(profile.id) || x.note_taker_id === profile.id || x.host_id === profile.id));
      const slots = (s.data as { booked_by: string | null; starts_at: string }[]) ?? [];
      setSlot({ booked: slots.some((x) => x.booked_by === profile.id), open: slots.filter((x) => !x.booked_by && x.starts_at > new Date().toISOString()).length });
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
      {slot && !slot.booked && slot.open > 0 && <p className="mt-2 text-small"><Link to="/meetings?tab=slots" className="link">Book your one-to-one with the MD</Link> — {slot.open} slots open.</p>}
    </section>
  );
}
