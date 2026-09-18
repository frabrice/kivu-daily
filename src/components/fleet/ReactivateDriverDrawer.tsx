import { useState } from 'react';
import { supabase, Driver } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { todayStr } from '../../lib/utils';
import Modal from '../Modal';
import DateInput from '../DateInput';

export default function ReactivateDriverDrawer({ driver, onClose, onSaved }: { driver: Driver; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [eventDate, setEventDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = !!reason.trim() && !!eventDate;

  const save = async () => {
    if (!canSave || !profile) return;
    setSaving(true);
    setError('');
    const { error: eventErr } = await supabase.from('driver_contract_events').insert({
      driver_id: driver.id,
      event_type: 'reactivated',
      reason: reason.trim(),
      details: details.trim() || null,
      event_date: eventDate,
      created_by: profile.id,
    });
    if (eventErr) { setSaving(false); setError(eventErr.message); return; }
    const { error: driverErr } = await supabase.from('drivers').update({
      contract_status: 'active',
      stage: 'active',
      updated_at: new Date().toISOString(),
    }).eq('id', driver.id);
    setSaving(false);
    if (driverErr) { setError(driverErr.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Reactivate Driver" subtitle={driver.full_name} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Reason for reactivating</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Resolved deposit shortfall" autoFocus />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Describe (optional)</label>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} className="input resize-none" placeholder="Any extra context…" />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Date Reactivated</label>
          <DateInput value={eventDate} onChange={setEventDate} />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
            {saving ? 'Reactivating…' : 'Reactivate Driver'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
