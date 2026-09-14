import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase, Feature } from '../../lib/supabase';
import Modal from '../Modal';

export default function FeatureDrawer({
  feature,
  milestoneId,
  canEdit,
  onClose,
  onSaved,
}: {
  feature: Feature | null;
  milestoneId: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(feature?.name ?? '');
  const [description, setDescription] = useState(feature?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const payload = { name: name.trim(), description: description.trim() || null };
    const { error: err } = feature
      ? await supabase.from('features').update(payload).eq('id', feature.id)
      : await supabase.from('features').insert({ ...payload, milestone_id: milestoneId });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!feature) return;
    setSaving(true);
    await supabase.from('features').delete().eq('id', feature.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={feature ? feature.name : 'New Feature'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="input" placeholder="Offline mode" autoFocus />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} rows={3} className="input resize-none" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {canEdit && (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {feature ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : feature ? 'Save Changes' : 'Create Feature'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
