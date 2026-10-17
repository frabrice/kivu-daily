import { ReactNode, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ItData, addDays, kigaliToday } from '../../lib/it';
import { DECISION_STATUS, DecisionStatus, ItDecision, ItRelease, PLATFORMS, Platform, ReleaseStatus, defaultChecklist } from '../../lib/itReview';
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

// ------------------------------------------------------------ release
export function ReleaseFormModal({ data, release, releases, onClose, onSaved }: { data: ItData; release: ItRelease | null; releases: ItRelease[]; onClose: () => void; onSaved: (id: string) => void }) {
  const last = (p: Platform) => releases.filter((r) => r.platform === p && r.status !== 'cancelled').sort((a, b) => b.number - a.number)[0];
  const bump = (v: string | undefined) => { const m = v?.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/); return m ? `${m[1]}.${Number(m[2]) + 1}.0` : ''; };
  const active = data.milestones.filter((m) => m.status !== 'cancelled' && m.status !== 'completed').sort((a, b) => a.end_date.localeCompare(b.end_date));
  const [f, setF] = useState({
    platform: release?.platform ?? 'app' as Platform, version: release?.version ?? bump(last('app')?.version), name: release?.name ?? '',
    milestone_id: release?.milestone_id ?? active[0]?.id ?? '', planned_date: release?.planned_date ?? (active[0]?.end_date ?? addDays(kigaliToday(), 13)),
    owner_id: release?.owner_id ?? (data.members.find((m) => m.role === 'head')?.profile_id ?? ''), status: release?.status ?? 'planned' as ReleaseStatus,
    rollback_reason: release?.rollback_reason ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.version.trim()) { setError('Give it a version number, e.g. 2.5.0.'); return; }
    if (f.status === 'rolled_back' && !f.rollback_reason.trim()) { setError('Say why it was rolled back.'); return; }
    setBusy(true); setError('');
    const payload = {
      platform: f.platform, version: f.version.trim(), name: f.name.trim() || null, milestone_id: f.milestone_id || null, planned_date: f.planned_date || null,
      owner_id: f.owner_id || null, status: f.status, rollback_reason: f.status === 'rolled_back' ? f.rollback_reason.trim() : null,
      ...(release ? {} : { checklist: defaultChecklist(f.platform) }),
    };
    const res = release ? await supabase.from('it_releases').update(payload).eq('id', release.id).select('id').single() : await supabase.from('it_releases').insert(payload).select('id').single();
    setBusy(false);
    if (res.error) { setError(res.error.message.includes('duplicate') ? `There is already a ${f.platform} release ${f.version}.` : res.error.message); return; }
    onSaved(res.data.id); onClose();
  };
  const remove = async () => {
    if (!release || !confirm(`Delete release ${release.version}? Its issues stay, they just leave the release.`)) return;
    const { error: err } = await supabase.from('it_releases').delete().eq('id', release.id);
    if (err) setError(err.message); else { onSaved(''); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={release ? `Edit R${release.number} · ${release.version}` : 'New release'} subtitle="A version that goes out to riders, drivers or staff, with what it ships and a checklist before it goes." maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>What *</span>
            <select value={f.platform} onChange={(e) => { const p = e.target.value as Platform; setF((x) => ({ ...x, platform: p, version: release ? x.version : bump(last(p)?.version) })); }} className="input" disabled={!!release && release.status === 'released'}>
              {PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select></label>
          <label className="block"><span className={lbl}>Version *</span><input value={f.version} onChange={(e) => set('version', e.target.value)} className="input font-mono" placeholder="2.5.0" />
            {!release && last(f.platform) && <span className="text-micro text-fg-subtle">Last: {last(f.platform)!.version}</span>}</label>
        </div>
        <label className="block"><span className={lbl}>Name (optional)</span><input value={f.name} onChange={(e) => set('name', e.target.value)} className="input" placeholder="e.g. Partner promo codes" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Milestone</span><select value={f.milestone_id} onChange={(e) => set('milestone_id', e.target.value)} className="input"><option value="">—</option>{data.milestones.filter((m) => m.status !== 'cancelled').map((m) => <option key={m.id} value={m.id}>M{m.number} · {m.name}</option>)}</select></label>
          <label className="block"><span className={lbl}>Planned for</span><input type="date" value={f.planned_date} onChange={(e) => set('planned_date', e.target.value)} className="input" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Release owner</span><select value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)} className="input"><option value="">—</option>{data.members.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.name}</option>)}</select></label>
          {release && <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => set('status', e.target.value as ReleaseStatus)} className="input">
            <option value="planned">Planned</option><option value="testing">Testing</option><option value="released">Released</option>
            {release.status === 'released' || release.status === 'rolled_back' ? <option value="rolled_back">Rolled back</option> : null}<option value="cancelled">Cancelled</option>
          </select></label>}
        </div>
        {f.status === 'rolled_back' && <label className="block"><span className={lbl}>Why was it rolled back? *</span><textarea value={f.rollback_reason} onChange={(e) => set('rollback_reason', e.target.value)} rows={2} className="input resize-none" /></label>}
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={release ? 'Save' : 'Create release'} onSave={save} left={release && release.status !== 'released' && <button onClick={remove} className="btn-ghost text-danger text-caption">Delete</button>} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ decision
export function DecisionFormModal({ data, decision, decisions, isLead, defaults, onClose, onSaved }: {
  data: ItData; decision: ItDecision | null; decisions: ItDecision[]; isLead: boolean; defaults?: Partial<ItDecision>; onClose: () => void; onSaved: (id: string) => void;
}) {
  const [f, setF] = useState({
    title: decision?.title ?? defaults?.title ?? '', context: decision?.context ?? '', decision: decision?.decision ?? '', options: decision?.options ?? '',
    consequences: decision?.consequences ?? '', areas: decision?.areas ?? [] as string[], status: decision?.status ?? (isLead ? 'decided' : 'proposed') as DecisionStatus,
    issue_id: decision?.issue_id ? String(decision.issue_id) : defaults?.issue_id ? String(defaults.issue_id) : '', superseded_by: decision?.superseded_by ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.title.trim()) { setError('What is the decision about?'); return; }
    if (f.status === 'decided' && !f.decision.trim()) { setError('Write what was decided.'); return; }
    const issue = f.issue_id.trim().replace(/^KR-/i, '');
    if (issue && !data.issues.some((i) => String(i.id) === issue)) { setError(`There is no issue KR-${issue}.`); return; }
    setBusy(true); setError('');
    const payload = {
      title: f.title.trim(), context: f.context.trim() || null, decision: f.decision.trim() || null, options: f.options.trim() || null, consequences: f.consequences.trim() || null,
      areas: f.areas, status: f.status, issue_id: issue ? Number(issue) : null, superseded_by: f.status === 'superseded' ? f.superseded_by || null : null,
    };
    const res = decision ? await supabase.from('it_decisions').update(payload).eq('id', decision.id).select('id').single() : await supabase.from('it_decisions').insert(payload).select('id').single();
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved(res.data.id); onClose();
  };
  return (
    <Modal open onClose={onClose} title={decision ? `D${decision.number} · ${decision.title}` : 'Record a decision'} subtitle="So nobody asks again in three months why we did it this way." maxWidth="max-w-xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Decision about *</span><input value={f.title} onChange={(e) => set('title', e.target.value)} className="input" placeholder="e.g. Payments go through Pesapal only" autoFocus /></label>
        <label className="block"><span className={lbl}>Context — why did we have to decide?</span><textarea value={f.context} onChange={(e) => set('context', e.target.value)} rows={2} className="input resize-none" /></label>
        <label className="block"><span className={lbl}>What we decided{f.status === 'decided' ? ' *' : ''}</span><textarea value={f.decision} onChange={(e) => set('decision', e.target.value)} rows={2} className="input resize-none" /></label>
        <label className="block"><span className={lbl}>Other options we looked at</span><textarea value={f.options} onChange={(e) => set('options', e.target.value)} rows={2} className="input resize-none" /></label>
        <label className="block"><span className={lbl}>Consequences — what follows, what we accept</span><textarea value={f.consequences} onChange={(e) => set('consequences', e.target.value)} rows={2} className="input resize-none" /></label>
        <div><span className={lbl}>Areas</span><AreaPicker areas={data.areas} value={f.areas} onChange={(v) => set('areas', v)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Status</span>
            <select value={f.status} onChange={(e) => set('status', e.target.value as DecisionStatus)} className="input" disabled={!isLead}>
              {(Object.keys(DECISION_STATUS) as DecisionStatus[]).map((s) => <option key={s} value={s}>{DECISION_STATUS[s].label}</option>)}
            </select>
            {!isLead && <span className="text-micro text-fg-subtle">The head of IT or the MD decides it.</span>}</label>
          <label className="block"><span className={lbl}>Related issue</span><input value={f.issue_id} onChange={(e) => set('issue_id', e.target.value)} className="input font-mono" placeholder="KR-123" /></label>
        </div>
        {f.status === 'superseded' && <label className="block"><span className={lbl}>Replaced by</span><select value={f.superseded_by} onChange={(e) => set('superseded_by', e.target.value)} className="input"><option value="">—</option>{decisions.filter((d) => d.id !== decision?.id).map((d) => <option key={d.id} value={d.id}>D{d.number} · {d.title}</option>)}</select></label>}
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={decision ? 'Save' : 'Record'} onSave={save} />
      </div>
    </Modal>
  );
}
