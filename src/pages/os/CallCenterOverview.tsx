import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, Clock, Headphones, Megaphone, PhoneCall, PhoneIncoming, Radio, Siren, Timer, UserCheck, Wifi, WifiOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useCallTickets, isOverdue, isResponseOverdue, isUnresolved, CATEGORY_LABEL, STATUS_META } from '../../lib/callTickets';
import { CallCenterShift, durationLabel, SLOT_LABEL } from '../../lib/shifts';
import { DAILY_GOAL, OutreachCall } from '../../lib/outreach';
import { EntityLink } from '../../os/EntityLink';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import { today } from '../../lib/performance';
import { needsCall, presenceOf, stateOf, toExpected, useOnShift } from '../../lib/onShift';

const AGE = [
  { key: 'h2', label: 'Under 2 hours', max: 120 },
  { key: 'd1', label: '2–24 hours', max: 1440 },
  { key: 'd3', label: '1–3 days', max: 4320 },
  { key: 'old', label: 'Over 3 days', max: Infinity },
];

// The Call Center right now: who's on shift, open cases by age, what's
// overdue, call-backs due, and today's outreach against the goal.
export default function CallCenterOverview() {
  const { profile } = useAuth();
  const { tickets, personName, loading } = useCallTickets();
  const live = useQuery({
    queryKey: ['cc-live'], refetchInterval: 60_000,
    queryFn: async () => {
      const since = `${today()}T00:00:00+02:00`;
      const [shifts, calls] = await Promise.all([
        supabase.from('call_center_shifts').select('*').or(`status.eq.open,started_at.gte.${since}`).order('started_at', { ascending: false }),
        supabase.from('platform_outreach_calls').select('*').gte('created_at', since),
      ]);
      return { shifts: (shifts.data as CallCenterShift[]) ?? [], calls: (calls.data as OutreachCall[]) ?? [] };
    },
  });
  if (loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-card" />)}</div>;

  const now = Date.now();
  const open = tickets.filter(isUnresolved);
  const noReply = open.filter((t) => isResponseOverdue(t, now));
  const overdue = open.filter((t) => isOverdue(t, now));
  const callbacks = tickets.filter((t) => t.callback_at && new Date(t.callback_at).getTime() <= now + 30 * 60000 && t.status === 'resolved');
  const emergencies = tickets.filter((t) => t.priority === 'emergency' && !t.md_acknowledged_at);
  const todayList = tickets.filter((t) => t.created_at.slice(0, 10) === today());
  const solvedToday = todayList.filter((t) => t.resolved_on_call).length;
  const onShift = (live.data?.shifts ?? []).filter((s) => s.status === 'open');
  const todayShifts = live.data?.shifts ?? [];
  const calls = live.data?.calls ?? [];
  const agents = [...new Set(calls.map((c) => c.agent_id ?? ''))].map((id) => ({ id, n: calls.filter((c) => (c.agent_id ?? '') === id).length, yes: calls.filter((c) => (c.agent_id ?? '') === id && c.interested).length })).sort((a, b) => b.n - a.n);
  const ages = AGE.map((a, i) => ({ ...a, n: open.filter((t) => { const m = (now - new Date(t.created_at).getTime()) / 60000; return m < a.max && (i === 0 || m >= AGE[i - 1].max); }).length }));
  const maxAge = Math.max(1, ...ages.map((a) => a.n));
  const isCC = profile?.department?.slug === 'call_center';
  const byAge = [...open].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Radio} title="Call Center — live" subtitle={`${onShift.length} agent${onShift.length === 1 ? '' : 's'} on shift · refreshes every minute`}
        actions={isCC ? <Link to="/call-center/cases?new=call" className="btn-primary"><PhoneIncoming size={14} /> New call</Link> : undefined} />

      <StatGrid cols={4}>
        <StatCard to={isCC ? '/call-center/cases' : undefined} icon={PhoneCall} label="Open cases" value={open.length} sub={`${todayList.length} new today · ${solvedToday} solved on the call`} />
        <StatCard to={isCC ? '/call-center/cases' : undefined} icon={AlarmClock} label="No reply after 2 hours" value={noReply.length} tone={noReply.length ? 'danger' : 'success'} sub={`${overdue.length} past their resolution target`} />
        <StatCard to={isCC ? '/call-center/cases' : undefined} icon={Clock} label="Call-backs due" value={callbacks.length} tone={callbacks.length ? 'attention' : undefined} sub="Tell callers their case is resolved" />
        <StatCard icon={Siren} label="Emergencies to acknowledge" value={emergencies.length} tone={emergencies.length ? 'danger' : undefined} sub="Waiting for the MD" />
      </StatGrid>

      <OursOnShiftCard to={isCC ? '/call-center/on-shift' : '/fleet/on-shift'} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Box title="On shift now" icon={UserCheck} padded={false}>
          {onShift.length === 0 ? <EmptyState icon={Headphones} title="Nobody is on shift" body="Shifts start when an agent signs in." /> : (
            <ul className="divide-y divide-line-muted">
              {onShift.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-4 py-2.5">
                  <span className="w-2 h-2 rounded-full bg-success" />
                  {profile?.role === 'managing_director' ? <EntityLink type="agent" id={s.agent_id} label={personName(s.agent_id)} /> : <span className="text-body font-medium">{personName(s.agent_id)}</span>}
                  <span className="text-caption text-fg-muted">{SLOT_LABEL[s.slot].split(' ')[0]} · {s.station}</span>
                  <span className="ml-auto text-caption tabular-nums">{durationLabel((now - new Date(s.started_at).getTime()) / 60000)}</span>
                  {s.late_minutes > 10 && <Label tone="attention">{s.late_minutes} min late</Label>}
                </li>
              ))}
            </ul>
          )}
          {todayShifts.length > onShift.length && <p className="px-4 py-2 border-t border-line-muted text-caption text-fg-muted">{todayShifts.length - onShift.length} shift{todayShifts.length - onShift.length === 1 ? '' : 's'} already ended today</p>}
        </Box>
        <Box title="Open cases by age" icon={Timer}>
          <div className="space-y-2.5">
            {ages.map((a, i) => (
              <div key={a.key} className="grid grid-cols-[100px_1fr_28px] items-center gap-2 text-caption">
                <span className="text-fg-muted">{a.label}</span>
                <span className="h-3.5 rounded-r-[4px]" style={{ width: `${(a.n / maxAge) * 100}%`, minWidth: a.n ? 4 : 0, background: ['#2a78d6', '#eda100', '#eb6834', '#d03b3b'][i] }} />
                <span className="text-right tabular-nums font-medium">{a.n}</span>
              </div>
            ))}
          </div>
        </Box>
        <Box title="Outreach today" icon={Megaphone} right={<span className="text-caption text-fg-muted">goal {DAILY_GOAL} each</span>} padded={false}>
          {agents.length === 0 ? <p className="p-4 text-body text-fg-muted">No outreach calls yet today.</p> : (
            <ul className="divide-y divide-line-muted">
              {agents.map((a) => (
                <li key={a.id} className="px-4 py-2">
                  <div className="flex items-center justify-between text-body"><span>{personName(a.id)}</span><span className="tabular-nums text-caption">{a.n}/{DAILY_GOAL}{a.yes ? ` · ${a.yes} yes` : ''}</span></div>
                  <div className="h-1.5 mt-1 rounded-full bg-inset overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (a.n / DAILY_GOAL) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Box>
      </div>

      <Box title="Oldest open cases" icon={PhoneCall} padded={false}>
        {byAge.length === 0 ? <EmptyState icon={PhoneCall} title="No open cases" body="Every caller has an answer." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-body min-w-[700px]">
              <thead><tr className="text-caption text-fg-muted text-left border-b border-line-muted">{['Case', 'About', 'With', 'Status', 'Open for'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {byAge.slice(0, 15).map((t) => {
                  const m = (now - new Date(t.created_at).getTime()) / 60000;
                  return (
                    <tr key={t.id} className="border-b border-line-muted last:border-0 hover:bg-hover/50">
                      <td className="px-4 py-2"><EntityLink type="case" id={t.id} label={`${t.reference} · ${t.caller_name}`} /></td>
                      <td className="px-4 py-2 text-fg-muted">{CATEGORY_LABEL[t.category]}</td>
                      <td className="px-4 py-2">{t.assignee_id ? personName(t.assignee_id) : <span className="text-fg-subtle">Nobody</span>}</td>
                      <td className="px-4 py-2"><Label tone={isResponseOverdue(t, now) || isOverdue(t, now) ? 'danger' : 'attention'}>{STATUS_META[t.status].label}</Label></td>
                      <td className="px-4 py-2 tabular-nums">{durationLabel(m)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </div>
  );
}

// Our drivers who should be driving now, and who is offline in the app: checking
// it is one of the agents' daily tasks (Ours On Shift).
function OursOnShiftCard({ to }: { to: string }) {
  const d = useOnShift();
  if (d.loading) return <div className="h-20 skeleton rounded-card mb-4" />;
  const rows = d.roster.filter((r) => !r.blocked && Date.parse(r.starts_at) <= d.now && d.now < Date.parse(r.ends_at)).map((r) => {
    const e = toExpected(r);
    return { r, p: presenceOf(e, stateOf(e, d.states), d.now) };
  });
  const unique = [...new Map(rows.map((x) => [x.r.driver_id ?? x.r.key, x])).values()];
  const online = unique.filter((x) => x.p.presence === 'online').length;
  const call = unique.filter((x) => needsCall(x.p));
  return (
    <section className={`card p-4 mb-4 ${call.length ? 'border-danger/50' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        {call.length ? <WifiOff size={18} className="text-danger" /> : <Wifi size={18} className="text-success" />}
        <p className="text-body flex-1 min-w-[220px]"><b>Ours On Shift:</b> {unique.length} of our drivers should be driving now · <b className="text-success">{online} online</b>{call.length ? <> · <b className="text-danger">{call.length} offline — call them</b></> : ' · nobody to call'}</p>
        <Link to={to} className={call.length ? 'btn-primary h-8' : 'btn-secondary h-8'}>Open Ours On Shift</Link>
      </div>
      {call.length > 0 && <p className="mt-2 text-small text-fg-muted">{call.slice(0, 6).map((x) => `${x.r.name} (${x.r.plate ?? '—'})`).join(' · ')}{call.length > 6 ? ` · +${call.length - 6} more` : ''}</p>}
    </section>
  );
}
