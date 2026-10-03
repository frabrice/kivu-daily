import { useEffect, useMemo, useState } from 'react';
import { Inbox, PlayCircle, Hourglass, CheckCircle2, AlertTriangle, Users2, Headphones } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useCallTickets, isOverdue, isUnresolved, sortForWork, ageLabel } from '../lib/callTickets';
import { CallTicket } from '../lib/supabase';
import KpiTile from '../components/KpiTile';
import TicketList from '../components/callTickets/TicketList';
import TicketDrawer from '../components/callTickets/TicketDrawer';

type Tab = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'all';

// Everyone's inbox of caller issues the Call Center couldn't solve on the
// call and assigned to them. Work each one: start, ask the caller for
// more via the Call Center, resolve. The MD also sees every open ticket
// across the company, grouped by person.
export default function FromCallCenterPage({ initialTicketId }: { initialTicketId?: string | null }) {
  const { profile } = useAuth();
  const { tickets, people, loading, reload, personName, updatesFor } = useCallTickets();
  const isMD = profile?.role === 'managing_director';
  const [tab, setTab] = useState<Tab>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const mine = useMemo(() => tickets.filter((t) => t.assignee_id === profile?.id && !t.resolved_on_call), [tickets, profile?.id]);
  const byStatus = (s: CallTicket['status']) => mine.filter((t) => t.status === s).sort(sortForWork);
  const openT = byStatus('open');
  const progressT = byStatus('in_progress');
  const waitingT = byStatus('waiting_on_caller');
  const resolvedT = useMemo(
    () => tickets.filter((t) => !t.resolved_on_call && !isUnresolved(t) && (t.assignee_id === profile?.id || t.resolved_by === profile?.id))
      .sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? '')),
    [tickets, profile?.id],
  );
  const myOverdue = mine.filter((t) => isOverdue(t)).length;
  const weekAgo = Date.now() - 7 * 86400000;
  const resolvedThisWeek = resolvedT.filter((t) => t.resolved_at && new Date(t.resolved_at).getTime() >= weekAgo).length;

  const companyOpen = useMemo(() => tickets.filter(isUnresolved).sort(sortForWork), [tickets]);
  const byPerson = useMemo(() => {
    const m = new Map<string, CallTicket[]>();
    for (const t of companyOpen) m.set(t.assignee_id ?? '', [...(m.get(t.assignee_id ?? '') ?? []), t]);
    return [...m].map(([id, list]) => ({ id, list, overdue: list.filter((t) => isOverdue(t)).length, oldest: list.reduce((o, t) => (t.created_at < o ? t.created_at : o), list[0].created_at) }))
      .sort((a, b) => b.overdue - a.overdue || b.list.length - a.list.length);
  }, [companyOpen]);

  useEffect(() => {
    if (!initialTicketId) return;
    const t = tickets.find((x) => x.id === initialTicketId);
    if (!t) return;
    setSelectedId(t.id);
    if (t.assignee_id !== profile?.id && isMD) setTab('all');
    else setTab(t.status === 'in_progress' ? 'in_progress' : t.status === 'waiting_on_caller' ? 'waiting' : isUnresolved(t) ? 'open' : 'resolved');
  }, [initialTicketId, tickets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = tickets.find((t) => t.id === selectedId) ?? null;
  const open = (t: CallTicket) => setSelectedId(t.id);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Headphones size={16} className="text-brand-600 dark:text-brand-300" /> From Call Center</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Callers' issues the Call Center assigned to you. Resolve them and the Call Center calls the caller back.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Inbox} label="New" value={String(openT.length)} tone={openT.length ? 'negative' : undefined} />
        <KpiTile icon={PlayCircle} label="In progress" value={String(progressT.length + waitingT.length)} />
        <KpiTile icon={AlertTriangle} label="Overdue" value={String(myOverdue)} tone={myOverdue ? 'negative' : undefined} />
        <KpiTile icon={CheckCircle2} label="Resolved this week" value={String(resolvedThisWeek)} tone="positive" />
      </div>

      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit flex-wrap" role="tablist">
        <TabButton active={tab === 'open'} onClick={() => setTab('open')} icon={Inbox} label="New" badge={openT.length} hot />
        <TabButton active={tab === 'in_progress'} onClick={() => setTab('in_progress')} icon={PlayCircle} label="In progress" badge={progressT.length} />
        <TabButton active={tab === 'waiting'} onClick={() => setTab('waiting')} icon={Hourglass} label="Waiting on caller" badge={waitingT.length} />
        <TabButton active={tab === 'resolved'} onClick={() => setTab('resolved')} icon={CheckCircle2} label="Resolved" />
        {isMD && <TabButton active={tab === 'all'} onClick={() => setTab('all')} icon={Users2} label="All tickets" badge={companyOpen.length} />}
      </div>

      {tab === 'open' && <TicketList tickets={openT} personName={personName} onOpen={open} showAssignee={false} empty="Nothing new from the Call Center." />}
      {tab === 'in_progress' && <TicketList tickets={progressT} personName={personName} onOpen={open} showAssignee={false} empty="Nothing in progress." />}
      {tab === 'waiting' && <TicketList tickets={waitingT} personName={personName} onOpen={open} showAssignee={false} empty="Not waiting on any caller." />}
      {tab === 'resolved' && <TicketList tickets={resolvedT} personName={personName} onOpen={open} showAssignee={false} empty="You haven't resolved any tickets yet." />}
      {tab === 'all' && isMD && (
        <div className="space-y-4">
          {byPerson.length > 0 && (
            <div className="card overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 border-b border-gray-100 dark:border-white/5">
                    <th className="px-4 py-2 font-medium">Person</th>
                    <th className="px-4 py-2 font-medium">Open</th>
                    <th className="px-4 py-2 font-medium">Overdue</th>
                    <th className="px-4 py-2 font-medium">Oldest waiting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {byPerson.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-medium">{personName(r.id)}</td>
                      <td className="px-4 py-2">{r.list.length}</td>
                      <td className={`px-4 py-2 ${r.overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-400'}`}>{r.overdue || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{ageLabel(r.oldest)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TicketList tickets={companyOpen} personName={personName} onOpen={open} empty="No open tickets anywhere in the company." />
        </div>
      )}

      {selected && (
        <TicketDrawer ticket={selected} updates={updatesFor(selected.id)} people={people} personName={personName} onClose={() => setSelectedId(null)} onChanged={reload} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge, hot }: { active: boolean; onClick: () => void; icon: typeof Inbox; label: string; badge?: number; hot?: boolean }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {(badge ?? 0) > 0 && <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${hot ? 'bg-orange-500' : 'bg-gray-400'}`}>{badge}</span>}
    </button>
  );
}
