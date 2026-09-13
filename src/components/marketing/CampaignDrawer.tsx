import { useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { supabase, Campaign, CampaignStatus } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import Modal from '../Modal';

export default function CampaignDrawer({
  campaign,
  startEditing,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  startEditing: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing);
  const [name, setName] = useState(campaign?.name ?? '');
  const [goal, setGoal] = useState(campaign?.goal ?? '');
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? 'active');
  const [startDate, setStartDate] = useState(campaign?.start_date ?? '');
  const [endDate, setEndDate] = useState(campaign?.end_date ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      name: name.trim(),
      goal: goal.trim() || null,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
    };
    const { error: err } = campaign
      ? await supabase.from('campaigns').update(payload).eq('id', campaign.id)
      : await supabase.from('campaigns').insert({ ...payload, owner_id: profile!.id });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!campaign) return;
    setSaving(true);
    await supabase.from('campaigns').delete().eq('id', campaign.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={campaign ? campaign.name : 'New Campaign'} subtitle="A push with a goal, timeframe, and a list of targets" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Hotel Concierge Partnerships Q3" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Goal (optional)</label>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="What does success look like?" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)} disabled={!editing} className="input">
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!editing} className="input" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">End date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {campaign ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (campaign ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : campaign ? 'Save Changes' : 'Create Campaign'}
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
