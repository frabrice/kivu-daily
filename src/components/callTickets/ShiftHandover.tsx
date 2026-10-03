import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, CheckCircle2 } from 'lucide-react';
import { supabase, CallTicket } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { dateTimeLabel, STATUS_META } from '../../lib/callTickets';
import Modal from '../Modal';

interface HandoverItem { ticket_id: string; reference: string; caller: string; status: string; next_action: string }
interface Handover { id: string; author_id: string | null; note: string | null; items: HandoverItem[]; acknowledged_at: string | null; created_at: string }

// Script Book 13B: open work belongs to Kivu Ride, not one agent or shift.
export function useLatestHandover() {
  const [handover, setHandover] = useState<Handover | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('shift_handovers').select('*').order('created_at', { ascending: false }).limit(1);
    setHandover(((data as Handover[]) ?? [])[0] ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { handover, reload: load };
}

export function HandoverBanner({ handover, personName, onAcknowledged }: { handover: Handover; personName: (id: string | null) => string; onAcknowledged: () => void }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = handover.author_id === profile?.id;
  if (handover.acknowledged_at || mine) return null;

  const ack = async () => {
    setBusy(true);
    const { error: err } = await supabase.rpc('acknowledge_shift_handover', { p_id: handover.id });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onAcknowledged();
  };

  const withAction = handover.items.filter((i) => i.next_action.trim());
  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/70 dark:bg-violet-500/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <ArrowRightLeft size={15} className="text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold">Shift handover from {personName(handover.author_id)} · {dateTimeLabel(handover.created_at)}</p>
          {handover.note && <p className="text-[12px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-0.5">{handover.note}</p>}
        </div>
        <button onClick={ack} disabled={busy} className="btn-primary text-[11px] flex items-center gap-1 shrink-0 disabled:opacity-50"><CheckCircle2 size={12} /> Got it</button>
      </div>
      {withAction.length > 0 && (
        <ul className="space-y-1 pl-6">
          {withAction.map((i) => (
            <li key={i.ticket_id} className="text-[11px]"><span className="font-mono text-gray-500">{i.reference}</span> · {i.caller} — <b>{i.next_action}</b></li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-gray-400 pl-6">{handover.items.length} open case{handover.items.length === 1 ? '' : 's'} at handover.</p>
      {error && <p className="text-[11px] text-red-600 pl-6">{error}</p>}
    </div>
  );
}

export function HandoverDrawer({ openCases, onClose, onSaved }: { openCases: CallTicket[]; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [note, setNote] = useState('');
  const [actions, setActions] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    const items: HandoverItem[] = openCases.map((t) => ({
      ticket_id: t.id, reference: t.reference, caller: t.caller_name, status: t.status, next_action: (actions[t.id] ?? '').trim(),
    }));
    const { error: err } = await supabase.from('shift_handovers').insert({ author_id: profile?.id, note: note.trim() || null, items });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Hand over your shift" subtitle="The next shift sees this at the top of Calls & Tickets" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500" htmlFor="handover-note">Anything the next shift must know</label>
          <textarea id="handover-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input resize-none"
            placeholder="Urgent or safety cases, promises made to callers, anything unusual…" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-500 mb-1.5">Open and pending cases ({openCases.length}) — last action and exact next action</p>
          {openCases.length === 0 ? (
            <p className="text-[12px] text-gray-400">No open cases. Nice.</p>
          ) : (
            <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
              {openCases.map((t) => (
                <div key={t.id} className="rounded-lg border border-gray-100 dark:border-white/10 p-2.5">
                  <p className="text-[11px]">
                    <span className="font-mono text-gray-400">{t.reference}</span> · <b>{t.caller_name}</b> · {STATUS_META[t.status].label}
                    {t.priority !== 'normal' && <span className="ml-1 text-[9px] font-bold text-white bg-red-600 px-1 rounded">{t.priority.toUpperCase()}</span>}
                  </p>
                  <input value={actions[t.id] ?? ''} onChange={(e) => setActions((a) => ({ ...a, [t.id]: e.target.value }))} className="input mt-1.5 text-[12px]"
                    placeholder="e.g. Called driver at 17:00, no answer — call again at 08:00" aria-label={`Next action for ${t.reference}`} />
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Save handover'}</button>
        </div>
      </div>
    </Modal>
  );
}
