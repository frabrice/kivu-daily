import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, CalendarPlus, Check, CheckCircle2, ClipboardList, Clock, History, Pencil, Play, Plus, Settings2, Square, UserPlus, Users2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useFleetData } from '../../lib/fleet';
import { useFreelance } from '../../lib/freelance';
import {
  ATTENDANCE, AttendanceStatus, DAY_NAMES, MANUAL_METRICS, MeetingsData, Metric, Series, clock, fleetMetrics, hhmm, kigaliToday, metricsList, minutesLate, useMeetingRoom, useMeetings,
} from '../../lib/meetings';
import { addDays } from '../../lib/it';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs } from '../../ui/kit';
import Modal from '../../components/Modal';
import { ShouldVsDid } from '../../components/company/ShouldVsDid';
import { BookTab } from './BookingTab';
import { DeclineModal, isScheduled } from './ScheduleWithAnyone';

// Meetings, run systematically: today's meetings from the regular series,
// the meeting room (attendance, one note-taker, numbers, decisions,
// actions), onboarding one-to-ones booked from open slots, history, and the
// settings of the regular meetings (MD).

type Tab = 'today' | 'book' | 'history' | 'series';
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
const dayTitle = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const STATUS_TONE = { scheduled: 'neutral', running: 'accent', done: 'success', cancelled: 'neutral' } as const;
const STATUS_LABEL = { scheduled: 'Not started', running: 'In progress', done: 'Done', cancelled: 'Cancelled' } as const;

export default function MeetingsPage() {
  usePageTitle('Meetings');
  const a = useAccess();
  const today = kigaliToday();
  const days = useMemo(() => Array.from({ length: 7 }, (_, k) => addDays(today, k)), [today]);
  const data = useMeetings(days);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = ((raw === 'slots' ? 'book' : raw) as Tab) || 'today';
  const open = params.get('m');
  if (open) return <MeetingRoom id={open} data={data} onBack={() => setParams({})} />;
  if (data.loading) return <Loading />;
  return (
    <div className="animate-fade-in">
      <PageHeader icon={CalendarClock} title="Meetings" subtitle="Regular meetings are ready every day: start them, tick who came, record the numbers and decisions — everyone expected gets the recap." />
      <UnderlineTabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { key: 'today', label: 'Today & coming', icon: CalendarClock }, { key: 'book', label: 'Book a meeting', icon: CalendarPlus }, { key: 'history', label: 'History', icon: History },
        ...(a.isMd ? [{ key: 'series' as Tab, label: 'Regular meetings', icon: Settings2 }] : []),
      ]} />
      {tab === 'today' && <TodayTab data={data} days={days} open={(id) => setParams({ m: id })} />}
      {tab === 'book' && <BookTab data={data} open={(id) => setParams({ m: id })} />}
      {tab === 'history' && <HistoryTab data={data} open={(id) => setParams({ m: id })} />}
      {tab === 'series' && a.isMd && <SeriesTab data={data} />}
    </div>
  );
}

// ------------------------------------------------------------ today & coming
function TodayTab({ data, days, open }: { data: MeetingsData; days: string[]; open: (id: string) => void }) {
  const { profile } = useAuth();
  return (
    <div className="space-y-5">
      {days.map((d, idx) => {
        const list = data.occurrences.filter((o) => o.day === d && o.status !== 'cancelled').sort((x, y) => (x.scheduled_start ?? '').localeCompare(y.scheduled_start ?? ''));
        if (!list.length && idx > 0) return null;
        return (
          <section key={d}>
            <h2 className="section-title mb-2">{idx === 0 ? 'Today' : idx === 1 ? 'Tomorrow' : dayTitle(d)}</h2>
            {list.length ? <div className="space-y-2">{list.map((o) => {
              const att = data.attendance.filter((x) => x.occurrence_id === o.id);
              const mine = o.note_taker_id === profile?.id;
              return (
                <button key={o.id} onClick={() => open(o.id)} className="w-full text-left card p-3 hover:border-line-strong flex flex-wrap items-center gap-3">
                  <span className="font-mono text-body font-semibold w-14">{hhmm(o.scheduled_start)}</span>
                  <span className="flex-1 min-w-[200px]"><span className="text-body font-semibold">{o.title}</span><span className="block text-caption text-fg-muted">{att.length} expected · notes by {data.nameOf(o.note_taker_id).split(' ')[0]}{mine ? ' (you)' : ''}</span></span>
                  <Label tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Label>
                  {o.status === 'done' && <span className="text-caption text-fg-muted">{att.filter((x) => x.status === 'present' || x.status === 'late').length}/{att.length} came</span>}
                </button>
              );
            })}</div> : <p className="text-small text-fg-muted">No meeting for you today.</p>}
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ the meeting room
function MeetingRoom({ id, data, onBack }: { id: string; data: MeetingsData; onBack: () => void }) {
  const { profile } = useAuth();
  const a = useAccess();
  const room = useMeetingRoom(id);
  const o = room.occ;
  usePageTitle(o ? o.title : 'Meeting');
  const fleet = useFleetData();
  const freelance = useFreelance(30);
  const [notes, setNotes] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [guest, setGuest] = useState('');
  const [declining, setDeclining] = useState(false);
  const [item, setItem] = useState<{ kind: 'decision' | 'action'; text: string; owner_id: string; due_date: string }>({ kind: 'action', text: '', owner_id: '', due_date: '' });
  useEffect(() => { setNotes(o?.notes ?? ''); }, [o?.notes]);
  useEffect(() => { if (o) setManual(Object.fromEntries(metricsList(o).filter((m) => !m.auto).map((m) => [m.key, m.value === null ? '' : String(m.value)]))); }, [o?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const auto: Metric[] = useMemo(() => {
    if (!o) return [];
    if (o.metrics_kind === 'fleet') return fleet.loading ? [] : fleetMetrics(o.day, { ...fleet, freelance: freelance.shifts });
    return MANUAL_METRICS[o.metrics_kind ?? ''] ?? [];
  }, [o, fleet, freelance.shifts]);
  if (room.loading || !o) return <Loading />;
  const done = o.status === 'done';
  const canRun = a.isMd || o.host_id === profile?.id || o.note_taker_id === profile?.id;
  const canWrite = a.isMd || o.note_taker_id === profile?.id;
  const saved = metricsList(o);
  // While open: live numbers + what was typed. Once done: what was saved.
  const metrics: Metric[] = done && saved.length ? saved : auto.map((m) => (m.auto ? m : { ...m, value: manual[m.key] === undefined || manual[m.key] === '' ? null : isNaN(Number(manual[m.key])) ? manual[m.key] : Number(manual[m.key]) }));
  const late = minutesLate(o);
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => { setBusy(true); setError(''); const { error: err } = await fn(); setBusy(false); if (err) setError(err.message); else { room.reload(); data.reload(); } };
  const mark = (pid: string, status: AttendanceStatus) => run(() => supabase.from('meeting_attendance').update({ status, marked_at: new Date().toISOString() }).eq('occurrence_id', id).eq('profile_id', pid));
  const reason = (pid: string, r: string) => run(() => supabase.from('meeting_attendance').update({ reason: r || null }).eq('occurrence_id', id).eq('profile_id', pid));
  const addGuest = () => guest && run(() => supabase.from('meeting_attendance').insert({ occurrence_id: id, profile_id: guest, status: 'present', guest: true, marked_at: new Date().toISOString() })).then(() => setGuest(''));
  const saveNotes = () => notes !== (o.notes ?? '') && run(() => supabase.from('meeting_occurrences').update({ notes }).eq('id', id));
  const handOver = (pid: string) => run(() => supabase.from('meeting_occurrences').update({ note_taker_id: pid }).eq('id', id));
  // An action with an owner becomes their task at once (with the meeting as its origin).
  const addItem = () => {
    if (!item.text.trim()) return;
    if (item.kind === 'action' && !item.owner_id) { setError('Choose who will do it.'); return; }
    const call = item.kind === 'action'
      ? () => supabase.rpc('add_meeting_action', { p_occ: id, p_text: item.text.trim(), p_owner: item.owner_id, p_due: item.due_date || null })
      : () => supabase.from('meeting_items').insert({ occurrence_id: id, kind: 'decision', text: item.text.trim(), sort: room.items.length });
    run(call).then(() => setItem({ ...item, text: '' }));
  };
  const removeItem = (itemId: string) => run(() => supabase.rpc('remove_meeting_item', { p_item: itemId }));
  const end = () => { if (!confirm('End the meeting? The numbers are saved, actions become tasks and everyone expected gets the recap.')) return; run(() => supabase.rpc('end_meeting', { p_id: id, p_metrics: metrics })); };
  const groups = [...new Set(metrics.map((m) => m.group ?? ''))];
  const decisions = room.items.filter((i) => i.kind === 'decision'), actions = room.items.filter((i) => i.kind === 'action'), checks = room.items.filter((i) => i.kind === 'check');
  return (
    <div className="animate-fade-in">
      <button onClick={onBack} className="text-caption text-fg-muted hover:text-fg flex items-center gap-1 mb-2"><ArrowLeft size={12} /> Meetings</button>
      <PageHeader icon={CalendarClock} title={o.title} labels={<><Label tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Label>{late !== null && late > 2 && <Label tone="attention">started {late} min late</Label>}</>}
        meta={<><span>{dayTitle(o.day)} · planned {hhmm(o.scheduled_start)} ({o.duration_min} min)</span><span>Started {clock(o.started_at)}{o.ended_at ? ` · ended ${clock(o.ended_at)}` : ''}</span><span>Notes: {data.nameOf(o.note_taker_id)}</span></>}
        actions={<>
          {isScheduled(o) && o.status === 'scheduled' && o.host_id !== profile?.id && o.expected.includes(profile?.id ?? '') && room.attendance.find((x) => x.profile_id === profile?.id)?.status !== 'excused'
            && <button onClick={() => setDeclining(true)} className="btn-ghost text-danger">I can't make it</button>}
          {isScheduled(o) && o.status === 'scheduled' && (o.host_id === profile?.id || a.isMd)
            && <button onClick={() => confirm('Cancel this meeting? Everyone invited is told.') && run(() => supabase.rpc('cancel_meeting', { p_occ: id }))} disabled={busy} className="btn-ghost text-danger">Cancel meeting</button>}
          {canRun && o.status === 'scheduled' && <button onClick={() => run(() => supabase.rpc('start_meeting', { p_id: id }))} disabled={busy} className="btn-primary"><Play size={14} /> Start meeting</button>}
          {canRun && o.status === 'running' && <button onClick={end} disabled={busy} className="btn-primary"><Square size={14} /> End meeting</button>}
        </>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
      {declining && <DeclineModal o={o} onClose={() => setDeclining(false)} onDone={() => { room.reload(); data.reload(); }} />}
      {o.status === 'cancelled' && <p className="mb-3 text-small rounded-lg bg-inset px-3 py-2">This meeting was cancelled.</p>}
      {done && <p className="mb-3 text-small rounded-lg bg-success-muted px-3 py-2">Done{o.recap_sent_at ? ' — the recap was emailed to everyone expected' : ''}.{actions.length ? ` ${actions.length} action${actions.length === 1 ? '' : 's'} added to people's tasks.` : ''}</p>}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="space-y-4 xl:col-span-2">
          {metrics.length > 0 && (
            <Box title="The numbers" icon={ClipboardList} right={o.metrics_kind === 'fleet' && !done && <span className="text-caption text-fg-muted">live from Fleet · type the rest</span>}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                {groups.map((g) => (
                  <div key={g} className="mb-2">
                    {g && <p className="text-caption font-semibold text-fg-muted uppercase tracking-wide mb-1">{g}</p>}
                    {metrics.filter((m) => (m.group ?? '') === g).map((m) => (
                      <div key={m.key} className="flex items-center gap-2 py-1 border-b border-line-muted text-small">
                        <span className="flex-1">{m.label}{m.note && <span className="block text-caption text-fg-muted">{m.note}</span>}</span>
                        {m.auto || done || !canWrite ? <b className="tabular-nums">{m.value === null ? '—' : typeof m.value === 'number' ? m.value.toLocaleString('en-US') : m.value}{m.unit && m.value !== null ? ` ${m.unit === 'RWF' ? 'RWF' : ''}` : ''}</b>
                          : <input value={manual[m.key] ?? ''} onChange={(e) => setManual({ ...manual, [m.key]: e.target.value })} className="input !py-0.5 !w-28 text-right tabular-nums text-small" aria-label={m.label} />}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Box>
          )}
          {o.metrics_kind === 'fleet' && (a.plan === 'full' || a.dept === 'finance') && <ShouldVsDid weeks={4} compact />}
          <Box title="Notes" icon={Pencil} right={<span className="text-caption text-fg-muted">{canWrite ? 'Only you write here' : `Written by ${data.nameOf(o.note_taker_id).split(' ')[0]} — updates live`}</span>}>
            {o.agenda.length > 0 && <ol className="list-decimal ml-5 mb-3 text-small text-fg-muted space-y-0.5">{o.agenda.map((x) => <li key={x}>{x}</li>)}</ol>}
            {canWrite && !done ? <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} rows={10} className="input resize-y" placeholder="What was said, point by point. Saved when you click outside." />
              : <p className="text-body whitespace-pre-line min-h-[60px]">{o.notes || <span className="text-fg-subtle">No notes yet.</span>}</p>}
          </Box>
          <Box title="Decisions and actions" icon={CheckCircle2}>
            {decisions.length > 0 && <><p className="text-caption font-semibold text-fg-muted mb-1">Decisions</p><ul className="mb-3 space-y-1">{decisions.map((d) => <li key={d.id} className="text-small flex gap-2"><Check size={14} className="text-success mt-0.5" /><span className="flex-1">{d.text}</span>{canRun && !done && <button onClick={() => removeItem(d.id)} className="btn-ghost p-1" aria-label="Remove"><X size={12} /></button>}</li>)}</ul></>}
            {actions.length > 0 && <><p className="text-caption font-semibold text-fg-muted mb-1">Actions</p><ul className="mb-3 space-y-1">{actions.map((x) => <li key={x.id} className="text-small flex flex-wrap gap-2"><span className="flex-1">{x.text}</span><span className="text-caption text-fg-muted">{data.nameOf(x.owner_id).split(' ')[0]}{x.due_date ? ` · by ${x.due_date.slice(5)}` : ''}{x.task_id ? ' · ✓ in their tasks' : ''}</span>{canRun && !done && <button onClick={() => removeItem(x.id)} className="btn-ghost p-1" aria-label="Remove"><X size={12} /></button>}</li>)}</ul></>}
            {canRun && !done ? (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-line-muted">
                <select value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value as 'decision' | 'action' })} className="input !w-auto !py-1 text-small"><option value="action">Action</option><option value="decision">Decision</option></select>
                <input value={item.text} onChange={(e) => setItem({ ...item, text: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addItem()} className="input !py-1 text-small flex-1 min-w-[200px]" placeholder={item.kind === 'action' ? 'e.g. Take back RAF 123 C tomorrow morning' : 'e.g. Replacement drivers start the same day'} />
                {item.kind === 'action' && <>
                  <select value={item.owner_id} onChange={(e) => setItem({ ...item, owner_id: e.target.value })} className="input !w-auto !py-1 text-small"><option value="">Who?</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <input type="date" value={item.due_date} onChange={(e) => setItem({ ...item, due_date: e.target.value })} className="input !w-auto !py-1 text-small" />
                </>}
                <button onClick={addItem} className="btn-secondary"><Plus size={13} /> Add</button>
              </div>
            ) : !decisions.length && !actions.length && <p className="text-small text-fg-muted">None.</p>}
          </Box>
          {checks.length > 0 && (
            <Box title="What we went through" icon={ClipboardList}>
              <ul className="space-y-1.5">{checks.map((c) => (
                <li key={c.id}><label className="flex items-start gap-2 text-small"><input type="checkbox" checked={c.done} disabled={!canRun || done} onChange={() => run(() => supabase.from('meeting_items').update({ done: !c.done }).eq('id', c.id))} className="mt-0.5" /><span className={c.done ? 'line-through text-fg-muted' : ''}>{c.text}</span></label></li>
              ))}</ul>
            </Box>
          )}
        </div>
        <Box title={`Who's here · ${room.attendance.filter((x) => x.status === 'present' || x.status === 'late').length}/${room.attendance.length}`} icon={Users2}>
          <ul className="space-y-2">{[...room.attendance].sort((x, y) => data.nameOf(x.profile_id).localeCompare(data.nameOf(y.profile_id))).map((x) => (
            <li key={x.profile_id} className="text-small">
              <div className="flex items-center gap-2"><span className="flex-1 font-medium">{data.nameOf(x.profile_id)}{x.guest && <span className="text-caption text-fg-muted"> · guest</span>}</span>{(!canRun || done) && <Label tone={ATTENDANCE[x.status].tone}>{ATTENDANCE[x.status].label}</Label>}</div>
              {canRun && !done && <div className="flex flex-wrap gap-1 mt-1">{(['present', 'late', 'absent', 'excused'] as AttendanceStatus[]).map((s) => (
                <button key={s} onClick={() => mark(x.profile_id, s)} className={`px-2 py-0.5 rounded-full text-caption border ${x.status === s ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{ATTENDANCE[s].label}</button>
              ))}</div>}
              {canRun && !done && (x.status === 'absent' || x.status === 'late' || x.status === 'excused') && <input defaultValue={x.reason ?? ''} onBlur={(e) => e.target.value !== (x.reason ?? '') && reason(x.profile_id, e.target.value)} className="input !py-0.5 text-caption mt-1" placeholder="Why?" />}
              {(done || !canRun) && x.reason && <p className="text-caption text-fg-muted">{x.reason}</p>}
            </li>
          ))}</ul>
          {canRun && !done && <>
            <div className="flex gap-2 mt-3 pt-3 border-t border-line-muted"><select value={guest} onChange={(e) => setGuest(e.target.value)} className="input !py-1 text-small"><option value="">Add someone who joined…</option>{data.people.filter((p) => !room.attendance.some((x) => x.profile_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button onClick={addGuest} className="btn-ghost p-1.5" aria-label="Add"><UserPlus size={14} /></button></div>
            <label className="block mt-3"><span className="text-caption text-fg-muted">Notes taken by</span><select value={o.note_taker_id ?? ''} onChange={(e) => handOver(e.target.value)} className="input !py-1 text-small">{room.attendance.map((x) => <option key={x.profile_id} value={x.profile_id}>{data.nameOf(x.profile_id)}</option>)}</select></label>
          </>}
        </Box>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ history
function HistoryTab({ data, open }: { data: MeetingsData; open: (id: string) => void }) {
  const past = data.occurrences.filter((o) => o.status === 'done');
  const missed = data.occurrences.filter((o) => o.status === 'scheduled' && o.day < kigaliToday());
  // Attendance per person over the last 60 days.
  const per = new Map<string, { expected: number; came: number; late: number }>();
  for (const o of past) for (const x of data.attendance.filter((y) => y.occurrence_id === o.id && !y.guest)) {
    const r = per.get(x.profile_id) ?? { expected: 0, came: 0, late: 0 };
    r.expected += 1; if (x.status === 'present' || x.status === 'late') r.came += 1; if (x.status === 'late') r.late += 1;
    per.set(x.profile_id, r);
  }
  const fleet = past.filter((o) => o.kind === 'fleet_daily').slice(0, 14);
  const keys = ['collected_today', 'not_cleared', 'cars_taken_back', 'replaced_same_day', 'empty_seats', 'in_garage', 'fines_today'];
  const lateAvg = past.map(minutesLate).filter((m): m is number => m !== null);
  return (
    <>
      <StatGrid cols={4}>
        <StatCard label="Meetings held (60 days)" value={past.length} />
        <StatCard label="Not held" value={missed.length} tone={missed.length ? 'attention' : undefined} sub="scheduled but never started" />
        <StatCard icon={Clock} label="Average start" value={lateAvg.length ? `${Math.round(lateAvg.reduce((s, m) => s + m, 0) / lateAvg.length)} min late` : '—'} />
        <StatCard icon={Users2} label="Attendance" value={[...per.values()].reduce((s, r) => s + r.expected, 0) ? `${Math.round(([...per.values()].reduce((s, r) => s + r.came, 0) / [...per.values()].reduce((s, r) => s + r.expected, 0)) * 100)}%` : '—'} />
      </StatGrid>
      {fleet.length > 0 && (
        <Box title="Fleet & drivers — the numbers, meeting by meeting" icon={ClipboardList} padded={false} className="mb-4">
          <div className="overflow-x-auto"><table className="w-full text-small min-w-[760px]">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset"><th className="px-3 py-2">Day</th>{keys.map((k) => <th key={k} className="px-3 py-2 text-right">{metricsList(fleet[0]).find((m) => m.key === k)?.label ?? k}</th>)}</tr></thead>
            <tbody>{fleet.map((o) => <tr key={o.id} onClick={() => open(o.id)} className="border-t border-line-muted cursor-pointer hover:bg-hover/60"><td className="px-3 py-2">{o.day}</td>{keys.map((k) => { const v = metricsList(o).find((m) => m.key === k)?.value; return <td key={k} className="px-3 py-2 text-right tabular-nums">{v === null || v === undefined ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : v}</td>; })}</tr>)}</tbody>
          </table></div>
        </Box>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Attendance by person" icon={Users2} padded={false}>
          {per.size ? <table className="w-full text-small"><tbody>{[...per.entries()].sort((x, y) => y[1].expected - x[1].expected).map(([pid, r]) => (
            <tr key={pid} className="border-t border-line-muted first:border-t-0"><td className="px-3 py-2">{data.nameOf(pid)}</td><td className="px-3 py-2 text-right tabular-nums">{r.came}/{r.expected}</td><td className="px-3 py-2 text-right tabular-nums text-caption text-fg-muted">{r.late ? `${r.late} late` : ''}</td><td className="px-3 py-2 text-right tabular-nums font-medium">{Math.round((r.came / r.expected) * 100)}%</td></tr>
          ))}</tbody></table> : <p className="p-5 text-small text-fg-muted">No meeting held yet.</p>}
        </Box>
        <Box title="Past meetings" icon={History} padded={false}>
          {past.length ? <ul className="divide-y divide-line-muted max-h-[420px] overflow-y-auto">{past.map((o) => (
            <li key={o.id}><button onClick={() => open(o.id)} className="w-full text-left px-4 py-2 hover:bg-hover/60 text-small flex gap-2"><span className="w-24 text-fg-muted">{o.day}</span><span className="flex-1">{o.title}</span><span className="text-caption text-fg-muted">{clock(o.started_at)}–{clock(o.ended_at)}</span></button></li>
          ))}</ul> : <EmptyState icon={History} title="Nothing yet" />}
        </Box>
      </div>
    </>
  );
}

// ------------------------------------------------------------ regular meetings (MD)
function SeriesTab({ data }: { data: MeetingsData }) {
  const [editing, setEditing] = useState<Series | 'new' | null>(null);
  return (
    <>
      <div className="flex justify-end mb-3"><button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> New regular meeting</button></div>
      <div className="space-y-2">{data.series.map((s) => (
        <button key={s.id} onClick={() => setEditing(s)} className={`w-full text-left card p-3 hover:border-line-strong flex flex-wrap items-center gap-3 ${s.active ? '' : 'opacity-60'}`}>
          <span className="font-mono text-body font-semibold w-14">{hhmm(s.start_time)}</span>
          <span className="flex-1 min-w-[200px]"><span className="text-body font-semibold">{s.name}</span><span className="block text-caption text-fg-muted">{s.days.length === 7 ? 'Every day' : s.days.map((d) => DAY_NAMES[d]).join(', ')} · {s.duration_min} min · {s.expected.length} people · notes by {data.nameOf(s.note_taker_id).split(' ')[0]}</span></span>
          {!s.active && <Label>Paused</Label>}{s.metrics && <Label tone="info">{s.metrics === 'fleet' ? 'fleet numbers' : s.metrics === 'it' ? 'IT numbers' : 'Call Center numbers'}</Label>}
        </button>
      ))}</div>
      {editing && <SeriesModal data={data} series={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SeriesModal({ data, series, onClose }: { data: MeetingsData; series: Series | null; onClose: () => void }) {
  const { profile } = useAuth();
  const [f, setF0] = useState({ name: series?.name ?? '', purpose: series?.purpose ?? '', days: series?.days ?? [1, 2, 3, 4, 5], start_time: hhmm(series?.start_time ?? '09:00'), duration_min: series?.duration_min ?? 30,
    expected: series?.expected ?? (profile ? [profile.id] : []), note_taker_id: series?.note_taker_id ?? profile?.id ?? '', agenda: (series?.agenda ?? []).join('\n'), metrics: series?.metrics ?? '', email_recap: series?.email_recap ?? true, active: series?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setF = (v: typeof f) => { setF0(v); setClashes(null); };
  const [clashes, setClashes] = useState<{ person: string; clash: string }[] | null>(null);
  const save = async () => {
    if (!f.name.trim() || !f.days.length) { setError('Give it a name and at least one day.'); return; }
    setBusy(true); setError('');
    // Nobody double-booked: list the clashes first, save only once they are seen.
    if (f.active && clashes === null) {
      const { data: rows } = await supabase.rpc('series_clashes', { p_series: series?.id ?? null, p_days: f.days, p_start: f.start_time, p_minutes: f.duration_min, p_people: f.expected });
      const list = (rows ?? []) as { person: string; clash: string }[];
      if (list.length) { setClashes(list); setBusy(false); return; }
    }
    const row = { name: f.name.trim(), purpose: f.purpose.trim() || null, days: [...f.days].sort(), start_time: f.start_time, duration_min: f.duration_min, expected: f.expected, note_taker_id: f.note_taker_id || null, host_id: series?.host_id ?? profile?.id,
      agenda: f.agenda.split('\n').map((x) => x.trim()).filter(Boolean), metrics: f.metrics || null, email_recap: f.email_recap, active: f.active, updated_at: new Date().toISOString() };
    const res = series ? await supabase.from('meeting_series').update(row).eq('id', series.id) : await supabase.from('meeting_series').insert({ ...row, kind: 'other' });
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    data.reload(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={series ? series.name : 'New regular meeting'} subtitle="Changes apply from the next meeting created; meetings already on the list keep their settings." maxWidth="max-w-xl">
      <div className="space-y-3">
        <label className="block"><span className="text-caption text-fg-muted">Name *</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="input" /></label>
        <label className="block"><span className="text-caption text-fg-muted">Purpose</span><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} className="input" /></label>
        <div><span className="text-caption text-fg-muted">Days</span><div className="flex flex-wrap gap-1.5 mt-1">{[1, 2, 3, 4, 5, 6, 7].map((d) => { const on = f.days.includes(d); return <button key={d} type="button" onClick={() => setF({ ...f, days: on ? f.days.filter((x) => x !== d) : [...f.days, d] })} className={`w-11 py-1 rounded-md text-caption border ${on ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted'}`}>{DAY_NAMES[d]}</button>; })}</div></div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className="text-caption text-fg-muted">Starts</span><input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Minutes</span><input type="number" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: Number(e.target.value) || 30 })} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Numbers</span><select value={f.metrics} onChange={(e) => setF({ ...f, metrics: e.target.value as Series['metrics'] & string })} className="input"><option value="">None</option><option value="fleet">Fleet</option><option value="it">IT</option><option value="call_center">Call Center</option></select></label>
        </div>
        <div><span className="text-caption text-fg-muted">Who is expected</span><div className="flex flex-wrap gap-1.5 mt-1 max-h-40 overflow-y-auto">{data.people.map((p) => { const on = f.expected.includes(p.id); return <button key={p.id} type="button" onClick={() => setF({ ...f, expected: on ? f.expected.filter((x) => x !== p.id) : [...f.expected, p.id] })} className={`px-2.5 py-1 rounded-full text-caption border ${on ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted'}`}>{p.name.split(' ')[0]}</button>; })}</div></div>
        <label className="block"><span className="text-caption text-fg-muted">Notes taken by</span><select value={f.note_taker_id} onChange={(e) => setF({ ...f, note_taker_id: e.target.value })} className="input">{f.expected.map((id) => <option key={id} value={id}>{data.nameOf(id)}</option>)}</select></label>
        <label className="block"><span className="text-caption text-fg-muted">Agenda (one point per line)</span><textarea value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} rows={4} className="input resize-none" /></label>
        <div className="flex gap-4 text-small"><label className="flex items-center gap-1.5"><input type="checkbox" checked={f.email_recap} onChange={(e) => setF({ ...f, email_recap: e.target.checked })} /> Email the recap</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label></div>
        {clashes && clashes.length > 0 && (
          <div className="rounded-md bg-attention-muted px-3 py-2 text-small">
            <p className="font-semibold">This time collides for {new Set(clashes.map((c) => c.person)).size} person{new Set(clashes.map((c) => c.person)).size === 1 ? '' : 's'}:</p>
            <ul className="mt-1 space-y-0.5">{clashes.slice(0, 8).map((c, k) => <li key={k}><b>{c.person}</b> — {c.clash}</li>)}</ul>
            <p className="mt-1 text-caption text-fg-muted">Change the day, time or people — or save anyway if both meetings really happen together.</p>
          </div>
        )}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">{clashes?.length ? 'Save anyway' : 'Save'}</button></div>
      </div>
    </Modal>
  );
}
