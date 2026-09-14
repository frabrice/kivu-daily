import { useState } from 'react';
import { Plus, Trash2, CheckSquare, Square, X, Pencil, User, Flag, ListChecks, Package } from 'lucide-react';
import { supabase, UserStory, UserStoryStatus, UserStoryPriority, AcceptanceCriterion, Profile, Product } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { STORY_STATUSES, PRIORITY_STYLE } from '../../lib/itHub';
import Modal from '../Modal';

export default function StoryDrawer({
  story,
  startEditing,
  featureId,
  isIssue = false,
  itProfiles,
  products = [],
  canEdit,
  onClose,
  onSaved,
}: {
  story: UserStory | null;
  startEditing: boolean;
  featureId: string | null;
  isIssue?: boolean;
  itProfiles: Profile[];
  products?: Product[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [title, setTitle] = useState(story?.title ?? '');
  const [persona, setPersona] = useState(story?.persona ?? (isIssue ? 'driver' : ''));
  const [need, setNeed] = useState(story?.need ?? '');
  const [benefit, setBenefit] = useState(story?.benefit ?? (story ? '' : 'the underlying issue gets fixed for everyone'));
  const [details, setDetails] = useState(story?.details ?? '');
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(story?.acceptance_criteria ?? []);
  const [status, setStatus] = useState<UserStoryStatus>(story?.status ?? 'backlog');
  const [priority, setPriority] = useState<UserStoryPriority>(story?.priority ?? 'medium');
  const [assigneeId, setAssigneeId] = useState(story?.assignee_id ?? '');
  const [productId, setProductId] = useState(story?.product_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addCriterion = () => setCriteria((c) => [...c, { text: '', done: false }]);
  const updateCriterion = (i: number, patch: Partial<AcceptanceCriterion>) =>
    setCriteria((c) => c.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  const removeCriterion = (i: number) => setCriteria((c) => c.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!persona.trim() || !need.trim() || !benefit.trim()) return;
    if (isIssue && !story && (!title.trim() || !productId)) return;
    setSaving(true);
    setError('');
    const payload = {
      title: title.trim() || null,
      persona: persona.trim(),
      need: need.trim(),
      benefit: benefit.trim(),
      details: details.trim() || null,
      acceptance_criteria: criteria.filter((c) => c.text.trim()),
      status,
      priority,
      assignee_id: assigneeId || null,
      ...(isIssue ? { product_id: productId || null } : {}),
      updated_at: new Date().toISOString(),
    };

    let storyId = story?.id ?? null;
    if (story) {
      const { error: err } = await supabase.from('user_stories').update(payload).eq('id', story.id);
      if (err) { setSaving(false); setError(err.message); return; }
    } else {
      const { data, error: err } = await supabase
        .from('user_stories')
        .insert({
          ...payload,
          feature_id: isIssue ? null : featureId,
          source: isIssue ? 'flagged' : 'manual',
          created_by: profile!.id,
        })
        .select('id')
        .single();
      if (err) { setSaving(false); setError(err.message); return; }
      storyId = data?.id ?? null;
    }

    if (isIssue && storyId) {
      const { error: syncErr } = await supabase.rpc('sync_issue_task', { p_story_id: storyId });
      if (syncErr) { setSaving(false); setError(syncErr.message); return; }
    }

    setSaving(false);
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!story) return;
    setSaving(true);
    if (story.source === 'flagged') {
      await supabase.rpc('delete_issue', { p_story_id: story.id });
    } else {
      await supabase.from('user_stories').delete().eq('id', story.id);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const statusMeta = STORY_STATUSES.find((s) => s.key === status);
  const selectedProduct = products.find((p) => p.id === productId);

  return (
    <Modal open onClose={onClose} title={story ? (story.source === 'flagged' ? 'Issue' : 'User Story') : (isIssue ? 'New Issue' : 'New User Story')} maxWidth="max-w-lg">
      {!editing && story ? (
        <div className="space-y-4">
          {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
          <div className="card p-3.5 bg-gray-50 dark:bg-white/5 text-[12px] leading-relaxed">
            <span className="text-gray-400">As a</span> <span className="font-medium">{persona}</span>,{' '}
            <span className="text-gray-400">I need</span> <span className="font-medium">{need}</span>,{' '}
            <span className="text-gray-400">so that</span> <span className="font-medium">{benefit}</span>.
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {statusMeta && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${statusMeta.color}20`, color: statusMeta.color }}>
                {statusMeta.label}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-2 py-0.5 rounded-full ${PRIORITY_STYLE[priority]}`}>
              <Flag size={10} /> {priority}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
              <User size={10} /> {itProfiles.find((p) => p.id === assigneeId)?.full_name ?? 'Unassigned'}
            </span>
            {isIssue && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-cyan-600 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 px-2 py-0.5 rounded-full">
                <Package size={10} /> {selectedProduct?.name ?? 'No product'}
              </span>
            )}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Details</p>
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap">
              {details || <span className="text-gray-400">No additional details.</span>}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 flex items-center gap-1.5">
              <ListChecks size={12} /> Acceptance Criteria
            </p>
            {criteria.length === 0 ? (
              <p className="text-[12px] text-gray-400">No acceptance criteria yet.</p>
            ) : (
              <div className="space-y-1.5">
                {criteria.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px]">
                    {c.done ? <CheckSquare size={15} className="text-positive shrink-0 mt-0.5" /> : <Square size={15} className="text-gray-300 dark:text-white/20 shrink-0 mt-0.5" />}
                    <span className={c.done ? 'text-gray-400 line-through' : ''}>{c.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isIssue && assigneeId && (
            <p className="text-[10px] text-gray-400">Shows as a task on {itProfiles.find((p) => p.id === assigneeId)?.full_name?.split(' ')[0]}'s Today page.</p>
          )}

          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {canEdit ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Delete
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Close</button>
              {canEdit && (
                <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                  <Pencil size={13} /> Edit
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {isIssue && (
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editing} className="input" placeholder="App crashes when uploading a photo" autoFocus />
            </div>
          )}

          <div className="card p-3 bg-gray-50 dark:bg-white/5 text-[12px] leading-relaxed">
            <span className="text-gray-400">As a</span> <span className="font-medium">{persona || '…'}</span>,{' '}
            <span className="text-gray-400">I need</span> <span className="font-medium">{need || '…'}</span>,{' '}
            <span className="text-gray-400">so that</span> <span className="font-medium">{benefit || '…'}</span>.
          </div>

          {!isIssue && (
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Title (optional)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editing} className="input" placeholder="Short name for this story" />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">As a… (persona)</label>
            <input value={persona} onChange={(e) => setPersona(e.target.value)} disabled={!editing} className="input" placeholder="driver, rider, call center agent…" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">I need…</label>
            <input value={need} onChange={(e) => setNeed(e.target.value)} disabled={!editing} className="input" placeholder="to see my earnings for the week" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">So that…</label>
            <input value={benefit} onChange={(e) => setBenefit(e.target.value)} disabled={!editing} className="input" placeholder="I can plan my schedule" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Details</label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Extra context, constraints, links…" />
          </div>

          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Acceptance Criteria</label>
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
                <button type="button" onClick={addCriterion} className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 pt-0.5">
                  <Plus size={12} /> Add criterion
                </button>
              )}
              {!editing && criteria.length === 0 && <p className="text-[11px] text-gray-400">No acceptance criteria yet.</p>}
            </div>
          </div>

          {isIssue && (
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Package size={11} /> Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!editing} className="input">
                <option value="">No product selected</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1.5">Which product this affects - a minor issue doesn't need a milestone, just the product it's under.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as UserStoryStatus)} disabled={!editing} className="input">
                {STORY_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as UserStoryPriority)} disabled={!editing} className="input">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Assignee</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={!editing} className="input">
              <option value="">Unassigned</option>
              {itProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            {isIssue && (
              <p className="text-[10px] text-gray-400 mt-1.5">Assigning someone here also puts it on their Today page as a task, kept in sync as status or assignee change.</p>
            )}
          </div>

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {story ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Delete
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (story ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button
                onClick={save}
                disabled={saving || !persona.trim() || !need.trim() || !benefit.trim() || (isIssue && !story && (!title.trim() || !productId))}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? 'Saving…' : story ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
