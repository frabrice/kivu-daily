import { useState } from 'react';
import { Flag } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Modal from './Modal';

interface FlagToITDrawerProps {
  entityType: string;
  entityId: string;
  entityLabel: string;
  defaultPersona?: string;
  onClose: () => void;
  onFlagged?: () => void;
}

export default function FlagToITDrawer({
  entityType,
  entityId,
  entityLabel,
  defaultPersona = 'driver',
  onClose,
  onFlagged,
}: FlagToITDrawerProps) {
  const [persona, setPersona] = useState(defaultPersona);
  const [need, setNeed] = useState('');
  const [details, setDetails] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!need.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.rpc('flag_to_it', {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_entity_label: entityLabel,
      p_persona: persona.trim() || 'driver',
      p_need: need.trim(),
      p_details: details.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    onFlagged?.();
  };

  if (done) {
    return (
      <Modal open onClose={onClose} title="Flagged to IT" maxWidth="max-w-md">
        <div className="text-center py-6">
          <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center mx-auto mb-3">
            <Flag size={18} className="text-brand-600 dark:text-brand-300" />
          </div>
          <p className="text-[13px] font-medium">Sent to IT's backlog</p>
          <p className="text-[12px] text-gray-400 mt-1">They'll see it in their Product Hub inbox.</p>
          <button onClick={onClose} className="btn-primary mt-4">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Flag to IT" subtitle={entityLabel} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Who does this affect?</label>
          <input value={persona} onChange={(e) => setPersona(e.target.value)} className="input" placeholder="driver, rider…" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">What's the problem or need?</label>
          <textarea value={need} onChange={(e) => setNeed(e.target.value)} rows={2} className="input resize-none" placeholder="e.g. keeps failing to upload their license photo" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Extra context (optional)</label>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} className="input resize-none" placeholder="Anything IT would need to reproduce or understand it…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !need.trim()} className="btn-primary disabled:opacity-50 flex items-center gap-1.5">
            <Flag size={13} /> {saving ? 'Sending…' : 'Flag to IT'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
