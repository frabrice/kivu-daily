import { Phone } from 'lucide-react';
import { Driver, CallLog } from '../../lib/supabase';
import { timeAgo } from '../../lib/utils';
import Modal from '../Modal';

export default function CallHistoryDrawer({
  driver,
  logs,
  onClose,
  onLogCall,
}: {
  driver: Driver;
  logs: CallLog[];
  onClose: () => void;
  onLogCall: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`${driver.full_name}'s Call History`} subtitle={`${logs.length} call${logs.length === 1 ? '' : 's'} logged`} maxWidth="max-w-lg">
      <div className="space-y-3">
        {logs.length === 0 ? (
          <div className="py-6 text-center">
            <Phone size={24} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[13px] text-gray-400">No calls logged with this driver yet.</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="p-2.5 rounded-lg border border-gray-100 dark:border-white/5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium">{l.reason?.label ?? 'Call'}</p>
                  <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(l.created_at)}</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {l.outcome?.label ?? 'No outcome'} · by {l.caller?.full_name ?? 'Unknown'}
                </p>
                {l.note && <p className="text-[12px] text-gray-600 dark:text-gray-300 mt-1.5">{l.note}</p>}
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={onLogCall} className="btn-primary flex items-center gap-1.5">
            <Phone size={13} /> Log a Call
          </button>
        </div>
      </div>
    </Modal>
  );
}
