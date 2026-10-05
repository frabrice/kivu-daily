import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { dateTimeLabel } from '../../lib/callTickets';

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
