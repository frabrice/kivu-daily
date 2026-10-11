import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlarmClock, AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Clock, Megaphone, MessageSquareText, PhoneIncoming, PhoneOutgoing, Smile, Ticket } from 'lucide-react';
import { supabase, CallTicket } from '../../lib/supabase';
import { CallCenterShift, durationLabel, SLOT_LABEL } from '../../lib/shifts';
import { CATEGORY_LABEL } from '../../lib/callTickets';
import { OutreachCall, RESULT_LABEL } from '../../lib/outreach';
import ShiftReportModal, { shiftMinutes } from '../../components/callCenter/ShiftReportModal';
import { ChartCard, DailyBars, dayList, Empty, Kpi, kigaliDay, longDay, MiniTable, pct, RangeTabs, RankBars, STATUS, usePalette } from '../../components/charts/kit';

type Range = 7 | 30 | 90 | 0;
const RANGES: { v: Range; label: string }[] = [{ v: 7, label: '7 days' }, { v: 30, label: '30 days' }, { v: 90, label: '90 days' }, { v: 0, label: 'All time' }];

type StartTone = 'good' | 'warning' | 'serious' | 'critical';
const startTone = (s: CallCenterShift): StartTone => (s.status === 'auto_closed' ? 'critical' : s.late_minutes > 30 ? 'serious' : s.late_minutes > 10 ? 'warning' : 'good');
const TONE_LABEL: Record<StartTone, string> = { good: 'On time', warning: 'Late 11–30 min', serious: 'Late 30+ min', critical: 'Not ended' };
const SLOT_LETTER = { morning: 'M', afternoon: 'A', night: 'N' } as const;
const kTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });

interface Metrics {
  shifts: number; days: number; minutes: number; onTime: number; late: number; lateMinutes: number; notEnded: number;
  received: number; made: number; missed: number; contacts: number; solved: number; closed: number; outreach: number; interested: number;
}
function metricsOf(list: CallCenterShift[]): Metrics {
  const sum = (f: (s: CallCenterShift) => number) => list.reduce((a, s) => a + f(s), 0);
  const late = list.filter((s) => s.late_minutes > 10);
  return {
    shifts: list.length, days: new Set(list.map((s) => kigaliDay(s.started_at))).size, minutes: sum(shiftMinutes),
    onTime: list.filter((s) => s.late_minutes <= 10).length, late: late.length, lateMinutes: late.reduce((a, s) => a + s.late_minutes, 0),
    notEnded: list.filter((s) => s.status === 'auto_closed').length,
    received: sum((s) => Number(s.report.calls_received ?? 0)), made: sum((s) => Number(s.report.calls_made ?? 0)), missed: sum((s) => Number(s.report.calls_missed ?? 0)),
    contacts: sum((s) => s.stats.contacts_logged ?? 0), solved: sum((s) => s.stats.solved_on_call ?? 0), closed: sum((s) => s.stats.cases_closed ?? 0),
    outreach: sum((s) => s.stats.outreach_calls ?? 0), interested: sum((s) => s.stats.outreach_interested ?? 0),
  };
}

// MD: everything about one Call Center agent - which days they worked and
// when they started, their calls, cases, outreach and what they wrote in
// their shift reports - next to the team average.
export default function AgentPerformancePage({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const c = usePalette();
  const [range, setRange] = useState<Range>(30);
  const [profile, setProfile] = useState<{ full_name: string; email: string | null; is_active: boolean; created_at: string } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [allShifts, setAllShifts] = useState<CallCenterShift[]>([]);
  const [tickets, setTickets] = useState<CallTicket[]>([]);
  const [outreach, setOutreach] = useState<OutreachCall[]>([]);
  const [open, setOpen] = useState<CallCenterShift | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('profiles').select('id, full_name, email, is_active, created_at'),
      supabase.from('call_center_shifts').select('*').order('started_at', { ascending: false }).limit(5000),
      supabase.from('call_tickets').select('id, reference, category, status, priority, created_at, assigned_at, first_response_at, resolved_on_call, satisfaction, created_by, assignee_id, closed_by, resolved_by, closed_at, resolved_at')
        .or(`created_by.eq.${agentId},assignee_id.eq.${agentId},closed_by.eq.${agentId},resolved_by.eq.${agentId}`).limit(5000),
      supabase.from('platform_outreach_calls').select('*').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(5000),
    ]).then(([p, s, t, o]) => {
      const people = (p.data as { id: string; full_name: string; email: string | null; is_active: boolean; created_at: string }[]) ?? [];
      setNames(Object.fromEntries(people.map((x) => [x.id, x.full_name.trim()])));
      setProfile(people.find((x) => x.id === agentId) ?? null);
      setAllShifts((s.data as CallCenterShift[]) ?? []);
      setTickets((t.data as CallTicket[]) ?? []);
      setOutreach((o.data as OutreachCall[]) ?? []);
      setLoading(false);
    });
  }, [agentId]);

  const today = kigaliDay(new Date());
  const mineAll = useMemo(() => allShifts.filter((s) => s.agent_id === agentId), [allShifts, agentId]);
  const firstDay = mineAll.length ? kigaliDay(mineAll[mineAll.length - 1].started_at) : today;
  const since = range ? kigaliDay(new Date(Date.now() - (range - 1) * 86400000)) : firstDay;
  const inRange = (iso: string) => kigaliDay(iso) >= since;
  const mine = mineAll.filter((s) => inRange(s.started_at));
  const m = metricsOf(mine);

  // Team: every agent with a shift in the same period, for averages and ranks.
  const team = useMemo(() => {
    const by = new Map<string, CallCenterShift[]>();
    for (const s of allShifts) if (kigaliDay(s.started_at) >= since) by.set(s.agent_id, [...(by.get(s.agent_id) ?? []), s]);
    return [...by.entries()].map(([id, list]) => ({ id, ...metricsOf(list) }));
  }, [allShifts, since]);
  const avg = (f: (x: Metrics) => number | null) => {
    const v = team.map(f).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const onTimeRate = (x: Metrics) => (x.shifts ? (x.onTime / x.shifts) * 100 : null);
  const madePerHour = (x: Metrics) => (x.minutes ? x.made / (x.minutes / 60) : null);
  const solvedRate = (x: Metrics) => (x.contacts ? (x.solved / x.contacts) * 100 : null);
  const rankOf = (f: (x: Metrics) => number | null) => {
    const mineV = f(m);
    if (mineV === null || team.length < 2) return null;
    return 1 + team.filter((x) => (f(x) ?? -Infinity) > mineV).length;
  };
  const vsTeam = (f: (x: Metrics) => number | null, fmt: (n: number) => string) => {
    const a = avg(f);
    const r = rankOf(f);
    return a === null ? undefined : <>Team average {fmt(a)}{r ? <span className="text-gray-400"> · #{r} of {team.length}</span> : null}</>;
  };

  const myTickets = tickets.filter((t) => inRange(t.created_at));
  const logged = myTickets.filter((t) => t.created_by === agentId);
  const assigned = myTickets.filter((t) => t.assignee_id === agentId);
  const closedByMe = tickets.filter((t) => (t.closed_by === agentId || t.resolved_by === agentId) && inRange(t.closed_at ?? t.resolved_at ?? t.created_at));
  const responseMins = assigned.filter((t) => t.first_response_at).map((t) => (new Date(t.first_response_at!).getTime() - new Date(t.assigned_at ?? t.created_at).getTime()) / 60000).filter((n) => n >= 0);
  const avgResponse = responseMins.length ? responseMins.reduce((a, b) => a + b, 0) / responseMins.length : null;
  const rated = logged.filter((t) => t.satisfaction);
  const happy = rated.filter((t) => t.satisfaction === 'happy').length;
  const byCategory = Object.entries(logged.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.category]: (acc[t.category] ?? 0) + 1 }), {}))
    .map(([k, n]) => ({ key: k, label: CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k, n })).sort((a, b) => b.n - a.n);

  const myOutreach = outreach.filter((o) => inRange(o.created_at));
  const oReached = myOutreach.filter((o) => o.result === 'reached').length;
  const oYes = myOutreach.filter((o) => o.interested).length;

  const days = dayList(since, today);
  const daily = days.map((d) => {
    const ss = mine.filter((s) => kigaliDay(s.started_at) === d);
    const oo = myOutreach.filter((o) => kigaliDay(o.created_at) === d);
    return {
      day: d,
      received: ss.reduce((a, s) => a + Number(s.report.calls_received ?? 0), 0),
      made: ss.reduce((a, s) => a + Number(s.report.calls_made ?? 0), 0),
      hours: Math.round((ss.reduce((a, s) => a + shiftMinutes(s), 0) / 60) * 10) / 10,
      reached: oo.filter((o) => o.result === 'reached').length,
      no_answer: oo.filter((o) => o.result === 'no_answer').length,
      callback: oo.filter((o) => o.result === 'callback').length,
      wrong_number: oo.filter((o) => o.result === 'wrong_number').length,
    };
  });
  const callSeries = [{ key: 'received', label: 'Calls received', color: c.blue }, { key: 'made', label: 'Calls made', color: c.orange }] as const;
  const outreachSeries = [
    { key: 'reached', label: RESULT_LABEL.reached, color: c.blue },
    { key: 'no_answer', label: RESULT_LABEL.no_answer, color: c.orange },
    { key: 'callback', label: RESULT_LABEL.callback, color: c.aqua },
    { key: 'wrong_number', label: RESULT_LABEL.wrong_number, color: c.other },
  ] as const;
  const starts = [...mine].reverse().map((s) => ({ key: s.id, label: `${longDay(kigaliDay(s.started_at))} · ${SLOT_LETTER[s.slot]}`, late: Math.max(0, s.late_minutes), tone: startTone(s), shift: s }));
  const writings = mine.filter((s) => [s.report.problems, s.report.suggestions, s.report.feedback, s.report.unresolved_summary].some((v) => v && v.trim())).slice(0, 12);
  const name = (id: string | null) => (id ? names[id] ?? '—' : '—');

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2">
          <button onClick={onBack} className="btn-ghost p-1.5 mt-0.5" aria-label="Back"><ArrowLeft size={16} /></button>
          <div>
            <h2 className="text-base font-semibold">{profile?.full_name.trim() ?? 'Agent'}{profile && !profile.is_active && <span className="ml-2 text-[11px] font-normal text-gray-400">(left)</span>}</h2>
            <p className="text-[11px] text-gray-500">
              Call Center agent · {mineAll.length} shift{mineAll.length === 1 ? '' : 's'} since {longDay(firstDay)}
              {mineAll[0] && <> · last shift {longDay(kigaliDay(mineAll[0].started_at))}</>}
            </p>
          </div>
        </div>
        <RangeTabs value={range} onChange={setRange} options={RANGES} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={CalendarDays} label="Days worked" value={m.days} sub={`${m.shifts} shift${m.shifts === 1 ? '' : 's'} · ${durationLabel(m.minutes)} on shift${m.shifts ? ` · ${durationLabel(m.minutes / m.shifts)} each` : ''}`} />
        <Kpi icon={AlarmClock} label="Started on time" value={m.shifts ? `${pct(m.onTime, m.shifts)}%` : '—'} tone={m.shifts && (pct(m.onTime, m.shifts) ?? 100) < 80 ? 'bad' : undefined}
          sub={m.late ? `${m.late} late start${m.late === 1 ? '' : 's'}, ${Math.round(m.lateMinutes / m.late)} min late on average` : 'No late starts'} compare={vsTeam(onTimeRate, (n) => `${Math.round(n)}%`)} />
        <Kpi icon={PhoneIncoming} label="Calls received" value={m.received} sub={`${m.missed} missed${m.received + m.missed ? ` (${pct(m.missed, m.received + m.missed)}%)` : ''}`} />
        <Kpi icon={PhoneOutgoing} label="Calls made" value={m.made} sub={m.minutes ? `${(m.made / (m.minutes / 60)).toFixed(1)} per hour on shift` : '—'} compare={vsTeam(madePerHour, (n) => `${n.toFixed(1)}/hour`)} />
        <Kpi icon={CheckCircle2} label="Solved on the spot" value={m.contacts ? `${pct(m.solved, m.contacts)}%` : '—'} sub={`${m.contacts} contacts logged · ${m.closed} cases closed on shift`} compare={vsTeam(solvedRate, (n) => `${Math.round(n)}%`)} />
        <Kpi icon={Ticket} label="Cases" value={logged.length} sub={`logged · ${assigned.length} assigned to them · ${closedByMe.length} closed by them`}
          compare={avgResponse !== null ? <>First reply after {durationLabel(avgResponse)} on average</> : undefined} />
        <Kpi icon={Megaphone} label="Outreach calls" value={myOutreach.length} sub={myOutreach.length ? `${pct(oReached, myOutreach.length)}% reached · ${oYes} said yes to something` : 'None in this period'} />
        <Kpi icon={AlertTriangle} label="Shifts not ended" value={m.notEnded} tone={m.notEnded ? 'bad' : undefined}
          sub={rated.length ? <><Smile size={11} className="inline -mt-0.5" /> {pct(happy, rated.length)}% happy callers ({rated.length} rated)</> : 'Shift closed automatically, no report'} />
      </div>

      <StartsCalendar days={days} shifts={mine} onOpen={setOpen} />

      <ChartCard title="Minutes late at each start" subtitle="On time = started within 10 minutes of the shift start. Click a bar for that shift's report."
        table={<MiniTable head={['Shift', 'Started', 'Minutes late', 'Status']} rows={[...starts].reverse().map((s) => [s.label, kTime(s.shift.started_at), s.late, TONE_LABEL[s.tone]])} />}>
        {starts.length === 0 ? <Empty>No shifts in this period.</Empty> : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(Object.keys(TONE_LABEL) as StartTone[]).map((t) => <span key={t} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS[t] }} />{TONE_LABEL[t]} <b>{starts.filter((s) => s.tone === t).length}</b></span>)}
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={starts} margin={{ top: 4, right: 4, left: -12, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip cursor={{ fill: c.grid }} content={({ active, payload }) => {
                    const s = active && payload?.[0] ? (payload[0].payload as (typeof starts)[number]) : null;
                    return s ? (
                      <div className="rounded-lg border border-gray-100 dark:border-white/10 bg-white dark:bg-navy-700 shadow-lg px-3 py-2 text-[11px]">
                        <p className="font-semibold">{SLOT_LABEL[s.shift.slot]} · {longDay(kigaliDay(s.shift.started_at))}</p>
                        <p className="text-gray-600 dark:text-gray-300">Started {kTime(s.shift.started_at)} · {s.late ? `${s.late} min late` : 'on time'}</p>
                        <p className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300"><span className="w-2 h-2 rounded-sm" style={{ background: STATUS[s.tone] }} />{TONE_LABEL[s.tone]}</p>
                      </div>
                    ) : null;
                  }} />
                  <Bar dataKey="late" radius={[4, 4, 0, 0]} minPointSize={3} isAnimationActive={false} onClick={(d) => setOpen((d as unknown as { shift: CallCenterShift }).shift)} cursor="pointer">
                    {starts.map((s) => <Cell key={s.key} fill={STATUS[s.tone]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Calls per day" subtitle="From their shift reports" legend={callSeries}
          table={<MiniTable head={['Day', 'Received', 'Made', 'Hours']} rows={[...daily].reverse().filter((d) => d.received || d.made || d.hours).map((d) => [longDay(d.day), d.received, d.made, d.hours])} />}>
          {m.received + m.made === 0 ? <Empty>No calls reported in this period.</Empty> : <DailyBars data={daily} series={callSeries} c={c} />}
        </ChartCard>
        <ChartCard title="Outreach calls per day" subtitle={`Non-Insider drivers · ${oYes} said yes to the app, device or branding`} legend={outreachSeries}
          table={<MiniTable head={['Day', 'Reached', 'No answer', 'Call back', 'Wrong number']} rows={[...daily].reverse().filter((d) => d.reached + d.no_answer + d.callback + d.wrong_number).map((d) => [longDay(d.day), d.reached, d.no_answer, d.callback, d.wrong_number])} />}>
          {myOutreach.length === 0 ? <Empty>No outreach calls in this period.</Empty> : <DailyBars data={daily} series={outreachSeries} c={c} />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="What their cases are about" subtitle={`${logged.length} contacts and cases they logged, by Script Book section`}>
          <RankBars rows={byCategory} color={c.blue} empty="No cases logged in this period." />
        </ChartCard>
        <div className="card p-4 space-y-3 min-w-0">
          <p className="text-[13px] font-semibold flex items-center gap-1.5"><MessageSquareText size={14} /> What they wrote in their shift reports</p>
          {writings.length === 0 ? <Empty>No problems, suggestions or feedback written in this period.</Empty> : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {writings.map((s) => (
                <button key={s.id} onClick={() => setOpen(s)} className="block w-full text-left rounded-lg border border-gray-100 dark:border-white/10 p-2.5 hover:border-brand/40">
                  <p className="text-[10px] text-gray-400 mb-1">{longDay(kigaliDay(s.started_at))} · {SLOT_LABEL[s.slot].split(' ')[0]}</p>
                  {([['Problems', s.report.problems], ['Still unresolved', s.report.unresolved_summary], ['Caller feedback', s.report.feedback], ['Suggestions', s.report.suggestions]] as [string, string | undefined][])
                    .filter(([, v]) => v && v.trim()).map(([l, v]) => <p key={l} className="text-[12px]"><span className="font-semibold text-gray-500">{l}: </span>{v}</p>)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <p className="text-[13px] font-semibold px-4 pt-4 pb-2 flex items-center gap-1.5"><Clock size={14} /> Every shift</p>
        {mine.length === 0 ? <Empty>No shifts in this period.</Empty> : (
          <table className="w-full text-[12px] min-w-[760px]">
            <thead><tr className="text-[11px] text-gray-400 border-b border-gray-100 dark:border-white/5 text-left">
              {['Day', 'Shift', 'Started', 'Ended', 'Time', 'Start', 'In / out / missed', 'Logged', 'Outreach', 'Partner'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {mine.map((s) => {
                const tone = startTone(s);
                return (
                  <tr key={s.id} onClick={() => setOpen(s)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td className="px-3 py-2 whitespace-nowrap">{longDay(kigaliDay(s.started_at))}</td>
                    <td className="px-3 py-2">{SLOT_LABEL[s.slot].split(' ')[0]}</td>
                    <td className="px-3 py-2 tabular-nums">{kTime(s.started_at)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.ended_at ? kTime(s.ended_at) : s.status === 'open' ? 'now' : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{durationLabel(shiftMinutes(s))}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATUS[tone] }} />{tone === 'good' ? 'On time' : tone === 'critical' ? 'Not ended' : `${s.late_minutes} min late`}</span></td>
                    <td className="px-3 py-2 tabular-nums">{s.report.calls_received ?? 0} / {s.report.calls_made ?? 0} / {s.report.calls_missed ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{s.stats.contacts_logged ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{s.stats.outreach_calls ?? 0}</td>
                    <td className="px-3 py-2 text-gray-500">{s.partner_id ? name(s.partner_id) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && <ShiftReportModal shift={open} name={name} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Calendar of the period, Monday-first: which days they worked, which
// shift (M/A/N) and how the start went.
function StartsCalendar({ days, shifts, onOpen }: { days: string[]; shifts: CallCenterShift[]; onOpen: (s: CallCenterShift) => void }) {
  const shown = days.slice(-91);
  if (!shown.length) return null;
  const lead = (new Date(`${shown[0]}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...shown];
  const byDay = new Map<string, CallCenterShift[]>();
  for (const s of shifts) { const d = kigaliDay(s.started_at); byDay.set(d, [...(byDay.get(d) ?? []), s]); }
  const worked = shown.filter((d) => byDay.has(d)).length;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">Days and starts</p>
          <p className="text-[11px] text-gray-500">Worked {worked} of {shown.length} days{days.length > 91 ? ' (last 13 weeks shown)' : ''} · M = morning, A = afternoon, N = night. Click a shift for its report.</p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(TONE_LABEL) as StartTone[]).map((t) => <span key={t} className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS[t] }} />{TONE_LABEL[t]}</span>)}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 max-w-[560px]">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="text-[10px] text-gray-400 text-center">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const list = byDay.get(d) ?? [];
          return (
            <div key={d} title={`${longDay(d)}${list.length ? '' : ' · no shift'}`} className={`rounded-md border p-1 min-h-[44px] ${list.length ? 'border-gray-200 dark:border-white/10' : 'border-dashed border-gray-100 dark:border-white/5'}`}>
              <p className="text-[9px] text-gray-400 leading-none">{Number(d.slice(8))}{d.slice(8) === '01' ? ` ${new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })}` : ''}</p>
              <div className="flex flex-wrap gap-0.5 mt-1">
                {list.map((s) => {
                  const tone = startTone(s);
                  return (
                    <button key={s.id} onClick={() => onOpen(s)} title={`${SLOT_LABEL[s.slot]} · started ${kTime(s.started_at)} · ${TONE_LABEL[tone]}`}
                      className="text-[9px] font-bold leading-none px-1 py-0.5 rounded text-white" style={{ background: STATUS[tone], color: tone === 'warning' ? '#3a2a00' : '#fff' }}>
                      {SLOT_LETTER[s.slot]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
