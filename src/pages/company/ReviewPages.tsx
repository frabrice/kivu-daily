import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Code2, Download, FileText, Gavel, Landmark, Lock, Map as MapIcon, Pencil, Plus, Search, Target, Wallet } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { dayLabel, kigaliToday, when } from '../../lib/it';
import { BUDGET_STATUS, DEPT_LABEL, OBJECTIVE_STATUS, budgetMoney, krProgress, krValue, liveValues, quarterOf, scoreOf, usePlan } from '../../lib/companyPlan';
import { FUNDING_STATUS, incomeNow, latestCash, useMoney } from '../../lib/companyMoney';
import { STAGE_STATUS, gateMet, useGrowth } from '../../lib/companyGrowth';
import {
  CompanyDecision, DECISION_STATUS, DecisionStatus, MonthlyReview, SPENT_LABEL, monthEnd, monthStart, monthTitle, shiftMonth, snapshotOf, useDecisions, useReview,
} from '../../lib/companyReview';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import { CompanyDecisionModal } from '../../components/company/ReviewModals';

// Company plan, phase 4: the monthly partners' review (one page + PDF) and
// the company decisions log.

const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(Math.abs(n) % 1e6 ? 1 : 0)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
const pctDelta = (now: number, before: number | undefined) => (before ? `${now >= before ? '▲' : '▼'} ${Math.abs(Math.round(((now - before) / before) * 100))}% vs last month` : '');
type NoteKey = 'highlights' | 'problems' | 'next_focus' | 'notes';
const NOTE_FIELDS: { key: NoteKey; label: string; hint: string }[] = [
  { key: 'highlights', label: 'Highlights', hint: 'What went well this month.' },
  { key: 'problems', label: 'Problems & risks', hint: 'What went wrong, what worries us, what needs a decision.' },
  { key: 'next_focus', label: 'Focus for next month', hint: 'The 3 things that matter most.' },
  { key: 'notes', label: 'Other notes', hint: 'Anything else said in the meeting.' },
];

// ================================================================ MONTHLY REVIEW
export function CompanyReview() {
  usePageTitle('Monthly review');
  const { profile } = useAuth();
  const a = useAccess();
  const [params, setParams] = useSearchParams();
  const today = kigaliToday();
  const defaultMonth = Number(today.slice(8, 10)) <= 10 ? shiftMonth(today, -1) : monthStart(today);
  const month = monthStart(params.get('month') ?? defaultMonth);
  const plan = usePlan();
  const money = useMoney();
  const growth = useGrowth();
  const r = useReview(month);
  const [deciding, setDeciding] = useState<CompanyDecision | 'new' | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState('');
  const commission = Number(money.settings?.commission_pct ?? 9.5);
  const s = useMemo(() => (r.facts ? snapshotOf(month, r.facts, commission, today) : null), [r.facts, month, commission, today]);
  const p = useMemo(() => (r.prev ? snapshotOf(shiftMonth(month, -1), r.prev, commission, today) : null), [r.prev, month, commission, today]);
  const live = useMemo(() => {
    const t = liveValues(plan.trips);
    const inc = money.live && money.settings ? incomeNow(money.live, money.settings) : null;
    return { ...t, monthly_surplus: inc && money.settings ? inc.recurring - Number(money.settings.monthly_costs) : null, managed_cars: money.live ? Number(money.live.managed_cars) : null };
  }, [plan.trips, money.live, money.settings]);
  if (a.plan !== 'full') return <EmptyState icon={Lock} title="The monthly review is for the MD and full plan access" />;
  if (plan.loading || money.loading || growth.loading || r.loading || !s || !r.facts) return <Loading />;
  const review = r.review;
  const f = r.facts;
  const by = f.own_income_by_type ?? {};
  const cash = latestCash(money.checks.filter((c) => c.checked_on <= monthEnd(month)));
  const q = quarterOf(monthEnd(month) < today ? monthEnd(month) : today);
  const objectives = plan.objectives.filter((o) => o.period === q && o.status !== 'dropped').map((o) => {
    const krs = plan.krs.filter((k) => k.objective_id === o.id);
    return { o, pct: krs.length ? Math.round(krs.reduce((t, k) => t + krProgress(k, krValue(k, live)), 0) / krs.length) : 0 };
  });
  const now = plan.priorities.filter((x) => x.horizon === 'now' && x.status !== 'dropped').sort((x, y) => (scoreOf(y) ?? -1) - (scoreOf(x) ?? -1));
  const stages = growth.stages.filter((x) => x.status !== 'dropped').map((st) => { const g = growth.gates.filter((x) => x.stage_id === st.id); return { st, met: g.filter((x) => gateMet(x, live) === true).length, total: g.length }; });
  const budgets = plan.budgets.filter((b) => b.status !== 'rejected').map((b) => ({ b, m: budgetMoney(b, plan.lines, plan.spend), monthSpent: plan.spend.filter((x) => x.company_budget_id === b.id && x.transaction_date >= month && x.transaction_date <= monthEnd(month)).reduce((t, x) => t + Number(x.amount), 0) }));
  const monthDecisions = r.decisions.filter((d) => d.decided_at && d.decided_at >= month && d.decided_at <= monthEnd(month));
  const open = r.decisions.filter((d) => d.status === 'proposed');
  const people = [...new Set([...plan.people.filter((x) => plan.members.some((m) => m.profile_id === x.id)).map((x) => x.id), ...plan.people.filter((x) => x.id === profile?.id).map((x) => x.id)])];
  const save = async (patch: Partial<MonthlyReview>) => {
    setError('');
    const { error: err } = await supabase.from('company_monthly_reviews').upsert({ month, ...patch, updated_by: profile?.id, updated_at: new Date().toISOString() }, { onConflict: 'month' });
    if (err) setError(err.message); else r.reload();
  };
  const toggle = (id: string) => { const cur = review?.attendees ?? []; save({ attendees: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); };
  const markHeld = () => save({ held_at: new Date().toISOString(), held_by: profile?.id, snapshot: s, attendees: review?.attendees?.length ? review.attendees : people });
  const pdf = async () => {
    setPdfBusy(true);
    try {
      const { companyReviewPdfBlob } = await import('../../lib/companyReviewPdf');
      const blob = await companyReviewPdfBlob({
        month, s, prev: p, facts: f, review, nameOf: plan.nameOf,
        objectives: objectives.map(({ o, pct }) => ({ title: o.title, pct, status: OBJECTIVE_STATUS[o.status].label })),
        priorities: now.map((x) => ({ label: `P${x.number} ${x.title}`, score: scoreOf(x) })),
        stages: stages.map(({ st, met, total }) => ({ name: `S${st.number} ${st.name}`, status: STAGE_STATUS[st.status].label, gates: total ? `${met}/${total}` : '—', target: st.target_date ? dayLabel(st.target_date, true) : '—' })),
        budgets: budgets.map(({ b, m }) => ({ name: `B${b.number} ${b.name}`, status: BUDGET_STATUS[b.status].label, approved: m.approved, spent: m.spent })),
        funding: money.funding.filter((x) => x.status !== 'lost').map((x) => ({ name: `F${x.number} ${x.name}`, status: FUNDING_STATUS[x.status].label, amount: x.amount === null ? null : Number(x.amount) })),
        decisions: monthDecisions, cash: cash.list.length ? { own: cash.own, asOf: cash.asOf ? dayLabel(cash.asOf, true) : null } : null,
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = `Kivu-Ride-monthly-review-${month.slice(0, 7)}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } finally { setPdfBusy(false); }
  };
  const thisMonth = monthStart(today);
  return (
    <div className="animate-fade-in">
      <PageHeader icon={CalendarCheck} title="Monthly review" subtitle="The partners' meeting on one page: trips, money, objectives, priorities, expansion, IT, decisions — and the notes."
        labels={review?.held_at ? <Label tone="success">Held {dayLabel(review.held_at)}</Label> : month === thisMonth ? <Label tone="info">Month in progress</Label> : <Label>Not held</Label>}
        actions={<>
          <div className="flex items-center gap-1">
            <button onClick={() => setParams({ month: shiftMonth(month, -1) })} className="btn-ghost p-1.5" aria-label="Previous month"><ChevronLeft size={16} /></button>
            <span className="text-small font-medium min-w-[120px] text-center">{monthTitle(month)}</span>
            <button onClick={() => setParams({ month: shiftMonth(month, 1) })} disabled={month >= thisMonth} className="btn-ghost p-1.5 disabled:opacity-30" aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
          <button onClick={pdf} disabled={pdfBusy} className="btn-secondary"><Download size={14} /> {pdfBusy ? 'Making PDF…' : 'PDF'}</button>
          {!review?.held_at && <button onClick={markHeld} className="btn-primary"><CheckCircle2 size={14} /> Mark as held</button>}
        </>} />
      {error && <p className="mb-3 text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
      <StatGrid cols={5}>
        <StatCard label="Completed trips / day" value={s.perDay} sub={`${s.completed} trips · ${pctDelta(s.perDay, p?.perDay)}`} />
        <StatCard label="Requests completed" value={s.completionPct === null ? '—' : `${s.completionPct}%`} sub={`${s.noDriverPct ?? 0}% found no driver`} tone={(s.completionPct ?? 0) < 70 ? 'attention' : undefined} />
        <StatCard icon={Landmark} label="Own income" value={rwf(s.ownRecurring)} sub={pctDelta(s.ownRecurring, p?.ownRecurring) || 'margins, fees, commission'} />
        <StatCard label="Out (ledger)" value={rwf(s.spentTotal)} sub={`${rwf(s.budgetSpent)} from budgets`} />
        <StatCard icon={Wallet} label="Cash (own)" value={cash.list.length ? rwf(cash.own) : '—'} sub={cash.asOf ? `as of ${dayLabel(cash.asOf)}` : 'not recorded — Money page'} />
      </StatGrid>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Box title="Own income" icon={Landmark} padded={false}>
              <table className="w-full text-small"><tbody>
                {[['Managed cars — our margin', Number(by.management_margin ?? 0), p?.managedMargin], ['Management fees & other revenue', Number(by.revenue ?? 0), undefined], ['App commission (estimate)', s.commission, p?.commission], ['Onboarding fees (one-off)', Number(by.onboarding_fee ?? 0), undefined]].map(([k, v, before]) => (
                  <tr key={k as string} className="border-t border-line-muted first:border-t-0"><td className="px-3 py-2">{k}</td><td className="px-3 py-2 text-right tabular-nums">{rwf(v as number)}</td><td className="px-3 py-2 text-right text-caption text-fg-muted w-24">{before !== undefined ? pctDelta(v as number, before as number).replace(' vs last month', '') : ''}</td></tr>
                ))}
                <tr className="border-t border-line font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{rwf(s.ownIncome)}</td><td /></tr>
              </tbody></table>
            </Box>
            <Box title="Out, in the ledger" icon={Wallet} padded={false}>
              <table className="w-full text-small"><tbody>
                {Object.entries(f.spent_by_type ?? {}).map(([k, v]) => <tr key={k} className="border-t border-line-muted first:border-t-0"><td className="px-3 py-2">{SPENT_LABEL[k] ?? k.replace(/_/g, ' ')}</td><td className="px-3 py-2 text-right tabular-nums">{rwf(Number(v))}</td></tr>)}
                {!Object.keys(f.spent_by_type ?? {}).length && <tr><td className="px-3 py-4 text-fg-muted">Nothing recorded.</td></tr>}
              </tbody></table>
              <p className="px-3 py-2 text-caption text-fg-muted border-t border-line-muted">Owner payouts are owners' money passing through. Salaries and rent appear here only when Finance records them.</p>
            </Box>
          </div>
          <Box title="Objectives" icon={Target} right={<Link to="/company/objectives" className="text-caption link">Open</Link>}>
            {objectives.length ? <ul className="space-y-2">{objectives.map(({ o, pct }) => (
              <li key={o.id} className="text-small"><div className="flex items-center gap-2"><span className="flex-1">{o.title}</span><Label tone={OBJECTIVE_STATUS[o.status].tone}>{OBJECTIVE_STATUS[o.status].label}</Label><b className="tabular-nums w-10 text-right">{pct}%</b></div>
                <div className="h-1.5 rounded-full bg-inset overflow-hidden mt-1"><div className="h-full bg-success" style={{ width: `${pct}%` }} /></div></li>
            ))}</ul> : <p className="text-small text-fg-muted">No objectives for this quarter.</p>}
          </Box>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Box title={`Now (${now.length})`} icon={Target} right={<Link to="/company/priorities" className="text-caption link">Open</Link>}>
              {now.length > 5 && <p className="mb-2 text-caption rounded bg-attention-muted px-2 py-1">{now.length} things in Now — pick 3–5.</p>}
              <ul className="space-y-1 text-small">{now.map((x) => <li key={x.id} className="flex gap-2"><span className="font-mono text-caption text-fg-muted">P{x.number}</span><span className="flex-1">{x.title}</span><span className="text-caption tabular-nums">{scoreOf(x) ?? '—'}</span></li>)}</ul>
            </Box>
            <Box title="Expansion" icon={MapIcon} right={<Link to="/company/expansion" className="text-caption link">Open</Link>}>
              <ul className="space-y-1.5 text-small">{stages.map(({ st, met, total }) => (
                <li key={st.id} className="flex flex-wrap items-center gap-2"><span className="flex-1">S{st.number} {st.name}</span><Label tone={STAGE_STATUS[st.status].tone}>{STAGE_STATUS[st.status].label}</Label><span className="text-caption text-fg-muted">{total ? `${met}/${total} gates` : ''}{st.target_date ? ` · ${dayLabel(st.target_date)}` : ''}</span></li>
              ))}</ul>
            </Box>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Box title="Budgets" icon={Wallet} right={<Link to="/company/budgets" className="text-caption link">Open</Link>}>
              {budgets.length ? <ul className="space-y-1 text-small">{budgets.map(({ b, m, monthSpent }) => (
                <li key={b.id} className="flex flex-wrap gap-2"><span className="flex-1">B{b.number} {b.name}</span><Label tone={BUDGET_STATUS[b.status].tone}>{BUDGET_STATUS[b.status].label}</Label><span className="text-caption text-fg-muted tabular-nums">{short(m.approved ?? m.planned)} · {short(monthSpent)} this month</span></li>
              ))}</ul> : <p className="text-small text-fg-muted">No budgets yet.</p>}
            </Box>
            <Box title="Funding" icon={Landmark} right={<Link to="/company/money?tab=funding" className="text-caption link">Open</Link>}>
              <ul className="space-y-1 text-small">{money.funding.filter((x) => x.status !== 'lost').map((x) => (
                <li key={x.id} className="flex flex-wrap gap-2"><span className="flex-1">F{x.number} {x.name}</span><Label tone={FUNDING_STATUS[x.status].tone}>{FUNDING_STATUS[x.status].label}</Label><span className="text-caption tabular-nums text-fg-muted">{x.amount ? short(Number(x.amount)) : '—'}</span></li>
              ))}</ul>
            </Box>
          </div>
          <Box title="IT & product" icon={Code2}>
            <p className="text-small mb-2"><b>{f.it.issues_done}</b> issues done ({f.it.bugs_fixed} bugs fixed) · {f.it.releases.length ? <>released <b>{f.it.releases.map((x) => x.name).join(', ')}</b></> : 'no release'}{f.it.milestones_completed.length ? <> · completed {f.it.milestones_completed.join(', ')}</> : ''}</p>
            <ul className="space-y-1 text-small">{f.it.milestones_active.map((m) => (
              <li key={m.name} className="flex items-center gap-2"><span className="flex-1">{m.name}</span><span className="w-28"><span className="block h-1.5 rounded-full bg-inset overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${m.total ? (m.done / m.total) * 100 : 0}%` }} /></span></span><span className="text-caption tabular-nums w-24 text-right">{m.done}/{m.total} · {dayLabel(m.end)}</span></li>
            ))}</ul>
          </Box>
        </div>
        <div className="space-y-4">
          <Box title="Meeting notes" icon={FileText}>
            <p className="text-caption font-medium text-fg-muted mb-1.5">Who's here</p>
            <div className="flex flex-wrap gap-1.5 mb-3">{people.map((id) => { const on = review?.attendees.includes(id); return <button key={id} onClick={() => toggle(id)} className={`px-2.5 py-1 rounded-full text-caption border ${on ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{plan.nameOf(id).split(' ')[0]}</button>; })}</div>
            <div className="space-y-3">{NOTE_FIELDS.map((n) => <NoteField key={`${month}-${n.key}`} label={n.label} hint={n.hint} value={review?.[n.key] ?? ''} onSave={(v) => save({ [n.key]: v || null })} />)}</div>
            {review?.updated_at && <p className="text-micro text-fg-subtle mt-2">Saved {when(review.updated_at)} by {plan.nameOf(review.updated_by)}</p>}
          </Box>
          <Box title={`Decisions this month (${monthDecisions.length})`} icon={Gavel} right={<button onClick={() => setDeciding('new')} className="btn-ghost text-caption"><Plus size={13} /> Record</button>}>
            {monthDecisions.length ? <ul className="space-y-2">{monthDecisions.map((d) => <li key={d.id} className="text-small"><button onClick={() => setDeciding(d)} className="text-left hover:underline font-medium">D{d.number} · {d.title}</button>{d.decision && <p className="text-caption text-fg-muted line-clamp-2">{d.decision}</p>}</li>)}</ul>
              : <p className="text-small text-fg-muted">None recorded. Decided something in the meeting? Record it.</p>}
            {open.length > 0 && <p className="mt-2 text-caption"><Link to="/company/decisions" className="link">{open.length} waiting to be decided</Link></p>}
          </Box>
          {r.reviews.some((x) => x.held_at && x.month !== month) && (
            <Box title="Past reviews">
              <ul className="space-y-1 text-small">{r.reviews.filter((x) => x.held_at && x.month !== month).slice(0, 12).map((x) => (
                <li key={x.month}><button onClick={() => setParams({ month: x.month })} className="link">{monthTitle(x.month)}</button>{x.snapshot && <span className="text-caption text-fg-muted"> · {x.snapshot.perDay} trips/day, {short(x.snapshot.ownRecurring)} income</span>}</li>
              ))}</ul>
            </Box>
          )}
        </div>
      </div>
      {deciding && <CompanyDecisionModal plan={plan} decision={deciding === 'new' ? null : deciding} decisions={r.decisions} extra={{ funding: money.funding, stages: growth.stages }} onClose={() => setDeciding(null)} onSaved={r.reload} />}
    </div>
  );
}

function NoteField({ label, hint, value, onSave }: { label: string; hint: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block"><span className="block text-caption font-medium text-fg-muted">{label}</span>
      <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} rows={3} className="input resize-y text-small" placeholder={hint} /></label>
  );
}

// ================================================================ DECISIONS LOG
export function CompanyDecisions() {
  usePageTitle('Company decisions');
  const a = useAccess();
  const plan = usePlan();
  const { decisions, loading, reload } = useDecisions();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | DecisionStatus>('all');
  const [editing, setEditing] = useState<CompanyDecision | 'new' | null>(null);
  const isAdmin = a.plan === 'full';
  if (loading || plan.loading) return <Loading />;
  const openId = params.get('d');
  const list = decisions.filter((d) => (filter === 'all' || d.status === filter) && (!q || `${d.title} ${d.context ?? ''} ${d.decision ?? ''} D${d.number}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Gavel} title="Company decisions" subtitle="What the company decided, why, what else we considered and what follows — so nobody has to remember it."
        actions={isAdmin && <button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> Record a decision</button>} />
      {!isAdmin && <p className="mb-3 text-caption text-fg-muted flex items-center gap-1"><Lock size={12} /> You see the decisions that involve {DEPT_LABEL[a.planDept ?? ''] ?? 'your department'}.</p>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search decisions…" /></div>
        {(['all', 'proposed', 'decided', 'superseded', 'reversed'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-2.5 py-1 rounded-full text-caption border ${filter === s ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{s === 'all' ? 'All' : DECISION_STATUS[s].label} <span className="tabular-nums">{s === 'all' ? decisions.length : decisions.filter((d) => d.status === s).length}</span></button>
        ))}
      </div>
      {!list.length ? <EmptyState icon={Gavel} title={decisions.length ? 'No decision matches' : 'No decisions yet'} /> : (
        <div className="space-y-2">{list.map((d) => {
          const isOpen = openId === d.id;
          const sup = d.superseded_by ? decisions.find((x) => x.id === d.superseded_by) : null;
          const prio = plan.priorities.find((x) => x.id === d.priority_id);
          const budget = plan.budgets.find((x) => x.id === d.budget_id);
          return (
            <section key={d.id} className={`card ${isOpen ? 'border-line-strong' : ''}`}>
              <button onClick={() => setParams(isOpen ? {} : { d: d.id })} className="w-full flex flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-hover/50">
                <span className="font-mono text-caption text-fg-muted">D{d.number}</span>
                <span className="text-body font-semibold flex-1 min-w-[200px]">{d.title}</span>
                {d.departments.map((x) => <Label key={x}>{DEPT_LABEL[x] ?? x}</Label>)}
                <Label tone={DECISION_STATUS[d.status].tone}>{DECISION_STATUS[d.status].label}</Label>
                <span className="text-caption text-fg-muted whitespace-nowrap">{d.decided_at ? `${plan.nameOf(d.decided_by).split(' ')[0]} · ${dayLabel(d.decided_at, true)}` : ''}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-small border-t border-line-muted">
                  {[['Context', d.context], ['What we decided', d.decision], ['Options considered', d.options], ['What follows', d.consequences]].map(([k, v]) => (
                    <div key={k as string}><p className="text-caption font-medium text-fg-muted mb-0.5">{k}</p><p className="whitespace-pre-line">{v || <span className="text-fg-subtle">—</span>}</p></div>
                  ))}
                  <div className="md:col-span-2 flex flex-wrap items-center gap-3 text-caption text-fg-muted">
                    {prio && <span>Priority: P{prio.number} {prio.title}</span>}
                    {budget && <Link to={`/company/budgets?b=${budget.id}`} className="link">B{budget.number} {budget.name}</Link>}
                    {sup && <button onClick={() => setParams({ d: sup.id })} className="link">Replaced by D{sup.number}</button>}
                    <span className="flex-1" />
                    {isAdmin && <button onClick={() => setEditing(d)} className="btn-secondary text-caption"><Pencil size={12} /> Edit</button>}
                  </div>
                </div>
              )}
            </section>
          );
        })}</div>
      )}
      {editing && <CompanyDecisionModal plan={plan} decision={editing === 'new' ? null : editing} decisions={decisions} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
