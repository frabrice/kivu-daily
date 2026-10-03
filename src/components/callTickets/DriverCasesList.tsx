import { useEffect, useState } from 'react';
import { Headphones } from 'lucide-react';
import { supabase, CallTicket } from '../../lib/supabase';
import { CATEGORY_LABEL, STATUS_META, dateTimeLabel } from '../../lib/callTickets';

// Call Center cases linked to one driver - passenger complaints, lost
// items, breakdowns... Read-only here: the case itself is worked from
// From Call Center / Calls & Tickets.
export default function DriverCasesList({ driverId, platformDriverId }: { driverId?: string; platformDriverId?: string }) {
  const [cases, setCases] = useState<CallTicket[] | null>(null);

  useEffect(() => {
    let q = supabase.from('call_tickets').select('*').order('created_at', { ascending: false }).limit(50);
    q = driverId ? q.eq('driver_id', driverId) : q.eq('platform_driver_id', platformDriverId ?? '');
    q.then(({ data }) => setCases((data as CallTicket[]) ?? []));
  }, [driverId, platformDriverId]);

  if (cases === null) return null;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5 mb-2"><Headphones size={13} /> Caller cases ({cases.length})</p>
      {cases.length === 0 ? (
        <p className="text-[11px] text-gray-400">No Call Center cases linked to this driver.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/5">
          {cases.map((c) => (
            <div key={c.id} className="py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono text-gray-400">{c.reference}</span>
                {c.priority !== 'normal' && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded text-white ${c.priority === 'emergency' ? 'bg-red-700' : 'bg-red-500'}`}>{c.priority.toUpperCase()}</span>}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_META[c.status].chip}`}>{STATUS_META[c.status].label}</span>
                <span className="text-[10px] text-gray-400 ml-auto">{dateTimeLabel(c.created_at)}</span>
              </div>
              <p className="text-[12px] font-medium mt-0.5">{c.situation ?? CATEGORY_LABEL[c.category]} <span className="font-normal text-gray-400">· from {c.caller_name}</span></p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 line-clamp-2">{c.details}</p>
              {c.resolution_note && <p className="text-[11px] text-teal-700 dark:text-teal-300 mt-0.5">Resolution: {c.resolution_note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
