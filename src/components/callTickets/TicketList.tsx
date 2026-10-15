import { AlertTriangle, CalendarClock, ChevronRight, Inbox, Phone } from 'lucide-react';
import { CallTicket } from '../../lib/supabase';
import { Pager, usePaged } from '../../ui/Pager';
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
  const { rows, pager } = usePaged(tickets, { key: 'tickets' });
  if (tickets.length === 0) {
    return (
      <div className="card p-10 text-center">
        <Inbox size={22} className="mx-auto text-fg-subtle mb-2" />
        <p className="text-small text-fg-subtle">{empty}</p>
      </div>
    );
  }
  return (
    <div>
    <div className="card divide-y divide-line-muted overflow-hidden">
      {rows.map((t) => {
        const noResponse = isResponseOverdue(t);
        const overdue = noResponse || isOverdue(t);
        const callbackDue = !!t.callback_at && t.status !== 'closed' && new Date(t.callback_at).getTime() <= Date.now();
        const status = STATUS_META[t.status];
        return (
          <button key={t.id} onClick={() => onOpen(t)} className="w-full flex items-stretch text-left hover:bg-hover transition-colors">
            <span className={`w-1 shrink-0 ${t.priority === 'emergency' ? 'bg-red-700' : t.priority === 'urgent' ? 'bg-red-500' : overdue ? 'bg-amber-400' : 'bg-transparent'}`} aria-hidden />
            <div className="flex-1 min-w-0 px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-caption font-mono text-fg-subtle">{t.reference}</span>
                {t.priority !== 'normal' && <span className={`text-micro font-bold px-1.5 py-0.5 rounded text-white ${t.priority === 'emergency' ? 'bg-red-700' : 'bg-red-500'}`}>{t.priority.toUpperCase()}</span>}
                <span className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${status.chip}`}>{status.label}</span>
                {overdue && <span className="text-micro font-medium text-red-600 dark:text-red-400 flex items-center gap-0.5"><AlertTriangle size={10} /> {noResponse ? 'No response yet' : 'Overdue'}</span>}
                {callbackDue && <span className="text-micro font-medium text-orange-600 flex items-center gap-0.5"><CalendarClock size={10} /> Call back now</span>}
              </div>
              <p className="text-body font-semibold mt-1 truncate">{t.caller_name} <span className="font-normal text-fg-subtle">· {t.situation ?? CATEGORY_LABEL[t.category]}</span></p>
              <p className="text-small text-fg-muted truncate">{t.details}</p>
              <p className="text-caption text-fg-subtle mt-1 flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1"><Phone size={10} /> {t.caller_phone}</span>
                {showAssignee && <span>{t.resolved_on_call ? `${t.outcome_kind ? OUTCOME_LABEL[t.outcome_kind] : 'Solved on the call'} · ${personName(t.created_by)}` : `With ${personName(t.assignee_id)}`}</span>}
              </p>
            </div>
            <div className="flex flex-col items-end justify-center gap-1 px-3 shrink-0">
              <span className={`text-caption font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}`}>{ageLabel(t.created_at)}</span>
              <ChevronRight size={15} className="text-fg-subtle" />
            </div>
          </button>
        );
      })}
    </div>
    <Pager pager={pager} noun="cases" />
    </div>
  );
}
