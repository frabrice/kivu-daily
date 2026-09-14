import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import Modal from '../Modal';

export default function ProductDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('products').insert({ name: name.trim(), description: description.trim() || null });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="New Product" subtitle="e.g. iOS App, Android App, Web Dashboard" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="iOS App" autoFocus />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input resize-none" placeholder="What this product is" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Product'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
