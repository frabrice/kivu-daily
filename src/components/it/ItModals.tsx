import { useMemo, useState } from 'react';
import { CheckCircle2, Lightbulb, Plus, Search, Send, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  ItArea, ItData, ItInboxItem, ItIssue, ItMilestone, IssueStatus, IssueType, PRIORITIES, Priority, SIZES, STATUSES, Size, TYPES, addDays, isOpen, keyOf, kigaliToday,
} from '../../lib/it';
import Modal from '../Modal';
import { Label } from '../../ui/kit';

const lbl = 'block text-caption font-medium mb-1.5 text-fg-muted';
const Err = ({ msg }: { msg: string }) => (msg ? <p className="text-caption text-danger bg-danger-muted rounded-md px-3 py-2">{msg}</p> : null);
const Foot = ({ onClose, busy, label, onSave, disabled, left }: { onClose: () => void; busy: boolean; label: string; onSave: () => void; disabled?: boolean; left?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-muted">
    <div>{left}</div>
    <div className="flex gap-2">
      <button onClick={onClose} className="btn-ghost">Cancel</button>
      <button onClick={onSave} disabled={busy || disabled} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : label}</button>
    </div>
  </div>
);

export function AreaPicker({ areas, value, onChange }: { areas: ItArea[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {areas.map((a) => {
        const on = value.includes(a.key);
        return (
          <button key={a.key} type="button" title={a.hint ?? undefined} onClick={() => onChange(on ? value.filter((x) => x !== a.key) : [...value, a.key])} aria-pressed={on}
            className={`px-2.5 py-1 rounded-full text-caption border ${on ? 'border-accent bg-accent/15 text-fg font-medium' : 'border-line text-fg-muted hover:bg-hover'}`}>{a.label}</button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ issue
export function IssueFormModal({ data, issue, isLead, me, defaults, onClose, onSaved }: {
  data: ItData; issue: ItIssue | null; isLead: boolean; me: string; defaults?: Partial<ItIssue>; onClose: () => void; onSaved: (id: number) => void;
}) {
  const base = issue ?? defaults ?? {};
  const [f, setF] = useState({
    title: base.title ?? '', description: base.description ?? '', type: (base.type ?? 'feature') as IssueType, areas: base.areas ?? [] as string[],
    priority: (base.priority ?? 'p2') as Priority, size: (base.size ?? '') as Size | '', status: (base.status ?? (isLead ? 'backlog' : 'in_progress')) as IssueStatus,
    assignee_id: base.assignee_id ?? (isLead ? '' : me), milestone_id: base.milestone_id ?? '', due_date: base.due_date ?? '', labels: (base.labels ?? []).join(', '),
    github_url: base.github_url ?? '', criteria: (base.acceptance_criteria ?? []).map((c) => c.text),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const openMilestones = data.milestones.filter((m) => m.status === 'planned' || m.status === 'active' || m.id === f.milestone_id);
  const save = async () => {
    if (!f.title.trim()) { setError('Give the issue a short title.'); return; }
    if (!f.areas.length) { setError('Choose at least one area it touches.'); return; }
    setBusy(true); setError('');
    const payload: Record<string, unknown> = {
      title: f.title.trim(), description: f.description.trim() || null, type: f.type, areas: f.areas, size: f.size || null, status: f.status,
      assignee_id: f.assignee_id || null, due_date: f.due_date || null, labels: f.labels.split(',').map((x) => x.trim()).filter(Boolean),
      github_url: f.github_url.trim() || null, acceptance_criteria: f.criteria.map((t) => t.trim()).filter(Boolean).map((text) => ({ text, done: (issue?.acceptance_criteria ?? []).find((c) => c.text === text)?.done ?? false })),
    };
    if (isLead || !issue) { payload.priority = f.priority; payload.milestone_id = f.milestone_id || null; }
    const res = issue ? await supabase.from('it_issues').update(payload).eq('id', issue.id).select('id').single() : await supabase.from('it_issues').insert(payload).select('id').single();
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved(res.data.id);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={issue ? `Edit ${keyOf(issue.id)}` : 'New issue'} subtitle={issue ? issue.title : isLead ? 'Planned work' : 'Your own work is shown as unplanned until the head of IT plans it.'} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Title *</span><input value={f.title} onChange={(e) => set('title', e.target.value)} className="input" placeholder="What needs to be done, in a few words" autoFocus /></label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block"><span className={lbl}>Type</span><select value={f.type} onChange={(e) => set('type', e.target.value as IssueType)} className="input">{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Priority</span><select value={f.priority} disabled={!!issue && !isLead} onChange={(e) => set('priority', e.target.value as Priority)} className="input disabled:opacity-60">{PRIORITIES.map((p) => <option key={p.key} value={p.key} title={p.help}>{p.label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Size</span><select value={f.size} onChange={(e) => set('size', e.target.value as Size | '')} className="input"><option value="">Not sized</option>{SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => set('status', e.target.value as IssueStatus)} className="input">{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        </div>
        <div><span className={lbl}>Areas it touches *</span><AreaPicker areas={data.areas} value={f.areas} onChange={(v) => set('areas', v)} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block"><span className={lbl}>Assignee</span>
            <select value={f.assignee_id} onChange={(e) => set('assignee_id', e.target.value)} className="input">
              <option value="">Nobody yet</option>
              {data.members.filter((m) => isLead || m.profile_id === me || m.profile_id === f.assignee_id).map((m) => <option key={m.profile_id} value={m.profile_id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block"><span className={lbl}>Milestone</span>
            <select value={f.milestone_id} disabled={!isLead} onChange={(e) => set('milestone_id', e.target.value)} className="input disabled:opacity-60">
              <option value="">No milestone</option>{openMilestones.map((m) => <option key={m.id} value={m.id}>M{m.number} · {m.name}</option>)}
            </select>
          </label>
          <label className="block"><span className={lbl}>Due</span><input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} className="input" /></label>
        </div>
        <label className="block"><span className={lbl}>Description</span><textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={4} className="input resize-y" placeholder="The problem, who it affects, what done looks like" /></label>
        <div>
          <span className={lbl}>Done when… (acceptance criteria)</span>
          <div className="space-y-1.5">
            {f.criteria.map((c, i) => (
              <div key={i} className="flex gap-1.5">
                <input value={c} onChange={(e) => set('criteria', f.criteria.map((x, j) => (j === i ? e.target.value : x)))} className="input" placeholder="e.g. A rider sees the discount before confirming" />
                <button type="button" onClick={() => set('criteria', f.criteria.filter((_, j) => j !== i))} className="btn-ghost p-2" aria-label="Remove"><X size={14} /></button>
              </div>
            ))}
            <button type="button" onClick={() => set('criteria', [...f.criteria, ''])} className="btn-ghost text-caption"><Plus size={13} /> Add a criterion</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Labels</span><input value={f.labels} onChange={(e) => set('labels', e.target.value)} className="input" placeholder="comma, separated" /></label>
          <label className="block"><span className={lbl}>GitHub link (issue or pull request)</span><input value={f.github_url} onChange={(e) => set('github_url', e.target.value)} className="input" placeholder="https://github.com/…" /></label>
        </div>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={issue ? 'Save' : 'Create issue'} onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ milestone
export function MilestoneFormModal({ data, milestone, onClose, onSaved }: { data: ItData; milestone: ItMilestone | null; onClose: () => void; onSaved: (id: string) => void }) {
  const last = data.milestones.filter((m) => m.status !== 'cancelled').sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
  const start0 = milestone?.start_date ?? (last && last.end_date >= kigaliToday() ? addDays(last.end_date, 1) : kigaliToday());
  const [f, setF] = useState({
    name: milestone?.name ?? '', goal: milestone?.goal ?? '', start_date: start0, end_date: milestone?.end_date ?? addDays(start0, 13),
    status: milestone?.status ?? 'planned', owner_id: milestone?.owner_id ?? (data.members.find((m) => m.role === 'head')?.profile_id ?? ''),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const days = Math.round((Date.parse(f.end_date) - Date.parse(f.start_date)) / 86400000) + 1;
  const save = async () => {
    if (!f.name.trim()) { setError('Give the milestone a name.'); return; }
    if (f.end_date < f.start_date) { setError('The end date is before the start.'); return; }
    setBusy(true); setError('');
    const payload = { name: f.name.trim(), goal: f.goal.trim() || null, start_date: f.start_date, end_date: f.end_date, status: f.status, owner_id: f.owner_id || null, updated_at: new Date().toISOString(),
      ...(f.status === 'completed' && milestone?.status !== 'completed' ? { completed_at: new Date().toISOString() } : {}) };
    const res = milestone ? await supabase.from('it_milestones').update(payload).eq('id', milestone.id).select('id').single() : await supabase.from('it_milestones').insert(payload).select('id').single();
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved(res.data.id); onClose();
  };
  return (
    <Modal open onClose={onClose} title={milestone ? `Edit M${milestone.number}` : 'New milestone'} subtitle="Time-boxed: what ships between the start and the end date. 2 weeks by default." maxWidth="max-w-lg">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>Name *</span><input value={f.name} onChange={(e) => set('name', e.target.value)} className="input" placeholder="e.g. Driver wallet & withdrawals" autoFocus /></label>
        <label className="block"><span className={lbl}>Goal — what is true when it's done</span><textarea value={f.goal} onChange={(e) => set('goal', e.target.value)} rows={2} className="input resize-none" /></label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block"><span className={lbl}>Start *</span><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} className="input" /></label>
          <label className="block"><span className={lbl}>End *</span><input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set('end_date', e.target.value)} className="input" /></label>
          <label className="block"><span className={lbl}>Status</span><select value={f.status} onChange={(e) => set('status', e.target.value as ItMilestone['status'])} className="input"><option value="planned">Planned</option><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
          <label className="block"><span className={lbl}>Owner</span><select value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)} className="input"><option value="">—</option>{data.members.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.name}</option>)}</select></label>
        </div>
        <p className="text-caption text-fg-muted">{days > 0 ? `${days} days · ${Math.round(days / 7 * 10) / 10} weeks` : ''}
          {[7, 14, 21, 28].map((n) => <button key={n} type="button" onClick={() => set('end_date', addDays(f.start_date, n - 1))} className="ml-2 link">{n / 7} wk</button>)}</p>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={milestone ? 'Save' : 'Create milestone'} onSave={save} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ triage
export function TriageModal({ data, item, onClose, onDone }: { data: ItData; item: ItInboxItem; onClose: () => void; onDone: (issueId: number | null) => void }) {
  const [action, setAction] = useState<'accept' | 'merge' | 'park' | 'decline'>('accept');
  const [f, setF] = useState({ title: item.title, type: 'improvement' as IssueType, areas: [] as string[], priority: 'p2' as Priority, size: '' as Size | '', assignee_id: '', milestone_id: '' });
  const [merge, setMerge] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const candidates = useMemo(() => {
    const n = q.trim().toLowerCase();
    const words = item.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    return data.issues.filter(isOpen).map((i) => ({ i, score: n ? (`${keyOf(i.id)} ${i.title}`.toLowerCase().includes(n) ? 10 : 0) : words.filter((w) => i.title.toLowerCase().includes(w)).length }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.i);
  }, [q, item.title, data.issues]);
  const run = async () => {
    if (action === 'accept' && !f.areas.length) { setError('Choose at least one area.'); return; }
    if (action === 'merge' && !merge) { setError('Choose the issue to merge into.'); return; }
    if (action === 'decline' && !note.trim()) { setError('Say why — the person who asked will see it.'); return; }
    setBusy(true); setError('');
    const { data: id, error: err } = await supabase.rpc('triage_it_inbox', {
      p_id: item.id, p_action: action, p_note: note,
      p_issue: action === 'accept' ? { ...f, size: f.size || null, assignee_id: f.assignee_id || null, milestone_id: f.milestone_id || null } : null,
      p_merge_into: action === 'merge' ? Number(merge) : null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone((id as number | null) ?? null); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Triage request" subtitle={`From ${data.nameOf(item.submitted_by)}${item.entity_label ? ` · about ${item.entity_label}` : ''}`} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="rounded-lg bg-inset p-3">
          <p className="text-body font-medium">{item.title}</p>
          {item.details && <p className="text-small text-fg-muted mt-1 whitespace-pre-line">{item.details}</p>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {([['accept', 'Accept → issue'], ['merge', 'Merge into issue'], ['park', 'Park for later'], ['decline', 'Decline']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setAction(k)} aria-pressed={action === k} className={`px-2.5 py-2 rounded-lg border text-small ${action === k ? 'border-accent bg-accent/10 font-medium' : 'border-line text-fg-muted hover:bg-hover'}`}>{l}</button>
          ))}
        </div>
        {action === 'accept' && (
          <div className="space-y-3">
            <label className="block"><span className={lbl}>Issue title</span><input value={f.title} onChange={(e) => set('title', e.target.value)} className="input" /></label>
            <div><span className={lbl}>Areas *</span><AreaPicker areas={data.areas} value={f.areas} onChange={(v) => set('areas', v)} /></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <label className="block"><span className={lbl}>Type</span><select value={f.type} onChange={(e) => set('type', e.target.value as IssueType)} className="input">{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
              <label className="block"><span className={lbl}>Priority</span><select value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)} className="input">{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
              <label className="block"><span className={lbl}>Size</span><select value={f.size} onChange={(e) => set('size', e.target.value as Size | '')} className="input"><option value="">—</option>{SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
              <label className="block"><span className={lbl}>Assignee</span><select value={f.assignee_id} onChange={(e) => set('assignee_id', e.target.value)} className="input"><option value="">Nobody yet</option>{data.members.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.name}</option>)}</select></label>
              <label className="block sm:col-span-2"><span className={lbl}>Milestone</span><select value={f.milestone_id} onChange={(e) => set('milestone_id', e.target.value)} className="input"><option value="">Backlog (no milestone)</option>{data.milestones.filter((m) => m.status === 'planned' || m.status === 'active').map((m) => <option key={m.id} value={m.id}>M{m.number} · {m.name}</option>)}</select></label>
            </div>
          </div>
        )}
        {action === 'merge' && (
          <div className="space-y-2">
            <label className="relative block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Search open issues (similar ones are suggested)" /></label>
            <div className="space-y-1">
              {candidates.map((i) => (
                <label key={i.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-small cursor-pointer ${merge === String(i.id) ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
                  <input type="radio" checked={merge === String(i.id)} onChange={() => setMerge(String(i.id))} /><span className="font-mono text-caption">{keyOf(i.id)}</span>{i.title}
                </label>
              ))}
              {!candidates.length && <p className="text-caption text-fg-muted">No similar open issue — search by words or KR number.</p>}
            </div>
          </div>
        )}
        <label className="block"><span className={lbl}>{action === 'decline' ? 'Why? * (they will see it)' : 'Note (optional, they will see it)'}</span><input value={note} onChange={(e) => setNote(e.target.value)} className="input" /></label>
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label={{ accept: 'Create issue', merge: 'Merge', park: 'Park', decline: 'Decline' }[action]} onSave={run} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ "what are you working on?"
export function CheckInModal({ data, me, onClose, onDone }: { data: ItData; me: string; onClose: () => void; onDone: () => void }) {
  const mine = data.issues.filter((i) => isOpen(i) && (i.assignee_id === me || !i.assignee_id));
  const current = mine.filter((i) => i.assignee_id === me && (i.status === 'in_progress' || i.status === 'in_review' || i.status === 'testing'));
  const [pick, setPick] = useState(current[0] ? String(current[0].id) : '');
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const n = q.trim().toLowerCase();
  const list = mine.filter((i) => !n || `${keyOf(i.id)} ${i.title}`.toLowerCase().includes(n))
    .sort((a, b) => Number(b.assignee_id === me) - Number(a.assignee_id === me) || a.priority.localeCompare(b.priority)).slice(0, 30);
  const confirm = async (id = pick) => {
    if (!id) { setError('Pick the issue you are working on, or create it.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('confirm_it_work', { p_issue: Number(id), p_note: note });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(); onClose();
  };
  if (creating) return <IssueFormModal data={data} issue={null} isLead={false} me={me} onClose={() => setCreating(false)} onSaved={(id) => confirm(String(id))} />;
  return (
    <Modal open onClose={onClose} title="What are you working on?" subtitle="Confirm it so the team (and the MD) can see it. It goes In progress in your name." maxWidth="max-w-lg">
      <div className="space-y-3">
        <label className="relative block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input !pl-8" placeholder="Find an issue" /></label>
        <div className="space-y-1 max-h-[44vh] overflow-y-auto">
          {list.map((i) => (
            <label key={i.id} className={`flex items-start gap-2 rounded-md border px-2.5 py-2 cursor-pointer ${pick === String(i.id) ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
              <input type="radio" className="mt-1" checked={pick === String(i.id)} onChange={() => setPick(String(i.id))} />
              <span className="flex-1 min-w-0"><span className="block text-body"><span className="font-mono text-caption text-fg-muted mr-1.5">{keyOf(i.id)}</span>{i.title}</span>
                <span className="text-caption text-fg-muted">{i.assignee_id === me ? 'Yours' : 'Nobody has it'} · {STATUSES.find((s) => s.key === i.status)?.label}</span></span>
            </label>
          ))}
          {!list.length && <p className="text-small text-fg-muted py-4 text-center">Nothing assigned to you. Create what you are doing.</p>}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="One line on today (optional)" aria-label="Note" />
        <Err msg={error} />
        <Foot onClose={onClose} busy={busy} label="Confirm" onSave={() => confirm()} left={<button onClick={() => setCreating(true)} className="btn-ghost text-caption"><Plus size={13} /> It's not listed — create it</button>} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ anyone: request to IT
export function SubmitToItModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [who, setWho] = useState('rider');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    if (!title.trim()) { setError('Say what you need.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('submit_to_it', { p: { title, details, persona: who } });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(true);
  };
  if (done) return (
    <Modal open onClose={onClose} title="Sent to IT" maxWidth="max-w-md">
      <div className="text-center py-6"><CheckCircle2 size={28} className="mx-auto text-success mb-2" /><p className="text-body">It's in IT's inbox. The head of IT decides what happens to it, and you'll be told when it's done.</p>
        <button onClick={onClose} className="btn-primary mt-4">Done</button></div>
    </Modal>
  );
  return (
    <Modal open onClose={onClose} title="Request to IT" subtitle="An idea, a problem or something you need from the app or Kivu Daily." maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className={lbl}>What do you need? *</span><input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="e.g. Drivers can't upload their licence photo" autoFocus /></label>
        <div><span className={lbl}>Who does it affect?</span>
          <div className="flex flex-wrap gap-1.5">{[['rider', 'Riders'], ['driver', 'Drivers'], ['staff', 'Our team'], ['partner', 'Partners / owners']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setWho(k)} aria-pressed={who === k} className={`px-2.5 py-1 rounded-full text-caption border ${who === k ? 'border-accent bg-accent/15' : 'border-line text-fg-muted'}`}>{l}</button>
          ))}</div>
        </div>
        <label className="block"><span className={lbl}>Details</span><textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4} className="input resize-none" placeholder="What happens, where, how often, a screenshot link…" /></label>
        <p className="text-caption text-fg-muted flex items-center gap-1.5"><Lightbulb size={13} /> Requests are reviewed by the head of IT before they become work.</p>
        <Err msg={error} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={send} disabled={busy} className="btn-primary disabled:opacity-50"><Send size={14} /> {busy ? 'Sending…' : 'Send to IT'}</button></div>
      </div>
    </Modal>
  );
}

export const StatusLabel = ({ status }: { status: IssueStatus }) => { const s = STATUSES.find((x) => x.key === status)!; return <Label tone={s.tone}>{s.label}</Label>; };
