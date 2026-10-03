import { AlertTriangle, CalendarClock, ChevronRight, Inbox, Phone } from 'lucide-react';
import { CallTicket } from '../../lib/supabase';
import { ageLabel, CATEGORY_LABEL, isOverdue, isResponseOverdue, STATUS_META, OUTCOME_LABEL } from '../../lib/callTickets';

// One row per ticket: a priority stripe on the left, the caller and what
// it's about, who has it, and how long the caller has been waiting.
export default function TicketList({
  tickets,
  personName,
  onOpen,
  showAssignee = true,
  empty,
}: {
  tickets: CallTicket[];
  personName: (id: string | null | undefined) => string;
  onOpen: (t: CallTicket) => void;
  showAssignee?: boolean;
  empty: string;
}) {
  if (tickets.length === 0) {
    return (
      <div className="card p-10 text-center">
        <Inbox size={22} className="mx-auto text-gray-300 mb-2" />
        <p className="text-[12px] text-gray-400">{empty}</p>
      </div>
    );
  }
  return (
    <div className="card divide-y divide-gray-100 dark:divide-white/5 overflow-hidden">
      {tickets.map((t) => {
        const noResponse = isResponseOverdue(t);
        const overdue = noResponse || isOverdue(t);
        const callbackDue = !!t.callback_at && t.status !== 'closed' && new Date(t.callback_at).getTime() <= Date.now();
        const status = STATUS_META[t.status];
        return (
          <button key={t.id} onClick={() => onOpen(t)} className="w-full flex items-stretch text-left hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
            <span className={`w-1 shrink-0 ${t.priority === 'emergency' ? 'bg-red-700' : t.priority === 'urgent' ? 'bg-red-500' : overdue ? 'bg-amber-400' : 'bg-transparent'}`} aria-hidden />
            <div className="flex-1 min-w-0 px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono text-gray-400">{t.reference}</span>
                {t.priority !== 'normal' && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded text-white ${t.priority === 'emergency' ? 'bg-red-700' : 'bg-red-500'}`}>{t.priority.toUpperCase()}</span>}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${status.chip}`}>{status.label}</span>
                {overdue && <span className="text-[10px] font-medium text-red-600 dark:text-red-400 flex items-center gap-0.5"><AlertTriangle size={10} /> {noResponse ? 'No response yet' : 'Overdue'}</span>}
                {callbackDue && <span className="text-[10px] font-medium text-orange-600 flex items-center gap-0.5"><CalendarClock size={10} /> Call back now</span>}
              </div>
              <p className="text-[13px] font-semibold mt-1 truncate">{t.caller_name} <span className="font-normal text-gray-400">· {t.situation ?? CATEGORY_LABEL[t.category]}</span></p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{t.details}</p>
              <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1"><Phone size={10} /> {t.caller_phone}</span>
                {showAssignee && <span>{t.resolved_on_call ? `${t.outcome_kind ? OUTCOME_LABEL[t.outcome_kind] : 'Solved on the call'} · ${personName(t.created_by)}` : `With ${personName(t.assignee_id)}`}</span>}
              </p>
            </div>
            <div className="flex flex-col items-end justify-center gap-1 px-3 shrink-0">
              <span className={`text-[11px] font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{ageLabel(t.created_at)}</span>
              <ChevronRight size={15} className="text-gray-300" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
