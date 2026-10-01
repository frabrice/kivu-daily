import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { todayStr } from '../lib/utils';
import Modal from './Modal';
import DateInput from './DateInput';

// Shared by Finance's Team page and the MD's own Departments view - a
// termination needs the real date it happened, not just whatever
// moment someone clicked the button, since Finance or the MD is often
// recording one after the fact. admin_deactivate_employee enforces
// server-side that Finance can terminate any regular employee but only
// the MD can terminate another MD.
export default function TerminateEmployeeModal({
  employeeId, employeeName, onClose, onTerminated,
}: {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
  onTerminated: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const terminate = async () => {
    setSaving(true);
    setError('');
    const { error: err } = await supabase.rpc('admin_deactivate_employee', { p_user_id: employeeId, p_termination_date: date });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onTerminated();
  };

  return (
    <Modal open onClose={onClose} title={`Terminate ${employeeName}`} maxWidth="max-w-sm">
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">This deactivates their account and removes their access. Pick the exact date they were terminated — it doesn't have to be today.</p>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Termination Date</label>
          <DateInput value={date} onChange={setDate} />
        </div>
        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={terminate} disabled={saving || !date} className="bg-red-500 hover:bg-red-600 text-white text-[12px] font-medium px-3.5 py-2 rounded-lg disabled:opacity-50">
            {saving ? 'Terminating…' : 'Terminate'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
