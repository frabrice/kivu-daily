import { useState } from 'react';
import { Plus, Trash2, CheckSquare, Square, X, Pencil } from 'lucide-react';
import { supabase, UserStory, UserStoryStatus, UserStoryPriority, AcceptanceCriterion, Profile } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { STORY_STATUSES } from '../../lib/itHub';
import Modal from '../Modal';

export default function StoryDrawer({
  story,
  startEditing,
  featureId,
  isIssue = false,
  itProfiles,
  canEdit,
  onClose,
  onSaved,
}: {
  story: UserStory | null;
  startEditing: boolean;
  featureId: string;
  isIssue?: boolean;
  itProfiles: Profile[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [persona, setPersona] = useState(story?.persona ?? (isIssue ? 'driver' : ''));
  const [need, setNeed] = useState(story?.need ?? '');
  const [benefit, setBenefit] = useState(story?.benefit ?? (story ? '' : 'the underlying issue gets fixed for everyone'));
  const [details, setDetails] = useState(story?.details ?? '');
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(story?.acceptance_criteria ?? []);
  const [status, setStatus] = useState<UserStoryStatus>(story?.status ?? 'backlog');
  const [priority, setPriority] = useState<UserStoryPriority>(story?.priority ?? 'medium');
  const [assigneeId, setAssigneeId] = useState(story?.assignee_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addCriterion = () => setCriteria((c) => [...c, { text: '', done: false }]);
  const updateCriterion = (i: number, patch: Partial<AcceptanceCriterion>) =>
    setCriteria((c) => c.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  const removeCriterion = (i: number) => setCriteria((c) => c.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!persona.trim() || !need.trim() || !benefit.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      persona: persona.trim(),
      need: need.trim(),
      benefit: benefit.trim(),
      details: details.trim() || null,
      acceptance_criteria: criteria.filter((c) => c.text.trim()),
      status,
      priority,
      assignee_id: assigneeId || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = story
      ? await supabase.from('user_stories').update(payload).eq('id', story.id)
      : await supabase.from('user_stories').insert({ ...payload, feature_id: featureId, source: isIssue ? 'flagged' : 'manual', created_by: profile!.id });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!story) return;
    setSaving(true);
    await supabase.from('user_stories').delete().eq('id', story.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={story ? (story.source === 'flagged' ? 'Issue' : 'User Story') : (isIssue ? 'New Issue' : 'New User Story')} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="card p-3 bg-gray-50 dark:bg-white/5 text-[13px] leading-relaxed">
          <span className="text-gray-400">As a</span> <span className="font-medium">{persona || '…'}</span>,{' '}
          <span className="text-gray-400">I need</span> <span className="font-medium">{need || '…'}</span>,{' '}
          <span className="text-gray-400">so that</span> <span className="font-medium">{benefit || '…'}</span>.
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">As a… (persona)</label>
          <input value={persona} onChange={(e) => setPersona(e.target.value)} disabled={!editing} className="input" placeholder="driver, rider, call center agent…" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">I need…</label>
          <input value={need} onChange={(e) => setNeed(e.target.value)} disabled={!editing} className="input" placeholder="to see my earnings for the week" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">So that…</label>
          <input value={benefit} onChange={(e) => setBenefit(e.target.value)} disabled={!editing} className="input" placeholder="I can plan my schedule" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Details</label>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Extra context, constraints, links…" />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Acceptance Criteria</label>
          <div className="space-y-1.5">
            {criteria.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <button type="button" onClick={() => editing && updateCriterion(i, { done: !c.done })} className="shrink-0 text-gray-400">
                  {c.done ? <CheckSquare size={16} className="text-positive" /> : <Square size={16} />}
                </button>
                <input
                  value={c.text}
                  onChange={(e) => updateCriterion(i, { text: e.target.value })}
                  disabled={!editing}
                  className="input flex-1 py-1.5"
                  placeholder="Given… when… then…"
                />
                {editing && (
                  <button type="button" onClick={() => removeCriterion(i)} className="shrink-0 text-gray-300 hover:text-red-500">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {editing && (
              <button type="button" onClick={addCriterion} className="text-[12px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 pt-0.5">
                <Plus size={12} /> Add criterion
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as UserStoryStatus)} disabled={!editing} className="input">
              {STORY_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as UserStoryPriority)} disabled={!editing} className="input">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Assignee</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={!editing} className="input">
            <option value="">Unassigned</option>
            {itProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {story ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (story ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !persona.trim() || !need.trim() || !benefit.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : story ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
