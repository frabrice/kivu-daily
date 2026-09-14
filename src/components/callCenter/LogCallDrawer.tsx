import { useState } from 'react';
import { Flag } from 'lucide-react';
import { supabase, Driver, CallReason, CallOutcome, CallScript } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import Modal from '../Modal';
import FlagToITDrawer from '../FlagToITDrawer';

export default function LogCallDrawer({
  driver,
  drivers,
  reasons,
  outcomes,
  scripts,
  onClose,
  onSaved,
}: {
  driver: Driver;
  drivers: Driver[];
  reasons: CallReason[];
  outcomes: CallOutcome[];
  scripts: CallScript[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [driverId, setDriverId] = useState(driver.id);
  const [reasonId, setReasonId] = useState('');
  const [outcomeId, setOutcomeId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);

  const matchingScript = scripts.find((s) => s.reason_id === reasonId);
  const currentDriver = drivers.find((d) => d.id === driverId) ?? driver;
  const currentReason = reasons.find((r) => r.id === reasonId);

  const save = async () => {
    if (!driverId || !reasonId || !outcomeId) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('call_logs').insert({
      driver_id: driverId,
      caller_id: profile!.id,
      reason_id: reasonId,
      outcome_id: outcomeId,
      note: note.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Log a Call" subtitle="Pick from the list — no typing needed" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Driver</label>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="input">
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} · {d.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Reason for call</label>
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className="input">
            <option value="">Select a reason</option>
            {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>

        {matchingScript && (
          <div className="p-3 rounded-lg bg-brand/5 border border-brand/20">
            <p className="text-[10px] font-semibold text-brand-700 dark:text-brand-300 mb-1">{matchingScript.title}</p>
            <p className="text-[11px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{matchingScript.body}</p>
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Outcome</label>
          <select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)} className="input">
            <option value="">Select an outcome</option>
            {outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Note (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input resize-none" placeholder="Anything worth remembering…" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={() => setFlagOpen(true)} className="btn-ghost text-gray-500 flex items-center gap-1.5">
            <Flag size={13} /> Flag to IT
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving || !driverId || !reasonId || !outcomeId} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Log Call'}
            </button>
          </div>
        </div>
      </div>

      {flagOpen && (
        <FlagToITDrawer
          entityType="call_context"
          entityId={currentDriver.id}
          entityLabel={`Call with ${currentDriver.full_name}${currentReason ? ` · ${currentReason.label}` : ''}`}
          onClose={() => setFlagOpen(false)}
        />
      )}
    </Modal>
  );
}
