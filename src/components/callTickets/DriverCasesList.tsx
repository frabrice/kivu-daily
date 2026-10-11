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
      <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle flex items-center gap-1.5 mb-2"><Headphones size={13} /> Caller cases ({cases.length})</p>
      {cases.length === 0 ? (
        <p className="text-caption text-fg-subtle">No Call Center cases linked to this driver.</p>
      ) : (
        <div className="divide-y divide-line-muted ">
          {cases.map((c) => (
            <div key={c.id} className="py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-caption font-mono text-fg-subtle">{c.reference}</span>
                {c.priority !== 'normal' && <span className={`text-micro font-bold px-1.5 py-0.5 rounded text-white ${c.priority === 'emergency' ? 'bg-red-700' : 'bg-red-500'}`}>{c.priority.toUpperCase()}</span>}
                <span className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${STATUS_META[c.status].chip}`}>{STATUS_META[c.status].label}</span>
                <span className="text-micro text-fg-subtle ml-auto">{dateTimeLabel(c.created_at)}</span>
              </div>
              <p className="text-small font-medium mt-0.5">{c.situation ?? CATEGORY_LABEL[c.category]} <span className="font-normal text-fg-subtle">· from {c.caller_name}</span></p>
              <p className="text-small text-fg-muted line-clamp-2">{c.details}</p>
              {c.resolution_note && <p className="text-caption text-teal-700 dark:text-teal-300 mt-0.5">Resolution: {c.resolution_note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
