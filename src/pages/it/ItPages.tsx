import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Ban, CalendarRange, CheckCircle2, Clock, Flag, Gauge, Inbox, KanbanSquare, LayoutList, ListChecks, Milestone as MilestoneIcon, Pencil,
  Plus, Rocket, Search, Users, UserX,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import {
  ACTIVE, FORECAST, ItData, ItMilestone, IssueStatus, PRIORITIES, PRIORITY_OF, STATUSES, SOURCE_LABEL, TYPES, TYPE_LABEL, addDays, ago, dayLabel, daysSince, isOpen, keyOf,
  kigaliToday, milestoneStats, pointsOf, useItData, useMyIt, when, workOf,
} from '../../lib/it';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs } from '../../ui/kit';
import { Pager, usePaged } from '../../ui/Pager';
import { ChartCard, DailyBars, DailyLines, RankBars, usePalette } from '../../components/charts/kit';
import IssuePanel from '../../components/it/IssuePanel';
import Modal from '../../components/Modal';
import { CheckInModal, IssueFormModal, MilestoneFormModal, StatusLabel, TriageModal } from '../../components/it/ItModals';

// IT & Product: Overview, Issues, Milestones, Inbox and Team.

const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

function useItContext() {
  const { profile } = useAuth();
  const data = useItData();
  const me = profile?.id ?? '';
  const member = data.members.find((m) => m.profile_id === me);
  const isLead = profile?.role === 'managing_director' || member?.role === 'head' || member?.role === 'md';
  const my = useMyIt(data, me);
  return { data, me, isLead, member, my };
}

const Avatar = ({ name, size = 28 }: { name: string; size?: number }) => (
  <span className="rounded-full bg-accent/15 text-accent-fg flex items-center justify-center font-semibold shrink-0" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>
);
const AreaChips = ({ data, areas }: { data: ItData; areas: string[] }) => (
  <span className="flex flex-wrap gap-1">{areas.map((a) => <span key={a} className="px-1.5 py-px rounded bg-inset text-micro text-fg-muted">{data.areaLabel(a)}</span>)}</span>
);
function Progress({ pct, tone = 'accent' }: { pct: number; tone?: 'accent' | 'success' | 'danger' | 'attention' }) {
  const c = { accent: 'rgb(var(--c-accent))', success: 'rgb(var(--c-success))', danger: 'rgb(var(--c-danger))', attention: 'rgb(var(--c-attention))' }[tone];
  return <div className="h-2 rounded-full bg-inset overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: c }} /></div>;
}
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;

function CheckInBanner({ ctx, onOpen }: { ctx: ReturnType<typeof useItContext>; onOpen?: () => void }) {
  if (!ctx.my.pendingCheckin) return null;
  if (!onOpen) return <Link to="/product/team?checkin=1" className="w-full mb-4 flex items-center gap-3 rounded-lg border border-attention/50 bg-attention-muted px-4 py-3"><Clock size={18} className="text-attention" /><span className="flex-1"><b>What are you working on?</b> <span className="text-small text-fg-muted">Confirm your current issue.</span></span><span className="btn-primary text-caption">Check in</span></Link>;
  return (
    <button onClick={onOpen} className="w-full mb-4 flex items-center gap-3 rounded-lg border border-attention/50 bg-attention-muted px-4 py-3 text-left">
      <Clock size={18} className="text-attention" />
      <span className="flex-1"><b>What are you working on?</b> <span className="text-small text-fg-muted">Confirm your current issue for the {ctx.my.pendingCheckin.slot === 'morning' ? 'morning' : 'afternoon'} check-in.</span></span>
      <span className="btn-primary text-caption">Check in</span>
    </button>
  );
}

// ================================================================ OVERVIEW
export function ItOverview() {
  usePageTitle('IT & Product');
  const ctx = useItContext();
  const { data, me, isLead, member } = ctx;
  const c = usePalette();
  const [newIssue, setNewIssue] = useState(false);
  const [newMilestone, setNewMilestone] = useState(false);
  const [checkin, setCheckin] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const today = kigaliToday();
  const weekly = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const from = addDays(today, -7 * (8 - i) + 1), to = addDays(today, -7 * (7 - i));
    const doneIn = data.issues.filter((x) => x.status === 'done' && x.completed_at && x.completed_at.slice(0, 10) >= from && x.completed_at.slice(0, 10) <= to);
    return { day: from, done: doneIn.length, unplanned: doneIn.filter((x) => !x.planned).length };
  }), [data.issues, today]);
  if (data.loading) return <Loading />;

  const openIssues = data.issues.filter(isOpen);
  const current = data.milestones.filter((m) => m.status === 'active' || (m.status === 'planned' && m.start_date <= addDays(today, 14))).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const p0 = openIssues.filter((i) => i.priority === 'p0');
  const blocked = openIssues.filter((i) => i.blocked);
  const stale = openIssues.filter((i) => ACTIVE.includes(i.status) && daysSince(i.last_activity_at) >= 3);
  const newInbox = data.inbox.filter((x) => x.status === 'new');
  const inProgress = openIssues.filter((i) => ACTIVE.includes(i.status));
  const doneWeek = data.issues.filter((i) => i.status === 'done' && i.completed_at && daysSince(i.completed_at) < 7);
  const byArea = data.areas.map((a) => ({ key: a.key, label: a.label, n: openIssues.filter((i) => i.areas.includes(a.key)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const issue = open ? data.issues.find((i) => i.id === open) : null;

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Rocket} title="IT & Product" subtitle="Milestones, the work and who is doing what — the plan for building the best ride-hailing technology in Africa."
        actions={<>
          {member?.checks_in && <button onClick={() => setCheckin(true)} className="btn-secondary"><Clock size={14} /> Check in</button>}
          {isLead && <button onClick={() => setNewMilestone(true)} className="btn-secondary"><MilestoneIcon size={14} /> New milestone</button>}
          <button onClick={() => setNewIssue(true)} className="btn-primary"><Plus size={14} /> New issue</button>
        </>} />
      <CheckInBanner ctx={ctx} onOpen={() => setCheckin(true)} />

      <StatGrid cols={6}>
        <StatCard icon={Gauge} label="In progress now" value={inProgress.length} sub={`${data.members.filter((m) => m.checks_in && !workOf(m.profile_id, data.issues).active.length).length} people with nothing`} to="/product/team" />
        <StatCard icon={ListChecks} label="Open issues" value={openIssues.length} sub={`${openIssues.filter((i) => i.priority === 'p1').length} high priority`} to="/product/issues" />
        <StatCard icon={AlertTriangle} label="Urgent (P0)" value={p0.length} tone={p0.length ? 'danger' : undefined} sub={p0.length ? 'Drop everything' : 'Nothing urgent'} to="/product/issues?priority=p0" />
        <StatCard icon={Ban} label="Blocked or stalled" value={blocked.length + stale.length} tone={blocked.length + stale.length ? 'attention' : undefined} sub={`${blocked.length} blocked · ${stale.length} no update 3+ days`} to="/product/issues" />
        <StatCard icon={CheckCircle2} label="Done this week" value={doneWeek.length} tone="success" spark={weekly.map((w) => w.done)} sub={`${doneWeek.filter((i) => !i.planned).length} were unplanned`} />
        <StatCard icon={Inbox} label="Requests to triage" value={newInbox.length} tone={newInbox.length ? 'attention' : undefined} sub="In the inbox" to="/product/inbox" />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2 space-y-3">
          <h2 className="section-title flex items-center gap-2"><MilestoneIcon size={15} /> Milestones now</h2>
          {current.length ? current.map((m) => <MilestoneCard key={m.id} data={data} m={m} />)
            : <EmptyState icon={MilestoneIcon} title="No milestone running" body="Plan the next two weeks: create a milestone and put issues in it." action={isLead && <button onClick={() => setNewMilestone(true)} className="btn-primary"><Plus size={14} /> New milestone</button>} />}
        </div>
        <Box title="Who is on what" icon={Users} padded={false} right={<Link to="/product/team" className="text-caption link">Team</Link>}>
          <ul className="divide-y divide-line-muted">
            {data.members.map((m) => {
              const w = workOf(m.profile_id, data.issues);
              const cur = w.active[0];
              return (
                <li key={m.profile_id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium truncate">{m.name}<span className="text-caption text-fg-muted font-normal"> · {m.title ?? (m.role === 'head' ? 'Head of IT' : 'IT')}</span></p>
                    {cur ? <button onClick={() => setOpen(cur.id)} className="block text-left text-small truncate max-w-full hover:underline"><span className="font-mono text-caption text-fg-muted">{keyOf(cur.id)}</span> {cur.title}</button>
                      : <p className={`text-small ${m.checks_in ? 'text-danger' : 'text-fg-muted'}`}>{m.checks_in ? 'Nothing in progress' : '—'}</p>}
                    {cur && <p className="text-caption text-fg-muted">since {ago(cur.started_at)} · updated {ago(cur.last_activity_at)}{w.active.length > 1 ? ` · +${w.active.length - 1} more` : ''}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Box>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <ChartCard title="Finished per week" subtitle="Last 8 weeks · planned and unplanned">
          <DailyBars data={weekly.map((w) => ({ day: w.day, planned: w.done - w.unplanned, unplanned: w.unplanned }))} series={[{ key: 'planned', label: 'Planned', color: c.blue }, { key: 'unplanned', label: 'Unplanned', color: c.yellow }]} c={c} height={200} />
        </ChartCard>
        <Box title="Open issues by area" icon={LayoutList}><RankBars rows={byArea.map((a) => ({ key: a.key, label: a.label, n: a.n }))} color={c.blue} empty="No open issues." /></Box>
        <Box title="Needs attention" icon={Flag} padded={false}>
          <ul className="divide-y divide-line-muted max-h-72 overflow-y-auto">
            {[...p0.map((i) => ({ i, why: 'P0 · urgent', tone: 'danger' as const })), ...blocked.map((i) => ({ i, why: `Blocked${i.blocked_reason ? `: ${i.blocked_reason}` : ''}`, tone: 'danger' as const })),
              ...stale.map((i) => ({ i, why: `No update for ${daysSince(i.last_activity_at)} days`, tone: 'attention' as const })),
              ...openIssues.filter((i) => !i.assignee_id && i.priority <= 'p1' && i.milestone_id).map((i) => ({ i, why: 'High priority, nobody on it', tone: 'attention' as const }))]
              .slice(0, 12).map(({ i, why, tone }, n) => (
                <li key={`${i.id}-${n}`}><button onClick={() => setOpen(i.id)} className="w-full text-left px-4 py-2 hover:bg-hover"><span className="block text-small truncate"><span className="font-mono text-caption text-fg-muted">{keyOf(i.id)}</span> {i.title}</span><span className={`text-caption ${tone === 'danger' ? 'text-danger' : 'text-attention'}`}>{why}</span></button></li>
              ))}
            {!p0.length && !blocked.length && !stale.length && <li className="px-4 py-6 text-center text-small text-fg-muted">Nothing needs attention.</li>}
          </ul>
        </Box>
      </div>

      {newIssue && <IssueFormModal data={data} issue={null} isLead={isLead} me={me} onClose={() => setNewIssue(false)} onSaved={(id) => { data.reload(); setOpen(id); }} />}
      {newMilestone && <MilestoneFormModal data={data} milestone={null} onClose={() => setNewMilestone(false)} onSaved={() => data.reload()} />}
      {checkin && <CheckInModal data={data} me={me} onClose={() => setCheckin(false)} onDone={data.reload} />}
      {issue && <IssuePanel data={data} issue={issue} me={me} isLead={isLead} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MilestoneCard({ data, m }: { data: ItData; m: ItMilestone }) {
  const s = milestoneStats(m, data.issues, data.areas);
  const f = FORECAST[s.forecast];
  const left = Math.round((Date.parse(m.end_date) - Date.parse(kigaliToday())) / 86400000);
  return (
    <Link to={`/product/milestones?m=${m.id}`} className="card p-4 block hover:border-line-strong">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-mono text-caption text-fg-muted">M{m.number}</span>
        <span className="text-body font-semibold flex-1 min-w-0 truncate">{m.name}</span>
        <Label tone={f.tone}>{f.label}</Label>
        <span className="text-caption text-fg-muted">{dayLabel(m.start_date)} – {dayLabel(m.end_date)} · {left >= 0 ? `${left} days left` : `${-left} days over`}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
        <div className="space-y-1">
          <Progress pct={s.pct} tone={s.forecast === 'late' ? 'danger' : s.forecast === 'at_risk' ? 'attention' : 'success'} />
          <div className="h-1 rounded-full bg-inset overflow-hidden"><div className="h-full bg-line-strong" style={{ width: `${s.timePct}%` }} /></div>
        </div>
        <span className="text-small tabular-nums"><b>{s.done}</b>/{s.total} done · {s.pct}%</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-caption text-fg-muted">
        {s.byArea.slice(0, 6).map((a) => <span key={a.key}>{a.key ? data.areaLabel(a.key) : 'No area'} <b className="text-fg">{a.done}/{a.total}</b></span>)}
        {s.blocked > 0 && <span className="text-danger">{s.blocked} blocked</span>}
        {s.addedAfterStart > 0 && <span className="text-attention">+{s.addedAfterStart} added after start</span>}
      </div>
    </Link>
  );
}

// ================================================================ ISSUES
type IssueView = 'board' | 'table';
export function ItIssues() {
  usePageTitle('Issues');
  const ctx = useItContext();
  const { data, me, isLead } = ctx;
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<IssueView>(() => { try { return (localStorage.getItem('it-issue-view') as IssueView) || 'board'; } catch { return 'board'; } });
  const [q, setQ] = useState('');
  const [milestone, setMilestone] = useState(params.get('milestone') ?? '');
  const [area, setArea] = useState('');
  const [person, setPerson] = useState('');
  const [priority, setPriority] = useState(params.get('priority') ?? '');
  const [type, setType] = useState('');
  const [closed, setClosed] = useState(false);
  const [newIssue, setNewIssue] = useState(params.get('new') === '1');
  const open = params.get('issue') ? Number(params.get('issue')) : null;
  const setOpen = (id: number | null) => { const p = new URLSearchParams(params); if (id) p.set('issue', String(id)); else p.delete('issue'); setParams(p, { replace: true }); };
  useEffect(() => { try { localStorage.setItem('it-issue-view', view); } catch { /* ignore */ } }, [view]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return data.issues.filter((i) => {
      if (!closed && !isOpen(i) && !(i.status === 'done' && i.completed_at && daysSince(i.completed_at) < 14 && view === 'board')) return false;
      if (milestone === 'none' ? !!i.milestone_id : milestone && i.milestone_id !== milestone) return false;
      if (area && !i.areas.includes(area)) return false;
      if (person === 'me' ? i.assignee_id !== me : person === 'none' ? !!i.assignee_id : person && i.assignee_id !== person) return false;
      if (person === 'unplanned' && i.planned) return false;
      if (priority && i.priority !== priority) return false;
      if (type && i.type !== type) return false;
      return !n || `${keyOf(i.id)} ${i.title} ${i.labels.join(' ')}`.toLowerCase().includes(n);
    }).sort((a, b) => a.priority.localeCompare(b.priority) || b.last_activity_at.localeCompare(a.last_activity_at));
  }, [data.issues, q, milestone, area, person, priority, type, closed, me, view]);
  const paged = usePaged(list, { key: 'it-issues', reset: `${q}${milestone}${area}${person}${priority}${type}${closed}` });
  if (data.loading) return <Loading />;
  const issue = open ? data.issues.find((i) => i.id === open) : null;
  const columns: IssueStatus[] = ['backlog', 'ready', 'in_progress', 'in_review', 'testing', 'done'];

  return (
    <div className="animate-fade-in">
      <PageHeader icon={ListChecks} title="Issues" subtitle="All IT work. Requests from other teams come in through the Inbox first."
        actions={<button onClick={() => setNewIssue(true)} className="btn-primary"><Plus size={14} /> New issue</button>} />
      <CheckInBanner ctx={ctx} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="relative block w-56"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search KR- or words" /></label>
        <select value={milestone} onChange={(e) => setMilestone(e.target.value)} className="input !w-auto" aria-label="Milestone"><option value="">Any milestone</option><option value="none">Backlog (no milestone)</option>{data.milestones.map((m) => <option key={m.id} value={m.id}>M{m.number} · {m.name}</option>)}</select>
        <select value={area} onChange={(e) => setArea(e.target.value)} className="input !w-auto" aria-label="Area"><option value="">Any area</option>{data.areas.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
        <select value={person} onChange={(e) => setPerson(e.target.value)} className="input !w-auto" aria-label="Person"><option value="">Anyone</option><option value="me">Mine</option><option value="none">Nobody</option><option value="unplanned">Unplanned work</option>{data.members.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.name}</option>)}</select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input !w-auto" aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="input !w-auto" aria-label="Type"><option value="">Any type</option>{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        <label className="flex items-center gap-1.5 text-small text-fg-muted"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Closed too</label>
        <div className="ml-auto flex gap-0.5 p-0.5 bg-inset rounded-lg">
          {([['board', KanbanSquare, 'Board'], ['table', LayoutList, 'Table']] as const).map(([k, Icon, l]) => (
            <button key={k} onClick={() => setView(k)} aria-pressed={view === k} className={`px-2.5 py-1 rounded-md text-small flex items-center gap-1.5 ${view === k ? 'bg-surface-3 shadow-sm font-medium' : 'text-fg-muted'}`}><Icon size={14} /> {l}</button>
          ))}
        </div>
      </div>

      {view === 'board' ? (
        <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-3 overflow-x-auto pb-2">
          {columns.map((col) => {
            const items = list.filter((i) => i.status === col);
            return (
              <div key={col} className="rounded-lg bg-inset p-2 min-h-[200px]">
                <p className="px-1.5 pb-2 text-caption font-semibold text-fg-muted flex items-center gap-1.5"><StatusLabel status={col} /> {items.length}{col === 'done' && !closed && <span className="font-normal">· last 14 days</span>}</p>
                <div className="space-y-1.5">
                  {items.map((i) => (
                    <button key={i.id} onClick={() => setOpen(i.id)} className="w-full text-left card p-2.5 hover:border-line-strong">
                      <p className="flex items-center gap-1.5 text-micro text-fg-muted"><span className="font-mono">{keyOf(i.id)}</span>
                        <Label tone={PRIORITY_OF[i.priority].tone}>{i.priority.toUpperCase()}</Label>
                        {i.type === 'bug' && <Label tone="danger">Bug</Label>}{!i.planned && <Label tone="attention">Unplanned</Label>}{i.blocked && <Label tone="danger" icon={Ban}>Blocked</Label>}</p>
                      <p className="text-small font-medium mt-1 line-clamp-2">{i.title}</p>
                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <AreaChips data={data} areas={i.areas.slice(0, 2)} />
                        {i.assignee_id ? <Avatar name={data.nameOf(i.assignee_id)} size={22} /> : <UserX size={14} className="text-fg-subtle" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : list.length ? (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-body min-w-[980px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Issue', 'Status', 'Priority', 'Areas', 'Assignee', 'Milestone', 'Size', 'Updated'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {paged.rows.map((i) => (
                  <tr key={i.id} onClick={() => setOpen(i.id)} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                    <td className={`${td} max-w-[360px]`}><span className="font-mono text-caption text-fg-muted">{keyOf(i.id)}</span> <span className="font-medium">{i.title}</span>
                      <span className="block text-caption text-fg-muted">{TYPE_LABEL[i.type]}{!i.planned ? ' · unplanned' : ''}{i.blocked ? ' · blocked' : ''}</span></td>
                    <td className={td}><StatusLabel status={i.status} /></td>
                    <td className={td}><Label tone={PRIORITY_OF[i.priority].tone}>{i.priority.toUpperCase()}</Label></td>
                    <td className={td}><AreaChips data={data} areas={i.areas} /></td>
                    <td className={`${td} whitespace-nowrap`}>{i.assignee_id ? data.nameOf(i.assignee_id) : <span className="text-fg-subtle">Nobody</span>}</td>
                    <td className={`${td} text-caption whitespace-nowrap`}>{i.milestone_id ? `M${data.milestones.find((m) => m.id === i.milestone_id)?.number}` : 'Backlog'}</td>
                    <td className={`${td} text-caption uppercase`}>{i.size ?? '—'}</td>
                    <td className={`${td} text-caption text-fg-muted whitespace-nowrap`}>{ago(i.last_activity_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager pager={paged.pager} noun="issues" />
        </>
      ) : <EmptyState icon={ListChecks} title="No issue matches" />}

      {newIssue && <IssueFormModal data={data} issue={null} isLead={isLead} me={me} defaults={milestone && milestone !== 'none' ? { milestone_id: milestone } : undefined} onClose={() => { setNewIssue(false); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }} onSaved={(id) => { data.reload(); setOpen(id); }} />}
      {issue && <IssuePanel data={data} issue={issue} me={me} isLead={isLead} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ================================================================ MILESTONES
export function ItMilestones() {
  usePageTitle('Milestones');
  const { data, me, isLead } = useItContext();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const openId = params.get('m');
  if (data.loading) return <Loading />;
  const m = openId ? data.milestones.find((x) => x.id === openId) : null;
  if (m) return <MilestoneDetail data={data} m={m} me={me} isLead={isLead} onBack={() => setParams({})} />;
  const groups: [string, ItMilestone[]][] = [
    ['Active', data.milestones.filter((x) => x.status === 'active')],
    ['Planned', data.milestones.filter((x) => x.status === 'planned').sort((a, b) => a.start_date.localeCompare(b.start_date))],
    ['Finished', data.milestones.filter((x) => x.status === 'completed' || x.status === 'cancelled')],
  ];
  return (
    <div className="animate-fade-in">
      <PageHeader icon={MilestoneIcon} title="Milestones" subtitle="Time-boxed delivery: a goal, a start and an end date (2 weeks by default), and the issues that make it."
        actions={isLead && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> New milestone</button>} />
      {data.milestones.length ? groups.map(([g, ms]) => ms.length > 0 && (
        <section key={g} className="mb-5">
          <h2 className="section-title mb-2">{g} <span className="text-fg-muted font-normal">· {ms.length}</span></h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{ms.map((x) => <MilestoneCard key={x.id} data={data} m={x} />)}</div>
        </section>
      )) : <EmptyState icon={MilestoneIcon} title="No milestones yet" />}
      {creating && <MilestoneFormModal data={data} milestone={null} onClose={() => setCreating(false)} onSaved={(id) => { data.reload(); setParams({ m: id }); }} />}
    </div>
  );
}

function MilestoneDetail({ data, m, me, isLead, onBack }: { data: ItData; m: ItMilestone; me: string; isLead: boolean; onBack: () => void }) {
  usePageTitle(`M${m.number} · ${m.name}`);
  const c = usePalette();
  const s = useMemo(() => milestoneStats(m, data.issues, data.areas), [m, data.issues, data.areas]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newIssue, setNewIssue] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState('');
  const issues = data.issues.filter((i) => i.milestone_id === m.id).sort((a, b) => STATUSES.findIndex((x) => x.key === a.status) - STATUSES.findIndex((x) => x.key === b.status) || a.priority.localeCompare(b.priority));
  const paged = usePaged(issues, { key: 'milestone-issues' });
  const people = data.members.map((p) => ({ p, list: issues.filter((i) => i.assignee_id === p.profile_id) })).filter((x) => x.list.length);
  const f = FORECAST[s.forecast];
  const left = Math.round((Date.parse(m.end_date) - Date.parse(kigaliToday())) / 86400000);
  const setStatus = async (status: ItMilestone['status']) => {
    const { error: err } = await supabase.from('it_milestones').update({ status, updated_at: new Date().toISOString(), ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}) }).eq('id', m.id);
    if (err) setError(err.message); else data.reload();
  };
  const issue = open ? data.issues.find((i) => i.id === open) : null;
  return (
    <div className="animate-fade-in">
      <button onClick={onBack} className="text-caption text-fg-muted hover:text-fg flex items-center gap-1 mb-2"><ArrowLeft size={12} /> All milestones</button>
      <PageHeader icon={MilestoneIcon} title={`M${m.number} · ${m.name}`} subtitle={m.goal ?? undefined}
        labels={<><Label tone={m.status === 'active' ? 'accent' : m.status === 'completed' ? 'success' : 'neutral'}>{m.status[0].toUpperCase() + m.status.slice(1)}</Label><Label tone={f.tone}>{f.label}</Label></>}
        meta={<><span className="flex items-center gap-1"><CalendarRange size={12} /> {dayLabel(m.start_date)} – {dayLabel(m.end_date, true)} · {s.daysTotal} days</span><span>{left >= 0 ? `${left} days left` : `${-left} days over`}</span><span>Owner: {data.nameOf(m.owner_id)}</span></>}
        actions={isLead && <>
          {m.status === 'planned' && <button onClick={() => setStatus('active')} className="btn-primary"><Rocket size={14} /> Start</button>}
          {m.status === 'active' && <button onClick={() => setStatus('completed')} className="btn-primary"><CheckCircle2 size={14} /> Complete</button>}
          <button onClick={() => setAdding(true)} className="btn-secondary"><Plus size={14} /> Add issues</button>
          <button onClick={() => setEditing(true)} className="btn-ghost" aria-label="Edit"><Pencil size={14} /></button>
        </>} />
      {error && <p className="mb-3 text-caption text-danger">{error}</p>}
      <StatGrid cols={6}>
        <StatCard label="Progress" value={`${s.pct}%`} sub={`${s.pointsDone}/${s.points} points · ${s.timePct}% of the time`} tone={s.forecast === 'late' ? 'danger' : s.forecast === 'at_risk' ? 'attention' : 'success'} />
        <StatCard label="Issues done" value={`${s.done}/${s.total}`} sub={`${s.byStatus.in_progress + s.byStatus.in_review + s.byStatus.testing} in progress`} />
        <StatCard label="Added after start" value={s.addedAfterStart} tone={s.addedAfterStart ? 'attention' : undefined} sub="Scope that grew" />
        <StatCard label="Unplanned" value={s.unplanned} sub="Developers' own issues" />
        <StatCard label="Blocked" value={s.blocked} tone={s.blocked ? 'danger' : undefined} sub="Waiting on something" />
        <StatCard label="Nobody on it" value={s.unassigned} tone={s.unassigned ? 'attention' : undefined} sub="Open, unassigned" />
      </StatGrid>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2">
          <ChartCard title="Burn-up" subtitle="Points done (green) against the scope (grey) · yellow is the even pace">
            {s.burn.length > 1 ? <DailyLines data={s.burn} series={[{ key: 'scope', label: 'Scope', color: c.other }, { key: 'ideal', label: 'Even pace', color: c.yellow }, { key: 'done', label: 'Done', color: c.aqua }]} c={c} height={220} />
              : <p className="text-small text-fg-muted py-10 text-center">{s.daysGone === 0 ? `Starts ${dayLabel(m.start_date)}.` : 'The chart fills in day by day.'}</p>}
          </ChartCard>
        </div>
        <Box title="By area" icon={LayoutList}>
          <ul className="space-y-2">
            {s.byArea.map((a) => (
              <li key={a.key || 'none'}>
                <div className="flex justify-between text-caption mb-0.5"><span>{a.key ? data.areaLabel(a.key) : 'No area'}</span><span className="tabular-nums text-fg-muted">{a.done}/{a.total}</span></div>
                <Progress pct={a.total ? (a.done / a.total) * 100 : 0} tone="success" />
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-line-muted flex flex-wrap gap-x-3 gap-y-1 text-caption text-fg-muted">
            {TYPES.filter((t) => s.byType[t.key]).map((t) => <span key={t.key}>{t.label} <b className="text-fg">{s.byType[t.key]}</b></span>)}
          </div>
        </Box>
      </div>
      {people.length > 0 && (
        <Box title="Who is doing what" icon={Users} className="mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {people.map(({ p, list }) => {
              const done = list.filter((i) => i.status === 'done').length;
              return (
                <div key={p.profile_id} className="flex items-center gap-2.5">
                  <Avatar name={p.name} />
                  <div className="flex-1 min-w-0"><p className="text-small font-medium truncate">{p.name}</p><Progress pct={(done / list.length) * 100} tone="success" /><p className="text-caption text-fg-muted">{done}/{list.length} done · {list.reduce((x, i) => x + pointsOf(i), 0)} pts</p></div>
                </div>
              );
            })}
          </div>
        </Box>
      )}
      <Box title="Issues" icon={ListChecks} padded={false} right={<button onClick={() => setNewIssue(true)} className="btn-ghost text-caption"><Plus size={13} /> New issue here</button>}>
        {issues.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-body min-w-[820px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Issue', 'Status', 'Priority', 'Areas', 'Assignee', 'Size'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {paged.rows.map((i) => (
                    <tr key={i.id} onClick={() => setOpen(i.id)} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                      <td className={`${td} max-w-[380px]`}><span className="font-mono text-caption text-fg-muted">{keyOf(i.id)}</span> {i.title}{i.milestone_added_at && i.milestone_added_at.slice(0, 10) > m.start_date && <span className="ml-1.5"><Label tone="attention">added later</Label></span>}</td>
                      <td className={td}><StatusLabel status={i.status} /></td>
                      <td className={td}><Label tone={PRIORITY_OF[i.priority].tone}>{i.priority.toUpperCase()}</Label></td>
                      <td className={td}><AreaChips data={data} areas={i.areas} /></td>
                      <td className={`${td} whitespace-nowrap`}>{i.assignee_id ? data.nameOf(i.assignee_id) : <span className="text-fg-subtle">Nobody</span>}</td>
                      <td className={`${td} uppercase text-caption`}>{i.size ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager pager={paged.pager} noun="issues" className="px-3" />
          </>
        ) : <p className="p-6 text-center text-body text-fg-muted">No issues yet — add some from the backlog.</p>}
      </Box>
      {editing && <MilestoneFormModal data={data} milestone={m} onClose={() => setEditing(false)} onSaved={() => data.reload()} />}
      {adding && <AddToMilestone data={data} m={m} onClose={() => setAdding(false)} />}
      {newIssue && <IssueFormModal data={data} issue={null} isLead={isLead} me={me} defaults={{ milestone_id: m.id }} onClose={() => setNewIssue(false)} onSaved={(id) => { data.reload(); setOpen(id); }} />}
      {issue && <IssuePanel data={data} issue={issue} me={me} isLead={isLead} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AddToMilestone({ data, m, onClose }: { data: ItData; m: ItMilestone; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = q.trim().toLowerCase();
  const list = data.issues.filter((i) => isOpen(i) && i.milestone_id !== m.id && (!n || `${keyOf(i.id)} ${i.title}`.toLowerCase().includes(n))).sort((a, b) => Number(!!a.milestone_id) - Number(!!b.milestone_id) || a.priority.localeCompare(b.priority));
  const save = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.from('it_issues').update({ milestone_id: m.id }).in('id', [...picked]);
    setBusy(false);
    if (err) { setError(err.message); return; }
    data.reload(); onClose();
  };
  const ModalComp = Modal;
  return (
    <ModalComp open onClose={onClose} title={`Add issues to M${m.number}`} subtitle="Backlog first, then issues in other milestones (they move here)." maxWidth="max-w-xl">
      <div className="space-y-3">
        <label className="relative block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search" /></label>
        <ul className="divide-y divide-line-muted rounded-lg border border-line max-h-[52vh] overflow-y-auto">
          {list.map((i) => (
            <li key={i.id}><label className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-hover">
              <input type="checkbox" className="mt-1" checked={picked.has(i.id)} onChange={() => setPicked((s) => { const x = new Set(s); if (x.has(i.id)) x.delete(i.id); else x.add(i.id); return x; })} />
              <span className="flex-1 min-w-0"><span className="block text-body"><span className="font-mono text-caption text-fg-muted">{keyOf(i.id)}</span> {i.title}</span>
                <span className="text-caption text-fg-muted">{i.priority.toUpperCase()} · {i.milestone_id ? `now in M${data.milestones.find((x) => x.id === i.milestone_id)?.number}` : 'backlog'} · {SOURCE_LABEL[i.source]}</span></span>
            </label></li>
          ))}
          {!list.length && <li className="px-3 py-6 text-center text-small text-fg-muted">Nothing to add.</li>}
        </ul>
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={save} disabled={busy || !picked.size} className="btn-primary disabled:opacity-50">Add {picked.size || ''}</button></div>
      </div>
    </ModalComp>
  );
}

// ================================================================ INBOX
type InboxTab = 'new' | 'parked' | 'decided';
export function ItInbox() {
  usePageTitle('Inbox');
  const { data, isLead } = useItContext();
  const [tab, setTab] = useState<InboxTab>('new');
  const [triage, setTriage] = useState<string | null>(null);
  const list = data.inbox.filter((x) => (tab === 'new' ? x.status === 'new' : tab === 'parked' ? x.status === 'parked' : ['accepted', 'merged', 'declined'].includes(x.status)));
  const paged = usePaged(list, { key: 'it-inbox', reset: tab });
  if (data.loading) return <Loading />;
  const item = triage ? data.inbox.find((x) => x.id === triage) : null;
  const decision: Record<string, { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }> = { accepted: { label: 'Accepted', tone: 'success' }, merged: { label: 'Merged', tone: 'info' }, declined: { label: 'Declined', tone: 'danger' }, parked: { label: 'Parked', tone: 'neutral' } };
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Inbox} title="Inbox" subtitle="Every request, idea and flag from the company lands here. The head of IT decides: accept as an issue, merge, park or decline — the person who asked sees the answer." />
      <UnderlineTabs<InboxTab> value={tab} onChange={setTab} tabs={[{ key: 'new', label: 'To triage', count: data.inbox.filter((x) => x.status === 'new').length, tone: 'danger' }, { key: 'parked', label: 'Parked', count: data.inbox.filter((x) => x.status === 'parked').length }, { key: 'decided', label: 'Decided' }]} />
      {list.length ? (
        <>
          <ul className="space-y-2">
            {paged.rows.map((x) => (
              <li key={x.id} className="card p-4 flex flex-wrap items-start gap-3">
                <Avatar name={data.nameOf(x.submitted_by)} />
                <div className="flex-1 min-w-[240px]">
                  <p className="text-body font-medium">{x.title}</p>
                  <p className="text-caption text-fg-muted">{data.nameOf(x.submitted_by)} · {when(x.submitted_at)}{x.persona ? ` · affects ${x.persona}s` : ''}{x.entity_label ? ` · about ${x.entity_label}` : ''}</p>
                  {x.details && <p className="text-small text-fg-muted mt-1 whitespace-pre-line line-clamp-4">{x.details}</p>}
                  {x.status !== 'new' && <p className="text-caption mt-1.5"><Label tone={decision[x.status].tone}>{decision[x.status].label}</Label> by {data.nameOf(x.decided_by)} · {when(x.decided_at)}{x.issue_id ? <> · <Link to={`/product/issues?issue=${x.issue_id}`} className="link">{keyOf(x.issue_id)}</Link></> : ''}{x.decision_note ? ` · “${x.decision_note}”` : ''}</p>}
                </div>
                {isLead && (x.status === 'new' || x.status === 'parked') && <button onClick={() => setTriage(x.id)} className="btn-primary text-caption">Triage</button>}
              </li>
            ))}
          </ul>
          <Pager pager={paged.pager} noun="requests" />
        </>
      ) : <EmptyState icon={Inbox} title={tab === 'new' ? 'Inbox zero' : 'Nothing here'} body={tab === 'new' ? 'Every request has been decided.' : undefined} />}
      {item && <TriageModal data={data} item={item} onClose={() => setTriage(null)} onDone={() => data.reload()} />}
    </div>
  );
}

// ================================================================ TEAM
export function ItTeam() {
  usePageTitle('IT team');
  const ctx = useItContext();
  const { data, me, isLead, member } = ctx;
  const [params, setParams] = useSearchParams();
  const [checkin, setCheckin] = useState(params.get('checkin') === '1');
  const [open, setOpen] = useState<number | null>(null);
  const today = kigaliToday();
  const days = Array.from({ length: 10 }, (_, i) => addDays(today, -i)).filter((d) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; }).slice(0, 5);
  if (data.loading) return <Loading />;
  const issue = open ? data.issues.find((i) => i.id === open) : null;
  const toggleChecks = async (profileId: string, v: boolean) => { await supabase.from('it_members').update({ checks_in: v }).eq('profile_id', profileId); data.reload(); };
  const cell = (pid: string, day: string, slot: 'morning' | 'afternoon') => {
    const c = data.checkins.find((x) => x.profile_id === pid && x.day === day && x.slot === slot);
    const self = data.checkins.find((x) => x.profile_id === pid && x.day === day && x.slot === 'self');
    if (c?.confirmed_at) return <span className="text-success" title={`Confirmed ${when(c.confirmed_at)}${c.issue_id ? ` · ${keyOf(c.issue_id)}` : ''}`}>✓</span>;
    if (c?.asked_at) return <span className="text-danger" title="Asked, not answered">✗</span>;
    if (self?.confirmed_at && slot === 'morning') return <span className="text-success" title="Checked in on their own">✓</span>;
    return <span className="text-fg-subtle">·</span>;
  };
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Users} title="IT team" subtitle="What everyone is working on right now. Check-ins at 10:00 and 14:00, Monday to Friday."
        actions={member?.checks_in && <button onClick={() => { setCheckin(true); }} className="btn-primary"><Clock size={14} /> Check in</button>} />
      <CheckInBanner ctx={ctx} onOpen={() => setCheckin(true)} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        {data.members.map((m) => {
          const w = workOf(m.profile_id, data.issues);
          const todayAsk = data.checkins.filter((x) => x.profile_id === m.profile_id && x.day === today);
          return (
            <section key={m.profile_id} className="card p-4">
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={m.name} size={36} />
                <div className="flex-1 min-w-0"><p className="text-body font-semibold">{m.name}</p><p className="text-caption text-fg-muted">{m.title ?? (m.role === 'head' ? 'Head of IT' : m.role === 'md' ? 'Managing Director' : 'IT')}</p></div>
                {!w.active.length && m.checks_in ? <Label tone="danger">Nothing in progress</Label> : w.active.length > 2 ? <Label tone="attention">{w.active.length} at once</Label> : null}
              </div>
              <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle mb-1">Working on</p>
              {w.active.length ? (
                <ul className="space-y-1 mb-3">{w.active.map((i) => (
                  <li key={i.id}><button onClick={() => setOpen(i.id)} className="w-full text-left rounded-md px-2 py-1.5 hover:bg-hover">
                    <span className="block text-small"><span className="font-mono text-caption text-fg-muted">{keyOf(i.id)}</span> {i.title}</span>
                    <span className="text-caption text-fg-muted"><StatusLabel status={i.status} /> · since {ago(i.started_at)} · updated {ago(i.last_activity_at)}{!i.planned ? ' · unplanned' : ''}{i.blocked ? ' · blocked' : ''}</span>
                  </button></li>
                ))}</ul>
              ) : <p className="text-small text-fg-muted mb-3">—</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-muted">
                <span>Done this week <b className="text-fg">{w.doneWeek.length}</b></span>
                <span>Next up <b className="text-fg">{w.next.length}</b></span>
                <span>Unplanned open <b className={w.unplannedOpen.length ? 'text-attention' : 'text-fg'}>{w.unplannedOpen.length}</b></span>
                {m.checks_in && <span>Today: {todayAsk.length ? todayAsk.map((x) => `${x.slot} ${x.confirmed_at ? '✓' : '✗'}`).join(' · ') : 'not asked yet'}</span>}
              </div>
              {data.members.length > 0 && isLead && m.profile_id !== me && (
                <label className="mt-3 flex items-center gap-2 text-caption text-fg-muted"><input type="checkbox" checked={m.checks_in} onChange={(e) => toggleChecks(m.profile_id, e.target.checked)} disabled={!isLead} /> Gets the daily check-ins</label>
              )}
            </section>
          );
        })}
      </div>
      <Box title="Check-ins this week" icon={ListChecks} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-body min-w-[560px]">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset"><th className={th}>Person</th>{days.map((d) => <th key={d} className={`${th} text-center`}>{dayLabel(d)}<span className="block font-normal">10:00 · 14:00</span></th>)}</tr></thead>
            <tbody>
              {data.members.filter((m) => m.checks_in).map((m) => (
                <tr key={m.profile_id} className="border-t border-line-muted">
                  <td className={td}>{m.name}</td>
                  {days.map((d) => <td key={d} className={`${td} text-center tabular-nums`}>{cell(m.profile_id, d, 'morning')} &nbsp; {cell(m.profile_id, d, 'afternoon')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
      {checkin && <CheckInModal data={data} me={me} onClose={() => { setCheckin(false); if (params.get('checkin')) setParams({}, { replace: true }); }} onDone={data.reload} />}
      {issue && <IssuePanel data={data} issue={issue} me={me} isLead={isLead} onClose={() => setOpen(null)} />}
    </div>
  );
}

