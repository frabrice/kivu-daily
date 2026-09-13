import { useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { supabase, CallScript, CallReason } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import Modal from '../Modal';

export default function ScriptDrawer({
  script,
  startEditing,
  reasons,
  onClose,
  onSaved,
}: {
  script: CallScript | null;
  startEditing: boolean;
  reasons: CallReason[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing);
  const [title, setTitle] = useState(script?.title ?? '');
  const [reasonId, setReasonId] = useState(script?.reason_id ?? '');
  const [body, setBody] = useState(script?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setError('');
    const payload = { title: title.trim(), reason_id: reasonId || null, body: body.trim() };
    const { error: err } = script
      ? await supabase.from('call_scripts').update(payload).eq('id', script.id)
      : await supabase.from('call_scripts').insert({ ...payload, created_by: profile!.id });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!script) return;
    setSaving(true);
    await supabase.from('call_scripts').delete().eq('id', script.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={script ? script.title : 'Add a Call Script'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editing} className="input" placeholder="e.g. App confusion walkthrough" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Applies to reason (optional)</label>
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} disabled={!editing} className="input">
            <option value="">General / any reason</option>
            {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">What to say</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!editing} rows={6} className="input resize-none" placeholder="Mwaramutse! I'm calling from Kivu Ride…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {script ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (script ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !title.trim() || !body.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : script ? 'Save Changes' : 'Add Script'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
              <Pencil size={13} /> Edit
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
