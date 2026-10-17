import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, Compass, Flag, Map, Pencil, Plus, Send, Target, Wallet } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { ItData, dayLabel, kigaliToday, milestoneStats, useItData, FORECAST } from '../../lib/it';
import {
  BUDGET_CATEGORIES, CATEGORY_LABEL, HORIZONS, askedBiggerBudget, waitingForMd, INITIATIVE_STATUS, ItInitiative, ItObjective, OBJECTIVE_STATUS, PlanData, initiativeDelivery, krProgress, lineTotal, moneyOf,
  objectiveProgress, quarterLabel, quarterOf, rwf, rwfShort, usePlanData,
} from '../../lib/itPlan';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs } from '../../ui/kit';
import { RankBars, usePalette } from '../../components/charts/kit';
import { BudgetLineModal, DecisionModal, InitiativeFormModal, ObjectiveFormModal } from '../../components/it/PlanModals';
import { MilestoneFormModal } from '../../components/it/ItModals';

// IT & Product phase 2: Roadmap (projects: Now / Next / Later + timeline,
// and each project's page), Objectives (quarterly, with key results) and
// Budget (approved, planned, committed, spent).

const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
function Bar({ pct, color = 'rgb(var(--c-success))' }: { pct: number; color?: string }) {
  return <div className="h-2 rounded-full bg-inset overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>;
}

function useCtx() {
  const { profile } = useAuth();
  const data = useItData();
  const plan = usePlanData();
  const member = data.members.find((m) => m.profile_id === profile?.id);
  const isMd = profile?.role === 'managing_director';
  const isLead = isMd || member?.role === 'head' || member?.role === 'md';
  return { data, plan, isMd, isLead };
}

// ================================================================ ROADMAP
type RoadView = 'board' | 'timeline';
export function ItRoadmap() {
  usePageTitle('Roadmap');
  const ctx = useCtx();
  const { data, plan, isLead, isMd } = ctx;
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<RoadView>('board');
  const [creating, setCreating] = useState(false);
  const openId = params.get('i');
  if (data.loading || plan.loading) return <Loading />;
  const open = openId ? plan.initiatives.find((x) => x.id === openId) : null;
  if (open) return <InitiativePage ctx={ctx} i={open} onBack={() => setParams({})} />;
  const live = plan.initiatives.filter((i) => !['declined', 'cancelled'].includes(i.status));
  const waiting = plan.initiatives.filter((i) => waitingForMd(i, moneyOf(i, plan.lines, plan.spend)));
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Map} title="Roadmap" subtitle="The big projects: what we build now, next and later — each with its problem, outcome, dates and budget."
        actions={isLead && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> New project</button>} />
      {isMd && waiting.length > 0 && (
        <div className="mb-4 rounded-lg border border-attention/50 bg-attention-muted px-4 py-3 flex flex-wrap items-center gap-2">
          <AlertTriangle size={16} className="text-attention" /><span className="flex-1"><b>{waiting.length} project{waiting.length === 1 ? '' : 's'} waiting for your approval:</b> {waiting.map((w) => w.name).join(', ')}</span>
          <button onClick={() => setParams({ i: waiting[0].id })} className="btn-primary text-caption">Review</button>
        </div>
      )}
      <UnderlineTabs<RoadView> value={view} onChange={setView} tabs={[{ key: 'board', label: 'Now · Next · Later', icon: Compass }, { key: 'timeline', label: 'Timeline', icon: Map }]} />
      {!live.length ? <EmptyState icon={Map} title="No projects yet" action={isLead && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> New project</button>} />
        : view === 'board' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {HORIZONS.map((h) => {
              const list = live.filter((i) => (i.status === 'done' ? false : i.horizon === h.key));
              return (
                <div key={h.key} className="rounded-lg bg-inset p-2.5">
                  <p className="px-1 pb-2"><span className="text-body font-semibold">{h.label}</span> <span className="text-caption text-fg-muted">· {h.help}</span></p>
                  <div className="space-y-2">{list.map((i) => <InitiativeCard key={i.id} ctx={ctx} i={i} />)}{!list.length && <p className="text-caption text-fg-subtle px-1 py-4">Nothing here.</p>}</div>
                </div>
              );
            })}
          </div>
        ) : <Timeline ctx={ctx} list={live} />}
      {plan.initiatives.some((i) => i.status === 'done') && (
        <section className="mt-5">
          <h2 className="section-title mb-2">Done</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">{plan.initiatives.filter((i) => i.status === 'done').map((i) => <InitiativeCard key={i.id} ctx={ctx} i={i} />)}</div>
        </section>
      )}
      {creating && <InitiativeFormModal data={data} plan={plan} initiative={null} onClose={() => setCreating(false)} onSaved={(id) => { plan.reload(); setParams({ i: id }); }} />}
    </div>
  );
}

function InitiativeCard({ ctx, i }: { ctx: ReturnType<typeof useCtx>; i: ItInitiative }) {
  const { data, plan } = ctx;
  const d = initiativeDelivery(i, data.milestones, data.issues);
  const m = moneyOf(i, plan.lines, plan.spend);
  const st = INITIATIVE_STATUS[i.status];
  const obj = plan.objectives.find((o) => o.id === i.objective_id);
  return (
    <Link to={`/product/roadmap?i=${i.id}`} className="block card p-3 hover:border-line-strong">
      <div className="flex items-start gap-2">
        <span className="font-mono text-caption text-fg-muted mt-0.5">I{i.number}</span>
        <span className="flex-1 text-body font-semibold leading-snug">{i.name}</span>
        <Label tone={st.tone}>{st.label}</Label>
      </div>
      {obj && <p className="text-caption text-fg-muted mt-1 flex items-center gap-1"><Target size={11} /> {obj.title}</p>}
      <div className="mt-2 space-y-1">
        <Bar pct={d.pct} />
        <p className="text-caption text-fg-muted flex justify-between"><span>{d.done}/{d.issues} issues · {d.milestones.length} milestone{d.milestones.length === 1 ? '' : 's'}</span><span>{i.start_date ? `${dayLabel(i.start_date)} → ${dayLabel(i.target_date)}` : 'No dates'}</span></p>
      </div>
      <p className="text-caption mt-1.5 flex justify-between">
        <span className="text-fg-muted">Budget {m.approved !== null ? <b className="text-fg">{rwfShort(m.approved)}</b> : <>planned <b className="text-fg">{rwfShort(m.planned)}</b></>}</span>
        <span className={m.over ? 'text-danger' : 'text-fg-muted'}>{askedBiggerBudget(i, m) ? 'bigger budget asked' : m.over ? 'over approved' : `spent ${rwfShort(m.spent)}`}</span>
      </p>
    </Link>
  );
}

function Timeline({ ctx, list }: { ctx: ReturnType<typeof useCtx>; list: ItInitiative[] }) {
  const { data } = ctx;
  const today = kigaliToday();
  const dated = list.filter((i) => i.start_date && i.target_date).sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  const from = `${quarterOf(today).slice(0, 4)}-${String((Number(quarterOf(today).slice(-1)) - 1) * 3 + 1).padStart(2, '0')}-01`;
  const months = Array.from({ length: 9 }, (_, k) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7); });
  const start = Date.parse(`${months[0]}-01`), end = Date.parse(new Date(Date.UTC(Number(months[8].slice(0, 4)), Number(months[8].slice(5)), 0)).toISOString().slice(0, 10));
  const pos = (d: string) => Math.max(0, Math.min(100, ((Date.parse(d) - start) / (end - start)) * 100));
  return (
    <div className="card p-4 overflow-x-auto">
      <div className="min-w-[860px]">
        <div className="grid grid-cols-[220px_1fr] text-caption text-fg-muted mb-1">
          <span />
          <div className="grid" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>{months.map((m) => <span key={m} className="border-l border-line-muted pl-1">{new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}</span>)}</div>
        </div>
        {dated.map((i) => {
          const st = INITIATIVE_STATUS[i.status];
          const color = { success: 'rgb(var(--c-success))', accent: 'rgb(var(--c-accent))', attention: 'rgb(var(--c-attention))', info: 'rgb(var(--c-link))', danger: 'rgb(var(--c-danger))', neutral: 'rgb(var(--c-line-strong))', done: 'rgb(var(--c-done))' }[st.tone];
          const ms = data.milestones.filter((m) => m.initiative_id === i.id);
          return (
            <div key={i.id} className="grid grid-cols-[220px_1fr] items-center py-1.5 border-t border-line-muted">
              <Link to={`/product/roadmap?i=${i.id}`} className="text-small truncate pr-2 hover:underline"><span className="font-mono text-caption text-fg-muted">I{i.number}</span> {i.name}</Link>
              <div className="relative h-7">
                <div className="absolute inset-y-0 border-l-2 border-danger/60" style={{ left: `${pos(today)}%` }} title="Today" />
                <div className="absolute top-1 h-5 rounded-md opacity-80" style={{ left: `${pos(i.start_date!)}%`, width: `${Math.max(1, pos(i.target_date!) - pos(i.start_date!))}%`, background: color }} title={`${st.label} · ${dayLabel(i.start_date)} → ${dayLabel(i.target_date, true)}`} />
                {ms.map((m) => <div key={m.id} className="absolute top-0 h-7 w-0.5 bg-fg/70" style={{ left: `${pos(m.end_date)}%` }} title={`M${m.number} · ${m.name} ends ${dayLabel(m.end_date)}`} />)}
              </div>
            </div>
          );
        })}
        {!dated.length && <p className="text-small text-fg-muted py-6 text-center">Give projects start and target dates to see them here.</p>}
        <p className="text-caption text-fg-muted mt-2">Bars: project dates, coloured by status · thin marks: milestone end dates · red line: today.</p>
      </div>
    </div>
  );
}

function InitiativePage({ ctx, i, onBack }: { ctx: ReturnType<typeof useCtx>; i: ItInitiative; onBack: () => void }) {
  usePageTitle(`I${i.number} · ${i.name}`);
  const { data, plan, isLead, isMd } = ctx;
  const [editing, setEditing] = useState(false);
  const [line, setLine] = useState<string | 'new' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [newMilestone, setNewMilestone] = useState(false);
  const [error, setError] = useState('');
  const m = moneyOf(i, plan.lines, plan.spend);
  const d = initiativeDelivery(i, data.milestones, data.issues);
  const st = INITIATIVE_STATUS[i.status];
  const obj = plan.objectives.find((o) => o.id === i.objective_id);
  const lines = plan.lines.filter((l) => l.initiative_id === i.id);
  const spend = plan.spend.filter((s) => s.it_initiative_id === i.id).sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  const budgetBase = m.approved ?? m.planned;
  // Spending pays committed lines first, so they are not counted twice.
  const unpaid = Math.max(0, m.committed - m.spent), left = budgetBase - m.spent - unpaid;
  const propose = async () => {
    setError('');
    const { error: err } = await supabase.rpc('propose_it_initiative', { p_id: i.id });
    if (err) setError(err.message); else plan.reload();
  };
  const asked = askedBiggerBudget(i, m);
  // The MD decides directly; the head of IT asks the MD.
  const canPropose = isLead && !isMd && (['idea', 'declined'].includes(i.status) || (m.over && !asked && !['proposed', 'done', 'cancelled'].includes(i.status)));
  const canDecide = isMd && (['idea', 'proposed', 'declined'].includes(i.status) || m.over);
  return (
    <div className="animate-fade-in">
      <button onClick={onBack} className="text-caption text-fg-muted hover:text-fg flex items-center gap-1 mb-2"><ArrowLeft size={12} /> Roadmap</button>
      <PageHeader icon={Flag} title={`I${i.number} · ${i.name}`} labels={<><Label tone={st.tone}>{st.label}</Label><Label>{i.priority.toUpperCase()}</Label><Label>{HORIZONS.find((h) => h.key === i.horizon)?.label}</Label></>}
        meta={<><span>Owner: {data.nameOf(i.owner_id)}</span><span>{i.start_date ? `${dayLabel(i.start_date)} → ${dayLabel(i.target_date, true)}` : 'No dates yet'}</span>{obj && <span className="flex items-center gap-1"><Target size={12} /> {obj.title}</span>}</>}
        actions={<>
          {canPropose && <button onClick={propose} className="btn-primary"><Send size={14} /> {m.over ? 'Ask to approve the new budget' : 'Ask the MD to approve'}</button>}
          {canDecide && <button onClick={() => setDeciding(true)} className="btn-primary"><CheckCircle2 size={14} /> {m.over ? 'Decide on the bigger budget' : 'Approve or decline'}</button>}
          {isLead && <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={14} /> Edit</button>}
        </>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
      {i.decision_note && <p className="mb-3 text-small rounded-lg bg-inset px-3 py-2"><b>{data.nameOf(i.approved_by)}:</b> “{i.decision_note}”</p>}
      {m.over && <p className="mb-3 text-small rounded-lg bg-danger-muted text-danger px-3 py-2">The planned budget ({rwf(m.planned)}) is above what was approved ({rwf(m.approved ?? 0)}). {asked ? `The MD has been asked (${dayLabel(i.proposed_at)}).` : isMd ? 'Approve it or keep the old budget.' : 'Ask the MD to approve the new budget.'}</p>}

      <StatGrid cols={5}>
        <StatCard icon={Wallet} label={m.approved !== null ? 'Approved budget' : 'Planned budget'} value={rwf(budgetBase)} sub={m.approved !== null ? `approved ${dayLabel(i.approved_at)} by ${data.nameOf(i.approved_by)}` : 'Not approved yet'} />
        <StatCard icon={Banknote} label="Spent" value={rwf(m.spent)} tone={budgetBase && m.spent > budgetBase ? 'danger' : undefined} sub={budgetBase ? `${Math.round((m.spent / budgetBase) * 100)}% of the budget` : 'Recorded by Finance'} />
        <StatCard label="Committed, not paid" value={rwf(unpaid)} sub="Agreed with suppliers, not paid yet" />
        <StatCard label={left < 0 ? "Over budget" : "Left"} value={rwf(Math.abs(left))} tone={left < 0 ? "danger" : undefined} />
        <StatCard icon={CheckCircle2} label="Delivery" value={`${d.pct}%`} sub={`${d.done}/${d.issues} issues across ${d.milestones.length} milestone${d.milestones.length === 1 ? '' : 's'}`} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Box title="The problem">{i.problem ? <p className="text-body whitespace-pre-line">{i.problem}</p> : <p className="text-small text-fg-muted">Not written yet.</p>}</Box>
        <Box title="The outcome">{i.outcome ? <p className="text-body whitespace-pre-line">{i.outcome}</p> : <p className="text-small text-fg-muted">Not written yet.</p>}</Box>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Box title="Budget" icon={Wallet} padded={false} right={isLead && <button onClick={() => setLine('new')} className="btn-ghost text-caption"><Plus size={13} /> Line</button>}>
          {lines.length ? (
            <table className="w-full text-body">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['What', 'Category', 'How', 'Total'].map((h, k) => <th key={h} className={`${th} ${k === 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} onClick={isLead ? () => setLine(l.id) : undefined} className={`border-t border-line-muted ${isLead ? 'cursor-pointer hover:bg-hover/60' : ''}`}>
                    <td className={td}>{l.description}{l.committed && <span className="ml-1.5"><Label tone="info">committed</Label></span>}</td>
                    <td className={`${td} text-caption`}>{CATEGORY_LABEL[l.category]}</td>
                    <td className={`${td} text-caption text-fg-muted`}>{l.recurrence === 'monthly' ? `${rwf(Number(l.amount))} × ${l.months} months` : 'once'}</td>
                    <td className={`${td} text-right tabular-nums font-medium`}>{rwf(lineTotal(l))}</td>
                  </tr>
                ))}
                <tr className="border-t border-line bg-inset"><td className={`${td} font-semibold`} colSpan={3}>Planned total</td><td className={`${td} text-right tabular-nums font-semibold`}>{rwf(m.planned)}</td></tr>
              </tbody>
            </table>
          ) : <p className="p-5 text-small text-fg-muted">No budget lines yet{isLead ? ' — add what this project needs (tools, AI services, devices, contractors…).' : '.'}</p>}
        </Box>
        <Box title="Spending (from Finance)" icon={Banknote} padded={false}>
          {spend.length ? (
            <table className="w-full text-body">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Date', 'What', 'Status', 'Amount'].map((h, k) => <th key={h} className={`${th} ${k === 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>{spend.map((s) => (
                <tr key={s.id} className="border-t border-line-muted">
                  <td className={`${td} whitespace-nowrap`}>{dayLabel(s.transaction_date)}</td>
                  <td className={td}>{s.counterparty || s.description || s.reference}</td>
                  <td className={`${td} text-caption`}>{s.status}</td>
                  <td className={`${td} text-right tabular-nums`}>{rwf(Number(s.amount))}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="p-5 text-small text-fg-muted">Nothing spent yet. Finance links an expense to this project when recording it in the ledger (field "IT project").</p>}
        </Box>
      </div>

      <Box title="Milestones" icon={Flag} padded={false} right={isLead && <button onClick={() => setNewMilestone(true)} className="btn-ghost text-caption"><Plus size={13} /> Milestone</button>}>
        {d.milestones.length ? (
          <ul className="divide-y divide-line-muted">
            {d.milestones.map((ms) => {
              const s = milestoneStats(ms, data.issues, data.areas);
              return (
                <li key={ms.id}><Link to={`/product/milestones?m=${ms.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-hover">
                  <span className="font-mono text-caption text-fg-muted">M{ms.number}</span><span className="text-body font-medium flex-1 min-w-[160px]">{ms.name}</span>
                  <span className="text-caption text-fg-muted">{dayLabel(ms.start_date)} – {dayLabel(ms.end_date)}</span>
                  <span className="w-32"><Bar pct={s.pct} /></span><span className="text-caption tabular-nums">{s.done}/{s.total}</span><Label tone={FORECAST[s.forecast].tone}>{FORECAST[s.forecast].label}</Label>
                </Link></li>
              );
            })}
          </ul>
        ) : <p className="p-5 text-small text-fg-muted">No milestones yet. Break the project into 2-week milestones.</p>}
      </Box>

      {editing && <InitiativeFormModal data={data} plan={plan} initiative={i} onClose={() => setEditing(false)} onSaved={() => plan.reload()} />}
      {line && <BudgetLineModal initiativeId={i.id} line={line === 'new' ? null : lines.find((l) => l.id === line) ?? null} onClose={() => setLine(null)} onSaved={plan.reload} />}
      {deciding && <DecisionModal initiative={i} planned={m.planned} onClose={() => setDeciding(false)} onDone={plan.reload} />}
      {newMilestone && <MilestoneFormModal data={data} milestone={null} initiativeId={i.id} onClose={() => setNewMilestone(false)} onSaved={() => data.reload()} />}
    </div>
  );
}

// ================================================================ OBJECTIVES
export function ItObjectives() {
  usePageTitle('Objectives');
  const { data, plan, isLead } = useCtx();
  const [editing, setEditing] = useState<ItObjective | 'new' | null>(null);
  if (data.loading || plan.loading) return <Loading />;
  const periods = [...new Set(plan.objectives.map((o) => o.period))].sort().reverse();
  const saveKr = async (id: string, value: string) => {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    await supabase.from('it_key_results').update({ current_value: v, updated_at: new Date().toISOString() }).eq('id', id);
    plan.reload();
  };
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Target} title="Objectives" subtitle="Where we want the product to be each quarter, and the numbers that prove we got there. Projects on the roadmap serve these."
        actions={isLead && <button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> New objective</button>} />
      {!plan.objectives.length ? <EmptyState icon={Target} title="No objectives yet" body="Start with 2–4 for this quarter, e.g. reliability, speed of finding a driver, partner growth." action={isLead && <button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> New objective</button>} />
        : periods.map((p) => (
          <section key={p} className="mb-6">
            <h2 className="section-title mb-2">{quarterLabel(p)}</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {plan.objectives.filter((o) => o.period === p).map((o) => {
                const krs = plan.keyResults.filter((k) => k.objective_id === o.id);
                const pct = objectiveProgress(krs);
                const projects = plan.initiatives.filter((i) => i.objective_id === o.id);
                return (
                  <section key={o.id} className="card p-4">
                    <div className="flex items-start gap-2 mb-2">
                      <Target size={16} className="text-accent-fg mt-0.5" />
                      <div className="flex-1 min-w-0"><p className="text-body font-semibold">{o.title}</p>{o.why && <p className="text-caption text-fg-muted">{o.why}</p>}</div>
                      <Label tone={OBJECTIVE_STATUS[o.status].tone}>{OBJECTIVE_STATUS[o.status].label}</Label>
                      {isLead && <button onClick={() => setEditing(o)} className="btn-ghost p-1.5" aria-label="Edit"><Pencil size={13} /></button>}
                    </div>
                    <div className="flex items-center gap-2 mb-3"><div className="flex-1"><Bar pct={pct} /></div><span className="text-small font-semibold tabular-nums">{pct}%</span></div>
                    <ul className="space-y-2">
                      {krs.map((k) => (
                        <li key={k.id} className="text-small">
                          <div className="flex items-center gap-2">
                            <span className="flex-1">{k.title}</span>
                            {isLead ? <input defaultValue={String(k.current_value)} onBlur={(e) => e.target.value !== String(k.current_value) && saveKr(k.id, e.target.value)} className="input !w-20 !py-0.5 text-right tabular-nums" aria-label={`Current value of ${k.title}`} />
                              : <b className="tabular-nums">{Number(k.current_value)}</b>}
                            <span className="text-caption text-fg-muted whitespace-nowrap">/ {Number(k.target_value)}{k.unit ? ` ${k.unit}` : ''}</span>
                          </div>
                          <div className="mt-1"><Bar pct={krProgress(k)} color="rgb(var(--c-accent))" /></div>
                        </li>
                      ))}
                      {!krs.length && <li className="text-caption text-fg-muted">No key results yet.</li>}
                    </ul>
                    {projects.length > 0 && <p className="mt-3 pt-2 border-t border-line-muted text-caption text-fg-muted">Projects: {projects.map((x, n) => <span key={x.id}>{n ? ', ' : ''}<Link to={`/product/roadmap?i=${x.id}`} className="link">I{x.number} {x.name}</Link></span>)}</p>}
                    <p className="mt-1 text-caption text-fg-muted">Owner: {data.nameOf(o.owner_id)}</p>
                  </section>
                );
              })}
            </div>
          </section>
        ))}
      {editing && <ObjectiveFormModal data={data} objective={editing === 'new' ? null : editing} keyResults={editing === 'new' ? [] : plan.keyResults.filter((k) => k.objective_id === editing.id)} onClose={() => setEditing(null)} onSaved={plan.reload} />}
    </div>
  );
}

// ================================================================ BUDGET
export function ItBudget() {
  usePageTitle('IT budget');
  const { data, plan } = useCtx();
  const c = usePalette();
  const rows = useMemo(() => plan.initiatives.filter((i) => !['declined', 'cancelled'].includes(i.status)).map((i) => ({ i, m: moneyOf(i, plan.lines, plan.spend) })), [plan]);
  if (data.loading || plan.loading) return <Loading />;
  const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((s, x) => s + f(x), 0);
  const approved = sum((x) => x.m.approved ?? 0), planned = sum((x) => x.m.planned), spent = sum((x) => x.m.spent), committed = sum((x) => Math.max(0, x.m.committed - x.m.spent));
  const waiting = rows.filter((x) => waitingForMd(x.i, x.m));
  const byCat = BUDGET_CATEGORIES.map((cat) => ({ key: cat.key, label: cat.label, n: plan.lines.filter((l) => l.category === cat.key && rows.some((r) => r.i.id === l.initiative_id)).reduce((s, l) => s + lineTotal(l), 0) })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const month = kigaliToday().slice(0, 7);
  const spentMonth = plan.spend.filter((s) => s.transaction_date.slice(0, 7) === month).reduce((s, x) => s + Number(x.amount), 0);
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Wallet} title="IT budget" subtitle="Approved by the MD per project; spending recorded by Finance against each project." />
      <StatGrid cols={5}>
        <StatCard icon={CheckCircle2} label="Approved" value={rwf(approved)} sub={(() => { const n = rows.filter((x) => x.m.approved !== null).length; return `${n} project${n === 1 ? "" : "s"}`; })()} />
        <StatCard label="Planned" value={rwf(planned)} sub={planned > approved ? `${rwf(planned - approved)} not approved yet` : 'All approved'} tone={planned > approved ? 'attention' : undefined} />
        <StatCard icon={Banknote} label="Spent" value={rwf(spent)} sub={`${rwf(spentMonth)} this month`} />
        <StatCard label="Committed, not paid" value={rwf(committed)} />
        <StatCard icon={AlertTriangle} label="Waiting for the MD" value={waiting.length} tone={waiting.length ? 'attention' : undefined} sub="New projects or bigger budgets" />
      </StatGrid>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Box title="By project" icon={Map} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-body min-w-[720px]">
                <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Project', 'Status', 'Approved', 'Planned', 'Spent', 'Used'].map((h, k) => <th key={h} className={`${th} ${k >= 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map(({ i, m }) => {
                    const base = m.approved ?? m.planned;
                    const used = base ? Math.round((m.spent / base) * 100) : 0;
                    return (
                      <tr key={i.id} className="border-t border-line-muted">
                        <td className={td}><Link to={`/product/roadmap?i=${i.id}`} className="link"><span className="font-mono text-caption">I{i.number}</span> {i.name}</Link></td>
                        <td className={td}><Label tone={INITIATIVE_STATUS[i.status].tone}>{INITIATIVE_STATUS[i.status].label}</Label></td>
                        <td className={`${td} text-right tabular-nums`}>{m.approved !== null ? rwf(m.approved) : '—'}</td>
                        <td className={`${td} text-right tabular-nums ${m.over ? 'text-danger font-medium' : ''}`}>{rwf(m.planned)}</td>
                        <td className={`${td} text-right tabular-nums`}>{rwf(m.spent)}</td>
                        <td className={`${td} w-32`}><Bar pct={used} color={used > 100 ? 'rgb(var(--c-danger))' : 'rgb(var(--c-accent))'} /><span className="text-caption text-fg-muted">{used}%</span></td>
                      </tr>
                    );
                  })}
                  {!rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-fg-muted">No projects yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Box>
        </div>
        <Box title="Planned by category" icon={Wallet}><RankBars rows={byCat} color={c.blue} format={(n) => rwfShort(n)} empty="No budget lines yet." /></Box>
      </div>
    </div>
  );
}

export type { PlanData, ItData };
