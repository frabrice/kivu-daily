import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { kigaliToday } from '../../lib/it';
import { DEPARTMENTS, PlanData } from '../../lib/companyPlan';
import { CompanyDecision, DECISION_STATUS, DecisionStatus } from '../../lib/companyReview';
import Modal from '../Modal';

const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';

export function CompanyDecisionModal({ plan, decision, decisions, extra, onClose, onSaved }: {
  plan: PlanData; decision: CompanyDecision | null; decisions: CompanyDecision[]; extra?: { funding: { id: string; number: number; name: string }[]; stages: { id: string; number: number; name: string }[] };
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    title: decision?.title ?? '', context: decision?.context ?? '', decision: decision?.decision ?? '', options: decision?.options ?? '', consequences: decision?.consequences ?? '',
    departments: decision?.departments ?? [] as string[], status: decision?.status ?? 'decided' as DecisionStatus, decided_by: decision?.decided_by ?? '', decided_at: decision?.decided_at ?? kigaliToday(),
    priority_id: decision?.priority_id ?? '', budget_id: decision?.budget_id ?? '', funding_id: decision?.funding_id ?? '', stage_id: decision?.stage_id ?? '', superseded_by: decision?.superseded_by ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!f.title.trim()) { setError('What is the decision about?'); return; }
    if (f.status === 'decided' && !f.decision.trim()) { setError('Write what was decided.'); return; }
    setBusy(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const row = {
      title: f.title.trim(), context: f.context.trim() || null, decision: f.decision.trim() || null, options: f.options.trim() || null, consequences: f.consequences.trim() || null,
      departments: f.departments, status: f.status, decided_by: f.status === 'proposed' ? null : f.decided_by || user?.id || null, decided_at: f.status === 'proposed' ? null : f.decided_at || kigaliToday(),
      priority_id: f.priority_id || null, budget_id: f.budget_id || null, funding_id: f.funding_id || null, stage_id: f.stage_id || null, superseded_by: f.status === 'superseded' ? f.superseded_by || null : null,
      updated_at: new Date().toISOString(),
    };
    const res = decision ? await supabase.from('company_decisions').update(row).eq('id', decision.id) : await supabase.from('company_decisions').insert(row);
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved(); onClose();
  };
  const remove = async () => { if (!decision || !confirm(`Delete D${decision.number}?`)) return; await supabase.from('company_decisions').delete().eq('id', decision.id); onSaved(); onClose(); };
  return (
    <Modal open onClose={onClose} title={decision ? `D${decision.number} · ${decision.title}` : 'Record a company decision'} subtitle="So the partners, the team and future hires know what was decided, and why." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Decision about *</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="input" autoFocus /></label>
        <label className="block"><span className={lbl}>Context — why we had to decide</span><textarea value={f.context} onChange={(e) => setF({ ...f, context: e.target.value })} rows={2} className="input resize-none" /></label>
        <label className="block"><span className={lbl}>What we decided{f.status === 'decided' ? ' *' : ''}</span><textarea value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })} rows={2} className="input resize-none" /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Other options considered</span><textarea value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} rows={2} className="input resize-none" /></label>
          <label className="block"><span className={lbl}>What follows</span><textarea value={f.consequences} onChange={(e) => setF({ ...f, consequences: e.target.value })} rows={2} className="input resize-none" /></label>
        </div>
        <div><span className={lbl}>Departments it involves (their heads will see it)</span><div className="flex flex-wrap gap-1.5">{DEPARTMENTS.map((d) => { const on = f.departments.includes(d.slug); return <button key={d.slug} type="button" onClick={() => setF({ ...f, departments: on ? f.departments.filter((x) => x !== d.slug) : [...f.departments, d.slug] })} className={`px-2.5 py-1 rounded-full text-caption border ${on ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{d.label}</button>; })}</div></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as DecisionStatus })} className="input">{(Object.keys(DECISION_STATUS) as DecisionStatus[]).map((s) => <option key={s} value={s}>{DECISION_STATUS[s].label}</option>)}</select></label>
          {f.status !== 'proposed' && <>
            <label className="block"><span className={lbl}>Decided by</span><select value={f.decided_by} onChange={(e) => setF({ ...f, decided_by: e.target.value })} className="input"><option value="">Me</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="block"><span className={lbl}>On</span><input type="date" value={f.decided_at} onChange={(e) => setF({ ...f, decided_at: e.target.value })} className="input" /></label>
          </>}
          {f.status === 'superseded' && <label className="block sm:col-span-3"><span className={lbl}>Replaced by</span><select value={f.superseded_by} onChange={(e) => setF({ ...f, superseded_by: e.target.value })} className="input"><option value="">—</option>{decisions.filter((d) => d.id !== decision?.id).map((d) => <option key={d.id} value={d.id}>D{d.number} · {d.title}</option>)}</select></label>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Priority</span><select value={f.priority_id} onChange={(e) => setF({ ...f, priority_id: e.target.value })} className="input"><option value="">—</option>{plan.priorities.map((p) => <option key={p.id} value={p.id}>P{p.number} · {p.title}</option>)}</select></label>
          <label className="block"><span className={lbl}>Budget</span><select value={f.budget_id} onChange={(e) => setF({ ...f, budget_id: e.target.value })} className="input"><option value="">—</option>{plan.budgets.map((b) => <option key={b.id} value={b.id}>B{b.number} · {b.name}</option>)}</select></label>
          {extra && <>
            <label className="block"><span className={lbl}>Funding source</span><select value={f.funding_id} onChange={(e) => setF({ ...f, funding_id: e.target.value })} className="input"><option value="">—</option>{extra.funding.map((x) => <option key={x.id} value={x.id}>F{x.number} · {x.name}</option>)}</select></label>
            <label className="block"><span className={lbl}>Expansion stage</span><select value={f.stage_id} onChange={(e) => setF({ ...f, stage_id: e.target.value })} className="input"><option value="">—</option>{extra.stages.map((x) => <option key={x.id} value={x.id}>S{x.number} · {x.name}</option>)}</select></label>
          </>}
        </div>
        {error && <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
          <div>{decision && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>}</div>
          <div className="flex gap-2"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : decision ? 'Save' : 'Record'}</button></div>
        </div>
      </div>
    </Modal>
  );
}
