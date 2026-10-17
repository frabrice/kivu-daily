import { ReactNode, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { kigaliToday } from '../../lib/it';
import { DEPARTMENTS, PlanData } from '../../lib/companyPlan';
import {
  ACTIVITY_STATUS, Activity, CHANNELS, GATE_SOURCES, GateSource, GrowthData, MARKETING_NEEDS, MarketingNeed, NEED_KIND, NeedKind, STAGE_STATUS, Stage, StageNeed, StageStatus,
} from '../../lib/companyGrowth';
import Modal from '../Modal';

const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';
const Err = ({ msg }: { msg: string }) => (msg ? <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{msg}</p> : null);
const Foot = ({ onClose, busy, label, onSave, left }: { onClose: () => void; busy: boolean; label: string; onSave: () => void; left?: ReactNode }) => (
  <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
    <div>{left}</div>
    <div className="flex gap-2"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={onSave} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : label}</button></div>
  </div>
);
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.-]/g, '')));

// ------------------------------------------------------------ stage (with its gates)
type GateDraft = { id?: string; title: string; source: GateSource; comparator: '>=' | '<='; target: string; current_value: string; done: boolean };
export function StageModal({ growth, plan, stage, onClose }: { growth: GrowthData; plan: PlanData; stage: Stage | null; onClose: () => void }) {
  const existing = stage ? growth.gates.filter((g) => g.stage_id === stage.id) : [];
  const [f, setF] = useState({ name: stage?.name ?? '', summary: stage?.summary ?? '', places: (stage?.places ?? []).join(', '), status: stage?.status ?? 'planned' as StageStatus, target_date: stage?.target_date ?? '', owner_id: stage?.owner_id ?? '', budget_id: stage?.budget_id ?? '' });
  const [gates, setGates] = useState<GateDraft[]>(existing.map((g) => ({ id: g.id, title: g.title, source: g.source, comparator: g.comparator, target: g.target === null ? '' : String(g.target), current_value: g.current_value === null ? '' : String(g.current_value), done: g.done })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setGate = (i: number, p: Partial<GateDraft>) => setGates((x) => x.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const save = async () => {
    if (!f.name.trim()) { setError('Name the stage.'); return; }
    if (gates.some((g) => !g.title.trim() || (g.source !== 'check' && g.target.trim() === ''))) { setError('Each gate needs a title and a target (except yes/no gates).'); return; }
    setBusy(true); setError('');
    const payload = { name: f.name.trim(), summary: f.summary.trim() || null, places: f.places.split(',').map((x) => x.trim()).filter(Boolean), status: f.status, target_date: f.target_date || null, owner_id: f.owner_id || null, budget_id: f.budget_id || null, updated_at: new Date().toISOString() };
    const res = stage ? await supabase.from('company_expansion_stages').update(payload).eq('id', stage.id).select('id').single() : await supabase.from('company_expansion_stages').insert({ ...payload, sort: growth.stages.length + 1 }).select('id').single();
    if (res.error) { setBusy(false); setError(res.error.message); return; }
    const id = res.data.id as string;
    const keep = gates.filter((g) => g.id).map((g) => g.id!);
    const gone = existing.filter((g) => !keep.includes(g.id)).map((g) => g.id);
    if (gone.length) await supabase.from('company_expansion_gates').delete().in('id', gone);
    for (const [i, g] of gates.entries()) {
      const row = { stage_id: id, title: g.title.trim(), source: g.source, comparator: g.comparator, target: g.source === 'check' ? null : num(g.target), current_value: g.source === 'manual' ? num(g.current_value) : null, done: g.source === 'check' ? g.done : false, sort: i };
      const r = g.id ? await supabase.from('company_expansion_gates').update(row).eq('id', g.id) : await supabase.from('company_expansion_gates').insert(row);
      if (r.error) { setBusy(false); setError(r.error.message); return; }
    }
    setBusy(false); growth.reload(); onClose();
  };
  const remove = async () => { if (!stage || !confirm(`Delete the stage "${stage.name}"?`)) return; await supabase.from('company_expansion_stages').delete().eq('id', stage.id); growth.reload(); onClose(); };
  return (
    <Modal open onClose={onClose} title={stage ? `S${stage.number} · ${stage.name}` : 'New expansion stage'} subtitle="A step of the journey: where, by when, and the gates that must be true before we spend on it." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Stage *</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="input" autoFocus placeholder="e.g. All Rwanda: one town in every province" /></label>
        <label className="block"><span className={lbl}>What it means</span><textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} rows={2} className="input resize-none" /></label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block col-span-2"><span className={lbl}>Places (comma separated)</span><input value={f.places} onChange={(e) => setF({ ...f, places: e.target.value })} className="input" placeholder="Musanze, Rubavu…" /></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StageStatus })} className="input">{(Object.keys(STAGE_STATUS) as StageStatus[]).map((s) => <option key={s} value={s}>{STAGE_STATUS[s].label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Target date</span><input type="date" value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} className="input" /></label>
          <label className="block col-span-2"><span className={lbl}>Responsible</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} className="input"><option value="">—</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block col-span-2"><span className={lbl}>Budget</span><select value={f.budget_id} onChange={(e) => setF({ ...f, budget_id: e.target.value })} className="input"><option value="">No budget yet</option>{plan.budgets.map((b) => <option key={b.id} value={b.id}>B{b.number} · {b.name}</option>)}</select></label>
        </div>
        <div>
          <span className={lbl}>Gates — what must be true before we go</span>
          <div className="space-y-2">
            {gates.map((g, i) => (
              <div key={i} className="rounded-md border border-line-muted p-2 space-y-2">
                <div className="flex gap-2"><input value={g.title} onChange={(e) => setGate(i, { title: e.target.value })} className="input !py-1 text-small" placeholder="e.g. Charging available in each town" />
                  <button type="button" onClick={() => setGates((x) => x.filter((_, j) => j !== i))} className="btn-ghost p-1.5" aria-label="Remove gate"><X size={13} /></button></div>
                <div className="flex flex-wrap items-center gap-2 text-small">
                  <select value={g.source} onChange={(e) => setGate(i, { source: e.target.value as GateSource })} className="input !py-1 !w-auto text-small">{GATE_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                  {g.source === 'check' ? <label className="flex items-center gap-1.5"><input type="checkbox" checked={g.done} onChange={(e) => setGate(i, { done: e.target.checked })} /> true now</label> : <>
                    <select value={g.comparator} onChange={(e) => setGate(i, { comparator: e.target.value as '>=' | '<=' })} className="input !py-1 !w-auto text-small"><option value=">=">at least</option><option value="<=">at most</option></select>
                    <input value={g.target} onChange={(e) => setGate(i, { target: e.target.value })} className="input !py-1 !w-28 text-small" placeholder="target" />
                    {g.source === 'manual' && <label className="flex items-center gap-1.5">now <input value={g.current_value} onChange={(e) => setGate(i, { current_value: e.target.value })} className="input !py-1 !w-24 text-small" /></label>}
                  </>}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setGates((x) => [...x, { title: '', source: 'check', comparator: '>=', target: '', current_value: '', done: false }])} className="btn-ghost text-caption"><Plus size={13} /> Gate</button>
          </div>
        </div>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={stage ? 'Save' : 'Create'} onSave={save} left={stage && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>} />
      </div>
    </Modal>
  );
}

export function NeedModal({ growth, plan, stageId, need, onClose }: { growth: GrowthData; plan: PlanData; stageId: string; need: StageNeed | null; onClose: () => void }) {
  const [f, setF] = useState({ kind: need?.kind ?? 'drivers' as NeedKind, description: need?.description ?? '', quantity: need?.quantity === null || !need ? '' : String(need.quantity), cost: need?.cost === null || !need ? '' : String(need.cost), status: need?.status ?? 'todo' as StageNeed['status'], owner_id: need?.owner_id ?? '', due_date: need?.due_date ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!f.description.trim()) { setError('Say what is needed.'); return; }
    setBusy(true); setError('');
    const row = { stage_id: stageId, kind: f.kind, description: f.description.trim(), quantity: num(f.quantity), cost: num(f.cost), status: f.status, owner_id: f.owner_id || null, due_date: f.due_date || null };
    const res = need ? await supabase.from('company_expansion_needs').update(row).eq('id', need.id) : await supabase.from('company_expansion_needs').insert({ ...row, sort: growth.needs.filter((n) => n.stage_id === stageId).length + 1 });
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    growth.reload(); onClose();
  };
  const remove = async () => { if (!need) return; await supabase.from('company_expansion_needs').delete().eq('id', need.id); growth.reload(); onClose(); };
  return (
    <Modal open onClose={onClose} title={need ? 'Edit need' : 'What this stage needs'} maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>What *</span><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="input" autoFocus /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Kind</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as NeedKind })} className="input">{(Object.keys(NEED_KIND) as NeedKind[]).map((k) => <option key={k} value={k}>{NEED_KIND[k]}</option>)}</select></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StageNeed['status'] })} className="input"><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select></label>
          <label className="block"><span className={lbl}>How many</span><input value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} className="input" inputMode="numeric" /></label>
          <label className="block"><span className={lbl}>Cost (RWF)</span><input value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} className="input" inputMode="numeric" /></label>
          <label className="block"><span className={lbl}>Who</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} className="input"><option value="">—</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block"><span className={lbl}>By</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} className="input" /></label>
        </div>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Save" onSave={save} left={need && <button onClick={remove} className="btn-ghost text-danger text-caption">Remove</button>} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ marketing activity
export function ActivityModal({ growth, plan, activity, isAdmin, myDept, defaultNeed, onClose }: { growth: GrowthData; plan: PlanData; activity: Activity | null; isAdmin: boolean; myDept: string | null; defaultNeed?: MarketingNeed; onClose: () => void }) {
  const firstOfNext = (() => { const d = new Date(`${kigaliToday().slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
  const [f, setF] = useState({
    need: activity?.need ?? defaultNeed ?? 'riders' as MarketingNeed, title: activity?.title ?? '', channel: activity?.channel ?? 'social_ads', description: activity?.description ?? '',
    start_month: activity?.start_month ?? firstOfNext, months: String(activity?.months ?? 1), planned_cost: activity ? String(activity.planned_cost) : '', actual_cost: activity?.actual_cost === null || !activity ? '' : String(activity.actual_cost),
    budget_id: activity?.budget_id ?? '', expected_value: activity?.expected_value === null || !activity ? '' : String(activity.expected_value), expected_unit: activity?.expected_unit ?? '',
    actual_value: activity?.actual_value === null || !activity ? '' : String(activity.actual_value), status: activity?.status ?? 'planned' as Activity['status'], owner_id: activity?.owner_id ?? '',
    departments: activity?.departments ?? (myDept ? [myDept] : ['marketing_sales_bd']), campaign_id: activity?.campaign_id ?? '', stage_id: activity?.stage_id ?? '', notes: activity?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!f.title.trim()) { setError('Name the activity.'); return; }
    if (!f.departments.length) { setError('Choose the department(s) running it.'); return; }
    setBusy(true); setError('');
    const row = {
      need: f.need, title: f.title.trim(), channel: f.channel, description: f.description.trim() || null, start_month: f.start_month, months: Math.max(1, Number(f.months) || 1),
      planned_cost: num(f.planned_cost) ?? 0, actual_cost: num(f.actual_cost), budget_id: f.budget_id || null, expected_value: num(f.expected_value), expected_unit: f.expected_unit.trim() || null,
      actual_value: num(f.actual_value), status: f.status, owner_id: f.owner_id || null, departments: f.departments, campaign_id: f.campaign_id || null, stage_id: f.stage_id || null, notes: f.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const res = activity ? await supabase.from('company_marketing_activities').update(row).eq('id', activity.id) : await supabase.from('company_marketing_activities').insert({ ...row, sort: growth.activities.length + 1 });
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    growth.reload(); onClose();
  };
  const remove = async () => { if (!activity || !confirm(`Delete "${activity.title}"?`)) return; await supabase.from('company_marketing_activities').delete().eq('id', activity.id); growth.reload(); onClose(); };
  return (
    <Modal open onClose={onClose} title={activity ? activity.title : 'New marketing activity'} subtitle="What we do, for which need, what it costs and what it should bring." maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div><span className={lbl}>For which need</span><div className="flex flex-wrap gap-1.5">{MARKETING_NEEDS.map((n) => <button key={n.key} type="button" onClick={() => setF({ ...f, need: n.key })} className={`px-2.5 py-1 rounded-full text-caption border ${f.need === n.key ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{n.label}</button>)}</div></div>
        <label className="block"><span className={lbl}>Activity *</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="input" autoFocus /></label>
        <label className="block"><span className={lbl}>How</span><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} className="input resize-none" /></label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block col-span-2"><span className={lbl}>Channel</span><select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className="input">{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Starts</span><input type="month" value={f.start_month.slice(0, 7)} onChange={(e) => setF({ ...f, start_month: `${e.target.value}-01` })} className="input" /></label>
          <label className="block"><span className={lbl}>Months</span><input value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} className="input" inputMode="numeric" /></label>
          <label className="block"><span className={lbl}>Planned cost (RWF)</span><input value={f.planned_cost} onChange={(e) => setF({ ...f, planned_cost: e.target.value })} className="input" inputMode="numeric" /></label>
          <label className="block"><span className={lbl}>Spent so far</span><input value={f.actual_cost} onChange={(e) => setF({ ...f, actual_cost: e.target.value })} className="input" inputMode="numeric" /></label>
          <label className="block col-span-2"><span className={lbl}>Paid from budget</span><select value={f.budget_id} onChange={(e) => setF({ ...f, budget_id: e.target.value })} className="input"><option value="">No budget yet</option>{plan.budgets.map((b) => <option key={b.id} value={b.id}>B{b.number} · {b.name}</option>)}</select></label>
          <label className="block"><span className={lbl}>Expected</span><input value={f.expected_value} onChange={(e) => setF({ ...f, expected_value: e.target.value })} className="input" inputMode="numeric" /></label>
          <label className="block"><span className={lbl}>of what</span><input value={f.expected_unit} onChange={(e) => setF({ ...f, expected_unit: e.target.value })} className="input" placeholder="new riders" /></label>
          <label className="block"><span className={lbl}>Got so far</span><input value={f.actual_value} onChange={(e) => setF({ ...f, actual_value: e.target.value })} className="input" inputMode="numeric" /></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Activity['status'] })} className="input">{(Object.keys(ACTIVITY_STATUS) as Activity['status'][]).map((s) => <option key={s} value={s}>{ACTIVITY_STATUS[s].label}</option>)}</select></label>
          <label className="block col-span-2"><span className={lbl}>Responsible</span><select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} className="input"><option value="">—</option>{plan.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block col-span-2"><span className={lbl}>Outreach campaign (results counted live)</span><select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })} className="input"><option value="">—</option>{growth.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{!growth.campaigns.length && <span className="text-micro text-fg-subtle">No campaigns in Growth → Campaigns yet.</span>}</label>
          <label className="block col-span-2"><span className={lbl}>Expansion stage</span><select value={f.stage_id} onChange={(e) => setF({ ...f, stage_id: e.target.value })} className="input"><option value="">—</option>{growth.stages.map((s) => <option key={s.id} value={s.id}>S{s.number} · {s.name}</option>)}</select></label>
        </div>
        <div><span className={lbl}>Run by</span><div className="flex flex-wrap gap-1.5">{DEPARTMENTS.filter((d) => isAdmin || d.slug === myDept).map((d) => { const on = f.departments.includes(d.slug); return <button key={d.slug} type="button" onClick={() => setF({ ...f, departments: on ? f.departments.filter((x) => x !== d.slug) : [...f.departments, d.slug] })} className={`px-2.5 py-1 rounded-full text-caption border ${on ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted hover:bg-hover'}`}>{d.label}</button>; })}</div></div>
        <label className="block"><span className={lbl}>Notes</span><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="input" /></label>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={activity ? 'Save' : 'Add'} onSave={save} left={activity && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>} />
      </div>
    </Modal>
  );
}
