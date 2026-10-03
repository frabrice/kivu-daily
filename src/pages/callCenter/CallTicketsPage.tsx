import { useEffect, useMemo, useState } from 'react';
import { PhoneIncoming, Plus, PhoneCall, CheckCircle2, Inbox, AlertTriangle, PhoneForwarded, Search } from 'lucide-react';
import { useCallTickets, isOverdue, isUnresolved, sortForWork } from '../../lib/callTickets';
import { todayStr, dateStr } from '../../lib/utils';
import KpiTile from '../../components/KpiTile';
import TicketList from '../../components/callTickets/TicketList';
import TicketDrawer from '../../components/callTickets/TicketDrawer';
import NewCallDrawer from '../../components/callTickets/NewCallDrawer';

type Tab = 'callback' | 'open' | 'all';

// The Call Center's inbound desk: log every call, hand off what can't be
// solved on the spot, and close the loop by calling callers back once
// their issue is resolved.
export default function CallTicketsPage({ initialTicketId }: { initialTicketId?: string | null }) {
  const { tickets, people, assignable, loading, reload, personName, updatesFor } = useCallTickets();
  const [tab, setTab] = useState<Tab>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (initialTicketId && tickets.some((t) => t.id === initialTicketId)) {
      setSelectedId(initialTicketId);
      const t = tickets.find((x) => x.id === initialTicketId)!;
      setTab(t.status === 'resolved' ? 'callback' : isUnresolved(t) ? 'open' : 'all');
    }
  }, [initialTicketId, tickets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayStr();
  const callback = useMemo(() => tickets.filter((t) => t.status === 'resolved').sort((a, b) => (a.resolved_at ?? '').localeCompare(b.resolved_at ?? '')), [tickets]);
  const open = useMemo(() => tickets.filter(isUnresolved).sort(sortForWork), [tickets]);
  const todays = tickets.filter((t) => dateStr(new Date(t.created_at)) === today);
  const solvedToday = todays.filter((t) => t.resolved_on_call).length;
  const overdue = open.filter((t) => isOverdue(t)).length;
  const all = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => !needle || [t.reference, t.caller_name, t.caller_phone, t.details].some((f) => f.toLowerCase().includes(needle)));
  }, [tickets, q]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><PhoneIncoming size={16} className="text-brand-600 dark:text-brand-300" /> Calls & Tickets</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Log every call. Solve it on the spot, or send it to the person in charge.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-1.5 whitespace-nowrap"><Plus size={14} /> New call</button>
      </div>

      {toast && (
        <div className="flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">
          <CheckCircle2 size={14} /> {toast}
          <button onClick={() => setToast('')} className="ml-auto text-[11px] underline">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={PhoneCall} label="Calls today" value={String(todays.length)} />
        <KpiTile icon={CheckCircle2} label="Solved on the call today" value={todays.length ? `${solvedToday} (${Math.round((solvedToday / todays.length) * 100)}%)` : '0'} tone="positive" />
        <KpiTile icon={Inbox} label="Open tickets" value={String(open.length)} />
        <KpiTile icon={AlertTriangle} label="Overdue" value={String(overdue)} tone={overdue ? 'negative' : undefined} />
      </div>

      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit" role="tablist">
        <TabButton active={tab === 'callback'} onClick={() => setTab('callback')} icon={PhoneForwarded} label="Call back" badge={callback.length} urgent />
        <TabButton active={tab === 'open'} onClick={() => setTab('open')} icon={Inbox} label="Open" badge={open.length} />
        <TabButton active={tab === 'all'} onClick={() => setTab('all')} icon={PhoneCall} label="All calls" />
      </div>

      {tab === 'callback' && (
        <>
          <p className="text-[11px] text-gray-500">These are resolved. Call each caller, tell them the outcome, then <b>Close</b> it — or <b>Reopen</b> if it isn't fixed.</p>
          <TicketList tickets={callback} personName={personName} onOpen={(t) => setSelectedId(t.id)} empty="Nobody to call back right now." />
        </>
      )}
      {tab === 'open' && <TicketList tickets={open} personName={personName} onOpen={(t) => setSelectedId(t.id)} empty="No open tickets. Every caller has been taken care of." />}
      {tab === 'all' && (
        <>
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-8" placeholder="Search reference, name, phone or details" aria-label="Search calls" />
          </div>
          <TicketList tickets={all} personName={personName} onOpen={(t) => setSelectedId(t.id)} empty={q ? 'No calls match.' : 'No calls logged yet.'} />
        </>
      )}

      {creating && (
        <NewCallDrawer
          people={assignable}
          onClose={() => setCreating(false)}
          onSaved={(ref, to) => {
            setCreating(false);
            setToast(to ? `${ref} sent to ${to}. They've been emailed.` : `${ref} saved and closed.`);
            setTab(to ? 'open' : 'all');
            reload();
          }}
        />
      )}
      {selected && (
        <TicketDrawer ticket={selected} updates={updatesFor(selected.id)} people={people} personName={personName} onClose={() => setSelectedId(null)} onChanged={reload} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge, urgent }: { active: boolean; onClick: () => void; icon: typeof Inbox; label: string; badge?: number; urgent?: boolean }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {(badge ?? 0) > 0 && <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${urgent ? 'bg-orange-500' : 'bg-gray-400'}`}>{badge}</span>}
    </button>
  );
}
