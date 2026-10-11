import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase, Milestone, MilestoneStatus } from '../../lib/supabase';
import { MILESTONE_STATUSES } from '../../lib/itHub';
import Modal from '../Modal';
import DateInput from '../DateInput';

export default function MilestoneDrawer({
  milestone,
  productId,
  canEdit,
  onClose,
  onSaved,
}: {
  milestone: Milestone | null;
  productId: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(milestone?.name ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [targetDate, setTargetDate] = useState(milestone?.target_date ?? '');
  const [status, setStatus] = useState<MilestoneStatus>(milestone?.status ?? 'planned');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const payload = { name: name.trim(), description: description.trim() || null, target_date: targetDate || null, status };
    const { error: err } = milestone
      ? await supabase.from('milestones').update(payload).eq('id', milestone.id)
      : await supabase.from('milestones').insert({ ...payload, product_id: productId });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!milestone) return;
    setSaving(true);
    await supabase.from('milestones').delete().eq('id', milestone.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={milestone ? milestone.name : 'New Milestone'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="input" placeholder="v2.0 Launch" autoFocus />
        </div>
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} rows={3} className="input resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as MilestoneStatus)} disabled={!canEdit} className="input">
              {MILESTONE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Target date</label>
            <DateInput value={targetDate} onChange={setTargetDate} disabled={!canEdit} />
          </div>
        </div>

        {error && <div className="text-caption text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {canEdit && (
          <div className="flex justify-between gap-2 pt-3 border-t border-line-muted ">
            {milestone ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : milestone ? 'Save Changes' : 'Create Milestone'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
