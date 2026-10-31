import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlarmClock, AlertTriangle, BarChart3, CalendarDays, Car, CheckCircle2, Clock, FileText, Headphones, Lightbulb, ListChecks, PhoneIncoming, Printer, Smartphone, Timer, Trophy, Users, XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { CallCenterShift, durationLabel, SLOT_LABEL, ShiftSlot } from '../../lib/shifts';
import { fmtRwf, kTime, localPhone } from '../../lib/dispatch';
import {
  AgentRow, Booking, BookingStats, Outcome, OUTCOME_LABEL, OUTCOME_SHORT, ReportData, SOURCE_LABEL, addDays, agentRows, bookingStats, carRate, dayOf, daysBetween,
  FIRST_DAY, fmtWait, inShift, loadReport, shiftStats, todayK, wrongSlot,
} from '../../lib/ccReports';
import { ChartCard, DailyBars, DailyLines, Delta, Empty, Kpi, MiniTable, RankBars, STATUS, dayList, longDay, usePalette } from '../../components/charts/kit';
import { Label, PageHeader, UnderlineTabs } from '../../ui/kit';
import Modal from '../../components/Modal';
import LiveTrip from '../../components/dispatch/LiveTrip';
import { ShiftReportBody } from '../../components/callCenter/ShiftReportModal';

// Call Center > Reports (/call-center/reports): did every booking get a car?
// App bookings and hotline dispatches (Kivu Daily and the admin dashboard)
// next to the shifts and what the agents wrote in their shift reports, for
// any day or range. The MD sees the whole team and ranks the agents; an
// agent sees their own shifts. See lib/ccReports.ts for where each number
// comes from.

type Tab = 'overview' | 'agents' | 'bookings' | 'shifts';
type Ch = 'all' | 'app' | 'hotline';
const SLOTS: ShiftSlot[] = ['morning', 'afternoon', 'night'];
const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fullDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const showPct = (v: number | null) => (v == null ? '—' : `${v}%`);

export default function ReportsPage() {
  usePageTitle('Call Center reports');
  const { profile } = useAuth();
  const a = useAccess();
  const c = usePalette();
  const [params, setParams] = useSearchParams();
  const today = todayK();
  const from = isDay(params.get('from')) ? params.get('from')! : today;
  const to = isDay(params.get('to')) && params.get('to')! >= from ? params.get('to')! : from;
  const agent = a.isMd ? params.get('agent') || null : profile?.id ?? null;
  const slot = (SLOTS as string[]).includes(params.get('slot') ?? '') ? (params.get('slot') as ShiftSlot) : null;
  const ch = (['app', 'hotline'].includes(params.get('ch') ?? '') ? params.get('ch') : 'all') as Ch;
  const tab = ((['overview', 'agents', 'bookings', 'shifts'] as Tab[]).includes(params.get('tab') as Tab) ? params.get('tab') : 'overview') as Tab;
  const setQ = (patch: Record<string, string | null>) => setParams((p) => {
    const n = new URLSearchParams(p);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    return n;
  }, { replace: true });

  // This period and the one just before it, for the comparisons.
  // All time has no period before it.
  const allTime = from <= FIRST_DAY;
  const len = daysBetween(from, to);
  const prevFrom = allTime ? from : addDays(from, -len);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setLoading(true);
    loadReport(prevFrom, to).then((d) => { setData(d); setLoading(false); });
  }, [prevFrom, to, reload]);

  const view = useMemo(() => {
    if (!data) return null;
    const cut = (lo: string, hi: string) => {
      const shifts = data.shifts.filter((s) => dayOf(s.started_at) >= lo && dayOf(s.started_at) <= hi);
      const scoped = shifts.filter((s) => (!agent || s.agent_id === agent) && (!slot || s.slot === slot));
      let bookings = data.bookings.filter((b) => b.day >= lo && b.day <= hi);
      if (agent || slot) bookings = bookings.filter((b) => (agent && b.by === agent) || (!(b.channel === 'hotline' && b.by && b.by !== agent) && scoped.some((s) => inShift(s, b.at))));
      if (ch !== 'all') bookings = bookings.filter((b) => b.channel === ch);
      // The whole team's bookings in the days, for comparing one agent with the others.
      const team = data.bookings.filter((b) => b.day >= lo && b.day <= hi && (ch === 'all' || b.channel === ch));
      return { shifts: scoped, allShifts: shifts, bookings, team };
    };
    return { cur: cut(from, to), prev: cut(prevFrom, addDays(from, -1)) };
  }, [data, from, to, prevFrom, agent, slot, ch]);

  const people = data?.people ?? [];
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.full_name ?? '—' : '—');
  const agents = people.filter((p) => p.dept === 'call_center' || (data?.shifts ?? []).some((s) => s.agent_id === p.id))
    .sort((x, y) => Number(y.is_active) - Number(x.is_active) || x.full_name.localeCompare(y.full_name));
  const quick: [string, string, string][] = [['Today', today, today], ['Yesterday', addDays(today, -1), addDays(today, -1)], ['Last 7 days', addDays(today, -6), today], ['This month', `${today.slice(0, 8)}01`, today], ['All time', FIRST_DAY, today]];
  const tabs = [
    { key: 'overview' as Tab, label: 'Overview', icon: BarChart3 },
    ...(a.isMd ? [{ key: 'agents' as Tab, label: 'Agents', icon: Users }] : []),
    { key: 'bookings' as Tab, label: 'Bookings', icon: Car, count: view?.cur.bookings.filter((b) => b.outcome === 'no_car').length || undefined, tone: 'danger' as const },
    { key: 'shifts' as Tab, label: 'Shift reports', icon: FileText },
  ];

  return (
    <div className="space-y-4">
      <PageHeader icon={BarChart3} title={agent ? `Reports · ${nameOf(agent)}` : 'Call Center reports'}
        subtitle={`${from === to ? fullDay(from) : `${fullDay(from)} to ${fullDay(to)}`} · did every app booking and hotline call get a car?`}
        actions={<button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer size={14} /> Print</button>} />

      <div className="card p-3 space-y-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2 text-small">
          {quick.map(([l, f, t]) => (
            <button key={l} className={`px-2.5 py-1 rounded-md border ${from === f && to === t ? 'border-brand text-brand bg-brand/5 font-medium' : 'border-line text-fg-muted hover:border-brand/40'}`} onClick={() => setQ({ from: f, to: t })}>{l}</button>
          ))}
          <span className="flex items-center gap-1.5 sm:ml-auto flex-wrap">
            <CalendarDays size={14} className="text-fg-subtle" />
            <input type="date" className="input !w-auto py-1" value={from} min={FIRST_DAY} max={today} aria-label="From" onChange={(e) => e.target.value && setQ({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} />
            <span className="text-fg-subtle">to</span>
            <input type="date" className="input !w-auto py-1" value={to} min={from} max={today} aria-label="To" onChange={(e) => e.target.value && setQ({ to: e.target.value })} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-small">
          {a.isMd && (
            <select className="input !w-auto py-1" value={agent ?? ''} aria-label="Agent" onChange={(e) => setQ({ agent: e.target.value || null })}>
              <option value="">All agents</option>
              {agents.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.is_active ? '' : ' (left)'}</option>)}
            </select>
          )}
          <select className="input !w-auto py-1" value={slot ?? ''} aria-label="Shift" onChange={(e) => setQ({ slot: e.target.value || null })}>
            <option value="">All shifts</option>
            {SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
          </select>
          <div className="flex gap-0.5 p-0.5 bg-inset rounded-lg" role="radiogroup" aria-label="Channel">
            {([['all', 'App + hotline'], ['app', 'App'], ['hotline', 'Hotline']] as [Ch, string][]).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={ch === k} onClick={() => setQ({ ch: k === 'all' ? null : k })}
                className={`px-2.5 py-1 rounded-md text-small font-medium ${ch === k ? 'bg-surface-3 shadow-sm text-brand' : 'text-fg-muted'}`}>{l}</button>
            ))}
          </div>
          {(agent && a.isMd) || slot || ch !== 'all' ? <button className="btn-ghost text-caption" onClick={() => setQ({ agent: null, slot: null, ch: null })}>Clear filters</button> : null}
        </div>
      </div>

      <UnderlineTabs tabs={tabs} value={tab} onChange={(k) => setQ({ tab: k === 'overview' ? null : k })} />

      {loading || !view || !data ? <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>
        : tab === 'overview' ? <Overview cur={view.cur} prev={view.prev} from={from} to={to} c={c} agent={agent} rows={agentRows(data, view.cur.allShifts.filter((s) => !slot || s.slot === slot), view.cur.team)} />
        : tab === 'agents' && a.isMd ? <Agents data={data} rows={agentRows(data, view.cur.allShifts.filter((s) => !slot || s.slot === slot), view.cur.team)} c={c}
            onOpen={(id) => setQ({ agent: id, tab: 'shifts' })} onSaved={() => setReload((n) => n + 1)} />
        : tab === 'bookings' ? <Bookings list={view.cur.bookings} shifts={view.cur.allShifts} nameOf={nameOf} initial={params.get('outcome') as Outcome | null} canCancel={a.isMd || a.dept === 'call_center'} />
        : <Shifts shifts={view.cur.shifts} bookings={view.cur.bookings} nameOf={nameOf} agent={agent} canCancel={a.isMd || a.dept === 'call_center'} />}
    </div>
  );
}

// ------------------------------------------------------------------ overview
type Slice = { shifts: CallCenterShift[]; allShifts: CallCenterShift[]; bookings: Booking[]; team: Booking[] };
const OUTCOME_SERIES = (c: ReturnType<typeof usePalette>) => [
  { key: 'completed', label: 'Completed', color: c.aqua },
  { key: 'cancelled_after', label: 'Cancelled after a driver', color: c.yellow },
  { key: 'no_car', label: 'No car', color: STATUS.critical },
  { key: 'running', label: 'Running / other', color: c.other },
] as const;
const countBy = (list: Booking[]) => ({
  completed: list.filter((b) => b.outcome === 'completed').length, cancelled_after: list.filter((b) => b.outcome === 'cancelled_after').length,
  no_car: list.filter((b) => b.outcome === 'no_car').length, running: list.filter((b) => b.outcome === 'running' || b.outcome === 'failed').length,
});

function Overview({ cur, prev, from, to, c, agent, rows }: { cur: Slice; prev: Slice; from: string; to: string; c: ReturnType<typeof usePalette>; agent: string | null; rows: AgentRow[] }) {
  const s = bookingStats(cur.bookings), p = bookingStats(prev.bookings);
  const app = bookingStats(cur.bookings.filter((b) => b.channel === 'app')), hot = bookingStats(cur.bookings.filter((b) => b.channel === 'hotline'));
  const sh = shiftStats(cur.shifts), psh = shiftStats(prev.shifts);
  const rate = carRate(s), prate = carRate(p);
  const series = OUTCOME_SERIES(c);
  const days = dayList(from, to);
  const perDay = days.map((d) => ({ day: d, ...countBy(cur.bookings.filter((b) => b.day === d)) }));
  const rateDay = days.map((d) => {
    // A day with fewer than 3 bookings on a channel says little: left blank.
    const at = (chn: string) => { const st = bookingStats(cur.bookings.filter((b) => b.day === d && b.channel === chn)); return st.n >= 3 ? carRate(st) : null; };
    return { day: d, app: at('app'), hotline: at('hotline') };
  });
  const perHour = Array.from({ length: 24 }, (_, h) => ({ hour: String(h), ...countBy(cur.bookings.filter((b) => b.hour === h)) }));
  const bySource = (['app', 'kivu_daily', 'dashboard'] as const).map((src) => ({ label: SOURCE_LABEL[src], ...countBy(cur.bookings.filter((b) => b.source === src)) })).filter((r) => r.completed + r.cancelled_after + r.no_car + r.running);
  const slotOf = (b: Booking) => cur.allShifts.find((x) => inShift(x, b.at))?.slot ?? null;
  const bySlot = [...SLOTS.map((sl) => ({ label: SLOT_LABEL[sl].split(' ')[0], ...countBy(cur.bookings.filter((b) => slotOf(b) === sl)) })), { label: 'No shift', ...countBy(cur.bookings.filter((b) => !slotOf(b))) }]
    .filter((r) => r.completed + r.cancelled_after + r.no_car + r.running);
  const calls = days.map((d) => {
    const ss = cur.shifts.filter((x) => dayOf(x.started_at) === d);
    return { day: d, received: ss.reduce((n, x) => n + Number(x.report.calls_received ?? 0), 0), made: ss.reduce((n, x) => n + Number(x.report.calls_made ?? 0), 0), missed: ss.reduce((n, x) => n + Number(x.report.calls_missed ?? 0), 0) };
  });
  const tbl = (rowsIn: { label?: string; day?: string; hour?: string; completed: number; cancelled_after: number; no_car: number; running: number }[], first: string) =>
    <MiniTable head={[first, 'Completed', 'Cancelled after driver', 'No car', 'Running', 'Got a car']} rows={rowsIn.filter((r) => r.completed + r.cancelled_after + r.no_car + r.running).map((r) => {
      const n = r.completed + r.cancelled_after + r.no_car;
      return [r.label ?? (r.day ? longDay(r.day) : `${r.hour}:00`), r.completed, r.cancelled_after, r.no_car, r.running, showPct(pctOf(r.completed + r.cancelled_after, n))];
    })} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Car} label="Bookings that needed a car" value={s.n} sub={`${app.n} app · ${hot.n} hotline`} compare={<Delta now={s.n} before={p.n} />} />
        <Kpi icon={CheckCircle2} label="Got a car" value={showPct(rate)} tone={rate != null && rate < 70 ? 'bad' : undefined}
          sub={`${s.gotCar} of ${s.n - s.failed - s.pending} · app ${showPct(carRate(app))}, hotline ${showPct(carRate(hot))}`}
          compare={rate != null && prate != null ? <span className={rate >= prate ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{rate >= prate ? '▲' : '▼'} {Math.abs(rate - prate)} points vs the period before</span> : undefined} />
        <Kpi icon={XCircle} label="No car" value={s.noCar} tone={s.noCar ? 'bad' : undefined} sub="Cancelled before any driver accepted" compare={<Delta now={s.noCar} before={p.noCar} goodWhenUp={false} />} />
        <Kpi icon={ListChecks} label="Completed" value={s.completed} sub={`${showPct(pctOf(s.completed, s.n))} of bookings · ${s.cancelledAfter} cancelled after a driver`} compare={<Delta now={s.completed} before={p.completed} />} />
        <Kpi icon={Timer} label="Time to get a driver" value={fmtWait(s.medianWait)} sub={`Median · app ${fmtWait(app.medianWait)}, hotline ${fmtWait(hot.medianWait)}`} />
        <Kpi icon={AlertTriangle} label="Driver refusals" value={s.refusals} sub={`on ${s.withRefusals} booking${s.withRefusals === 1 ? '' : 's'} before one accepted`} />
        <Kpi icon={PhoneIncoming} label="Calls received" value={sh.received} sub={`${sh.made} made · ${sh.missed} missed (${showPct(pctOf(sh.missed, sh.received + sh.missed))})`} compare={<Delta now={sh.received} before={psh.received} />} />
        <Kpi icon={AlarmClock} label="Shifts started on time" value={showPct(pctOf(sh.onTime, sh.timed))} tone={sh.timed && sh.onTime / sh.timed < 0.8 ? 'bad' : undefined}
          sub={`${sh.shifts} shift${sh.shifts === 1 ? '' : 's'} · ${durationLabel(sh.minutes)} · ${sh.withReport} with a written report${sh.notEnded ? ` · ${sh.notEnded} not ended` : ''}${sh.wrongSlot ? ` · ${sh.wrongSlot} on the wrong shift` : ''}`} />
      </div>

      {agent && <MyPerformance rows={rows} agent={agent} />}
      <Insights cur={cur} rows={rows} agent={agent} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Bookings per day and what happened" subtitle="App bookings and hotline dispatches" legend={series} table={tbl(perDay, 'Day')}>
          {s.n ? <DailyBars data={perDay} series={series} c={c} /> : <Empty>No bookings in this period.</Empty>}
        </ChartCard>
        <ChartCard title="Share that got a car, per day" subtitle="Out of the bookings that are over; days with fewer than 3 bookings are left out" legend={[{ key: 'app', label: 'App', color: c.blue }, { key: 'hotline', label: 'Hotline', color: c.orange }]}
          table={<MiniTable head={['Day', 'App', 'Hotline']} rows={rateDay.filter((r) => r.app != null || r.hotline != null).map((r) => [longDay(r.day), showPct(r.app), showPct(r.hotline)])} />}>
          {s.n ? <DailyLines data={rateDay} series={[{ key: 'app', label: 'App', color: c.blue }, { key: 'hotline', label: 'Hotline', color: c.orange }]} c={c} domain={[0, 100]} format={(n) => `${n}%`} /> : <Empty>No bookings in this period.</Empty>}
        </ChartCard>
        <ChartCard title="By hour of the day" subtitle="When cars are missing: the red is bookings that got no car" legend={series} table={tbl(perHour, 'Hour')}>
          {s.n ? <DailyBars data={perHour} series={series} c={c} xKey="hour" xFormat={(h) => `${h}h`} tipTitle={(h) => `${h}:00 – ${h}:59`} /> : <Empty>No bookings in this period.</Empty>}
        </ChartCard>
        <ChartCard title="By shift" subtitle="Which shift's bookings got a car" legend={series} table={tbl(bySlot, 'Shift')}>
          {bySlot.length ? <DailyBars data={bySlot} series={series} c={c} xKey="label" xFormat={(x) => x} tipTitle={(x) => x} height={220} /> : <Empty>No bookings in this period.</Empty>}
        </ChartCard>
        <ChartCard title="App or hotline" subtitle="Where the bookings came from and what happened" legend={series} table={tbl(bySource, 'Channel')}>
          {bySource.length ? <DailyBars data={bySource} series={series} c={c} xKey="label" xFormat={(x) => x.replace('Hotline · ', '')} tipTitle={(x) => x} height={220} /> : <Empty>No bookings in this period.</Empty>}
        </ChartCard>
        <ChartCard title="Calls per day" subtitle="From the agents' shift reports" legend={[{ key: 'received', label: 'Received', color: c.blue }, { key: 'made', label: 'Made', color: c.aqua }, { key: 'missed', label: 'Missed', color: STATUS.critical }]}
          table={<MiniTable head={['Day', 'Received', 'Made', 'Missed']} rows={calls.filter((r) => r.received + r.made + r.missed).map((r) => [longDay(r.day), r.received, r.made, r.missed])} />}>
          {sh.received + sh.made ? <DailyBars data={calls} stacked={false} series={[{ key: 'received', label: 'Received', color: c.blue }, { key: 'made', label: 'Made', color: c.aqua }, { key: 'missed', label: 'Missed', color: STATUS.critical }]} c={c} /> : <Empty>No calls reported in this period.</Empty>}
        </ChartCard>
      </div>
    </div>
  );
}

// One agent's score, what it is made of and how each part compares with
// the team's average (no other agent's name), plus their place.
function MyPerformance({ rows, agent }: { rows: AgentRow[]; agent: string }) {
  const me = rows.find((r) => r.id === agent);
  if (!me) return null;
  const others = rows.filter((r) => r.id !== agent);
  const ranked = rows.filter((r) => r.score != null).sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
  const place = me.score != null ? ranked.findIndex((r) => r.id === agent) + 1 : null;
  const teamAvg = (i: number) => { const v = rows.map((r) => r.parts[i]?.value).filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const scoreAvg = (() => { const v = rows.map((r) => r.score).filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })();
  const tone = (v: number | null) => (v == null ? 'text-fg-subtle' : v >= 75 ? 'text-emerald-700 dark:text-emerald-400' : v >= 55 ? 'text-attention' : 'text-danger');
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <p className="text-caption text-fg-muted flex items-center gap-1.5"><Trophy size={13} /> Performance score</p>
          <p className={`text-h1 font-bold tabular-nums leading-tight ${tone(me.score)}`}>{me.score ?? '—'}<span className="text-ui text-fg-subtle font-normal"> / 100</span></p>
        </div>
        <div className="text-small text-fg-muted space-y-0.5">
          {place && ranked.length > 1 && <p><b className="text-fg">#{place}</b> of {ranked.length} agents this period</p>}
          {scoreAvg != null && others.length > 0 && <p>Team average {scoreAvg}</p>}
          {me.score == null && <p>Too little data in this period for a score.</p>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-small min-w-[520px]">
          <thead><tr className="text-caption text-fg-subtle text-left border-b border-line-muted">{['What counts', 'Weight', 'You', 'Team average'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line-muted">
            {me.parts.map((p, i) => (
              <tr key={p.label}>
                <td className="py-1.5 pr-3">{p.label}</td>
                <td className="py-1.5 pr-3 tabular-nums text-fg-muted">{p.weight}%</td>
                <td className={`py-1.5 pr-3 tabular-nums font-semibold ${tone(p.value == null ? null : Math.round(p.value))}`}>{p.value == null ? 'not enough data' : `${Math.round(p.value)}%`}</td>
                <td className="py-1.5 pr-3 tabular-nums text-fg-muted">{others.length ? showPct(teamAvg(i)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {me.flags.length > 0 && (
        <div className="rounded-lg bg-danger/5 border border-danger/20 p-2.5">
          <p className="text-caption font-semibold flex items-center gap-1.5 mb-1"><AlertTriangle size={13} className="text-danger" /> To work on</p>
          <ul className="text-small list-disc pl-5 space-y-0.5">{me.flags.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// What the numbers say, in sentences: what to ask the team to improve.
function Insights({ cur, rows, agent }: { cur: Slice; rows: AgentRow[]; agent: string | null }) {
  const out: { tone: 'bad' | 'good' | 'info'; text: ReactNode }[] = [];
  const s = bookingStats(cur.bookings);
  const app = bookingStats(cur.bookings.filter((b) => b.channel === 'app')), hot = bookingStats(cur.bookings.filter((b) => b.channel === 'hotline'));
  const rate = carRate(s);
  if (s.n && rate != null) out.push({ tone: rate < 70 ? 'bad' : 'good', text: <><b>{s.noCar}</b> of {s.n} bookings got no car ({100 - rate}% did not get one). {rate < 70 ? 'Ask the team to call drivers online near the pickup as soon as a booking waits more than a minute.' : 'Keep it up.'}</> });
  const hours = Array.from({ length: 24 }, (_, h) => { const l = cur.bookings.filter((b) => b.hour === h); return { h, n: l.length, no: l.filter((b) => b.outcome === 'no_car').length }; })
    .filter((x) => x.n >= 3 && x.no).sort((x, y) => y.no / y.n - x.no / x.n || y.no - x.no);
  if (hours[0]) out.push({ tone: 'bad', text: <>The worst hour is <b>{hours[0].h}:00–{hours[0].h}:59</b>: {hours[0].no} of {hours[0].n} bookings got no car{hours[1] ? <>, then {hours[1].h}:00 ({hours[1].no} of {hours[1].n})</> : null}. Make sure drivers are online then.</> });
  const slots = SLOTS.map((sl) => { const l = cur.bookings.filter((b) => cur.allShifts.find((x) => inShift(x, b.at))?.slot === sl); return { sl, st: bookingStats(l) }; }).filter((x) => x.st.n >= 3);
  const worstSlot = [...slots].sort((x, y) => (carRate(x.st) ?? 100) - (carRate(y.st) ?? 100))[0];
  if (worstSlot && slots.length > 1) out.push({ tone: 'info', text: <>The <b>{SLOT_LABEL[worstSlot.sl].split(' ')[0].toLowerCase()} shift</b> has the lowest share of bookings with a car: {showPct(carRate(worstSlot.st))} ({worstSlot.st.noCar} with no car).</> });
  if (app.medianWait != null && hot.medianWait != null && hot.medianWait > app.medianWait * 2) out.push({ tone: 'bad', text: <>A hotline booking waits <b>{fmtWait(hot.medianWait)}</b> for a driver, against {fmtWait(app.medianWait)} in the app. {hot.refusals ? <>Drivers refused hotline trips {hot.refusals} times.</> : null}</> });
  const noCarHot = cur.bookings.filter((b) => b.channel === 'hotline' && b.outcome === 'no_car').length;
  if (noCarHot) out.push({ tone: 'bad', text: <><b>{noCarHot}</b> hotline caller{noCarHot === 1 ? '' : 's'} got no car. See them in Bookings → No car, and call them back.</> });
  const mine = agent ? rows.find((r) => r.id === agent) : null;
  if (mine) out.push(mine.flags.length ? { tone: 'bad', text: <>To work on: {mine.flags.join('; ').toLowerCase()}.</> } : { tone: 'good', text: <>Nothing below the lines this period: keep it up.</> });
  if (!agent && rows.length > 1) {
    const ranked = rows.filter((r) => r.score != null);
    if (ranked.length > 1) out.push({ tone: 'good', text: <>Best this period: <b>{ranked[0].name}</b> (score {ranked[0].score}). Lowest: <b>{ranked[ranked.length - 1].name}</b> (score {ranked[ranked.length - 1].score}).</> });
    const flagged = rows.filter((r) => r.flags.length);
    if (flagged.length) out.push({ tone: 'bad', text: <>Needs attention: {flagged.map((r, i) => <span key={r.id}>{i ? '; ' : ''}<b>{r.name}</b>: {r.flags[0].toLowerCase()}</span>)}.</> });
  }
  if (!out.length) return null;
  return (
    <div className="card p-4 space-y-2">
      <p className="text-body font-semibold flex items-center gap-1.5"><Lightbulb size={15} className="text-attention" /> What the numbers say</p>
      <ul className="space-y-1.5">
        {out.map((x, i) => (
          <li key={i} className="text-small flex items-start gap-2">
            <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: x.tone === 'bad' ? STATUS.critical : x.tone === 'good' ? STATUS.good : STATUS.warning }} />
            <span>{x.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ agents
function Agents({ data, rows, c, onOpen, onSaved }: { data: ReportData; rows: AgentRow[]; c: ReturnType<typeof usePalette>; onOpen: (id: string) => void; onSaved: () => void }) {
  const [how, setHow] = useState(false);
  const cell = (st: BookingStats) => st.n ? <><b>{st.n}</b><span className="text-fg-muted"> · {showPct(carRate(st))} car</span>{st.noCar ? <span className="text-danger"> · {st.noCar} none</span> : null}</> : <span className="text-fg-subtle">—</span>;
  const tone = (v: number | null) => (v == null ? 'text-fg-subtle' : v >= 75 ? 'text-emerald-700 dark:text-emerald-400' : v >= 55 ? 'text-attention' : 'text-danger');
  return (
    <div className="space-y-4">
      {rows.length === 0 ? <Empty>No shifts in this period.</Empty> : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Score" subtitle="Out of 100. Click a name for their shifts." right={<button className="btn-ghost text-caption" onClick={() => setHow(true)}>How it works</button>}>
              <RankBars rows={rows.map((r) => ({ key: r.id, label: r.name, n: r.score ?? 0, sub: r.score == null ? '(too little data)' : undefined }))} color={c.blue} onRowClick={onOpen} />
            </ChartCard>
            <div className="card p-4 space-y-2 min-w-0">
              <p className="text-body font-semibold flex items-center gap-1.5"><AlertTriangle size={14} className="text-attention" /> Needs attention</p>
              {rows.every((r) => !r.flags.length) ? <p className="text-small text-fg-muted">Nobody is below the lines this period.</p> : (
                <ul className="space-y-1.5">
                  {rows.filter((r) => r.flags.length).map((r) => (
                    <li key={r.id} className="text-small"><button className="font-semibold hover:underline" onClick={() => onOpen(r.id)}>{r.name}</button>: {r.flags.join(' · ')}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-small min-w-[1240px]">
              <thead><tr className="text-caption text-fg-subtle text-left border-b border-line-muted">
                {['#', 'Agent', 'Score', 'Shifts', 'On time', 'Reports', 'Calls in / missed', 'Made per hour', 'Their dispatches', 'Team account (on shift)', 'App bookings on shift', 'Calls after trips', 'Branding yes'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line-muted">
                {rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-hover cursor-pointer" onClick={() => onOpen(r.id)}>
                    <td className="px-3 py-2 text-fg-subtle tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{i === 0 && r.score != null && <Trophy size={12} className="inline text-attention mr-1 -mt-0.5" />}{r.name}{!r.active && <span className="text-fg-subtle font-normal"> (left)</span>}</td>
                    <td className={`px-3 py-2 font-bold tabular-nums ${tone(r.score)}`}>{r.score ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.sh.shifts} <span className="text-fg-muted">· {durationLabel(r.sh.minutes)}</span></td>
                    <td className={`px-3 py-2 tabular-nums ${tone(pctOf(r.sh.onTime, r.sh.timed))}`}>{showPct(pctOf(r.sh.onTime, r.sh.timed))}</td>
                    <td className="px-3 py-2 tabular-nums">{r.sh.withReport}/{r.sh.shifts}{r.sh.notEnded ? <span className="text-danger"> · {r.sh.notEnded} not ended</span> : null}</td>
                    <td className="px-3 py-2 tabular-nums">{r.sh.received} / <span className={r.sh.missed ? 'text-danger' : ''}>{r.sh.missed}</span></td>
                    <td className="px-3 py-2 tabular-nums">{r.sh.minutes ? (r.sh.made / (r.sh.minutes / 60)).toFixed(1) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{cell(r.mine)}</td>
                    <td className="px-3 py-2 tabular-nums">{cell(r.teamHotline)}</td>
                    <td className="px-3 py-2 tabular-nums">{cell(r.app)}</td>
                    <td className={`px-3 py-2 tabular-nums ${tone(pctOf(r.calls.madeOnShift, r.calls.due))}`}>{r.calls.due ? `${r.calls.madeOnShift}/${r.calls.due} on shift` : '—'}<span className="text-fg-muted">{r.calls.byThem ? ` · ${r.calls.byThem} by them` : ''}</span></td>
                    <td className="px-3 py-2 tabular-nums">{r.calls.reached ? `${r.calls.yes} of ${r.calls.reached} reached` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <AdminAccounts data={data} onSaved={onSaved} />
      {how && (
        <Modal open onClose={() => setHow(false)} title="How the score works" subtitle="Out of 100, from what the agent controls">
          <div className="space-y-2 text-small">
            <p>Each part is a percentage; the score is their weighted average. A part with too little data (fewer than 3 dispatches or app bookings, fewer than 2 calls after trips due, fewer than 3 drivers reached) is left out and the others count more. Calls after trips: a call that comes in at night is due at 07:00, and counts for whoever is on shift then.</p>
            <MiniTable head={['Part', 'Weight']} rows={(rows[0]?.parts ?? []).map((p) => [p.label, `${p.weight}%`])} />
            <p className="text-fg-muted">"Team account" dispatches were made from a shared admin account while they were on shift: they show in the table but do not count in the score. Cancellations are not split by who cancelled yet: the app does not send that.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Which KivuRide admin account is which agent (MD).
function AdminAccounts({ data, onSaved }: { data: ReportData; onSaved: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seen = [...new Set(data.bookings.filter((b) => b.source === 'dashboard' && b.adminId != null).map((b) => b.adminId as number))];
  const ids = [...new Set([...data.accounts.map((x) => x.admin_id), ...seen])].sort((x, y) => x - y);
  const agents = data.people.filter((p) => p.dept === 'call_center' || data.accounts.some((x) => x.profile_id === p.id)).sort((x, y) => x.full_name.localeCompare(y.full_name));
  const save = async (id: number, value: string) => {
    setBusy(id); setErr(null);
    const row = value === 'shared' ? { admin_id: id, profile_id: null, kind: 'shared', note: 'Shared or management account' } : { admin_id: id, profile_id: value, kind: 'agent', note: agents.find((p) => p.id === value)?.full_name ?? null };
    const { error } = await supabase.from('kivuride_admin_accounts').upsert({ ...row, updated_at: new Date().toISOString() });
    setBusy(null);
    if (error) setErr(error.message); else onSaved();
  };
  return (
    <div className="card p-4 space-y-2">
      <p className="text-body font-semibold flex items-center gap-1.5"><Headphones size={14} /> KivuRide admin accounts</p>
      <p className="text-caption text-fg-muted">Dispatches from the KivuRide admin dashboard carry the admin account, not the person. Say whose each account is; a shared account's dispatches count for the team on shift.</p>
      {err && <p className="text-small text-danger">{err}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {ids.map((id) => {
          const acc = data.accounts.find((x) => x.admin_id === id);
          const n = data.bookings.filter((b) => b.adminId === id).length;
          return (
            <label key={id} className={`rounded-lg border p-2 text-small space-y-1 ${acc ? 'border-line' : 'border-attention'}`}>
              <span className="flex justify-between text-caption text-fg-muted"><span>Account #{id}{acc ? '' : ' · new, not set'}</span><span>{n} in these days</span></span>
              <select className="input w-full py-1" disabled={busy === id} value={acc ? (acc.kind === 'shared' ? 'shared' : acc.profile_id ?? '') : ''} onChange={(e) => e.target.value && save(id, e.target.value)}>
                {!acc && <option value="">Choose…</option>}
                <option value="shared">Shared / management (team on shift)</option>
                {agents.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bookings
const OUTCOME_TONE: Record<Outcome, 'success' | 'attention' | 'danger' | 'neutral' | 'info'> = { completed: 'success', cancelled_after: 'attention', no_car: 'danger', running: 'info', failed: 'neutral' };

function Bookings({ list, shifts, nameOf, initial, canCancel }: { list: Booking[]; shifts: CallCenterShift[]; nameOf: (id: string | null) => string; initial: Outcome | null; canCancel: boolean }) {
  const [only, setOnly] = useState<Outcome | 'all'>(initial ?? 'all');
  const [open, setOpen] = useState<Booking | null>(null);
  const shown = only === 'all' ? list : list.filter((b) => b.outcome === only);
  const onShift = (b: Booking) => [...new Set(shifts.filter((s) => inShift(s, b.at)).map((s) => nameOf(s.agent_id)))].join(', ') || 'No shift';
  const counts = (o: Outcome) => list.filter((b) => b.outcome === o).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-small">
        {([['all', `All ${list.length}`], ['no_car', `No car ${counts('no_car')}`], ['cancelled_after', `Cancelled after driver ${counts('cancelled_after')}`], ['completed', `Completed ${counts('completed')}`], ['running', `Running ${counts('running')}`]] as [Outcome | 'all', string][]).map(([k, l]) => (
          <button key={k} onClick={() => setOnly(k)} className={`px-2.5 py-1 rounded-full border ${only === k ? (k === 'no_car' ? 'border-danger bg-danger text-white' : 'border-brand bg-brand text-white') : 'border-line text-fg-muted'}`}>{l}</button>
        ))}
      </div>
      {only === 'no_car' && shown.length > 0 && <p className="text-caption text-fg-muted">These clients asked for a ride and no driver accepted. Call them back: a hotline client can be dispatched again from Dispatch.</p>}
      <div className="card overflow-x-auto">
        {shown.length === 0 ? <Empty>No bookings here.</Empty> : (
          <table className="w-full text-small min-w-[960px]">
            <thead><tr className="text-caption text-fg-subtle text-left border-b border-line-muted">
              {['When', 'Channel', 'Client', 'From → to', 'What happened', 'Wait', 'Refusals', 'Driver', 'Dispatched by', 'On shift'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line-muted">
              {shown.map((b) => (
                <tr key={b.key} className="hover:bg-hover cursor-pointer" onClick={() => setOpen(b)}>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{longDay(b.day)} {kTime(b.at)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{b.channel === 'app' ? <span className="flex items-center gap-1"><Smartphone size={12} /> App</span> : <span className="flex items-center gap-1"><PhoneIncoming size={12} /> {b.source === 'kivu_daily' ? 'Kivu Daily' : 'Dashboard'}</span>}</td>
                  <td className="px-2 py-2"><p className="font-medium">{b.client ?? '—'}</p>{b.phone && <p className="text-caption text-fg-muted">{localPhone(b.phone)}</p>}</td>
                  <td className="px-2 py-2 max-w-[240px]"><p className="truncate">{b.pickup ?? '—'}</p><p className="truncate text-fg-muted">→ {b.destination ?? '—'}</p></td>
                  <td className="px-2 py-2 whitespace-nowrap"><Label tone={OUTCOME_TONE[b.outcome]}>{OUTCOME_SHORT[b.outcome]}</Label></td>
                  <td className="px-2 py-2 tabular-nums">{fmtWait(b.acceptSecs)}</td>
                  <td className="px-2 py-2 tabular-nums">{b.refusals ?? '—'}</td>
                  <td className="px-2 py-2">{b.driver ?? '—'}{b.plate && <p className="text-caption text-fg-muted">{b.plate}</p>}</td>
                  <td className="px-2 py-2 text-fg-muted">{b.channel === 'app' ? 'Client (app)' : b.by ? nameOf(b.by) : `Team${b.adminId ? ` (account #${b.adminId})` : ''}`}</td>
                  <td className="px-2 py-2 text-fg-muted max-w-[160px] truncate">{onShift(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <BookingModal b={open} onClose={() => setOpen(null)} nameOf={nameOf} canCancel={canCancel} />}
    </div>
  );
}

function BookingModal({ b, onClose, nameOf, canCancel }: { b: Booking; onClose: () => void; nameOf: (id: string | null) => string; canCancel: boolean }) {
  const [d, setD] = useState(b.dispatch);
  return (
    <Modal open onClose={onClose} title={b.client ?? `Trip #${b.tripId}`} subtitle={`${SOURCE_LABEL[b.source]} · ${longDay(b.day)} ${kTime(b.at)}`} maxWidth="max-w-lg">
      {d ? <LiveTrip d={d} onChange={setD} onBookAgain={() => { window.location.href = '/dispatch'; }} canCancel={canCancel} bare /> : (
        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-small">
          {([
            ['What happened', <Label key="o" tone={OUTCOME_TONE[b.outcome]}>{OUTCOME_LABEL[b.outcome]}</Label>],
            ['App status', b.status], ['Client', `${b.client ?? '—'}${b.phone ? ` · ${localPhone(b.phone)}` : ''}`],
            ['From', b.pickup ?? '—'], ['To', b.destination ?? '—'], ['Car type', b.vehicleType ?? '—'],
            ['Driver', `${b.driver ?? '—'}${b.plate ? ` · ${b.plate}` : ''}`], ['Time to a driver', fmtWait(b.acceptSecs)], ['Drivers who refused', b.refusals ?? '—'],
            ['Fare', fmtRwf(b.fare)], ['Dispatched by', b.channel === 'app' ? 'The client, in the app' : b.by ? nameOf(b.by) : `The team on shift${b.adminId ? ` (admin account #${b.adminId})` : ''}`],
            ['Trip', b.tripId ? `#${b.tripId}` : '—'],
          ] as [string, ReactNode][]).map(([k, v]) => <div key={k} className="contents"><dt className="text-fg-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ shift reports
function Shifts({ shifts, bookings, nameOf, agent, canCancel }: { shifts: CallCenterShift[]; bookings: Booking[]; nameOf: (id: string | null) => string; agent: string | null; canCancel: boolean }) {
  const [open, setOpen] = useState<Booking | null>(null);
  const days = [...new Set(shifts.map((s) => dayOf(s.started_at)))].sort().reverse();
  if (!days.length) return <Empty>No shift in these days.</Empty>;
  return (
    <div className="space-y-4">
      {days.map((day) => (
        <section key={day} className="space-y-3 break-inside-avoid">
          <h2 className="text-ui font-semibold flex items-center gap-2 pt-1"><CalendarDays size={15} className="text-fg-subtle" />{fullDay(day)}</h2>
          {shifts.filter((s) => dayOf(s.started_at) === day).map((s) => {
            const during = bookings.filter((b) => inShift(s, b.at));
            const theirs = bookings.filter((b) => b.channel === 'hotline' && b.by === s.agent_id && (inShift(s, b.at)));
            const team = during.filter((b) => b.channel === 'hotline' && b.team);
            const app = during.filter((b) => b.channel === 'app');
            const st = (l: Booking[]) => bookingStats(l);
            return (
              <div key={s.id} className="card p-4 space-y-3 break-inside-avoid">
                <div className="flex flex-wrap items-center gap-2">
                  {!agent && <p className="text-ui font-semibold">{nameOf(s.agent_id)} ·</p>}
                  <p className="text-ui font-semibold">{SLOT_LABEL[s.slot]}</p>
                  <span className="text-caption text-fg-muted flex items-center gap-1"><Clock size={12} /> {kTime(s.started_at)} – {s.ended_at ? kTime(s.ended_at) : 'still on shift'} · {s.station}</span>
                  {wrongSlot(s) ? <Label tone="attention">Picked the wrong shift</Label> : s.late_minutes > 10 && <Label tone={s.late_minutes > 30 ? 'danger' : 'attention'}>{s.late_minutes} min late</Label>}
                  {s.status === 'auto_closed' && <Label tone="danger">Not ended</Label>}
                  {s.partner_id && <span className="text-caption text-fg-muted">with {nameOf(s.partner_id)}</span>}
                </div>
                <div className="grid sm:grid-cols-3 gap-2">
                  {([['Their hotline dispatches', theirs, PhoneIncoming], ['Team account dispatches', team, Headphones], ['App bookings during the shift', app, Smartphone]] as [string, Booking[], typeof Car][]).map(([l, list, Icon]) => {
                    const x = st(list);
                    return (
                      <div key={l} className="rounded-lg border border-line-muted p-2.5">
                        <p className="text-caption text-fg-muted flex items-center gap-1"><Icon size={12} /> {l}</p>
                        <p className="text-h3 font-bold tabular-nums">{x.n}</p>
                        <p className="text-caption text-fg-muted">{x.n ? <>{showPct(carRate(x))} got a car · {x.completed} completed{x.noCar ? <span className="text-danger"> · {x.noCar} no car</span> : null}</> : 'None'}</p>
                      </div>
                    );
                  })}
                </div>
                <ShiftReportBody shift={s} />
                {[...theirs, ...team, ...app].length > 0 && (
                  <details className="group">
                    <summary className="text-caption font-semibold text-brand cursor-pointer">See the {theirs.length + team.length + app.length} bookings of this shift</summary>
                    <ul className="mt-2 divide-y divide-line-muted text-small">
                      {[...theirs, ...team, ...app].sort((x, y) => x.at.localeCompare(y.at)).map((b) => (
                        <li key={b.key} className="py-1.5 flex flex-wrap items-center gap-2 cursor-pointer hover:bg-hover px-1 rounded" onClick={() => setOpen(b)}>
                          <span className="tabular-nums text-fg-muted w-11">{kTime(b.at)}</span>
                          <span className="w-20 text-caption">{b.channel === 'app' ? 'App' : b.by === s.agent_id ? 'Theirs' : 'Team'}</span>
                          <span className="font-medium">{b.client ?? '—'}</span>
                          <span className="text-fg-muted truncate max-w-[260px]">{b.pickup} → {b.destination}</span>
                          <span className="ml-auto"><Label tone={OUTCOME_TONE[b.outcome]}>{OUTCOME_SHORT[b.outcome]}</Label></span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </section>
      ))}
      {open && <BookingModal b={open} onClose={() => setOpen(null)} nameOf={nameOf} canCancel={canCancel} />}
    </div>
  );
}
