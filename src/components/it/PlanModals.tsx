import { ReactNode, useState } from 'react';
import { CheckCircle2, Plus, X, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ItData, PRIORITIES, addDays, kigaliToday } from '../../lib/it';
import {
  BUDGET_CATEGORIES, BudgetCategory, ItBudgetLine, ItInitiative, ItKeyResult, ItObjective, PlanData, lineTotal, nextQuarters, quarterLabel, rwf,
} from '../../lib/itPlan';
import Modal from '../Modal';
import { AreaPicker } from './ItModals';

const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';
const Err = ({ msg }: { msg: string }) => (msg ? <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{msg}</p> : null);
const Foot = ({ onClose, busy, label, onSave, left }: { onClose: () => void; busy: boolean; label: string; onSave: () => void; left?: ReactNode }) => (
  <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
    <div>{left}</div>
    <div className="flex gap-2"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={onSave} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : label}</button></div>
  </div>
);

// ------------------------------------------------------------ initiative
export function InitiativeFormModal({ data, plan, initiative, onClose, onSaved }: { data: ItData; plan: PlanData; initiative: ItInitiative | null; onClose: () => void; onSaved: (id: string) => void }) {
  const t = kigaliToday();
  const [f, setF] = useState({
    name: initiative?.name ?? '', problem: initiative?.problem ?? '', outcome: initiative?.outcome ?? '', objective_id: initiative?.objective_id ?? '',
    owner_id: initiative?.owner_id ?? (data.members.find((m) => m.role === 'head')?.profile_id ?? ''), areas: initiative?.areas ?? [] as string[],
    priority: initiative?.priority ?? 'p2', start_date: initiative?.start_date ?? t, target_date: initiative?.target_date ?? addDays(t, 89),
    horizon: initiative?.horizon ?? 'next', status: initiative?.status ?? 'idea',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const editableStatuses: ItInitiative['status'][] = initiative?.approved_at ? ['approved', 'in_progress', 'on_hold', 'done', 'cancelled'] : ['idea', 'cancelled'];
  const save = async () => {
    if (!f.name.trim()) { setError('Name the project.'); return; }
    if (f.target_date && f.start_date && f.target_date < f.start_date) { setError('The target date is before the start.'); return; }
    setBusy(true); setError('');
    const payload: Record<string, unknown> = {
      name: f.name.trim(), problem: f.problem.trim() || null, outcome: f.outcome.trim() || null, objective_id: f.objective_id || null, owner_id: f.owner_id || null,
      areas: f.areas, priority: f.priority, start_date: f.start_date || null, target_date: f.target_date || null, horizon: f.horizon,
    };
    if (!initiative || f.status !== initiative.status) payload.status = f.status;
    const res = initiative ? await supabase.from('it_initiatives').update(payload).eq('id', initiative.id).select('id').single() : await supabase.from('it_initiatives').insert(payload).select('id').single();
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved(res.data.id); onClose();
  };
  return (
    <Modal open onClose={onClose} title={initiative ? `Edit I${initiative.number}` : 'New project'} subtitle="A big improvement with its own budget. The MD approves it before work starts." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Name *</span><input value={f.name} onChange={(e) => set('name', e.target.value)} className="input" placeholder="e.g. AI-assisted testing" autoFocus /></label>
        <label className="block"><span className={lbl}>The problem — why now</span><textarea value={f.problem} onChange={(e) => set('problem', e.target.value)} rows={3} className="input resize-y" placeholder="What is wrong or missing today, and what it costs us" /></label>
        <label className="block"><span className={lbl}>The outcome — what is true when it's done</span><textarea value={f.outcome} onChange={(e) => set('outcome', e.target.value)} rows={3} className="input resize-y" placeholder="Measurable if possible: crash-free 99.5%, app start under 2 s…" /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Serves the objective</span>
            <select value={f.objective_id} onChange={(e) => set('objective_id', e.target.value)} className="input"><option value="">—</option>{plan.objectives.filter((o) => o.status !== 'dropped').map((o) => <option key={o.id} value={o.id}>{quarterLabel(o.period)} · {o.title}</option>)}</select></label>
          <label className="block"><span className={lbl}>Owner</span><select value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)} className="input"><option value="">—</option>{data.members.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.name}</option>)}</select></label>
        </div>
        <div><span className={lbl}>Areas</span><AreaPicker areas={data.areas} value={f.areas} onChange={(v) => set('areas', v)} /></div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <label className="block"><span className={lbl}>Start</span><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} className="input" /></label>
          <label className="block"><span className={lbl}>Target</span><input type="date" value={f.target_date} min={f.start_date} onChange={(e) => set('target_date', e.target.value)} className="input" /></label>
          <label className="block"><span className={lbl}>Priority</span><select value={f.priority} onChange={(e) => set('priority', e.target.value as ItInitiative['priority'])} className="input">{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Roadmap</span><select value={f.horizon} onChange={(e) => set('horizon', e.target.value as ItInitiative['horizon'])} className="input"><option value="now">Now</option><option value="next">Next</option><option value="later">Later</option></select></label>
          <label className="block"><span className={lbl}>Status</span>
            <select value={f.status} onChange={(e) => set('status', e.target.value as ItInitiative['status'])} className="input">
              {[...new Set([f.status, ...editableStatuses])].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select></label>
        </div>
        {!initiative?.approved_at && <p className="text-caption text-fg-muted">Approval: add the budget lines, then press "Ask the MD to approve" on the project.</p>}
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={initiative ? 'Save' : 'Create project'} onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ budget line
export function BudgetLineModal({ initiativeId, line, onClose, onSaved }: { initiativeId: string; line: ItBudgetLine | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ category: (line?.category ?? 'tools') as BudgetCategory, description: line?.description ?? '', amount: line ? String(line.amount) : '', recurrence: line?.recurrence ?? 'one_off', months: String(line?.months ?? 1), committed: line?.committed ?? false, notes: line?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const amount = Number(f.amount.replace(/[^\d.]/g, '')) || 0;
  const total = lineTotal({ amount, recurrence: f.recurrence as 'one_off' | 'monthly', months: Number(f.months) || 1 } as ItBudgetLine);
  const save = async () => {
    if (!f.description.trim() || !amount) { setError('Describe it and enter an amount.'); return; }
    setBusy(true); setError('');
    const payload = { initiative_id: initiativeId, category: f.category, description: f.description.trim(), amount, recurrence: f.recurrence, months: f.recurrence === 'monthly' ? Math.max(1, Number(f.months) || 1) : 1, committed: f.committed, notes: f.notes.trim() || null };
    const { error: err } = line ? await supabase.from('it_budget_lines').update(payload).eq('id', line.id) : await supabase.from('it_budget_lines').insert(payload);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved(); onClose();
  };
  const remove = async () => { if (!line) return; await supabase.from('it_budget_lines').delete().eq('id', line.id); onSaved(); onClose(); };
  return (
    <Modal open onClose={onClose} title={line ? 'Edit budget line' : 'Add a budget line'} subtitle="In RWF. Spending itself is recorded by Finance against the project." maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Category</span><select value={f.category} onChange={(e) => set('category', e.target.value as BudgetCategory)} className="input">{BUDGET_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Amount (RWF) *</span><input inputMode="numeric" value={f.amount} onChange={(e) => set('amount', e.target.value)} className="input tabular-nums" /></label>
        </div>
        <label className="block"><span className={lbl}>What for *</span><input value={f.description} onChange={(e) => set('description', e.target.value)} className="input" placeholder="e.g. Sentry Team plan, test phones, Gemini API" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Paid</span><select value={f.recurrence} onChange={(e) => set('recurrence', e.target.value as 'one_off' | 'monthly')} className="input"><option value="one_off">Once</option><option value="monthly">Every month</option></select></label>
          {f.recurrence === 'monthly' && <label className="block"><span className={lbl}>For how many months</span><input type="number" min={1} max={60} value={f.months} onChange={(e) => set('months', e.target.value)} className="input" /></label>}
        </div>
        <label className="flex items-center gap-2 text-small"><input type="checkbox" checked={f.committed} onChange={(e) => set('committed', e.target.checked)} /> Committed (ordered or signed, not yet paid)</label>
        <input value={f.notes} onChange={(e) => set('notes', e.target.value)} className="input" placeholder="Note (optional)" aria-label="Note" />
        <p className="text-small">Total: <b className="tabular-nums">{rwf(total)}</b></p>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={line ? 'Save' : 'Add line'} onSave={save} left={line && <button onClick={remove} className="btn-ghost text-caption text-danger">Remove</button>} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ objective + key results
interface KrDraft { id?: string; title: string; unit: string; start_value: string; target_value: string; current_value: string; lower_is_better: boolean }
export function ObjectiveFormModal({ data, objective, keyResults, onClose, onSaved }: { data: ItData; objective: ItObjective | null; keyResults: ItKeyResult[]; onClose: () => void; onSaved: () => void }) {
  const quarters = nextQuarters(5);
  const [f, setF] = useState({ title: objective?.title ?? '', why: objective?.why ?? '', period: objective?.period ?? quarters[0], owner_id: objective?.owner_id ?? '', status: objective?.status ?? 'active' });
  const [krs, setKrs] = useState<KrDraft[]>(keyResults.length ? keyResults.map((k) => ({ id: k.id, title: k.title, unit: k.unit ?? '', start_value: String(k.start_value), target_value: String(k.target_value), current_value: String(k.current_value), lower_is_better: k.lower_is_better }))
    : [{ title: '', unit: '', start_value: '0', target_value: '', current_value: '0', lower_is_better: false }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setKr = (i: number, patch: Partial<KrDraft>) => setKrs((l) => l.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const save = async () => {
    const good = krs.filter((k) => k.title.trim());
    if (!f.title.trim()) { setError('Write the objective.'); return; }
    if (good.some((k) => k.target_value === '' || Number.isNaN(Number(k.target_value)))) { setError('Every key result needs a target number.'); return; }
    setBusy(true); setError('');
    const payload = { title: f.title.trim(), why: f.why.trim() || null, period: f.period, owner_id: f.owner_id || null, status: f.status, updated_at: new Date().toISOString() };
    const res = objective ? await supabase.from('it_objectives').update(payload).eq('id', objective.id).select('id').single() : await supabase.from('it_objectives').insert(payload).select('id').single();
    if (res.error) { setBusy(false); setError(res.error.message); return; }
    const oid = res.data.id as string;
    const keep = good.filter((k) => k.id).map((k) => k.id!);
    const gone = keyResults.filter((k) => !keep.includes(k.id)).map((k) => k.id);
    if (gone.length) await supabase.from('it_key_results').delete().in('id', gone);
    for (const [n, k] of good.entries()) {
      const row = { objective_id: oid, title: k.title.trim(), unit: k.unit.trim() || null, start_value: Number(k.start_value) || 0, target_value: Number(k.target_value), current_value: Number(k.current_value) || 0, lower_is_better: k.lower_is_better, sort: n, updated_at: new Date().toISOString() };
      const { error: err } = k.id ? await supabase.from('it_key_results').update(row).eq('id', k.id) : await supabase.from('it_key_results').insert(row);
      if (err) { setBusy(false); setError(err.message); return; }
    }
    setBusy(false);
    onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={objective ? 'Edit objective' : 'New objective'} subtitle="Where we want to be by the end of the quarter, and the numbers that prove it." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Objective *</span><input value={f.title} onChange={(e) => set('title', e.target.value)} className="input" placeholder="e.g. The most reliable ride app in Kigali" autoFocus /></label>
        <label className="block"><span className={lbl}>Why it matters</span><textarea value={f.why} onChange={(e) => set('why', e.target.value)} rows={2} className="input resize-none" /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className={lbl}>Quarter</span><select value={f.period} onChange={(e) => set('period', e.target.value)} className="input">{[...new Set([f.period, ...quarters])].map((q) => <option key={q} value={q}>{quarterLabel(q)}</option>)}</select></label>
          <label className="block"><span className={lbl}>Owner</span><select value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)} className="input"><option value="">—</option>{data.members.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.name}</option>)}</select></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => set('status', e.target.value as ItObjective['status'])} className="input">{(['draft', 'active', 'achieved', 'missed', 'dropped'] as const).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
        </div>
        <div>
          <span className={lbl}>Key results — measurable, start → target</span>
          <div className="space-y-2">
            {krs.map((k, i) => (
              <div key={i} className="rounded-lg border border-line p-2.5 space-y-2">
                <div className="flex gap-1.5"><input value={k.title} onChange={(e) => setKr(i, { title: e.target.value })} className="input" placeholder="e.g. Crash-free sessions" /><button onClick={() => setKrs((l) => l.filter((_, j) => j !== i))} className="btn-ghost p-2" aria-label="Remove"><X size={14} /></button></div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-center">
                  <input value={k.start_value} onChange={(e) => setKr(i, { start_value: e.target.value })} className="input" placeholder="Start" aria-label="Start" />
                  <input value={k.target_value} onChange={(e) => setKr(i, { target_value: e.target.value })} className="input" placeholder="Target *" aria-label="Target" />
                  <input value={k.current_value} onChange={(e) => setKr(i, { current_value: e.target.value })} className="input" placeholder="Now" aria-label="Current" />
                  <input value={k.unit} onChange={(e) => setKr(i, { unit: e.target.value })} className="input" placeholder="Unit (%, s, trips)" aria-label="Unit" />
                  <label className="flex items-center gap-1.5 text-caption"><input type="checkbox" checked={k.lower_is_better} onChange={(e) => setKr(i, { lower_is_better: e.target.checked })} /> Lower is better</label>
                </div>
              </div>
            ))}
            <button onClick={() => setKrs((l) => [...l, { title: '', unit: '', start_value: '0', target_value: '', current_value: '0', lower_is_better: false }])} className="btn-ghost text-caption"><Plus size={13} /> Add a key result</button>
          </div>
        </div>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={objective ? 'Save' : 'Create objective'} onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ MD decision
export function DecisionModal({ initiative, planned, onClose, onDone }: { initiative: ItInitiative; planned: number; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (approve: boolean) => {
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('decide_it_initiative', { p_id: initiative.id, p_approve: approve, p_note: note });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Decide I${initiative.number} · ${initiative.name}`} subtitle={`Budget asked: ${rwf(planned)}${initiative.approved_budget !== null ? ` (approved before: ${rwf(Number(initiative.approved_budget))})` : ''}`} maxWidth="max-w-md">
      <div className="space-y-3">
        {initiative.problem && <p className="text-small"><b>Problem:</b> {initiative.problem}</p>}
        {initiative.outcome && <p className="text-small"><b>Outcome:</b> {initiative.outcome}</p>}
        <label className="block"><span className={lbl}>{initiative.approved_budget !== null ? 'Note to the team (required to keep the old budget — the project keeps running)' : 'Note to the team (required to decline)'}</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input resize-none" /></label>
        <Err msg={error} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onClose} className="btn-ghost">Later</button>
          <button onClick={() => decide(false)} disabled={busy} className="btn-danger disabled:opacity-50"><XCircle size={14} /> {initiative.approved_budget !== null && !['declined', 'cancelled'].includes(initiative.status) ? `Keep ${rwf(Number(initiative.approved_budget))}` : 'Decline'}</button>
          <button onClick={() => decide(true)} disabled={busy} className="btn-primary disabled:opacity-50"><CheckCircle2 size={14} /> Approve {rwf(planned)}</button>
        </div>
      </div>
    </Modal>
  );
}
