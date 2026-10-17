import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, CircleDashed, Map as MapIcon, Megaphone, MinusCircle, Pencil, Plus, Rocket, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { dayLabel, kigaliToday } from '../../lib/it';
import { BUDGET_STATUS, DEPT_LABEL, budgetMoney, liveValues, monthsOf, usePlan } from '../../lib/companyPlan';
import { incomeNow, useMoney } from '../../lib/companyMoney';
import {
  ACTIVITY_STATUS, Activity, CHANNEL_LABEL, GATE_SOURCES, Gate, LiveNumbers, MARKETING_NEEDS, MarketingNeed, NEED_KIND, STAGE_STATUS, Stage, StageNeed, gateMet, gateValue, useGrowth,
} from '../../lib/companyGrowth';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import { ActivityModal, NeedModal, StageModal } from '../../components/company/GrowthModals';

// Company plan, phase 3: the expansion journey (stages, gates, needs) and
// the marketing plan, grouped by what the company needs.

const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2';
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(Math.abs(n) % 1e6 ? 1 : 0)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const daysTo = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${kigaliToday()}T12:00:00Z`)) / 86400000);

function useCtx() {
  const { profile } = useAuth();
  const a = useAccess();
  const plan = usePlan();
  const growth = useGrowth();
  const money = useMoney();
  const isAdmin = a.plan === 'full';
  const live: LiveNumbers = useMemo(() => {
    const t = liveValues(plan.trips);
    const inc = isAdmin && money.live && money.settings ? incomeNow(money.live, money.settings) : null;
    return { ...t, monthly_surplus: inc && money.settings ? inc.recurring - Number(money.settings.monthly_costs) : null, managed_cars: money.live ? Number(money.live.managed_cars) : null };
  }, [plan.trips, money.live, money.settings, isAdmin]);
  return { plan, growth, money, live, isAdmin, myDept: a.planDept, me: profile?.id ?? '', loading: plan.loading || growth.loading || money.loading };
}

function fmtGate(g: Gate, v: number | null) {
  if (v === null) return '—';
  if (g.source === 'monthly_surplus') return `${v < 0 ? '−' : '+'}${short(Math.abs(v))}`;
  const unit = GATE_SOURCES.find((s) => s.key === g.source)?.unit;
  return `${Math.round(v * 10) / 10}${unit === '%' ? '%' : ''}`;
}

// ================================================================ EXPANSION
export function CompanyExpansion() {
  usePageTitle('Expansion');
  const ctx = useCtx();
  const { plan, growth, live, isAdmin, loading } = ctx;
  const [editing, setEditing] = useState<Stage | 'new' | null>(null);
  const [need, setNeed] = useState<{ stage: string; need: StageNeed | null } | null>(null);
  if (loading) return <Loading />;
  const stages = growth.stages.filter((s) => s.status !== 'dropped');
  const toggleCheck = async (g: Gate) => { await supabase.from('company_expansion_gates').update({ done: !g.done }).eq('id', g.id); growth.reload(); };
  const setManual = async (g: Gate, v: string) => { const n = Number(v); if (Number.isNaN(n)) return; await supabase.from('company_expansion_gates').update({ current_value: n }).eq('id', g.id); growth.reload(); };
  const setNeedStatus = async (n: StageNeed, status: StageNeed['status']) => { await supabase.from('company_expansion_needs').update({ status }).eq('id', n.id); growth.reload(); };
  return (
    <div className="animate-fade-in">
      <PageHeader icon={MapIcon} title="Expansion" subtitle="The journey from Kigali to the whole of Rwanda: each stage has gates that must be true before we spend on it, and a list of what it needs."
        actions={isAdmin && <button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> New stage</button>} />
      {!stages.length ? <EmptyState icon={MapIcon} title="No stages yet" /> : (
        <ol className="relative space-y-4">
          {stages.map((s, idx) => {
            const gates = growth.gates.filter((g) => g.stage_id === s.id);
            const met = gates.map((g) => gateMet(g, live));
            const ok = met.filter((m) => m === true).length;
            const unknown = met.filter((m) => m === null).length;
            const ready = gates.length > 0 && ok === gates.length;
            const needs = growth.needs.filter((n) => n.stage_id === s.id);
            const cost = needs.reduce((t, n) => t + Number(n.cost ?? 0), 0);
            const unpriced = needs.filter((n) => n.cost === null && n.status !== 'done').length;
            const budget = plan.budgets.find((b) => b.id === s.budget_id);
            const bm = budget ? budgetMoney(budget, plan.lines, plan.spend) : null;
            const acts = growth.activities.filter((a) => a.stage_id === s.id);
            const left = s.target_date ? daysTo(s.target_date) : null;
            return (
              <li key={s.id} className="relative pl-10">
                {idx < stages.length - 1 && <span className="absolute left-[15px] top-9 bottom-[-16px] w-0.5 bg-line" aria-hidden />}
                <span className={`absolute left-0 top-1 w-8 h-8 rounded-full flex items-center justify-center text-caption font-semibold ${s.status === 'live' ? 'bg-success text-white' : s.status === 'preparing' ? 'bg-attention text-white' : 'bg-inset text-fg-muted border border-line'}`}>S{s.number}</span>
                <section className="card p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-[220px]">
                      <p className="text-body font-semibold">{s.name}</p>
                      {s.summary && <p className="text-small text-fg-muted">{s.summary}</p>}
                      <div className="flex flex-wrap gap-1 mt-1.5">{s.places.map((p) => <Label key={p}>{p}</Label>)}</div>
                    </div>
                    <Label tone={STAGE_STATUS[s.status].tone}>{STAGE_STATUS[s.status].label}</Label>
                    {s.target_date && <span className={`text-caption ${left !== null && left < 30 && !ready && s.status !== 'live' ? 'text-danger font-medium' : 'text-fg-muted'}`}>by {dayLabel(s.target_date, true)}{left !== null && left >= 0 ? ` · ${left} days left` : ''}</span>}
                    {isAdmin && <button onClick={() => setEditing(s)} className="btn-ghost p-1.5" aria-label="Edit stage"><Pencil size={13} /></button>}
                  </div>
                  {gates.length > 0 && (
                    <div className={`mt-3 rounded-md px-3 py-2 ${ready ? 'bg-success-muted' : 'bg-inset'}`}>
                      <p className="text-caption font-medium mb-1.5">{s.status === 'live' ? 'Health of this stage' : ready ? 'Ready to go — every gate is met' : `Gates: ${ok} of ${gates.length} met${unknown ? ` · ${unknown} without a number yet` : ''}`}</p>
                      <ul className="space-y-1">{gates.map((g, k) => {
                        const v = gateValue(g, live);
                        const m = met[k];
                        return (
                          <li key={g.id} className="flex flex-wrap items-center gap-2 text-small">
                            {m === true ? <Check size={14} className="text-success" /> : m === false ? <X size={14} className="text-danger" /> : <CircleDashed size={14} className="text-fg-subtle" />}
                            <span className="flex-1 min-w-[180px]">{g.title}</span>
                            {g.source === 'check' ? (isAdmin ? <button onClick={() => toggleCheck(g)} className="btn-ghost text-caption !py-0.5">{g.done ? 'Mark not done' : 'Mark done'}</button> : <span className="text-caption text-fg-muted">{g.done ? 'done' : 'not yet'}</span>) : <>
                              {g.source === 'manual' && isAdmin ? <input defaultValue={g.current_value === null ? '' : String(g.current_value)} onBlur={(e) => e.target.value !== String(g.current_value ?? '') && setManual(g, e.target.value)} className="input !py-0.5 !w-20 text-right tabular-nums text-small" aria-label={`Current value of ${g.title}`} />
                                : <b className="tabular-nums">{fmtGate(g, v)}</b>}
                              <span className="text-caption text-fg-muted whitespace-nowrap">{g.comparator === '>=' ? 'need ≥' : 'need ≤'} {g.source === 'monthly_surplus' ? short(Number(g.target)) : Number(g.target)}{GATE_SOURCES.find((x) => x.key === g.source)?.unit === '%' ? '%' : ''}{g.source !== 'manual' ? ' · live' : ''}</span>
                            </>}
                          </li>
                        );
                      })}</ul>
                    </div>
                  )}
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1"><p className="text-caption font-medium">What it needs · {needs.filter((n) => n.status === 'done').length}/{needs.length} done{cost ? ` · ${rwf(cost)} priced` : ''}{unpriced ? ` · ${unpriced} not priced` : ''}</p>
                      {isAdmin && <button onClick={() => setNeed({ stage: s.id, need: null })} className="btn-ghost text-caption !py-0.5"><Plus size={12} /> Need</button>}</div>
                    {needs.length ? <div className="overflow-x-auto"><table className="w-full text-small min-w-[560px]"><tbody>{needs.map((n) => (
                      <tr key={n.id} className="border-t border-line-muted">
                        <td className={`${td} w-28 text-caption text-fg-muted`}>{NEED_KIND[n.kind]}</td>
                        <td className={td}>{isAdmin ? <button onClick={() => setNeed({ stage: s.id, need: n })} className={`text-left hover:underline ${n.status === 'done' ? 'line-through text-fg-muted' : ''}`}>{n.description}</button> : <span className={n.status === 'done' ? 'line-through text-fg-muted' : ''}>{n.description}</span>}</td>
                        <td className={`${td} text-right tabular-nums text-caption`}>{n.quantity !== null ? `× ${Number(n.quantity)}` : ''}</td>
                        <td className={`${td} text-right tabular-nums text-caption`}>{n.cost !== null ? short(Number(n.cost)) : '—'}</td>
                        <td className={`${td} text-caption text-fg-muted whitespace-nowrap`}>{n.owner_id ? plan.nameOf(n.owner_id).split(' ')[0] : ''}{n.due_date ? ` · ${dayLabel(n.due_date)}` : ''}</td>
                        <td className={`${td} w-32`}>{isAdmin ? <select value={n.status} onChange={(e) => setNeedStatus(n, e.target.value as StageNeed['status'])} className="input !py-0.5 text-caption"><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select>
                          : <Label tone={n.status === 'done' ? 'success' : n.status === 'doing' ? 'accent' : 'neutral'}>{n.status === 'todo' ? 'To do' : n.status === 'doing' ? 'In progress' : 'Done'}</Label>}</td>
                      </tr>
                    ))}</tbody></table></div> : <p className="text-caption text-fg-muted">Nothing listed yet.</p>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-muted">
                    <span>Budget: {budget ? <Link to={`/company/budgets?b=${budget.id}`} className="link">B{budget.number} {budget.name}</Link> : 'none yet'}{budget && bm ? ` · ${BUDGET_STATUS[budget.status].label} · ${short(bm.approved ?? bm.planned)} · spent ${short(bm.spent)}` : ''}</span>
                    {acts.length > 0 && <span>Marketing: <Link to="/company/marketing" className="link">{acts.length} activit{acts.length === 1 ? 'y' : 'ies'}</Link></span>}
                    {s.owner_id && <span>Responsible: {plan.nameOf(s.owner_id)}</span>}
                  </div>
                </section>
              </li>
            );
          })}
        </ol>
      )}
      {!isAdmin && <p className="mt-3 text-caption text-fg-muted">The MD and full plan access edit the stages. Money gates show "—" for you.</p>}
      {editing && <StageModal growth={growth} plan={plan} stage={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {need && <NeedModal growth={growth} plan={plan} stageId={need.stage} need={need.need} onClose={() => setNeed(null)} />}
    </div>
  );
}

// ================================================================ MARKETING PLAN
export function CompanyMarketing() {
  usePageTitle('Marketing plan');
  const ctx = useCtx();
  const { plan, growth, live, isAdmin, myDept, loading } = ctx;
  const [editing, setEditing] = useState<{ a: Activity | null; need?: MarketingNeed } | null>(null);
  if (loading) return <Loading />;
  const acts = growth.activities.filter((a) => a.status !== 'stopped');
  const canAdd = isAdmin || !!myDept;
  const months = [...new Set(acts.flatMap((a) => monthsOf(a.start_month, a.months)))].sort();
  const why: Record<MarketingNeed, string> = {
    drivers: live.no_driver_pct !== null && live.no_driver_pct !== undefined ? `${live.no_driver_pct}% of requests found no driver in the last 7 days.` : '',
    riders: live.requests_per_day !== null && live.requests_per_day !== undefined ? `${live.requests_per_day} ride requests a day (7-day average).` : '',
    companies: growth.campaigns.length ? `${growth.campaigns.reduce((s, c) => s + c.won, 0)} companies won in outreach campaigns.` : 'No outreach campaign in Growth → Campaigns yet.',
    launch: (() => { const s = growth.stages.find((x) => x.places.length > 1 && x.status !== 'live'); return s ? `Stage S${s.number}: ${STAGE_STATUS[s.status].label.toLowerCase()}${s.target_date ? `, by ${dayLabel(s.target_date)}` : ''}.` : ''; })(),
    brand: '',
  };
  const planned = acts.reduce((s, a) => s + Number(a.planned_cost), 0);
  const spent = acts.reduce((s, a) => s + Number(a.actual_cost ?? 0), 0);
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Megaphone} title="Marketing plan" subtitle="Built from what the company needs — drivers first while riders still find no car, then riders, companies and new towns. Each activity has a cost, a budget and an expected result."
        actions={canAdd && <button onClick={() => setEditing({ a: null })} className="btn-primary"><Plus size={14} /> New activity</button>} />
      <StatGrid cols={4}>
        <StatCard icon={Rocket} label="Activities" value={acts.length} sub={`${acts.filter((a) => a.status === 'running').length} running · ${acts.filter((a) => a.status === 'planned').length} planned`} />
        <StatCard label="Planned cost" value={rwf(planned)} sub={`${acts.filter((a) => !Number(a.planned_cost)).length} without a cost yet`} tone={acts.some((a) => !Number(a.planned_cost)) ? 'attention' : undefined} />
        <StatCard label="Spent" value={rwf(spent)} />
        <StatCard icon={AlertTriangle} label="Without a budget" value={acts.filter((a) => !a.budget_id).length} sub="link each to an approved budget" tone={acts.some((a) => !a.budget_id) ? 'attention' : undefined} />
      </StatGrid>
      {MARKETING_NEEDS.map((n) => {
        const list = acts.filter((a) => a.need === n.key);
        if (!list.length && n.key === 'brand') return null;
        return (
          <section key={n.key} className="mb-5">
            <div className="flex flex-wrap items-end gap-2 mb-2">
              <div className="flex-1"><h2 className="section-title">{n.label}</h2><p className="text-caption text-fg-muted">{n.why} {why[n.key] && <b className="text-fg">{why[n.key]}</b>}</p></div>
              {canAdd && <button onClick={() => setEditing({ a: null, need: n.key })} className="btn-ghost text-caption"><Plus size={12} /> Activity</button>}
            </div>
            {list.length ? (
              <Box padded={false}>
                <div className="overflow-x-auto">
                  <table className="w-full text-body min-w-[860px]">
                    <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Activity', 'Channel', 'When', 'Cost', 'Spent', 'Expected', 'Got', 'Per result', 'Status'].map((h, k) => <th key={h} className={`${th} ${k >= 3 && k <= 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>{list.map((a) => {
                      const camp = growth.campaigns.find((c) => c.id === a.campaign_id);
                      const got = camp ? camp.won : a.actual_value;
                      const perResult = got && Number(got) > 0 ? Number(a.actual_cost ?? a.planned_cost) / Number(got) : a.expected_value && Number(a.planned_cost) ? Number(a.planned_cost) / Number(a.expected_value) : null;
                      const editable = isAdmin || (!!myDept && a.departments.includes(myDept));
                      const budget = plan.budgets.find((b) => b.id === a.budget_id);
                      return (
                        <tr key={a.id} onClick={editable ? () => setEditing({ a }) : undefined} className={`border-t border-line-muted ${editable ? 'cursor-pointer hover:bg-hover/60' : ''}`}>
                          <td className={td}><p className="font-medium">{a.title}</p><p className="text-caption text-fg-muted">{a.departments.map((d) => DEPT_LABEL[d] ?? d).join(', ')}{budget ? ` · B${budget.number}` : ' · no budget'}{camp ? ` · ${camp.name}: ${camp.won} won / ${camp.contacts}` : ''}</p></td>
                          <td className={`${td} text-caption`}>{CHANNEL_LABEL[a.channel] ?? a.channel}</td>
                          <td className={`${td} text-caption whitespace-nowrap`}>{monthsOf(a.start_month, a.months).map((m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short' })).join('–').replace(/–.*–/, '–')}</td>
                          <td className={`${td} text-right tabular-nums`}>{Number(a.planned_cost) ? short(Number(a.planned_cost)) : '—'}</td>
                          <td className={`${td} text-right tabular-nums`}>{a.actual_cost !== null ? short(Number(a.actual_cost)) : '—'}</td>
                          <td className={`${td} text-right tabular-nums text-caption`}>{a.expected_value !== null ? `${Number(a.expected_value).toLocaleString()} ${a.expected_unit ?? ''}` : a.expected_unit ? `? ${a.expected_unit}` : '—'}</td>
                          <td className={`${td} text-right tabular-nums`}>{got !== null && got !== undefined ? Number(got).toLocaleString() : '—'}</td>
                          <td className={`${td} text-right tabular-nums text-caption`}>{perResult !== null ? short(perResult) : '—'}</td>
                          <td className={td}><Label tone={ACTIVITY_STATUS[a.status].tone}>{ACTIVITY_STATUS[a.status].label}</Label></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              </Box>
            ) : <p className="text-small text-fg-muted">Nothing planned for this need yet.</p>}
          </section>
        );
      })}
      {months.length > 0 && (
        <Box title="Month by month" icon={MinusCircle} padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-small min-w-[640px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset"><th className={th}>Activity</th>{months.map((m) => <th key={m} className={`${th} text-center`}>{new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}</th>)}</tr></thead>
              <tbody>{acts.map((a) => { const on = monthsOf(a.start_month, a.months); return (
                <tr key={a.id} className="border-t border-line-muted"><td className={`${td} max-w-[260px] truncate`}>{a.title}</td>{months.map((m) => <td key={m} className="px-1 py-2"><div className={`h-3 rounded ${on.includes(m) ? (a.status === 'running' ? 'bg-accent' : a.status === 'done' ? 'bg-success' : 'bg-accent/40') : ''}`} /></td>)}</tr>
              ); })}</tbody>
            </table>
          </div>
        </Box>
      )}
      {editing && <ActivityModal growth={growth} plan={plan} activity={editing.a} isAdmin={isAdmin} myDept={myDept} defaultNeed={editing.need} onClose={() => setEditing(null)} />}
    </div>
  );
}
