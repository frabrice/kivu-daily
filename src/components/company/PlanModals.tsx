import { ReactNode, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Plus, Trash2, X, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { kigaliToday } from '../../lib/it';
import {
  BUDGET_KINDS, Budget, BudgetKind, BudgetLine, CompanyKr, CompanyObjective, DEPARTMENTS, DEPT_LABEL, HORIZONS, Horizon, KIND, KR_SOURCES, KrSource, OBJECTIVE_STATUS,
  PlanData, PlanMember, Priority, Vision, lineTotal, monthsOf, nextQuarters, quarterLabel, rwf, scoreOf,
} from '../../lib/companyPlan';
import Modal from '../Modal';

const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';
const Err = ({ msg }: { msg: string }) => (msg ? <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{msg}</p> : null);
const Foot = ({ onClose, busy, label, onSave, left }: { onClose: () => void; busy: boolean; label: string; onSave: () => void; left?: ReactNode }) => (
  <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
    <div>{left}</div>
    <div className="flex gap-2"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={onSave} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : label}</button></div>
  </div>
);
function DeptPicker({ value, onChange, only }: { value: string[]; onChange: (v: string[]) => void; only?: string | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DEPARTMENTS.filter((d) => !only || d.slug === only).map((d) => {
        const on = value.includes(d.slug);
        return <button key={d.slug} type="button" onClick={() => onChange(on ? value.filter((x) => x !== d.slug) : [...value, d.slug])} className={`px-2.5 py-1 rounded-full text-caption border ${on ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{d.label}</button>;
      })}
    </div>
  );
}

// ------------------------------------------------------------ vision
export function VisionModal({ vision, onClose, onSaved }: { vision: Vision; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    vision: vision.vision ?? '', mission: vision.mission ?? '', ambition: vision.ambition ?? '', north_star_name: vision.north_star_name,
    north_star_target: vision.north_star_target === null ? '' : String(vision.north_star_target), north_star_target_date: vision.north_star_target_date ?? '', break_even_per_day: String(vision.break_even_per_day),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('company_vision').update({
      vision: f.vision.trim() || null, mission: f.mission.trim() || null, ambition: f.ambition.trim() || null, north_star_name: f.north_star_name.trim() || 'Completed trips per day',
      north_star_target: f.north_star_target.trim() ? Number(f.north_star_target) : null, north_star_target_date: f.north_star_target_date || null,
      break_even_per_day: Number(f.break_even_per_day) || 93, updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Vision & North Star" subtitle="Where Kivu Ride is going, and the one number that tells us if we're getting there." maxWidth="max-w-xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Vision — the world we want to create</span><textarea value={f.vision} onChange={(e) => set('vision', e.target.value)} rows={2} className="input resize-none" placeholder="e.g. Every ride in Rwanda is clean, safe and on time." /></label>
        <label className="block"><span className={lbl}>Mission — what we do every day to get there</span><textarea value={f.mission} onChange={(e) => set('mission', e.target.value)} rows={2} className="input resize-none" /></label>
        <label className="block"><span className={lbl}>In 3 years we are…</span><textarea value={f.ambition} onChange={(e) => set('ambition', e.target.value)} rows={3} className="input resize-none" placeholder="Cities, cars, trips a day, revenue, people…" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2"><span className={lbl}>North Star — the one number</span><input value={f.north_star_name} onChange={(e) => set('north_star_name', e.target.value)} className="input" /></label>
          <label className="block"><span className={lbl}>Target (per day)</span><input value={f.north_star_target} onChange={(e) => set('north_star_target', e.target.value)} className="input" inputMode="numeric" placeholder="e.g. 50" /></label>
          <label className="block"><span className={lbl}>By</span><input type="date" value={f.north_star_target_date} onChange={(e) => set('north_star_target_date', e.target.value)} className="input" /></label>
          <label className="block"><span className={lbl}>Break-even (trips per day)</span><input value={f.break_even_per_day} onChange={(e) => set('break_even_per_day', e.target.value)} className="input" inputMode="numeric" /><span className="text-micro text-fg-subtle">93 = ~3M RWF running cost ÷ 950 RWF per trip (9.5% of 10,000)</span></label>
        </div>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Save" onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ objective
type KrDraft = { id?: string; title: string; unit: string; source: KrSource; start_value: string; target_value: string; current_value: string; lower_is_better: boolean };
export function ObjectiveModal({ plan, objective, onClose }: { plan: PlanData; objective: CompanyObjective | null; onClose: () => void }) {
  const existing = objective ? plan.krs.filter((k) => k.objective_id === objective.id) : [];
  const [f, setF] = useState({
    title: objective?.title ?? '', why: objective?.why ?? '', period: objective?.period ?? nextQuarters(1)[0], owner_id: objective?.owner_id ?? '',
    departments: objective?.departments ?? [] as string[], status: objective?.status ?? 'active' as CompanyObjective['status'],
  });
  const [krs, setKrs] = useState<KrDraft[]>(existing.map((k) => ({ id: k.id, title: k.title, unit: k.unit ?? '', source: k.source, start_value: String(k.start_value), target_value: String(k.target_value), current_value: String(k.current_value), lower_is_better: k.lower_is_better })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setKr = (i: number, patch: Partial<KrDraft>) => setKrs((x) => x.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const save = async () => {
    if (!f.title.trim()) { setError('Give the objective a title.'); return; }
    if (krs.some((k) => !k.title.trim() || k.target_value.trim() === '')) { setError('Each key result needs a title and a target.'); return; }
    setBusy(true); setError('');
    const payload = { title: f.title.trim(), why: f.why.trim() || null, period: f.period, owner_id: f.owner_id || null, departments: f.departments, status: f.status, updated_at: new Date().toISOString() };
    const res = objective ? await supabase.from('company_objectives').update(payload).eq('id', objective.id).select('id').single() : await supabase.from('company_objectives').insert(payload).select('id').single();
    if (res.error) { setBusy(false); setError(res.error.message); return; }
    const id = res.data.id as string;
    const keep = krs.filter((k) => k.id).map((k) => k.id!);
    const gone = existing.filter((k) => !keep.includes(k.id)).map((k) => k.id);
    if (gone.length) await supabase.from('company_key_results').delete().in('id', gone);
    for (const [i, k] of krs.entries()) {
      const row = { objective_id: id, title: k.title.trim(), unit: k.unit.trim() || null, source: k.source, start_value: Number(k.start_value) || 0, target_value: Number(k.target_value), current_value: Number(k.current_value) || 0, lower_is_better: k.lower_is_better, sort: i, updated_at: new Date().toISOString() };
      const r = k.id ? await supabase.from('company_key_results').update(row).eq('id', k.id) : await supabase.from('company_key_results').insert(row);
      if (r.error) { setBusy(false); setError(r.error.message); return; }
    }
    setBusy(false); plan.reload(); onClose();
  };
  const remove = async () => {
    if (!objective || !confirm(`Delete "${objective.title}"?`)) return;
    await supabase.from('company_objectives').delete().eq('id', objective.id); plan.reload(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={objective ? 'Edit objective' : 'New company objective'} subtitle="Where we want the company to be by the end of the quarter, and the numbers that prove it." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Objective *</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="input" autoFocus placeholder="e.g. Win every ride request in Kigali" /></label>
        <label className="block"><span className={lbl}>Why it matters now</span><textarea value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} rows={2} className="input resize-none" /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className={lbl}>Quarter</span><select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} className="input">{[...new Set([f.period, ...nextQuarters(4)])].map((q) => <option key={q} value={q}>{quarterLabel(q)}</option>)}</select></label>
          <label className="block"><span className={lbl}>Owner</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} className="input"><option value="">—</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CompanyObjective['status'] })} className="input">{(Object.keys(OBJECTIVE_STATUS) as CompanyObjective['status'][]).map((s) => <option key={s} value={s}>{OBJECTIVE_STATUS[s].label}</option>)}</select></label>
        </div>
        <div><span className={lbl}>Departments involved</span><DeptPicker value={f.departments} onChange={(v) => setF({ ...f, departments: v })} /></div>
        <div>
          <span className={lbl}>Key results — numbers that prove it</span>
          <div className="space-y-2">
            {krs.map((k, i) => (
              <div key={i} className="rounded-md border border-line-muted p-2 space-y-2">
                <div className="flex gap-2"><input value={k.title} onChange={(e) => setKr(i, { title: e.target.value })} className="input" placeholder="e.g. Completed trips per day" />
                  <button type="button" onClick={() => setKrs((x) => x.filter((_, j) => j !== i))} className="btn-ghost p-2" aria-label="Remove"><X size={14} /></button></div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <label className="block col-span-2"><span className="text-micro text-fg-muted">Measured</span>
                    <select value={k.source} onChange={(e) => { const s = KR_SOURCES.find((x) => x.key === e.target.value)!; setKr(i, { source: s.key, unit: s.unit || k.unit, lower_is_better: s.lowerIsBetter ?? (s.key === 'manual' ? k.lower_is_better : false) }); }} className="input !py-1 text-small">
                      {KR_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
                  <label className="block"><span className="text-micro text-fg-muted">Start</span><input value={k.start_value} onChange={(e) => setKr(i, { start_value: e.target.value })} className="input !py-1 text-small" /></label>
                  <label className="block"><span className="text-micro text-fg-muted">Target</span><input value={k.target_value} onChange={(e) => setKr(i, { target_value: e.target.value })} className="input !py-1 text-small" /></label>
                  {k.source === 'manual' ? <label className="block"><span className="text-micro text-fg-muted">Now</span><input value={k.current_value} onChange={(e) => setKr(i, { current_value: e.target.value })} className="input !py-1 text-small" /></label>
                    : <span className="text-micro text-fg-subtle pb-2">Now: live</span>}
                </div>
                <div className="flex gap-3 text-caption"><input value={k.unit} onChange={(e) => setKr(i, { unit: e.target.value })} className="input !py-1 !w-32 text-small" placeholder="unit" />
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={k.lower_is_better} onChange={(e) => setKr(i, { lower_is_better: e.target.checked })} /> lower is better</label></div>
              </div>
            ))}
            <button type="button" onClick={() => setKrs((x) => [...x, { title: '', unit: '', source: 'manual', start_value: '0', target_value: '', current_value: '0', lower_is_better: false }])} className="btn-ghost text-caption"><Plus size={13} /> Key result</button>
          </div>
        </div>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={objective ? 'Save' : 'Create'} onSave={save} left={objective && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ priority
const SCORES: { key: 'impact_score' | 'confidence_score' | 'ease_score' | 'urgency_score'; label: string; low: string; high: string }[] = [
  { key: 'impact_score', label: 'Impact on the North Star', low: 'small', high: 'huge' },
  { key: 'confidence_score', label: 'Confidence it will work', low: 'a guess', high: 'proven' },
  { key: 'ease_score', label: 'Ease (money, people, time)', low: 'very costly', high: 'cheap & quick' },
  { key: 'urgency_score', label: 'Urgency', low: 'can wait', high: 'now or never' },
];
export function PriorityModal({ plan, priority, isAdmin, myDept, onClose }: { plan: PlanData; priority: Priority | null; isAdmin: boolean; myDept: string | null; onClose: () => void }) {
  const [f, setF] = useState({
    title: priority?.title ?? '', problem: priority?.problem ?? '', expected_impact: priority?.expected_impact ?? '', departments: priority?.departments ?? (myDept ? [myDept] : []) as string[],
    owner_id: priority?.owner_id ?? '', objective_id: priority?.objective_id ?? '', horizon: priority?.horizon ?? 'next' as Horizon, status: priority?.status ?? 'proposed' as Priority['status'],
    impact_score: priority?.impact_score ?? null as number | null, confidence_score: priority?.confidence_score ?? null as number | null, ease_score: priority?.ease_score ?? null as number | null,
    urgency_score: priority?.urgency_score ?? null as number | null, start_date: priority?.start_date ?? '', target_date: priority?.target_date ?? '', notes: priority?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const score = scoreOf({ ...(priority ?? {}), ...f } as Priority);
  const save = async () => {
    if (!f.title.trim()) { setError('Name the priority.'); return; }
    if (!f.departments.length) { setError('Choose at least one department.'); return; }
    setBusy(true); setError('');
    const payload = {
      title: f.title.trim(), problem: f.problem.trim() || null, expected_impact: f.expected_impact.trim() || null, departments: f.departments, owner_id: f.owner_id || null,
      objective_id: f.objective_id || null, horizon: f.horizon, status: isAdmin ? f.status : 'proposed', impact_score: f.impact_score, confidence_score: f.confidence_score,
      ease_score: f.ease_score, urgency_score: f.urgency_score, start_date: f.start_date || null, target_date: f.target_date || null, notes: f.notes.trim() || null, updated_at: new Date().toISOString(),
    };
    const res = priority ? await supabase.from('company_priorities').update(payload).eq('id', priority.id) : await supabase.from('company_priorities').insert({ ...payload, sort: plan.priorities.length + 1 });
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    plan.reload(); onClose();
  };
  const remove = async () => {
    if (!priority || !confirm(`Delete "${priority.title}"?`)) return;
    await supabase.from('company_priorities').delete().eq('id', priority.id); plan.reload(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={priority ? `P${priority.number} · ${priority.title}` : 'New priority'} subtitle={isAdmin ? 'A company bet: what it is, why, and how it scores against the others.' : 'Propose a priority for your department — the MD decides where it goes.'} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Priority *</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="input" autoFocus /></label>
        <label className="block"><span className={lbl}>Why — the problem or opportunity</span><textarea value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} rows={2} className="input resize-none" /></label>
        <label className="block"><span className={lbl}>What changes if we do it (ideally in trips, riders or money)</span><textarea value={f.expected_impact} onChange={(e) => setF({ ...f, expected_impact: e.target.value })} rows={2} className="input resize-none" /></label>
        <div><span className={lbl}>Departments *</span><DeptPicker value={f.departments} onChange={(v) => setF({ ...f, departments: v })} only={isAdmin ? null : myDept} /></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block"><span className={lbl}>Where</span><select value={f.horizon} onChange={(e) => setF({ ...f, horizon: e.target.value as Horizon })} className="input">{HORIZONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}</select></label>
          {isAdmin && <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Priority['status'] })} className="input"><option value="proposed">Proposed</option><option value="active">Active</option><option value="done">Done</option><option value="dropped">Dropped</option></select></label>}
          <label className="block"><span className={lbl}>Start</span><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} className="input" /></label>
          <label className="block"><span className={lbl}>Target date</span><input type="date" value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} className="input" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Owner</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} className="input"><option value="">—</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block"><span className={lbl}>Serves the objective</span><select value={f.objective_id} onChange={(e) => setF({ ...f, objective_id: e.target.value })} className="input"><option value="">—</option>{plan.objectives.filter((o) => o.status !== 'dropped').map((o) => <option key={o.id} value={o.id}>{quarterLabel(o.period)} · {o.title}</option>)}</select></label>
        </div>
        <div className="rounded-md bg-inset p-3">
          <p className="text-caption font-medium text-fg-muted mb-2 flex justify-between"><span>Score it (1–5 each)</span><span className="text-fg">{score === null ? 'Not scored' : `Score ${score}/100`}</span></p>
          <div className="space-y-2">{SCORES.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2 text-small">
              <span className="w-48">{s.label}</span>
              <span className="text-micro text-fg-subtle w-16 text-right">{s.low}</span>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setF({ ...f, [s.key]: f[s.key] === n ? null : n })} className={`w-8 h-8 rounded-md border text-caption ${f[s.key] === n ? 'border-accent bg-accent text-white' : 'border-line hover:bg-hover'}`}>{n}</button>)}
              <span className="text-micro text-fg-subtle">{s.high}</span>
            </div>
          ))}</div>
        </div>
        <label className="block"><span className={lbl}>Notes</span><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className="input resize-none" /></label>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={priority ? 'Save' : isAdmin ? 'Add' : 'Propose'} onSave={save} left={priority && isAdmin && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ budget builder (guided)
interface DraftLine { category: string; description: string; recurrence: 'one_off' | 'monthly'; amount: string; months: string; on: boolean; hint?: string }
export function BudgetWizard({ plan, isAdmin, myDept, me, onClose, onCreated }: { plan: PlanData; isAdmin: boolean; myDept: string | null; me: string; onClose: () => void; onCreated: (id: string) => void }) {
  const firstOfNext = (() => { const d = new Date(`${kigaliToday().slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<BudgetKind | null>(null);
  const [f, setF] = useState({ name: '', department_slug: myDept ?? '', owner_id: me, start_month: firstOfNext, months: '3', goal: '', goalChoice: '', priority_id: '', objective_id: '', expected_result: '', target_value: '', target_unit: '' });
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const k = kind ? KIND[kind] : null;
  const choose = (key: BudgetKind) => {
    const def = KIND[key];
    setKind(key);
    setF((x) => ({ ...x, department_slug: isAdmin ? def.dept ?? x.department_slug : myDept ?? '', name: x.name || `${def.label} budget`, target_unit: def.units[0] ?? '' }));
    setLines(def.items.map((i) => ({ category: i.category, description: i.description, recurrence: i.recurrence, amount: i.amount ? String(i.amount) : '', months: f.months, on: !!i.amount, hint: i.hint })));
    setStep(1);
  };
  const months = Math.max(1, Math.min(36, Number(f.months) || 1));
  const total = lines.filter((l) => l.on).reduce((s, l) => s + lineTotal({ amount: Number(l.amount) || 0, recurrence: l.recurrence, months: Number(l.months) || months }), 0);
  const perMonth = monthsOf(f.start_month, months).map((m, idx) => ({ m, n: lines.filter((l) => l.on).reduce((s, l) => s + (l.recurrence === 'monthly' ? (idx < (Number(l.months) || months) ? Number(l.amount) || 0 : 0) : idx === 0 ? Number(l.amount) || 0 : 0), 0) }));
  const next = () => {
    setError('');
    if (step === 1) {
      if (!f.name.trim()) { setError('Give the budget a name.'); return; }
      if (!isAdmin && !f.department_slug) { setError('Choose the department.'); return; }
      setLines((ls) => ls.map((l) => ({ ...l, months: l.recurrence === 'monthly' ? String(months) : '1' })));
    }
    if (step === 2 && !(f.goal || f.goalChoice).trim()) { setError('Say what this money should achieve.'); return; }
    setStep((s) => s + 1);
  };
  const save = async (submit: boolean) => {
    const chosen = lines.filter((l) => l.on && Number(l.amount) > 0);
    if (!chosen.length) { setError('Add at least one line with an amount.'); return; }
    setBusy(true); setError('');
    const goal = [f.goalChoice, f.goal.trim()].filter(Boolean).join(' — ');
    const res = await supabase.from('company_budgets').insert({
      name: f.name.trim(), kind, department_slug: f.department_slug || null, owner_id: f.owner_id || null, start_month: f.start_month, months, goal: goal || null,
      expected_result: f.expected_result.trim() || null, target_value: f.target_value.trim() ? Number(f.target_value) : null, target_unit: f.target_unit.trim() || null,
      priority_id: f.priority_id || null, objective_id: f.objective_id || null, answers: { goalChoice: f.goalChoice, created_with: 'guided' },
    }).select('id').single();
    if (res.error) { setBusy(false); setError(res.error.message); return; }
    const id = res.data.id as string;
    const { error: lErr } = await supabase.from('company_budget_lines').insert(chosen.map((l, i) => ({ budget_id: id, category: l.category, description: l.description, amount: Number(l.amount), recurrence: l.recurrence, months: l.recurrence === 'monthly' ? Number(l.months) || months : 1, sort: i })));
    if (lErr) { setBusy(false); setError(lErr.message); return; }
    if (submit) { const { error: sErr } = await supabase.rpc('submit_company_budget', { p_id: id }); if (sErr) { setBusy(false); setError(`Saved as a draft, but not submitted: ${sErr.message}`); plan.reload(); onCreated(id); return; } }
    setBusy(false); plan.reload(); onCreated(id); onClose();
  };
  const titles = ['What is it for?', 'The basics', 'What should it achieve?', 'What will it pay for?', 'Check and send'];
  return (
    <Modal open onClose={onClose} title={`New budget · ${titles[step]}`} subtitle={`Step ${step + 1} of 5${k ? ` · ${k.label}` : ''}`} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {step === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {BUDGET_KINDS.filter((x) => isAdmin || !x.dept || x.dept === myDept || x.key === 'other' || x.key === 'marketing').map((x) => (
              <button key={x.key} onClick={() => choose(x.key)} className={`text-left rounded-lg border p-3 hover:border-accent ${kind === x.key ? 'border-accent bg-accent/5' : 'border-line'}`}>
                <p className="text-body font-semibold">{x.label}</p><p className="text-caption text-fg-muted">{x.blurb}</p>
              </button>
            ))}
          </div>
        )}
        {step === 1 && <>
          <label className="block"><span className={lbl}>Name *</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="input" autoFocus placeholder="e.g. November–January rider campaign" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={lbl}>Department</span><select value={f.department_slug} onChange={(e) => setF({ ...f, department_slug: e.target.value })} disabled={!isAdmin} className="input disabled:opacity-70"><option value="">Company-wide</option>{DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}</select></label>
            <label className="block"><span className={lbl}>Responsible</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} className="input"><option value="">—</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="block"><span className={lbl}>Starts in</span><input type="month" value={f.start_month.slice(0, 7)} onChange={(e) => setF({ ...f, start_month: `${e.target.value}-01` })} className="input" /></label>
            <label className="block"><span className={lbl}>For how many months?</span><input value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} className="input" inputMode="numeric" /></label>
          </div>
        </>}
        {step === 2 && k && <>
          {k.goals.length > 0 && <div><span className={lbl}>Main goal</span><div className="flex flex-wrap gap-1.5">{k.goals.map((g) => <button key={g} type="button" onClick={() => setF({ ...f, goalChoice: f.goalChoice === g ? '' : g })} className={`px-2.5 py-1 rounded-full text-caption border ${f.goalChoice === g ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{g}</button>)}</div></div>}
          <label className="block"><span className={lbl}>In your words: what should this money achieve? *</span><textarea value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} rows={2} className="input resize-none" /></label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block"><span className={lbl}>Expected result</span><input value={f.target_value} onChange={(e) => setF({ ...f, target_value: e.target.value })} className="input" inputMode="numeric" placeholder="e.g. 500" /></label>
            <label className="block col-span-2"><span className={lbl}>of what</span><input value={f.target_unit} onChange={(e) => setF({ ...f, target_unit: e.target.value })} list="budget-units" className="input" placeholder="new riders, corporate accounts…" /><datalist id="budget-units">{k.units.map((u) => <option key={u} value={u} />)}</datalist></label>
          </div>
          <label className="block"><span className={lbl}>How will we know it worked?</span><input value={f.expected_result} onChange={(e) => setF({ ...f, expected_result: e.target.value })} className="input" placeholder="e.g. new riders with a promo code, counted in Trips" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={lbl}>Serves the priority</span><select value={f.priority_id} onChange={(e) => setF({ ...f, priority_id: e.target.value })} className="input"><option value="">—</option>{plan.priorities.filter((p) => p.horizon !== 'not_doing' && p.status !== 'dropped').map((p) => <option key={p.id} value={p.id}>P{p.number} · {p.title}</option>)}</select></label>
            <label className="block"><span className={lbl}>and the objective</span><select value={f.objective_id} onChange={(e) => setF({ ...f, objective_id: e.target.value })} className="input"><option value="">—</option>{plan.objectives.filter((o) => o.status !== 'dropped').map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
          </div>
        </>}
        {step === 3 && <>
          <p className="text-caption text-fg-muted">Tick what this budget pays for and fill in the amounts. Monthly amounts are per month. Add anything missing at the bottom.</p>
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {lines.map((l, i) => (
              <div key={i} className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${l.on ? 'border-accent/50 bg-accent/5' : 'border-line-muted'}`}>
                <input type="checkbox" checked={l.on} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} aria-label={`Include ${l.description}`} />
                <input value={l.description} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, description: e.target.value, on: true } : y)))} className="input !py-1 text-small flex-1 min-w-[180px]" />
                <input value={l.amount} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value.replace(/[^\d]/g, ''), on: true } : y)))} className="input !py-1 text-small !w-28 text-right" placeholder="RWF" inputMode="numeric" />
                <select value={l.recurrence} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, recurrence: e.target.value as DraftLine['recurrence'] } : y)))} className="input !py-1 text-small !w-auto"><option value="monthly">/ month</option><option value="one_off">once</option></select>
                {l.recurrence === 'monthly' && <span className="flex items-center gap-1 text-caption text-fg-muted">×<input value={l.months} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, months: e.target.value.replace(/[^\d]/g, '') } : y)))} className="input !py-1 text-small !w-12 text-center" /> mo</span>}
                {l.hint && <span className="text-micro text-fg-subtle w-full pl-6">{l.hint}</span>}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines((x) => [...x, { category: 'Other', description: '', recurrence: 'one_off', amount: '', months: String(months), on: true }])} className="btn-ghost text-caption"><Plus size={13} /> Add a line</button>
          <p className="text-body font-semibold text-right">Total: {rwf(total)}</p>
        </>}
        {step === 4 && <>
          <div className="rounded-md bg-inset p-3 text-small space-y-1">
            <p><b>{f.name}</b> · {k?.label} · {f.department_slug ? DEPT_LABEL[f.department_slug] : 'Company-wide'} · responsible {plan.nameOf(f.owner_id)}</p>
            <p>{months} month{months === 1 ? '' : 's'} from {new Date(`${f.start_month}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
            <p><b>Goal:</b> {[f.goalChoice, f.goal].filter(Boolean).join(' — ')}{f.target_value ? ` · expected ${Number(f.target_value).toLocaleString()} ${f.target_unit}` : ''}</p>
            {f.target_value && Number(f.target_value) > 0 && total > 0 && <p className="text-caption text-fg-muted">= {rwf(total / Number(f.target_value))} per {f.target_unit.replace(/s$/, '') || 'result'}</p>}
          </div>
          <table className="w-full text-small">
            <tbody>{lines.filter((l) => l.on && Number(l.amount) > 0).map((l, i) => (
              <tr key={i} className="border-t border-line-muted"><td className="py-1.5">{l.description}</td><td className="py-1.5 text-caption text-fg-muted">{l.recurrence === 'monthly' ? `${rwf(Number(l.amount))} × ${l.months} mo` : 'once'}</td><td className="py-1.5 text-right tabular-nums">{rwf(lineTotal({ amount: Number(l.amount), recurrence: l.recurrence, months: Number(l.months) || months }))}</td></tr>
            ))}
            <tr className="border-t border-line font-semibold"><td className="py-1.5" colSpan={2}>Total</td><td className="py-1.5 text-right tabular-nums">{rwf(total)}</td></tr></tbody>
          </table>
          <div className="flex flex-wrap gap-1.5 text-micro text-fg-muted">{perMonth.map((p) => <span key={p.m} className="rounded bg-inset px-1.5 py-0.5">{new Date(`${p.m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short' })} {rwf(p.n)}</span>)}</div>
        </>}
        <Err msg={error} />
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
          <button onClick={() => (step ? setStep(step - 1) : onClose())} className="btn-ghost">{step ? <><ArrowLeft size={14} /> Back</> : 'Cancel'}</button>
          {step > 0 && step < 4 && <button onClick={next} className="btn-primary">Next <ArrowRight size={14} /></button>}
          {step === 4 && <div className="flex gap-2">
            <button onClick={() => save(false)} disabled={busy} className="btn-secondary disabled:opacity-50">Save as draft</button>
            <button onClick={() => save(true)} disabled={busy} className="btn-primary disabled:opacity-50"><Check size={14} /> {isAdmin ? 'Save and submit' : 'Send for approval'}</button>
          </div>}
        </div>
      </div>
    </Modal>
  );
}

export function BudgetLineModal({ budgetId, line, defaultMonths, onClose, onSaved }: { budgetId: string; line: BudgetLine | null; defaultMonths: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ category: line?.category ?? '', description: line?.description ?? '', amount: line ? String(line.amount) : '', recurrence: line?.recurrence ?? 'one_off' as BudgetLine['recurrence'], months: String(line?.months ?? defaultMonths), notes: line?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!f.description.trim() || !Number(f.amount)) { setError('Say what it is and the amount.'); return; }
    setBusy(true); setError('');
    const row = { budget_id: budgetId, category: f.category.trim() || 'Other', description: f.description.trim(), amount: Number(f.amount), recurrence: f.recurrence, months: f.recurrence === 'monthly' ? Number(f.months) || 1 : 1, notes: f.notes.trim() || null };
    const res = line ? await supabase.from('company_budget_lines').update(row).eq('id', line.id) : await supabase.from('company_budget_lines').insert(row);
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved(); onClose();
  };
  const remove = async () => { if (!line) return; await supabase.from('company_budget_lines').delete().eq('id', line.id); onSaved(); onClose(); };
  return (
    <Modal open onClose={onClose} title={line ? 'Edit line' : 'Add a line'} maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>What for *</span><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="input" autoFocus /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Category</span><input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="input" /></label>
          <label className="block"><span className={lbl}>Amount (RWF) *</span><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, '') })} className="input" inputMode="numeric" /></label>
          <label className="block"><span className={lbl}>How</span><select value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as BudgetLine['recurrence'] })} className="input"><option value="one_off">Once</option><option value="monthly">Every month</option></select></label>
          {f.recurrence === 'monthly' && <label className="block"><span className={lbl}>Months</span><input value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} className="input" inputMode="numeric" /></label>}
        </div>
        <label className="block"><span className={lbl}>Notes</span><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="input" /></label>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Save" onSave={save} left={line && <button onClick={remove} className="btn-ghost text-danger text-caption"><Trash2 size={13} /> Remove</button>} />
      </div>
    </Modal>
  );
}

export function BudgetDecisionModal({ budget, planned, onClose, onDone }: { budget: Budget; planned: number; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (approve: boolean) => {
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('decide_company_budget', { p_id: budget.id, p_approve: approve, p_note: note });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(); onClose();
  };
  const before = budget.approved_amount !== null;
  return (
    <Modal open onClose={onClose} title={`Decide B${budget.number} · ${budget.name}`} subtitle={`Asked: ${rwf(planned)}${before ? ` (approved before: ${rwf(Number(budget.approved_amount))})` : ''}`} maxWidth="max-w-md">
      <div className="space-y-3">
        {budget.goal && <p className="text-small"><b>Goal:</b> {budget.goal}</p>}
        <label className="block"><span className={lbl}>{before ? 'Note (required to keep the old amount)' : 'Note (required to say no)'}</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input resize-none" /></label>
        <Err msg={error} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onClose} className="btn-ghost">Later</button>
          <button onClick={() => decide(false)} disabled={busy} className="btn-danger disabled:opacity-50"><XCircle size={14} /> {before ? `Keep ${rwf(Number(budget.approved_amount))}` : 'Not approved'}</button>
          <button onClick={() => decide(true)} disabled={busy} className="btn-primary disabled:opacity-50"><CheckCircle2 size={14} /> Approve {rwf(planned)}</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ who sees what (MD)
export function AccessModal({ plan, onClose }: { plan: PlanData; onClose: () => void }) {
  const [rows, setRows] = useState<PlanMember[]>(plan.members);
  const [add, setAdd] = useState({ profile_id: '', access: 'department' as PlanMember['access'], department_slug: '' });
  const [error, setError] = useState('');
  const save = async (m: PlanMember) => {
    setError('');
    const { error: err } = await supabase.from('company_plan_members').upsert({ profile_id: m.profile_id, access: m.access, department_slug: m.access === 'full' ? null : m.department_slug }, { onConflict: 'profile_id' });
    if (err) setError(err.message); else { setRows((x) => [...x.filter((y) => y.profile_id !== m.profile_id), m]); plan.reload(); }
  };
  const remove = async (id: string) => { await supabase.from('company_plan_members').delete().eq('profile_id', id); setRows((x) => x.filter((y) => y.profile_id !== id)); plan.reload(); };
  return (
    <Modal open onClose={onClose} title="Who sees the company plan" subtitle="Full access sees everything (you always do). A department head sees the vision and objectives, and only their own department's priorities and budgets." maxWidth="max-w-xl">
      <div className="space-y-3">
        <ul className="divide-y divide-line-muted">
          {rows.map((m) => (
            <li key={m.profile_id} className="flex flex-wrap items-center gap-2 py-2 text-small">
              <span className="flex-1 min-w-[160px] font-medium">{plan.nameOf(m.profile_id)}</span>
              <select value={m.access} onChange={(e) => save({ ...m, access: e.target.value as PlanMember['access'], department_slug: m.department_slug ?? 'admin' })} className="input !py-1 !w-auto text-small"><option value="full">Full access</option><option value="department">Department head</option></select>
              {m.access === 'department' && <select value={m.department_slug ?? ''} onChange={(e) => save({ ...m, department_slug: e.target.value })} className="input !py-1 !w-auto text-small">{DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}</select>}
              <button onClick={() => remove(m.profile_id)} className="btn-ghost p-1.5" aria-label="Remove"><X size={13} /></button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-line-muted">
          <label className="block flex-1 min-w-[180px]"><span className={lbl}>Add someone</span><select value={add.profile_id} onChange={(e) => { const p = plan.people.find((x) => x.id === e.target.value); setAdd({ ...add, profile_id: e.target.value, department_slug: p?.dept ?? add.department_slug }); }} className="input"><option value="">Choose…</option>{plan.people.filter((p) => !rows.some((r) => r.profile_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <select value={add.access} onChange={(e) => setAdd({ ...add, access: e.target.value as PlanMember['access'] })} className="input !w-auto"><option value="department">Department head</option><option value="full">Full access</option></select>
          {add.access === 'department' && <select value={add.department_slug} onChange={(e) => setAdd({ ...add, department_slug: e.target.value })} className="input !w-auto"><option value="">Department…</option>{DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}</select>}
          <button disabled={!add.profile_id || (add.access === 'department' && !add.department_slug)} onClick={() => { save({ profile_id: add.profile_id, access: add.access, department_slug: add.access === 'full' ? null : add.department_slug }); setAdd({ profile_id: '', access: 'department', department_slug: '' }); }} className="btn-primary disabled:opacity-50"><Plus size={14} /> Add</button>
        </div>
        <Err msg={error} />
        <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Done</button></div>
      </div>
    </Modal>
  );
}
export type { CompanyKr };
