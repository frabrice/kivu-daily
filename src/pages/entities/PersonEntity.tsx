import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, Clock, Flame, Headphones, LayoutGrid, ListTodo, User, XCircle } from 'lucide-react';
import { EntityViewProps } from '../../os/peek';
import { EntityLink, useEntityMeta } from '../../os/EntityLink';
import { useAuth } from '../../lib/auth';
import { supabase, CallTicket } from '../../lib/supabase';
import { useCompanyData, buildEmployeeStats } from '../../lib/company';
import { durationLabel } from '../../lib/shifts';
import { addDays, kDay, today } from '../../lib/performance';
import { Box, Details, EmptyState, Heatmap, Label, ObjectLayout, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import Avatar from '../../components/Avatar';
import EmployeeProfilePage from '../../components/EmployeeProfilePage';

const SHADE = ['rgb(var(--c-line-muted))', 'rgb(var(--c-accent) / 0.30)', 'rgb(var(--c-accent) / 0.55)', 'rgb(var(--c-accent) / 0.80)', 'rgb(var(--c-accent))'];

// A staff member: their work rhythm (GitHub-style activity calendar),
// tasks done and on time, cases they answer, and the MD's notes to them.
export default function PersonEntity({ id, mode }: EntityViewProps) {
  const { profile: me } = useAuth();
  const nav = useNavigate();
  const { profiles, allTasks, loading } = useCompanyData();
  const person = profiles.find((p) => p.id === id) ?? null;
  useEntityMeta('person', id, mode, person?.full_name.trim(), (person as { department?: { name?: string } } | null)?.department?.name);
  const cases = useQuery({
    queryKey: ['person-cases', id],
    queryFn: async () => ((await supabase.from('call_tickets').select('id, reference, caller_name, status, assigned_at, created_at, first_response_at').eq('assignee_id', id).order('created_at', { ascending: false }).limit(200)).data as CallTicket[]) ?? [],
  });

  const t = today();
  const tasks = useMemo(() => allTasks.filter((x) => x.user_id === id), [allTasks, id]);
  const days = useMemo(() => Array.from({ length: 91 }, (_, i) => {
    const day = addDays(t, i - 90);
    const list = tasks.filter((x) => x.date === day);
    const done = list.filter((x) => x.completed).length;
    return { day, given: list.length, done };
  }), [tasks, t]);

  if (loading) return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-card" />)}</div>;
  if (!person) return <EmptyState icon={User} title="Person not found" />;

  const emp = buildEmployeeStats(person, allTasks);
  const last30 = tasks.filter((x) => x.date > addDays(t, -30) && x.date <= t);
  const done30 = last30.filter((x) => x.completed);
  const onTime30 = done30.filter((x) => x.completed_at && kDay(x.completed_at) <= x.date).length;
  const missed30 = last30.filter((x) => !x.completed && x.date < t).length;
  const weekly = Array.from({ length: 8 }, (_, w) => days.slice(w * 7 + 35, w * 7 + 42).reduce((s, d) => s + d.done, 0));
  const myCases = cases.data ?? [];
  const replies = myCases.filter((c) => c.first_response_at).map((c) => (new Date(c.first_response_at!).getTime() - new Date(c.assigned_at ?? c.created_at).getTime()) / 60000).filter((n) => n >= 0);
  const avgReply = replies.length ? replies.reduce((a, b) => a + b, 0) / replies.length : null;
  const openCases = myCases.filter((c) => !['resolved', 'closed'].includes(c.status));
  const dept = (person as { department?: { name?: string; slug?: string } }).department;
  const isAgent = dept?.slug === 'call_center';
  const isMd = me?.role === 'managing_director';

  const header = (
    <PageHeader avatar={<Avatar name={person.full_name} url={person.avatar_url} size="lg" />} title={person.full_name.trim()}
      labels={<>{person.role === 'managing_director' && <Label tone="accent">Managing Director</Label>}{!person.is_active && <Label>Left</Label>}{person.responsibility_label && <Label tone="info">{person.responsibility_label}</Label>}</>}
      meta={<><span>{dept?.name ?? 'No department'}</span>{person.email && <a href={`mailto:${person.email}`} className="link">{person.email}</a>}</>}
      actions={mode === 'page' && isAgent && isMd ? <button onClick={() => nav(`/call-center/agents/${id}`)} className="btn-secondary"><Headphones size={14} /> Shifts and calls</button> : undefined} />
  );
  const stats = (
    <StatGrid cols={mode === 'peek' ? 2 : 4}>
      <StatCard label="Tasks done (30 days)" icon={CheckCircle2} value={last30.length ? `${Math.round((done30.length / last30.length) * 100)}%` : '—'} spark={weekly} sub={`${done30.length} of ${last30.length}`} />
      <StatCard label="On time" icon={Clock} value={done30.length ? `${Math.round((onTime30 / done30.length) * 100)}%` : '—'} sub="Done on the day they were due" />
      <StatCard label="Missed (30 days)" icon={XCircle} value={missed30} tone={missed30 ? 'danger' : undefined} sub="Past their day, never done" />
      <StatCard label="Streak" icon={Flame} value={`${emp.streak} day${emp.streak === 1 ? '' : 's'}`} sub={`Today ${emp.todayCompleted}/${emp.todayTotal}`} />
    </StatGrid>
  );
  const calendar = (
    <Box title="Work calendar" icon={Activity} right={<span className="text-caption text-fg-muted">Tasks done per day, last 13 weeks</span>}>
      <Heatmap cells={days.map((d) => {
        const level = d.given === 0 ? 0 : d.done === 0 ? 0 : d.done / d.given < 0.5 ? 1 : d.done / d.given < 0.8 ? 2 : d.done / d.given < 1 ? 3 : 4;
        return { day: d.day, state: String(level), title: `${new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.given ? `${d.done} of ${d.given} tasks done` : 'No tasks'}` };
      })} legend={[{ state: '0', label: 'None', color: SHADE[0] }, { state: '1', label: '', color: SHADE[1] }, { state: '2', label: '', color: SHADE[2] }, { state: '3', label: '', color: SHADE[3] }, { state: '4', label: 'All done', color: SHADE[4] }]} />
    </Box>
  );
  const casesBox = (
    <Box title="Call Center cases" icon={Headphones} right={avgReply !== null ? <span className="text-caption text-fg-muted">first reply after {durationLabel(avgReply)} on average</span> : undefined} padded={false}>
      {openCases.length === 0 ? <p className="p-4 text-body text-fg-muted">No open cases. {myCases.length} handled in total.</p> : (
        <ul className="divide-y divide-line-muted">
          {openCases.slice(0, 8).map((c) => <li key={c.id} className="px-4 py-2 flex items-center gap-2 text-body"><EntityLink type="case" id={c.id} label={`${c.reference} · ${c.caller_name}`} /><Label tone="attention">{c.status.replace(/_/g, ' ')}</Label></li>)}
        </ul>
      )}
    </Box>
  );
  const side = <Box title="Details"><Details items={[{ label: 'Department', value: dept?.name }, { label: 'Email', value: person.email }, { label: 'In charge of', value: person.responsibility_label }, { label: 'Joined Kivu Daily', value: new Date(person.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }]} /></Box>;

  if (mode === 'peek') return <div className="p-4 space-y-4">{header}{stats}{calendar}{casesBox}</div>;
  return (
    <div className="animate-fade-in space-y-4">
      {header}
      <ObjectLayout side={side} main={<>{stats}{calendar}{casesBox}</>} />
      <Box title="Tasks and notes, day by day" icon={ListTodo} right={<LayoutGrid size={14} className="text-fg-subtle" />}>
        <EmployeeProfilePage employee={emp} allTasks={allTasks} onBack={() => nav(-1)} canComment={isMd} />
      </Box>
    </div>
  );
}
