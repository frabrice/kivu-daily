import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Circle, ClipboardCheck, Clock, Moon, Radio, Sparkles, Users2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { EntityLink } from '../../os/EntityLink';
import { Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import { kFormat, kigaliToday } from '../../lib/kigali';

// People > Today (MD, 31 Oct 2026): everyone's tasks for a day - what
// they're on, how far, what's late. The MD sees everyone; a head of
// department (route_finance / route_operations / route_it / route_call_center) sees their own
// department. Data: team_day() (migration 20261101190000).

interface DayTask {
  id: string; user_id: string; title: string; completed: boolean; completed_at: string | null; due_time: string | null; priority: string | null;
  smart_key: string | null; smart_total: number | null; smart_done: number | null; recurring: boolean; assigned_by: string | null;
  review_status: string | null; carried: boolean; auto_completed: boolean | null; created_at: string; meeting: boolean;
}
interface TeamDay {
  scope: 'all' | string[];
  people: { id: string; full_name: string; responsibility_label: string | null; dept: string | null; dept_name: string | null }[];
  tasks: DayTask[];
  shifts: { agent_id: string; started_at: string; ended_at: string | null; status: string; slot: string }[];
  working_on: { profile_id: string; issue_id: number; title: string; at: string }[];
  last_seen: { actor_id: string; at: string }[];
}
type Filter = 'all' | 'behind' | 'late' | 'none';
const ORDER = ['finance', 'fleet', 'it', 'call_center'];
const SLOT: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };
const time = (iso: string) => kFormat(iso, 'en-GB', { hour: '2-digit', minute: '2-digit' });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

// A list task (e.g. "Call 7 drivers") counts each of its items.
const units = (t: DayTask) => (t.smart_total && t.smart_total > 0 ? t.smart_total : 1);
const doneUnits = (t: DayTask) => (t.completed ? units(t) : Math.min(units(t), t.smart_total ? t.smart_done ?? 0 : 0));
// Given by someone (the MD), finished, not reviewed yet - as on Home.
const toReview = (t: DayTask) => t.completed && !t.review_status && !!t.assigned_by && t.assigned_by !== t.user_id;
// Late: still open after its due time (any open task of a past day).
function isLate(t: DayTask, day: string, today: string, nowHm: string) {
  if (t.completed) return false;
  if (day < today) return true;
  return day === today && !!t.due_time && t.due_time.slice(0, 5) < nowHm;
}

export default function TeamDayPage() {
  usePageTitle('Team today');
  const a = useAccess();
  const today = kigaliToday();
  const [day, setDay] = useState(today);
  const [data, setData] = useState<TeamDay | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('team_day', { p_day: day });
    if (error) { setErr(error.message); return; }
    setErr(''); setData(d as TeamDay);
  }, [day]);
  useEffect(() => {
    setData(null); load();
    const ch = supabase.channel(`team-day-${Math.random().toString(36).slice(2)}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load()).subscribe();
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [load]);

  const nowHm = kFormat(Date.now(), 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const rows = useMemo(() => (data?.people ?? []).map((p) => {
    const tasks = (data?.tasks ?? []).filter((t) => t.user_id === p.id);
    const total = tasks.reduce((s, t) => s + units(t), 0);
    const done = tasks.reduce((s, t) => s + doneUnits(t), 0);
    const late = tasks.filter((t) => isLate(t, day, today, nowHm));
    const shifts = (data?.shifts ?? []).filter((s) => s.agent_id === p.id);
    const onShift = shifts.find((s) => s.status === 'open');
    const working = (data?.working_on ?? []).find((w) => w.profile_id === p.id);
    const seen = (data?.last_seen ?? []).find((s) => s.actor_id === p.id)?.at ?? null;
    return { p, tasks, total, done, pct: total ? Math.round((done / total) * 100) : 0, late, shifts, onShift, working, seen, toReview: tasks.filter(toReview).length };
  }), [data, day, today, nowHm]);

  const shown = rows.filter((r) => (!dept || r.p.dept === dept) && (filter === 'all' || (filter === 'none' ? r.tasks.length === 0 : filter === 'late' ? r.late.length > 0 : r.tasks.length > 0 && r.pct < 100)));
  const totalUnits = rows.reduce((s, r) => s + r.total, 0);
  const doneAll = rows.reduce((s, r) => s + r.done, 0);
  const lateAll = rows.reduce((s, r) => s + r.late.length, 0);
  const none = rows.filter((r) => r.tasks.length === 0).length;
  const review = rows.reduce((s, r) => s + r.toReview, 0);
  const depts = [...new Set(rows.map((r) => r.p.dept ?? 'other'))].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  const scopeLabel = data?.scope === 'all' ? 'Everyone' : `Your department${Array.isArray(data?.scope) && data!.scope.length > 1 ? 's' : ''}`;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <PageHeader icon={Users2} title="Team today" subtitle={`${scopeLabel} · ${longDay(day)}${day === today ? ` · now ${nowHm}` : ''}: what each person has to do, how far they are, and what's late.`} />
      <div className="card p-3 flex flex-wrap items-center gap-2 text-small">
        {([['Today', today], ['Yesterday', addDays(today, -1)]] as const).map(([l, d]) => (
          <button key={l} onClick={() => setDay(d)} className={`px-2.5 py-1 rounded-md border ${day === d ? 'border-brand text-brand bg-brand/5 font-medium' : 'border-line text-fg-muted'}`}>{l}</button>
        ))}
        <span className="flex items-center gap-1"><CalendarDays size={14} className="text-fg-subtle" /><input type="date" className="input !w-auto py-1" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" /></span>
        <div className="flex gap-0.5 p-0.5 bg-inset rounded-lg sm:ml-auto" role="radiogroup" aria-label="Show">
          {([['all', 'Everyone'], ['behind', 'Not finished'], ['late', 'Late'], ['none', 'No tasks']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-md font-medium ${filter === k ? 'bg-surface-3 shadow-sm text-brand' : 'text-fg-muted'}`}>{l}</button>
          ))}
        </div>
        {depts.length > 1 && (
          <select className="input !w-auto py-1" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{rows.find((r) => (r.p.dept ?? 'other') === d)?.p.dept_name ?? 'Other'}</option>)}
          </select>
        )}
      </div>

      {err && <p className="text-small text-danger">{err}</p>}
      {!data && !err ? <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div> : data && (
        <>
          <StatGrid cols={4}>
            <StatCard icon={CheckCircle2} label="Team progress" value={totalUnits ? `${Math.round((doneAll / totalUnits) * 100)}%` : '—'} sub={`${doneAll} of ${totalUnits} done (each call or item counts)`} tone={totalUnits && doneAll / totalUnits >= 0.8 ? 'success' : undefined} />
            <StatCard icon={AlertTriangle} label="Late" value={lateAll} tone={lateAll ? 'danger' : 'success'} sub={day === today ? 'Open after their due time' : 'Not finished that day'} onClick={() => setFilter('late')} />
            <StatCard icon={Moon} label="No tasks" value={none} tone={none ? 'attention' : undefined} sub={none ? rows.filter((r) => !r.tasks.length).map((r) => r.p.full_name.split(/\s+/)[0]).join(', ') : 'Everyone has work'} onClick={() => setFilter('none')} />
            <StatCard icon={ClipboardCheck} label="Finished, to review" value={review} sub={a.isMd ? 'Review them from Home' : 'Waiting for the MD'} />
          </StatGrid>

          <div className="card divide-y divide-line-muted">
            {shown.map((r) => {
              const isOpen = open.has(r.p.id);
              const now = r.onShift ? `On shift since ${time(r.onShift.started_at)} (${SLOT[r.onShift.slot] ?? r.onShift.slot})`
                : r.shifts.length ? `Shift ${r.shifts.map((s) => `${time(s.started_at)}–${s.ended_at ? time(s.ended_at) : '…'}`).join(', ')}`
                : r.working ? `Working on: ${r.working.title}` : null;
              return (
                <div key={r.p.id}>
                  <button onClick={() => toggle(r.p.id)} className="w-full grid grid-cols-[18px_minmax(150px,220px)_1fr_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                    {isOpen ? <ChevronDown size={15} className="text-fg-subtle" /> : <ChevronRight size={15} className="text-fg-subtle" />}
                    <span className="min-w-0">
                      <span className="block font-medium truncate">{r.p.full_name}</span>
                      <span className="block text-caption text-fg-muted truncate">{r.p.responsibility_label || r.p.dept_name || ''}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="flex h-2 rounded-full bg-inset overflow-hidden"><span className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.pct >= 80 ? 'rgb(var(--c-success))' : r.pct >= 40 ? 'rgb(var(--c-attention))' : 'rgb(var(--c-danger))' }} /></span>
                      <span className="block text-caption text-fg-muted mt-1 truncate">
                        {now ? <><Radio size={10} className="inline -mt-0.5 mr-1 text-success" />{now}</> : null}
                        {now && r.seen ? ' · ' : ''}{r.seen ? `last active ${time(r.seen)}` : !now ? 'No activity in Kivu Daily that day' : ''}
                      </span>
                    </span>
                    <span className="text-right text-caption tabular-nums w-36">
                      {r.tasks.length ? <><b className="text-small">{r.pct}%</b> · {r.tasks.filter((t) => t.completed).length}/{r.tasks.length} tasks</> : <span className="text-attention">No tasks</span>}
                      {r.late.length > 0 && <span className="block text-danger">{r.late.length} late</span>}
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="px-4 pb-3 pl-11 space-y-1">
                      {r.tasks.map((t) => {
                        const late = isLate(t, day, today, nowHm);
                        return (
                          <li key={t.id} className="flex items-start gap-2 text-small">
                            {t.completed ? <CheckCircle2 size={14} className="text-success mt-0.5 shrink-0" /> : <Circle size={14} className={`${late ? 'text-danger' : 'text-fg-subtle'} mt-0.5 shrink-0`} />}
                            <span className="flex-1 min-w-0">
                              <span className={t.completed ? 'text-fg-muted line-through' : ''}>{t.title}</span>
                              <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                                {t.smart_total ? <Label tone={t.completed ? 'success' : 'info'}>{t.smart_done ?? 0}/{t.smart_total}</Label> : null}
                                {t.smart_key ? <Label icon={Sparkles}>Automatic</Label> : t.recurring ? <Label>Daily routine</Label> : t.meeting ? <Label>From a meeting</Label> : t.assigned_by ? <Label tone="accent">Given to them</Label> : null}
                                {t.carried && <Label tone="attention">Carried over</Label>}
                                {t.priority === 'high' && !t.completed && <Label tone="danger">High</Label>}
                                {toReview(t) && <Label tone="info">To review</Label>}
                              </span>
                            </span>
                            <span className={`text-caption tabular-nums whitespace-nowrap ${late ? 'text-danger font-medium' : 'text-fg-muted'}`}>
                              {t.completed ? (t.completed_at ? `done ${time(t.completed_at)}` : 'done') : t.due_time ? <><Clock size={11} className="inline -mt-0.5" /> {t.due_time.slice(0, 5)}{late ? ' late' : ''}</> : 'open'}
                            </span>
                          </li>
                        );
                      })}
                      {r.tasks.length === 0 && <li className="text-small text-fg-muted">No tasks that day.</li>}
                      {a.isMd && <li className="pt-1"><EntityLink type="person" id={r.p.id} label="Open their page (all days, notes)" className="text-caption" /></li>}
                    </ul>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && <p className="px-4 py-8 text-center text-body text-fg-muted">Nobody matches this filter.</p>}
          </div>
          <p className="text-caption text-fg-muted">Progress counts each item of a list task (e.g. 5 of 7 calls made). A task is late when it is still open after its due time. You get this as a message at 17:30 every day.</p>
        </>
      )}
    </div>
  );
}
