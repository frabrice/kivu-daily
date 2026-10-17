import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Bug, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Download, FileText, Gavel, Inbox, ListChecks, Pencil, Plus, Rocket, Search, Undo2, Users2, X,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { FORECAST, ItCheckin, ItIssue, TYPE_LABEL, dayLabel, keyOf, kigaliToday, addDays, useItData, when } from '../../lib/it';
import { rwf, usePlanData } from '../../lib/itPlan';
import {
  CheckItem, DECISION_STATUS, DecisionStatus, ItDecision, ItRelease, ItWeeklyReview, PLATFORM_LABEL, RELEASE_STATUS, draftNotes, loadCheckins, mondayOf,
  releaseLabel, snapshotOf, useShipData, weekLabel, weekReview,
} from '../../lib/itReview';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import { StatusLabel } from '../../components/it/ItModals';
import { DecisionFormModal, ReleaseFormModal } from '../../components/it/ShipModals';

// IT & Product phase 3: Releases, Decisions and the Weekly review.

const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
function Bar({ pct, color = 'rgb(var(--c-success))' }: { pct: number; color?: string }) {
  return <div className="h-2 rounded-full bg-inset overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>;
}
const IssueLink = ({ i }: { i: ItIssue }) => <Link to={`/product/issues?issue=${i.id}`} className="hover:underline"><span className="font-mono text-caption text-fg-muted">{keyOf(i.id)}</span> {i.title}</Link>;

function useCtx() {
  const { profile } = useAuth();
  const data = useItData();
  const ship = useShipData();
  const member = data.members.find((m) => m.profile_id === profile?.id);
  const isMd = profile?.role === 'managing_director';
  const isLead = isMd || member?.role === 'head' || member?.role === 'md';
  return { data, ship, isLead, me: profile?.id };
}
type Ctx = ReturnType<typeof useCtx>;

// ================================================================ RELEASES
export function ItReleases() {
  usePageTitle('Releases');
  const ctx = useCtx();
  const { data, ship, isLead } = ctx;
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  if (data.loading || ship.loading) return <Loading />;
  const open = params.get('r') ? ship.releases.find((r) => r.id === params.get('r')) : null;
  if (open) return <ReleasePage ctx={ctx} r={open} onBack={() => setParams({})} />;
  const upcoming = ship.releases.filter((r) => r.status === 'planned' || r.status === 'testing').sort((a, b) => (a.planned_date ?? '9').localeCompare(b.planned_date ?? '9'));
  const history = ship.releases.filter((r) => !['planned', 'testing'].includes(r.status));
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Rocket} title="Releases" subtitle="What goes out to riders, drivers and staff — with what it ships and a checklist before it goes."
        actions={isLead && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> New release</button>} />
      {!ship.releases.length ? <EmptyState icon={Rocket} title="No releases yet" body="Plan the next app or dashboard version, attach the issues it ships, tick the checklist and mark it released — Call Center hears what changed." action={isLead && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> New release</button>} /> : <>
        <h2 className="section-title mb-2">Coming</h2>
        {upcoming.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
            {upcoming.map((r) => {
              const issues = data.issues.filter((i) => i.release_id === r.id && i.status !== 'wont_do');
              const ready = issues.filter((i) => i.status === 'done').length;
              const checks = r.checklist.filter((c) => c.done).length;
              return (
                <Link key={r.id} to={`/product/releases?r=${r.id}`} className="card p-3 hover:border-line-strong block">
                  <div className="flex items-center gap-2"><span className="text-body font-semibold flex-1">{releaseLabel(r)}{r.name ? <span className="font-normal text-fg-muted"> · {r.name}</span> : ''}</span><Label tone={RELEASE_STATUS[r.status].tone}>{RELEASE_STATUS[r.status].label}</Label></div>
                  <p className="text-caption text-fg-muted mt-0.5">Planned {dayLabel(r.planned_date)} · owner {data.nameOf(r.owner_id).split(' ')[0]}</p>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-caption">
                    <div><span className="text-fg-muted">Issues done {ready}/{issues.length}</span><Bar pct={issues.length ? (ready / issues.length) * 100 : 0} /></div>
                    <div><span className="text-fg-muted">Checklist {checks}/{r.checklist.length}</span><Bar pct={r.checklist.length ? (checks / r.checklist.length) * 100 : 0} color="rgb(var(--c-accent))" /></div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : <p className="text-small text-fg-muted mb-6">Nothing planned.{isLead ? ' Plan the next version so the team knows what goes out and when.' : ''}</p>}
        <Box title="History" icon={Rocket} padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-body min-w-[640px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Release', 'Status', 'Out', 'Issues', 'By'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-t border-line-muted hover:bg-hover/60 cursor-pointer" onClick={() => setParams({ r: r.id })}>
                    <td className={`${td} font-medium`}>{releaseLabel(r)}{r.name && <span className="text-fg-muted font-normal"> · {r.name}</span>}</td>
                    <td className={td}><Label tone={RELEASE_STATUS[r.status].tone}>{RELEASE_STATUS[r.status].label}</Label></td>
                    <td className={`${td} text-caption whitespace-nowrap`}>{r.released_at ? when(r.released_at) : '—'}</td>
                    <td className={`${td} tabular-nums`}>{data.issues.filter((i) => i.release_id === r.id).length}</td>
                    <td className={`${td} text-caption`}>{data.nameOf(r.released_by)}</td>
                  </tr>
                ))}
                {!history.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-fg-muted">Nothing released yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Box>
      </>}
      {creating && <ReleaseFormModal data={data} release={null} releases={ship.releases} onClose={() => setCreating(false)} onSaved={(id) => { ship.reload(); if (id) setParams({ r: id }); }} />}
    </div>
  );
}

function ReleasePage({ ctx, r, onBack }: { ctx: Ctx; r: ItRelease; onBack: () => void }) {
  usePageTitle(releaseLabel(r));
  const { data, ship, isLead } = ctx;
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(r.notes ?? '');
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNotes(r.notes ?? ''); }, [r.notes]);
  const issues = data.issues.filter((i) => i.release_id === r.id);
  const shipping = issues.filter((i) => i.status !== 'wont_do');
  const notDone = shipping.filter((i) => i.status !== 'done');
  const candidates = data.issues.filter((i) => !i.release_id && i.status !== 'wont_do' && (i.status === 'done' || i.status === 'testing' || i.status === 'in_review' || i.milestone_id === r.milestone_id))
    .sort((a, b) => (a.status === 'done' ? 0 : 1) - (b.status === 'done' ? 0 : 1) || b.id - a.id);
  const fromMilestone = r.milestone_id ? candidates.filter((i) => i.milestone_id === r.milestone_id && i.status === 'done') : [];
  const st = RELEASE_STATUS[r.status];
  const locked = !isLead || r.status === 'cancelled';
  const update = async (patch: Partial<ItRelease>) => {
    setError(''); setBusy(true);
    const { error: err } = await supabase.from('it_releases').update(patch).eq('id', r.id);
    setBusy(false);
    if (err) setError(err.message); else ship.reload();
  };
  const attach = async (ids: number[], releaseId: string | null) => {
    if (!ids.length) return;
    setError('');
    const { error: err } = await supabase.from('it_issues').update({ release_id: releaseId }).in('id', ids);
    if (err) setError(err.message); else { setPick(''); data.reload(); }
  };
  const toggle = (k: number) => update({ checklist: r.checklist.map((c, n) => (n === k ? { ...c, done: !c.done } : c)) as CheckItem[] });
  const release = async () => {
    const missing = r.checklist.filter((c) => !c.done).length;
    const warn = [missing ? `${missing} checklist item${missing === 1 ? ' is' : 's are'} not ticked` : '', notDone.length ? `${notDone.length} issue${notDone.length === 1 ? ' is' : 's are'} not done` : ''].filter(Boolean).join(' and ');
    if (!confirm(`${warn ? `${warn}. ` : ''}Mark ${releaseLabel(r)} as released? IT, the MD${r.platform === 'app' ? ', Call Center and Fleet' : ''} get the release notes.`)) return;
    await update({ status: 'released', notes: notes.trim() || null });
  };
  return (
    <div className="animate-fade-in">
      <button onClick={onBack} className="text-caption text-fg-muted hover:text-fg flex items-center gap-1 mb-2"><ArrowLeft size={12} /> Releases</button>
      <PageHeader icon={Rocket} title={`${releaseLabel(r)}${r.name ? ` · ${r.name}` : ''}`} labels={<><Label tone={st.tone}>{st.label}</Label><Label>R{r.number}</Label></>}
        meta={<><span>{PLATFORM_LABEL[r.platform]}</span><span>Owner: {data.nameOf(r.owner_id)}</span>{r.released_at ? <span>Released {when(r.released_at)} by {data.nameOf(r.released_by)}</span> : <span>Planned {dayLabel(r.planned_date, true)}</span>}
          {r.milestone_id && <Link to={`/product/milestones?m=${r.milestone_id}`} className="link">M{data.milestones.find((m) => m.id === r.milestone_id)?.number} · {data.milestones.find((m) => m.id === r.milestone_id)?.name}</Link>}</>}
        actions={isLead && <>
          {r.status === 'planned' && <button onClick={() => update({ status: 'testing' })} disabled={busy} className="btn-secondary"><ListChecks size={14} /> Start testing</button>}
          {(r.status === 'planned' || r.status === 'testing') && <button onClick={release} disabled={busy} className="btn-primary"><Rocket size={14} /> Mark as released</button>}
          {r.status === 'released' && <button onClick={() => setEditing(true)} className="btn-secondary text-danger"><Undo2 size={14} /> Roll back</button>}
          <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={14} /> Edit</button>
        </>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
      {r.status === 'rolled_back' && <p className="mb-3 text-small rounded-lg bg-danger-muted text-danger px-3 py-2"><b>Rolled back:</b> {r.rollback_reason}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2 space-y-4">
          <Box title={`What it ships (${shipping.length})`} icon={CheckCircle2} padded={false}
            right={notDone.length > 0 && <span className="text-caption text-attention">{notDone.length} not done yet</span>}>
            {issues.length ? (
              <ul className="divide-y divide-line-muted">
                {issues.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-4 py-2 text-body">
                    <span className="flex-1 min-w-0 truncate"><IssueLink i={i} /></span>
                    <span className="text-caption text-fg-muted">{TYPE_LABEL[i.type]}</span><StatusLabel status={i.status} />
                    {!locked && r.status !== 'released' && <button onClick={() => attach([i.id], null)} className="btn-ghost p-1" aria-label="Remove from release" title="Remove from release"><X size={13} /></button>}
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-small text-fg-muted">No issues attached yet.</p>}
            {!locked && r.status !== 'released' && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line-muted bg-inset/50">
                <select value={pick} onChange={(e) => setPick(e.target.value)} className="input !w-auto flex-1 min-w-[220px]">
                  <option value="">Add an issue…</option>
                  {candidates.map((i) => <option key={i.id} value={i.id}>{keyOf(i.id)} · {i.title} ({i.status.replace('_', ' ')})</option>)}
                </select>
                <button onClick={() => attach([Number(pick)], r.id)} disabled={!pick} className="btn-secondary disabled:opacity-50"><Plus size={13} /> Add</button>
                {fromMilestone.length > 0 && <button onClick={() => attach(fromMilestone.map((i) => i.id), r.id)} className="btn-ghost text-caption">Add all {fromMilestone.length} done from the milestone</button>}
              </div>
            )}
          </Box>
          <Box title="Release notes" icon={FileText} right={!locked && <button onClick={() => setNotes(draftNotes(shipping))} className="btn-ghost text-caption">Draft from issues</button>}>
            {locked ? (r.notes ? <p className="text-body whitespace-pre-line">{r.notes}</p> : <p className="text-small text-fg-muted">No notes.</p>) : <>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={7} className="input font-mono text-small" placeholder={'- New: …\n- Fixed: …'} />
              <div className="flex items-center justify-between mt-2">
                <p className="text-caption text-fg-muted">Written for people outside IT: what riders and drivers will notice. Left empty, they're drafted from the issues when it's released.</p>
                <button onClick={() => update({ notes: notes.trim() || null })} disabled={busy || notes === (r.notes ?? '')} className="btn-secondary disabled:opacity-50">Save notes</button>
              </div>
            </>}
          </Box>
        </div>
        <Box title={`Checklist ${r.checklist.filter((c) => c.done).length}/${r.checklist.length}`} icon={ListChecks}>
          <ul className="space-y-1.5">
            {r.checklist.map((c, k) => (
              <li key={k}><label className={`flex items-start gap-2 text-small ${locked ? '' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={c.done} disabled={locked || busy} onChange={() => toggle(k)} className="mt-0.5" /><span className={c.done ? 'line-through text-fg-muted' : ''}>{c.text}</span>
              </label></li>
            ))}
          </ul>
          {!locked && <AddCheck onAdd={(text) => update({ checklist: [...r.checklist, { text, done: false }] })} />}
        </Box>
      </div>
      {editing && <ReleaseFormModal data={data} release={r} releases={ship.releases} onClose={() => setEditing(false)} onSaved={(id) => { ship.reload(); if (!id) onBack(); }} />}
    </div>
  );
}
function AddCheck({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (t.trim()) { onAdd(t.trim()); setT(''); } }} className="flex gap-2 mt-3">
      <input value={t} onChange={(e) => setT(e.target.value)} className="input !py-1 text-small" placeholder="Add a check…" />
      <button type="submit" className="btn-ghost p-1.5" aria-label="Add check"><Plus size={14} /></button>
    </form>
  );
}

// ================================================================ DECISIONS
export function ItDecisions() {
  usePageTitle('Decisions');
  const { data, ship, isLead, me } = useCtx();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'all' | DecisionStatus>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ItDecision | 'new' | null>(params.get('new') ? 'new' : null);
  if (data.loading || ship.loading) return <Loading />;
  const openId = params.get('d');
  const list = ship.decisions.filter((d) => (filter === 'all' || d.status === filter) && (!q || `${d.title} ${d.context ?? ''} ${d.decision ?? ''} D${d.number}`.toLowerCase().includes(q.toLowerCase())));
  const canEdit = (d: ItDecision) => isLead || (d.created_by === me && d.status === 'proposed');
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Gavel} title="Decisions" subtitle="Why things are the way they are: each decision with its context, the options we looked at and what follows."
        actions={<button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> Record a decision</button>} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search decisions…" /></div>
        {(['all', 'proposed', 'decided', 'superseded', 'reversed'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-2.5 py-1 rounded-full text-caption border ${filter === s ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>
            {s === 'all' ? 'All' : DECISION_STATUS[s].label} <span className="tabular-nums">{s === 'all' ? ship.decisions.length : ship.decisions.filter((d) => d.status === s).length}</span>
          </button>
        ))}
      </div>
      {!list.length ? <EmptyState icon={Gavel} title={ship.decisions.length ? 'No decision matches' : 'No decisions recorded yet'} body="Record choices like which payment gateway, how drivers are matched, or what the app stops supporting." /> : (
        <div className="space-y-2">
          {list.map((d) => {
            const isOpen = openId === d.id;
            const st = DECISION_STATUS[d.status];
            const sup = d.superseded_by ? ship.decisions.find((x) => x.id === d.superseded_by) : null;
            return (
              <section key={d.id} className={`card ${isOpen ? 'border-line-strong' : ''}`}>
                <button onClick={() => setParams(isOpen ? {} : { d: d.id })} className="w-full flex flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-hover/50">
                  <span className="font-mono text-caption text-fg-muted">D{d.number}</span>
                  <span className="text-body font-semibold flex-1 min-w-[200px]">{d.title}</span>
                  {d.areas.map((a) => <Label key={a}>{data.areaLabel(a)}</Label>)}
                  <Label tone={st.tone}>{st.label}</Label>
                  <span className="text-caption text-fg-muted whitespace-nowrap">{d.decided_at ? `${data.nameOf(d.decided_by).split(' ')[0]} · ${dayLabel(d.decided_at)}` : `by ${data.nameOf(d.created_by).split(' ')[0]} · ${dayLabel(d.created_at)}`}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-small border-t border-line-muted pt-3">
                    {[['Context', d.context], ['What we decided', d.decision], ['Options we looked at', d.options], ['Consequences', d.consequences]].map(([k, v]) => (
                      <div key={k as string}><p className="text-caption font-medium text-fg-muted mb-0.5">{k}</p><p className="whitespace-pre-line">{v || <span className="text-fg-subtle">—</span>}</p></div>
                    ))}
                    <div className="md:col-span-2 flex flex-wrap items-center gap-3 text-caption text-fg-muted">
                      {d.issue_id && <Link to={`/product/issues?issue=${d.issue_id}`} className="link">{keyOf(d.issue_id)}</Link>}
                      {sup && <button onClick={() => setParams({ d: sup.id })} className="link">Replaced by D{sup.number} · {sup.title}</button>}
                      <span className="flex-1" />
                      {canEdit(d) && <button onClick={() => setEditing(d)} className="btn-secondary text-caption"><Pencil size={12} /> Edit</button>}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {editing && <DecisionFormModal data={data} decision={editing === 'new' ? null : editing} decisions={ship.decisions} isLead={isLead} onClose={() => { setEditing(null); if (params.get('new')) setParams({}); }} onSaved={(id) => { ship.reload(); setParams({ d: id }); }} />}
    </div>
  );
}

// ================================================================ WEEKLY REVIEW
type NoteKey = 'highlights' | 'risks' | 'next_focus' | 'notes';
const NOTE_FIELDS: { key: NoteKey; label: string; hint: string }[] = [
  { key: 'highlights', label: 'Highlights', hint: 'What went well, what shipped that matters.' },
  { key: 'risks', label: 'Risks & problems', hint: 'What slowed us, what may slip, what we need from others.' },
  { key: 'next_focus', label: 'Focus for next week', hint: 'The 2–3 things that matter most.' },
  { key: 'notes', label: 'Other notes', hint: 'Anything else said in the meeting.' },
];

export function ItReview() {
  usePageTitle('Weekly review');
  const { data, ship, isLead, me } = useCtx();
  const plan = usePlanData();
  const [params, setParams] = useSearchParams();
  const week = mondayOf(params.get('week') ?? kigaliToday());
  const setWeek = (w: string) => setParams({ week: w });
  const [checkins, setCheckins] = useState<ItCheckin[]>([]);
  const [deciding, setDeciding] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { loadCheckins(week, addDays(week, 6)).then(setCheckins); }, [week]);
  const review = ship.reviews.find((x) => x.week_start === week) ?? null;
  const r = useMemo(() => weekReview(week, data, ship.releases, ship.decisions, checkins, plan.initiatives, plan.spend), [week, data, ship.releases, ship.decisions, checkins, plan.initiatives, plan.spend]);
  if (data.loading || ship.loading || plan.loading) return <Loading />;
  const thisMonday = mondayOf(kigaliToday());
  const save = async (patch: Partial<ItWeeklyReview>) => {
    setError('');
    const { error: err } = await supabase.from('it_weekly_reviews').upsert({ week_start: week, ...patch, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: 'week_start' });
    if (err) setError(err.message); else ship.reload();
  };
  const toggleAttendee = (id: string) => { const cur = review?.attendees ?? []; save({ attendees: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); };
  const markHeld = () => save({ held_at: new Date().toISOString(), held_by: me, snapshot: snapshotOf(r), attendees: review?.attendees?.length ? review.attendees : data.members.map((m) => m.profile_id) });
  const pdf = async () => {
    setPdfBusy(true);
    try {
      const { weeklyReviewPdfBlob } = await import('../../lib/itReviewPdf');
      const blob = await weeklyReviewPdfBlob(r, review, data);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `Kivu-Ride-IT-review-${week}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally { setPdfBusy(false); }
  };
  const att = r.attention;
  return (
    <div className="animate-fade-in">
      <PageHeader icon={CalendarCheck} title="Weekly review" subtitle="The IT meeting on one page: numbers, milestones, what shipped, who did what, what needs attention, decisions and next week."
        labels={review?.held_at ? <Label tone="success">Held {dayLabel(review.held_at)}</Label> : r.current ? <Label tone="info">This week</Label> : <Label>Not held</Label>}
        actions={<>
          <div className="flex items-center gap-1">
            <button onClick={() => setWeek(addDays(week, -7))} className="btn-ghost p-1.5" aria-label="Previous week"><ChevronLeft size={16} /></button>
            <span className="text-small font-medium tabular-nums min-w-[150px] text-center">{weekLabel(week)}</span>
            <button onClick={() => setWeek(addDays(week, 7))} disabled={week >= thisMonday} className="btn-ghost p-1.5 disabled:opacity-30" aria-label="Next week"><ChevronRight size={16} /></button>
          </div>
          <button onClick={pdf} disabled={pdfBusy} className="btn-secondary"><Download size={14} /> {pdfBusy ? 'Making PDF…' : 'PDF'}</button>
          {!review?.held_at && <button onClick={markHeld} className="btn-primary"><CheckCircle2 size={14} /> Mark as held</button>}
        </>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}

      <StatGrid cols={6}>
        <StatCard icon={CheckCircle2} label="Shipped" value={r.done} sub={`${r.points} points · ${r.unplannedDone} unplanned`} />
        <StatCard icon={Bug} label="Bugs" value={`${r.bugsClosed} fixed`} sub={`${r.bugsOpened} new reported`} tone={r.bugsOpened > r.bugsClosed ? 'attention' : undefined} />
        <StatCard icon={Rocket} label="Releases" value={r.releases} sub={r.releasesList.map(releaseLabel).join(', ') || 'none'} />
        <StatCard icon={Inbox} label="Requests" value={r.requestsIn} sub={`${r.requestsTriaged} triaged`} />
        <StatCard icon={Users2} label="Check-ins" value={r.checkinRate === null ? '—' : `${r.checkinRate}%`} sub="answered" tone={r.checkinRate !== null && r.checkinRate < 80 ? 'attention' : undefined} />
        <StatCard icon={Gavel} label="Decisions" value={r.decisions} sub={r.spent ? `${rwf(r.spent)} spent on projects` : 'made this week'} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2 space-y-4">
          <Box title="Milestones" icon={CalendarCheck} padded={false}>
            {r.milestones.length ? (
              <ul className="divide-y divide-line-muted">
                {r.milestones.map(({ m, s, doneThisWeek }) => (
                  <li key={m.id}><Link to={`/product/milestones?m=${m.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-hover">
                    <span className="font-mono text-caption text-fg-muted">M{m.number}</span><span className="text-body font-medium flex-1 min-w-[160px]">{m.name}</span>
                    <span className="text-caption text-fg-muted">{dayLabel(m.start_date)} – {dayLabel(m.end_date)}</span>
                    <span className="w-28"><Bar pct={s.pct} /></span><span className="text-caption tabular-nums w-24">{s.pct}% · time {s.timePct}%</span>
                    <span className="text-caption text-fg-muted">+{doneThisWeek} this week</span><Label tone={FORECAST[s.forecast].tone}>{FORECAST[s.forecast].label}</Label>
                  </Link></li>
                ))}
              </ul>
            ) : <p className="p-5 text-small text-fg-muted">No milestone ran this week.</p>}
          </Box>

          <Box title={`Shipped (${r.done})`} icon={CheckCircle2} padded={false} right={<span className="text-caption text-fg-muted">{r.byArea.slice(0, 4).map((a) => `${a.key ? data.areaLabel(a.key) : 'No area'} ${a.n}`).join(' · ')}</span>}>
            {r.doneIssues.length ? (
              <ul className="divide-y divide-line-muted max-h-[420px] overflow-y-auto">
                {r.doneIssues.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-4 py-2 text-body">
                    <span className="flex-1 min-w-0 truncate"><IssueLink i={i} /></span>
                    {!i.planned && <Label tone="attention">unplanned</Label>}
                    <span className="text-caption text-fg-muted">{TYPE_LABEL[i.type]}</span>
                    <span className="text-caption w-20 truncate">{data.nameOf(i.assignee_id).split(' ')[0]}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-small text-fg-muted">Nothing marked done this week.</p>}
          </Box>

          <Box title="Team" icon={Users2} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-body min-w-[600px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Person', 'Done', 'Points', 'Bugs fixed', 'Own ideas', r.current ? 'In progress now' : 'In progress (today)', 'Check-ins'].map((h, k) => <th key={h} className={`${th} ${k ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>{r.people.map((p) => (
                  <tr key={p.id} className="border-t border-line-muted">
                    <td className={`${td} font-medium`}><Link to={`/product/issues?assignee=${p.id}`} className="hover:underline">{p.name}</Link></td>
                    <td className={`${td} text-right tabular-nums`}>{p.done}</td>
                    <td className={`${td} text-right tabular-nums`}>{p.points}</td>
                    <td className={`${td} text-right tabular-nums`}>{p.bugsFixed}</td>
                    <td className={`${td} text-right tabular-nums`}>{p.ownWork}</td>
                    <td className={`${td} text-right tabular-nums ${p.activeNow ? '' : 'text-danger font-medium'}`}>{p.activeNow || 'nothing'}</td>
                    <td className={`${td} text-right tabular-nums`}>{p.asked ? `${p.answered}/${p.asked}` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Box>

          <Box title="Needs attention" icon={AlertTriangle} padded={false}>
            {att.urgent.length + att.blocked.length + att.stale.length ? (
              <ul className="divide-y divide-line-muted">
                {[...att.urgent.map((i) => ({ i, why: <Label tone={i.priority === 'p0' ? 'danger' : 'attention'}>{i.priority.toUpperCase()}</Label> })),
                  ...att.blocked.filter((i) => !att.urgent.includes(i)).map((i) => ({ i, why: <Label tone="danger">Blocked</Label> })),
                  ...att.stale.filter((i) => !att.urgent.includes(i) && !att.blocked.includes(i)).map((i) => ({ i, why: <Label tone="attention">No update 3+ days</Label> }))]
                  .map(({ i, why }) => (
                    <li key={i.id} className="flex items-center gap-2 px-4 py-2 text-body">
                      <span className="flex-1 min-w-0 truncate"><IssueLink i={i} /></span>{why}<span className="text-caption w-20 truncate">{data.nameOf(i.assignee_id).split(' ')[0]}</span>
                    </li>
                  ))}
              </ul>
            ) : <p className="p-5 text-small text-fg-muted">Nothing urgent, blocked or stalled.</p>}
          </Box>
        </div>

        <div className="space-y-4">
          <Box title="Meeting notes" icon={FileText}>
            <p className="text-caption font-medium text-fg-muted mb-1.5">Who's here</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {data.members.map((m) => {
                const on = review?.attendees.includes(m.profile_id);
                return <button key={m.profile_id} onClick={() => toggleAttendee(m.profile_id)} className={`px-2.5 py-1 rounded-full text-caption border ${on ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{m.name.split(' ')[0]}</button>;
              })}
            </div>
            <div className="space-y-3">
              {NOTE_FIELDS.map((f) => <NoteField key={`${week}-${f.key}`} label={f.label} hint={f.hint} value={review?.[f.key] ?? ''} onSave={(v) => save({ [f.key]: v || null })} />)}
            </div>
            {review?.updated_at && <p className="text-micro text-fg-subtle mt-2">Saved {when(review.updated_at)} by {data.nameOf(review.updated_by)}{review.held_at ? ` · held ${when(review.held_at)}` : ''}</p>}
          </Box>

          <Box title={`Decisions (${r.decisions})`} icon={Gavel} right={<button onClick={() => setDeciding(true)} className="btn-ghost text-caption"><Plus size={13} /> Record</button>}>
            {r.decisionsList.length ? (
              <ul className="space-y-2">{r.decisionsList.map((d) => <li key={d.id} className="text-small"><Link to={`/product/decisions?d=${d.id}`} className="font-medium hover:underline">D{d.number} · {d.title}</Link>{d.decision && <p className="text-caption text-fg-muted line-clamp-2">{d.decision}</p>}</li>)}</ul>
            ) : <p className="text-small text-fg-muted">None this week. Decided something in the meeting? Record it.</p>}
            {ship.decisions.some((d) => d.status === 'proposed') && <p className="mt-2 text-caption"><Link to="/product/decisions" className="link">{ship.decisions.filter((d) => d.status === 'proposed').length} proposed, waiting to be decided</Link></p>}
          </Box>

          <Box title="Releases" icon={Rocket}>
            {r.releasesList.length ? <ul className="space-y-1 text-small">{r.releasesList.map((x) => <li key={x.id}><Link to={`/product/releases?r=${x.id}`} className="hover:underline font-medium">{releaseLabel(x)}</Link> <Label tone={RELEASE_STATUS[x.status].tone}>{RELEASE_STATUS[x.status].label}</Label> <span className="text-caption text-fg-muted">{dayLabel(x.released_at)}</span></li>)}</ul>
              : <p className="text-small text-fg-muted">Nothing released this week.</p>}
          </Box>

          <Box title="Next week" icon={ChevronRight}>
            <ul className="space-y-1.5 text-small">
              {r.nextWeek.milestones.map((m) => <li key={m.id}>M{m.number} · {m.name} <span className="text-fg-muted">ends {dayLabel(m.end_date)}</span></li>)}
              {r.nextWeek.releases.map((x) => <li key={x.id}>{releaseLabel(x)} <span className="text-fg-muted">planned {dayLabel(x.planned_date)}</span></li>)}
              <li>{r.nextWeek.ready} issue{r.nextWeek.ready === 1 ? '' : 's'} <span className="text-fg-muted">ready to pick up</span></li>
              {r.projects.waiting.map((i) => <li key={i.id}><Link to={`/product/roadmap?i=${i.id}`} className="link">I{i.number} · {i.name}</Link> <span className="text-fg-muted">waiting for the MD</span></li>)}
              {r.projects.spentByProject.map(({ i, n }) => <li key={i.id} className="text-caption text-fg-muted">I{i.number} spent {rwf(n)} this week</li>)}
            </ul>
          </Box>

          {ship.reviews.some((x) => x.held_at && x.week_start !== week) && (
            <Box title="Past reviews">
              <ul className="space-y-1 text-small">{ship.reviews.filter((x) => x.held_at && x.week_start !== week).slice(0, 8).map((x) => (
                <li key={x.week_start}><button onClick={() => setWeek(x.week_start)} className="link">{weekLabel(x.week_start)}</button>{x.snapshot && <span className="text-caption text-fg-muted"> · {x.snapshot.done} shipped, {x.snapshot.bugsClosed} bugs fixed</span>}</li>
              ))}</ul>
            </Box>
          )}
        </div>
      </div>
      {!isLead && !review?.held_at && <p className="text-caption text-fg-muted">Anyone in IT can take notes here during the meeting.</p>}
      {deciding && <DecisionFormModal data={data} decision={null} decisions={ship.decisions} isLead={isLead} onClose={() => setDeciding(false)} onSaved={() => ship.reload()} />}
    </div>
  );
}

function NoteField({ label, hint, value, onSave }: { label: string; hint: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="block text-caption font-medium text-fg-muted">{label}</span>
      <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} rows={3} className="input resize-y text-small" placeholder={hint} />
    </label>
  );
}
