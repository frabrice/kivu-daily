import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, Compass, Flag, Lock, Pencil, Plus, Send, Star, Target, Users2, Wallet } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { addDays, dayLabel, kigaliToday } from '../../lib/it';
import { useAccess } from '../../os/access';
import {
  BUDGET_STATUS, Budget, DEPT_LABEL, HORIZONS, KIND, OBJECTIVE_STATUS, PRIORITY_STATUS, PlanData, Priority, budgetMoney, krProgress, krValue, lineTotal, liveValues, monthLabel, monthsOf,
  quarterLabel, quarterOf, rwf, rwfShort, scoreOf, usePlan,
} from '../../lib/companyPlan';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import { ChartCard, DailyLines, usePalette } from '../../components/charts/kit';
import { AccessModal, BudgetDecisionModal, BudgetLineModal, BudgetWizard, ObjectiveModal, PriorityModal, VisionModal } from '../../components/company/PlanModals';

// The company plan: Direction (vision, North Star, this quarter), Objectives,
// Priorities and Budgets. Full access: the MD and the owners; department
// heads see the direction plus their own department's priorities and budgets.

const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
function Bar({ pct, color = 'rgb(var(--c-success))' }: { pct: number; color?: string }) {
  return <div className="h-2 rounded-full bg-inset overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>;
}
const Depts = ({ list }: { list: string[] }) => <>{list.map((d) => <Label key={d}>{DEPT_LABEL[d] ?? d}</Label>)}</>;

function useCtx() {
  const { profile } = useAuth();
  const a = useAccess();
  const plan = usePlan();
  return { plan, isAdmin: a.plan === 'full', isMd: a.isMd, myDept: a.planDept, me: profile?.id ?? '' };
}
type Ctx = ReturnType<typeof useCtx>;

// ================================================================ DIRECTION
export function CompanyDirection() {
  usePageTitle('Company plan');
  const ctx = useCtx();
  const { plan, isAdmin, isMd } = ctx;
  const c = usePalette();
  const [editVision, setEditVision] = useState(false);
  const [access, setAccess] = useState(false);
  const live = useMemo(() => liveValues(plan.trips), [plan.trips]);
  const chart = useMemo(() => {
    const out = [];
    const to = kigaliToday();
    for (let d = addDays(to, -59); d <= to; d = addDays(d, 1)) {
      const row = plan.trips.find((t) => t.day === d);
      const win = plan.trips.filter((t) => t.day > addDays(d, -7) && t.day <= d);
      out.push({ day: d, completed: row?.completed ?? 0, avg: Math.round((win.reduce((s, t) => s + t.completed, 0) / 7) * 10) / 10 });
    }
    return out;
  }, [plan.trips]);
  if (plan.loading || !plan.vision) return <Loading />;
  const v = plan.vision;
  const q = quarterOf(kigaliToday());
  const objectives = plan.objectives.filter((o) => o.period === q && o.status !== 'dropped');
  const now = plan.priorities.filter((p) => p.horizon === 'now' && p.status !== 'dropped' && p.status !== 'done').sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1));
  const ns = live.completed_per_day, be = Number(v.break_even_per_day);
  const money = plan.budgets.filter((b) => b.status !== 'rejected').map((b) => ({ b, m: budgetMoney(b, plan.lines, plan.spend) }));
  const waiting = plan.budgets.filter((b) => b.status === 'submitted');
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Compass} title="Company plan" subtitle="Where Kivu Ride is going, what matters most now, and the money behind it."
        actions={<>{isMd && <button onClick={() => setAccess(true)} className="btn-secondary"><Users2 size={14} /> Who sees this</button>}{isAdmin && <button onClick={() => setEditVision(true)} className="btn-secondary"><Pencil size={14} /> Vision & North Star</button>}</>} />

      {isAdmin && waiting.length > 0 && (
        <div className="mb-4 rounded-lg border border-attention/50 bg-attention-muted px-4 py-3 flex flex-wrap items-center gap-2">
          <AlertTriangle size={16} className="text-attention" /><span className="flex-1"><b>{waiting.length} budget{waiting.length === 1 ? '' : 's'} waiting for approval:</b> {waiting.map((b) => b.name).join(', ')}</span>
          <Link to={`/company/budgets?b=${waiting[0].id}`} className="btn-primary text-caption">Review</Link>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Box title="Vision" icon={Compass} className="xl:col-span-1">
          {v.vision || v.mission || v.ambition ? (
            <div className="space-y-3 text-body">
              {v.vision && <div><p className="text-caption text-fg-muted">Vision</p><p className="font-semibold">{v.vision}</p></div>}
              {v.mission && <div><p className="text-caption text-fg-muted">Mission</p><p>{v.mission}</p></div>}
              {v.ambition && <div><p className="text-caption text-fg-muted">In 3 years</p><p className="whitespace-pre-line">{v.ambition}</p></div>}
            </div>
          ) : (
            <div className="text-small text-fg-muted space-y-2">
              <p>Not written yet. Three questions to answer together:</p>
              <ol className="list-decimal ml-5 space-y-1"><li>What world do we want to create in Rwanda?</li><li>What do we do every day to get there?</li><li>In 3 years: how many cities, cars, trips a day, people, how much revenue?</li></ol>
              {isAdmin && <button onClick={() => setEditVision(true)} className="btn-primary text-caption mt-1"><Pencil size={13} /> Write it</button>}
            </div>
          )}
        </Box>
        <div className="xl:col-span-2">
          <ChartCard title={`North Star: ${v.north_star_name}`} subtitle={<>Now <b>{ns}</b> a day (7-day average) · break-even <b>{be}</b>{v.north_star_target ? <> · target <b>{Number(v.north_star_target)}</b> by {dayLabel(v.north_star_target_date, true)}</> : ' · no target set yet'}</>}
            legend={[{ key: 'completed', label: 'Completed that day', color: c.blue }, { key: 'avg', label: '7-day average', color: c.aqua }]}>
            <div className="mb-3">
              <div className="flex justify-between text-caption text-fg-muted mb-1"><span>0</span><span>{Math.round((ns / be) * 100)}% of break-even</span><span>{be}/day</span></div>
              <Bar pct={(ns / be) * 100} color={ns >= be ? 'rgb(var(--c-success))' : 'rgb(var(--c-attention))'} />
            </div>
            <DailyLines data={chart} c={c} height={180} series={[{ key: 'completed', label: 'Completed that day', color: c.blue }, { key: 'avg', label: '7-day average', color: c.aqua }]} />
          </ChartCard>
        </div>
      </div>

      <StatGrid cols={4}>
        <StatCard icon={Star} label="Completed trips / day" value={ns} sub={`${live.requests_per_day} requests a day · last 7 days`} />
        <StatCard icon={Target} label="Requests completed" value={`${live.completion_pct}%`} sub={`${live.no_driver_pct}% found no driver`} tone={live.completion_pct < 70 ? 'attention' : undefined} />
        <StatCard icon={Wallet} label="Budgets approved" value={rwf(money.reduce((s, x) => s + (x.m.approved ?? 0), 0))} sub={`${money.filter((x) => x.b.status === 'approved').length} of ${money.length} budgets`} />
        <StatCard icon={Banknote} label="Spent from budgets" value={rwf(money.reduce((s, x) => s + x.m.spent, 0))} sub="recorded by Finance" />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title={`${quarterLabel(q)} objectives`} icon={Target} right={<Link to="/company/objectives" className="text-caption link">All objectives</Link>}>
          {objectives.length ? <ul className="space-y-3">{objectives.map((o) => {
            const krs = plan.krs.filter((k) => k.objective_id === o.id);
            const pct = krs.length ? Math.round(krs.reduce((s, k) => s + krProgress(k, krValue(k, live)), 0) / krs.length) : 0;
            return <li key={o.id}><div className="flex items-center gap-2 text-small"><span className="flex-1 font-medium">{o.title}</span><Label tone={OBJECTIVE_STATUS[o.status].tone}>{OBJECTIVE_STATUS[o.status].label}</Label><span className="tabular-nums w-10 text-right">{pct}%</span></div><Bar pct={pct} /></li>;
          })}</ul> : <p className="text-small text-fg-muted">No objectives for this quarter yet.</p>}
        </Box>
        <Box title="Now — what gets our people and money" icon={Flag} right={<Link to="/company/priorities" className="text-caption link">All priorities</Link>}>
          {now.length > 5 && <p className="mb-2 text-caption rounded-md bg-attention-muted px-2 py-1"><b>{now.length} things in Now.</b> A small company does 3–5 well — score them and move the rest to Next.</p>}
          {now.length ? <ul className="divide-y divide-line-muted">{now.map((p) => (
            <li key={p.id} className="py-2 flex items-center gap-2 text-small"><span className="font-mono text-caption text-fg-muted">P{p.number}</span><span className="flex-1">{p.title}</span><span className="text-caption tabular-nums text-fg-muted">{scoreOf(p) ?? '—'}</span></li>
          ))}</ul> : <p className="text-small text-fg-muted">Nothing in Now.</p>}
        </Box>
      </div>
      {editVision && <VisionModal vision={v} onClose={() => setEditVision(false)} onSaved={plan.reload} />}
      {access && <AccessModal plan={plan} onClose={() => setAccess(false)} />}
    </div>
  );
}

// ================================================================ OBJECTIVES
export function CompanyObjectives() {
  usePageTitle('Company objectives');
  const { plan, isAdmin } = useCtx();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const live = useMemo(() => liveValues(plan.trips), [plan.trips]);
  if (plan.loading) return <Loading />;
  const periods = [...new Set(plan.objectives.map((o) => o.period))].sort().reverse();
  const saveKr = async (id: string, value: string) => {
    const n = Number(value); if (Number.isNaN(n)) return;
    await supabase.from('company_key_results').update({ current_value: n, updated_at: new Date().toISOString() }).eq('id', id); plan.reload();
  };
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Target} title="Company objectives" subtitle="Each quarter: where the company must be, and the numbers that prove it. Live numbers update from Trips by themselves."
        actions={isAdmin && <button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> New objective</button>} />
      {!plan.objectives.length ? <EmptyState icon={Target} title="No objectives yet" /> : periods.map((p) => (
        <section key={p} className="mb-6">
          <h2 className="section-title mb-2">{quarterLabel(p)}</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {plan.objectives.filter((o) => o.period === p).map((o) => {
              const krs = plan.krs.filter((k) => k.objective_id === o.id);
              const pct = krs.length ? Math.round(krs.reduce((s, k) => s + krProgress(k, krValue(k, live)), 0) / krs.length) : 0;
              const prios = plan.priorities.filter((x) => x.objective_id === o.id);
              return (
                <section key={o.id} className="card p-4">
                  <div className="flex items-start gap-2 mb-1">
                    <Target size={16} className="text-accent-fg mt-0.5" />
                    <div className="flex-1 min-w-0"><p className="text-body font-semibold">{o.title}</p>{o.why && <p className="text-caption text-fg-muted">{o.why}</p>}</div>
                    <Label tone={OBJECTIVE_STATUS[o.status].tone}>{OBJECTIVE_STATUS[o.status].label}</Label>
                    {isAdmin && <button onClick={() => setEditing(o.id)} className="btn-ghost p-1.5" aria-label="Edit"><Pencil size={13} /></button>}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2"><Depts list={o.departments} /></div>
                  <div className="flex items-center gap-2 mb-3"><div className="flex-1"><Bar pct={pct} /></div><span className="text-small font-semibold tabular-nums">{pct}%</span></div>
                  <ul className="space-y-2">{krs.map((k) => {
                    const val = krValue(k, live);
                    return (
                      <li key={k.id} className="text-small">
                        <div className="flex items-center gap-2">
                          <span className="flex-1">{k.title}{k.source !== 'manual' && <span className="ml-1"><Label tone="info">live</Label></span>}</span>
                          {k.source === 'manual' && isAdmin ? <input defaultValue={String(k.current_value)} onBlur={(e) => e.target.value !== String(k.current_value) && saveKr(k.id, e.target.value)} className="input !w-20 !py-0.5 text-right tabular-nums" aria-label={`Current value of ${k.title}`} />
                            : <b className="tabular-nums">{val}</b>}
                          <span className="text-caption text-fg-muted whitespace-nowrap">→ {Number(k.target_value)}{k.unit ? ` ${k.unit}` : ''} <span className="text-fg-subtle">(from {Number(k.start_value)})</span></span>
                        </div>
                        <div className="mt-1"><Bar pct={krProgress(k, val)} color="rgb(var(--c-accent))" /></div>
                      </li>
                    );
                  })}{!krs.length && <li className="text-caption text-fg-muted">No key results yet.</li>}</ul>
                  {prios.length > 0 && <p className="mt-3 pt-2 border-t border-line-muted text-caption text-fg-muted">Priorities: {prios.map((x, n) => <span key={x.id}>{n ? ', ' : ''}P{x.number} {x.title}</span>)}</p>}
                  <p className="mt-1 text-caption text-fg-muted">Owner: {plan.nameOf(o.owner_id)}</p>
                </section>
              );
            })}
          </div>
        </section>
      ))}
      {editing && <ObjectiveModal plan={plan} objective={editing === 'new' ? null : plan.objectives.find((o) => o.id === editing) ?? null} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ================================================================ PRIORITIES
export function CompanyPriorities() {
  usePageTitle('Priorities');
  const { plan, isAdmin, myDept, me } = useCtx();
  const [editing, setEditing] = useState<Priority | 'new' | null>(null);
  if (plan.loading) return <Loading />;
  const visible = plan.priorities.filter((p) => p.status !== 'dropped');
  const byScore = (a: Priority, b: Priority) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1) || a.sort - b.sort;
  const nowCount = visible.filter((p) => p.horizon === 'now' && p.status !== 'done').length;
  const unscored = visible.filter((p) => scoreOf(p) === null && p.status !== 'done').length;
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Flag} title="Priorities" subtitle="One list of company bets across every department. Score them, keep Now small, and say clearly what we're not doing."
        actions={(isAdmin || myDept) && <button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> {isAdmin ? 'New priority' : 'Propose a priority'}</button>} />
      {isAdmin && (nowCount > 5 || unscored > 0) && (
        <div className="mb-4 rounded-lg bg-attention-muted px-4 py-3 text-small">
          {nowCount > 5 && <p><b>{nowCount} priorities in Now.</b> With a small team, 3–5 is what gets done well. Move the lowest scores to Next.</p>}
          {unscored > 0 && <p><b>{unscored} not scored yet.</b> Open each one and give it 1–5 on impact, confidence, ease and urgency — the list sorts itself.</p>}
        </div>
      )}
      {!isAdmin && <p className="mb-3 text-caption text-fg-muted flex items-center gap-1"><Lock size={12} /> You see the priorities of {DEPT_LABEL[myDept ?? ''] ?? 'your department'}. New ones you add are proposals for the MD.</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-3">
        {HORIZONS.map((h) => {
          const list = visible.filter((p) => p.horizon === h.key).sort(byScore);
          return (
            <div key={h.key} className={`rounded-lg p-2.5 ${h.key === 'not_doing' ? 'bg-inset/60' : 'bg-inset'}`}>
              <p className="px-1 pb-2"><span className="text-body font-semibold">{h.label}</span> <span className="text-caption text-fg-muted tabular-nums">{list.length}</span><br /><span className="text-caption text-fg-muted">{h.help}</span></p>
              <div className="space-y-2">
                {list.map((p) => {
                  const s = scoreOf(p);
                  const obj = plan.objectives.find((o) => o.id === p.objective_id);
                  return (
                    <button key={p.id} onClick={() => (isAdmin || (p.created_by === me && p.status === 'proposed')) && setEditing(p)} className={`w-full text-left card p-3 hover:border-line-strong ${p.status === 'done' ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-caption text-fg-muted mt-0.5">P{p.number}</span>
                        <span className="flex-1 text-body font-semibold leading-snug">{p.title}</span>
                        <span className={`text-caption font-semibold tabular-nums rounded px-1.5 ${s === null ? 'text-fg-subtle' : s >= 40 ? 'bg-success-muted text-success' : s >= 15 ? 'bg-accent/10 text-accent-fg' : 'bg-inset text-fg-muted'}`} title="Score out of 100">{s ?? '–'}</span>
                      </div>
                      {p.expected_impact && <p className="text-caption text-fg-muted mt-1 line-clamp-2">{p.expected_impact}</p>}
                      <div className="flex flex-wrap items-center gap-1 mt-2"><Depts list={p.departments} />{p.status !== 'active' && <Label tone={PRIORITY_STATUS[p.status].tone}>{PRIORITY_STATUS[p.status].label}</Label>}{p.it_initiative_id && <Label tone="info">IT project</Label>}</div>
                      {(obj || p.target_date) && <p className="text-micro text-fg-subtle mt-1">{obj ? `→ ${obj.title}` : ''}{obj && p.target_date ? ' · ' : ''}{p.target_date ? `by ${dayLabel(p.target_date)}` : ''}</p>}
                    </button>
                  );
                })}
                {!list.length && <p className="text-caption text-fg-subtle px-1 py-3">Nothing here.</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-caption text-fg-muted">Score = impact × confidence × ease × urgency (each 1–5), out of 100. IT projects come from the IT roadmap; their budgets are approved there.</p>
      {editing && <PriorityModal plan={plan} priority={editing === 'new' ? null : editing} isAdmin={isAdmin} myDept={myDept} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ================================================================ BUDGETS
export function CompanyBudgets() {
  usePageTitle('Budgets');
  const ctx = useCtx();
  const { plan, isAdmin, myDept, me } = ctx;
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  if (plan.loading) return <Loading />;
  const open = params.get('b') ? plan.budgets.find((b) => b.id === params.get('b')) : null;
  if (open) return <BudgetPage ctx={ctx} b={open} onBack={() => setParams({})} />;
  const rows = plan.budgets.map((b) => ({ b, m: budgetMoney(b, plan.lines, plan.spend) }));
  const live = rows.filter((x) => x.b.status !== 'rejected' && x.b.status !== 'closed');
  const canCreate = isAdmin || !!myDept;
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Wallet} title="Budgets" subtitle="Each budget is built on its own — marketing, fleet, office, expansion… — answers a few questions, and is approved by the MD. Finance records spending against it."
        actions={canCreate && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> Create a budget</button>} />
      <StatGrid cols={4}>
        <StatCard icon={CheckCircle2} label="Approved" value={rwf(live.reduce((s, x) => s + (x.m.approved ?? 0), 0))} sub={`${live.filter((x) => x.b.status === 'approved').length} budgets`} />
        <StatCard label="Asked, not approved yet" value={rwf(live.filter((x) => x.b.status !== 'approved').reduce((s, x) => s + x.m.planned, 0))} sub={`${live.filter((x) => x.b.status === 'submitted').length} waiting · ${live.filter((x) => x.b.status === 'draft').length} drafts`} tone={live.some((x) => x.b.status === 'submitted') ? 'attention' : undefined} />
        <StatCard icon={Banknote} label="Spent" value={rwf(live.reduce((s, x) => s + x.m.spent, 0))} sub="linked in the Finance ledger" />
        <StatCard label="Left in approved budgets" value={rwf(live.filter((x) => x.b.status === 'approved').reduce((s, x) => s + Math.max(0, x.m.left), 0))} />
      </StatGrid>
      {!rows.length ? (
        <EmptyState icon={Wallet} title="No budgets yet" body="Start with the one that matters most now — e.g. the marketing budget for the next three months, or the launch of the 30 financed EVs."
          action={canCreate && <button onClick={() => setCreating(true)} className="btn-primary"><Plus size={14} /> Create a budget</button>} />
      ) : (
        <Box title="All budgets" icon={Wallet} padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-body min-w-[820px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Budget', 'For', 'Period', 'Status', 'Asked', 'Approved', 'Spent', 'Used'].map((h, k) => <th key={h} className={`${th} ${k >= 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(({ b, m }) => {
                const base = m.approved ?? m.planned;
                const used = base ? Math.round((m.spent / base) * 100) : 0;
                return (
                  <tr key={b.id} onClick={() => setParams({ b: b.id })} className="border-t border-line-muted hover:bg-hover/60 cursor-pointer">
                    <td className={td}><span className="font-mono text-caption text-fg-muted">B{b.number}</span> <span className="font-medium">{b.name}</span></td>
                    <td className={`${td} text-caption`}>{KIND[b.kind].label}{b.department_slug ? ` · ${DEPT_LABEL[b.department_slug]}` : ''}</td>
                    <td className={`${td} text-caption whitespace-nowrap`}>{monthLabel(b.start_month)}{b.months > 1 ? ` – ${monthLabel(monthsOf(b.start_month, b.months).slice(-1)[0])}` : ''}</td>
                    <td className={td}><Label tone={BUDGET_STATUS[b.status].tone}>{BUDGET_STATUS[b.status].label}</Label>{m.over && <span className="ml-1"><Label tone="danger">grew</Label></span>}</td>
                    <td className={`${td} text-right tabular-nums`}>{rwf(m.planned)}</td>
                    <td className={`${td} text-right tabular-nums`}>{m.approved !== null ? rwf(m.approved) : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{rwf(m.spent)}</td>
                    <td className={`${td} w-28`}><Bar pct={used} color={used > 100 ? 'rgb(var(--c-danger))' : 'rgb(var(--c-accent))'} /><span className="text-caption text-fg-muted">{used}%</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </Box>
      )}
      {creating && <BudgetWizard plan={plan} isAdmin={isAdmin} myDept={myDept} me={me} onClose={() => { setCreating(false); if (params.get('new')) setParams({}); }} onCreated={(id) => setParams({ b: id })} />}
    </div>
  );
}

function BudgetPage({ ctx, b, onBack }: { ctx: Ctx; b: Budget; onBack: () => void }) {
  usePageTitle(`B${b.number} · ${b.name}`);
  const { plan, isAdmin, myDept } = ctx;
  const [line, setLine] = useState<string | 'new' | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState('');
  const m = budgetMoney(b, plan.lines, plan.spend);
  const lines = plan.lines.filter((l) => l.budget_id === b.id);
  const spend = plan.spend.filter((s) => s.company_budget_id === b.id).sort((x, y) => y.transaction_date.localeCompare(x.transaction_date));
  const canEdit = isAdmin || (!!myDept && b.department_slug === myDept && ['draft', 'rejected', 'approved'].includes(b.status));
  const canSubmit = canEdit && (['draft', 'rejected'].includes(b.status) || (b.status === 'approved' && m.over));
  const canDecide = isAdmin && (b.status === 'submitted' || (b.status === 'approved' && m.over));
  const st = BUDGET_STATUS[b.status];
  const prio = plan.priorities.find((p) => p.id === b.priority_id);
  const obj = plan.objectives.find((o) => o.id === b.objective_id);
  const months = monthsOf(b.start_month, b.months);
  const perMonth = months.map((mo, idx) => ({
    mo, planned: lines.reduce((s, l) => s + (l.recurrence === 'monthly' ? (idx < l.months ? Number(l.amount) : 0) : idx === 0 ? Number(l.amount) : 0), 0),
    spent: spend.filter((x) => x.transaction_date.slice(0, 7) === mo).reduce((s, x) => s + Number(x.amount), 0),
  }));
  const submit = async () => { setError(''); const { error: err } = await supabase.rpc('submit_company_budget', { p_id: b.id }); if (err) setError(err.message); else plan.reload(); };
  const close = async () => { if (!confirm('Close this budget? It stays on record; no more spending is expected.')) return; const { error: err } = await supabase.from('company_budgets').update({ status: 'closed' }).eq('id', b.id); if (err) setError(err.message); else plan.reload(); };
  const remove = async () => { if (!confirm(`Delete the draft "${b.name}"?`)) return; await supabase.from('company_budgets').delete().eq('id', b.id); plan.reload(); onBack(); };
  return (
    <div className="animate-fade-in">
      <button onClick={onBack} className="text-caption text-fg-muted hover:text-fg flex items-center gap-1 mb-2"><ArrowLeft size={12} /> Budgets</button>
      <PageHeader icon={Wallet} title={`B${b.number} · ${b.name}`} labels={<><Label tone={st.tone}>{st.label}</Label><Label>{KIND[b.kind].label}</Label></>}
        meta={<><span>{b.department_slug ? DEPT_LABEL[b.department_slug] : 'Company-wide'}</span><span>Responsible: {plan.nameOf(b.owner_id)}</span><span>{monthLabel(b.start_month)}{b.months > 1 ? ` – ${monthLabel(months.slice(-1)[0])}` : ''} ({b.months} month{b.months === 1 ? '' : 's'})</span></>}
        actions={<>
          {canSubmit && <button onClick={submit} className="btn-primary"><Send size={14} /> {m.over ? 'Ask to approve the new amount' : isAdmin ? 'Submit' : 'Send for approval'}</button>}
          {canDecide && <button onClick={() => setDeciding(true)} className="btn-primary"><CheckCircle2 size={14} /> Approve or not</button>}
          {isAdmin && b.status === 'approved' && <button onClick={close} className="btn-secondary">Close</button>}
          {(isAdmin || b.status === 'draft') && b.status !== 'approved' && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>}
        </>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
      {b.decision_note && <p className="mb-3 text-small rounded-lg bg-inset px-3 py-2"><b>{plan.nameOf(b.approved_by)}:</b> “{b.decision_note}”</p>}
      {m.over && <p className="mb-3 text-small rounded-lg bg-danger-muted text-danger px-3 py-2">The lines now add up to {rwf(m.planned)}, more than the {rwf(m.approved ?? 0)} approved.</p>}
      <StatGrid cols={4}>
        <StatCard icon={Wallet} label={m.approved !== null ? 'Approved' : 'Asked'} value={rwf(m.approved ?? m.planned)} sub={m.approved !== null ? `approved ${dayLabel(b.approved_at)} by ${plan.nameOf(b.approved_by)}` : st.label} />
        <StatCard icon={Banknote} label="Spent" value={rwf(m.spent)} sub={(m.approved ?? m.planned) ? `${Math.round((m.spent / (m.approved ?? m.planned)) * 100)}% used` : ''} tone={m.left < 0 ? 'danger' : undefined} />
        <StatCard label={m.left < 0 ? 'Over budget' : 'Left'} value={rwf(Math.abs(m.left))} tone={m.left < 0 ? 'danger' : undefined} />
        <StatCard icon={Target} label="Expected result" value={b.target_value ? `${Number(b.target_value).toLocaleString()}` : '—'} sub={b.target_value ? `${b.target_unit ?? ''} · ${rwf((m.approved ?? m.planned) / Number(b.target_value))} each` : 'not set'} />
      </StatGrid>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Box title="What it should achieve" icon={Target}>
          <div className="space-y-2 text-small">
            <p>{b.goal || <span className="text-fg-muted">—</span>}</p>
            {b.expected_result && <p><span className="text-fg-muted">How we'll know:</span> {b.expected_result}</p>}
            {prio && <p><span className="text-fg-muted">Priority:</span> <Link to="/company/priorities" className="link">P{prio.number} {prio.title}</Link></p>}
            {obj && <p><span className="text-fg-muted">Objective:</span> {obj.title}</p>}
          </div>
        </Box>
        <div className="xl:col-span-2">
          <Box title="Lines" icon={Wallet} padded={false} right={canEdit && b.status !== 'submitted' && <button onClick={() => setLine('new')} className="btn-ghost text-caption"><Plus size={13} /> Line</button>}>
            <table className="w-full text-body">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['What', 'Category', 'How', 'Total'].map((h, k) => <th key={h} className={`${th} ${k === 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} onClick={canEdit && b.status !== 'submitted' ? () => setLine(l.id) : undefined} className={`border-t border-line-muted ${canEdit && b.status !== 'submitted' ? 'cursor-pointer hover:bg-hover/60' : ''}`}>
                    <td className={td}>{l.description}</td><td className={`${td} text-caption`}>{l.category}</td>
                    <td className={`${td} text-caption text-fg-muted`}>{l.recurrence === 'monthly' ? `${rwf(Number(l.amount))} × ${l.months} mo` : 'once'}</td>
                    <td className={`${td} text-right tabular-nums font-medium`}>{rwf(lineTotal(l))}</td>
                  </tr>
                ))}
                <tr className="border-t border-line bg-inset"><td className={`${td} font-semibold`} colSpan={3}>Total</td><td className={`${td} text-right tabular-nums font-semibold`}>{rwf(m.planned)}</td></tr>
              </tbody>
            </table>
          </Box>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Month by month" icon={Banknote} padded={false}>
          <table className="w-full text-body">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Month', 'Planned', 'Spent', ''].map((h, k) => <th key={h || k} className={`${th} ${k && k < 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>{perMonth.map((p) => (
              <tr key={p.mo} className="border-t border-line-muted">
                <td className={td}>{monthLabel(p.mo)}</td><td className={`${td} text-right tabular-nums`}>{rwfShort(p.planned)}</td>
                <td className={`${td} text-right tabular-nums ${p.spent > p.planned ? 'text-danger font-medium' : ''}`}>{rwfShort(p.spent)}</td>
                <td className={`${td} w-28`}><Bar pct={p.planned ? (p.spent / p.planned) * 100 : p.spent ? 100 : 0} color={p.spent > p.planned ? 'rgb(var(--c-danger))' : 'rgb(var(--c-accent))'} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Box>
        <Box title="Spending (from Finance)" icon={Banknote} padded={false}>
          {spend.length ? <table className="w-full text-body"><tbody>{spend.map((s) => (
            <tr key={s.id} className="border-t border-line-muted"><td className={`${td} whitespace-nowrap`}>{dayLabel(s.transaction_date)}</td><td className={td}>{s.counterparty || s.description || s.reference}</td><td className={`${td} text-caption`}>{s.status}</td><td className={`${td} text-right tabular-nums`}>{rwf(Number(s.amount))}</td></tr>
          ))}</tbody></table> : <p className="p-5 text-small text-fg-muted">Nothing spent yet. Finance picks this budget in the ledger ("Budget") when recording an expense.</p>}
        </Box>
      </div>
      {line && <BudgetLineModal budgetId={b.id} line={line === 'new' ? null : lines.find((l) => l.id === line) ?? null} defaultMonths={b.months} onClose={() => setLine(null)} onSaved={plan.reload} />}
      {deciding && <BudgetDecisionModal budget={b} planned={m.planned} onClose={() => setDeciding(false)} onDone={plan.reload} />}
    </div>
  );
}
export type { PlanData };
