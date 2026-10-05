import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Award, Clock, Frown, Meh, PhoneIncoming, PhoneOutgoing, Smile, Table2, BarChart3, Megaphone } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { CATEGORY_LABEL } from '../../lib/callTickets';
import { durationLabel } from '../../lib/shifts';
import { CallTicketCategory } from '../../lib/supabase';

// Call analytics for the MD and Finance: how many calls we get and make
// each day and what they're about, when the phones are busiest, and how
// each agent performs (on time, hours, outgoing calls, outreach, quality).

interface Day {
  day: string;
  in_passengers: number; in_drivers: number; in_noninsider: number; in_partners: number; in_other: number;
  out_drivers: number; out_noninsider: number; out_callbacks: number; out_other: number;
  missed: number; messages: number; contacts_logged: number; outreach_logged: number;
}
interface Agent {
  id: string; name: string; is_active: boolean;
  shifts: number; on_time: number; avg_late: number | null; minutes: number; not_ended: number;
  calls_in: number; calls_out: number; calls_missed: number;
  contacts_logged: number; solved_on_call: number; cases_closed: number; driver_calls: number;
  outreach_calls: number; outreach_interested: number; happy: number; rated: number;
}
interface Analytics {
  since: string;
  daily: Day[];
  by_category: { category: string; n: number }[];
  by_situation: { situation: string; n: number }[];
  heatmap: { dow: number; hour: number; n: number }[];
  agents: Agent[];
  quality: { contacts: number; solved_on_call: number; cases: number; response_met: number; happy: number; neutral: number; unhappy: number; emergencies: number };
  outreach: { drivers: number; called: number; reached: number; interested: number; branded: number; device_installed: number; calls_in_period: number; by_outcome: Record<string, number> };
}

// Reference categorical palette (validated light on #fff, dark on navy-800).
// Colour follows the caller: passengers blue, our drivers orange, Non-Insider
// aqua, partners yellow; "Other" is neutral gray in both charts.
const PALETTE = {
  light: { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', other: '#a3a3a3', surface: '#ffffff', grid: '#f1f5f9', axis: '#9ca3af' },
  dark: { blue: '#3987e5', orange: '#d95926', aqua: '#199e70', yellow: '#c98500', other: '#6b7f95', surface: '#17263A', grid: 'rgba(255,255,255,0.06)', axis: '#5d7791' },
};
// Sequential blue ramp (100 -> 700) for the busy-hours heatmap; ordinal steps for the funnel.
const BLUE_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const FUNNEL_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#184f95'];
const FUNNEL_DARK = ['#184f95', '#1c5cab', '#256abf', '#3987e5', '#6da7ec'];
const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };

const RANGES = [{ d: 7, label: '7 days' }, { d: 30, label: '30 days' }, { d: 90, label: '90 days' }];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export default function CallAnalyticsPage() {
  const { theme } = useTheme();
  const c = PALETTE[theme === 'dark' ? 'dark' : 'light'];
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    supabase.rpc('call_center_analytics', { p_days: days }).then(({ data: d, error: err }) => {
      if (err) setError(err.message);
      else setData(d as Analytics);
    });
  }, [days]);

  const IN_SERIES = useMemo(() => [
    { key: 'in_passengers', label: 'Passengers', color: c.blue },
    { key: 'in_drivers', label: 'Our drivers', color: c.orange },
    { key: 'in_noninsider', label: 'Non-Insider drivers', color: c.aqua },
    { key: 'in_partners', label: 'Owners & partners', color: c.yellow },
    { key: 'in_other', label: 'Other', color: c.other },
  ] as const, [c]);
  const OUT_SERIES = useMemo(() => [
    { key: 'out_callbacks', label: 'Call-backs to passengers', color: c.blue },
    { key: 'out_drivers', label: 'Our drivers', color: c.orange },
    { key: 'out_noninsider', label: 'Non-Insider drivers', color: c.aqua },
    { key: 'out_other', label: 'Other', color: c.other },
  ] as const, [c]);

  if (error) return <div className="card p-6 text-[12px] text-red-600">{error}</div>;
  if (!data) return <div className="card p-10 text-center text-[12px] text-gray-400">Loading call analytics…</div>;

  const sum = (k: keyof Day, list = data.daily) => list.reduce((t, d) => t + Number(d[k] ?? 0), 0);
  const totalIn = IN_SERIES.reduce((t, s) => t + sum(s.key), 0);
  const totalOut = OUT_SERIES.reduce((t, s) => t + sum(s.key), 0);
  const today = data.daily[data.daily.length - 1];
  const todayIn = today ? IN_SERIES.reduce((t, s) => t + Number(today[s.key]), 0) : 0;
  const todayOut = today ? OUT_SERIES.reduce((t, s) => t + Number(today[s.key]), 0) : 0;
  const last7 = data.daily.slice(-7);
  const prev7 = data.daily.slice(-14, -7);
  const wk = (list: Day[]) => IN_SERIES.reduce((t, s) => t + sum(s.key, list), 0);
  const q = data.quality;
  const legacy = data.daily.some((d) => d.day < '2026-10-05' && (d.in_other > 0 || d.out_other > 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-gray-500">From {longDay(data.since)} to today · numbers from agents' shift reports and what they logged in Kivu Daily.</p>
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.d} role="radio" aria-checked={days === r.d} onClick={() => setDays(r.d)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium ${days === r.d ? 'bg-white dark:bg-navy-700 shadow-sm text-brand-600 dark:text-brand-300' : 'text-gray-500'}`}>{r.label}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={PhoneIncoming} label="Calls received" value={totalIn} sub={`${todayIn} today · ${Math.round(totalIn / data.daily.length)}/day`}
          delta={days >= 14 && wk(prev7) ? { now: wk(last7), before: wk(prev7) } : undefined} />
        <Kpi icon={PhoneOutgoing} label="Calls made" value={totalOut} sub={`${todayOut} today · ${sum('out_noninsider')} to Non-Insider drivers`} />
        <Kpi icon={AlertTriangle} label="Missed calls" value={sum('missed')} sub={totalIn ? `${pct(sum('missed'), totalIn + sum('missed'))}% of calls that came in` : 'No calls reported'} />
        <Kpi icon={Clock} label="Solved on the spot" value={pct(q.solved_on_call, q.contacts) === null ? '—' : `${pct(q.solved_on_call, q.contacts)}%`}
          sub={`${q.contacts} contacts logged · 2-hour reply met ${pct(q.response_met, q.cases) ?? '—'}${q.cases ? '%' : ''}`} />
      </div>

      <StackedDaily title="Calls received per day" subtitle="Who called us" data={data.daily} series={IN_SERIES} c={c} />
      <StackedDaily title="Calls made per day" subtitle="Who we called" data={data.daily} series={OUT_SERIES} c={c} />
      {legacy && <p className="text-[11px] text-gray-400 -mt-2">Shift reports before 5 Oct 2026 only had totals, so those calls show as "Other".</p>}

      <AgentsSection agents={data.agents} c={c} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopicsCard data={data} c={c} />
        <Heatmap cells={data.heatmap} dark={theme === 'dark'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QualityCard q={q} />
        <OutreachFunnel o={data.outreach} dark={theme === 'dark'} />
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, delta }: { icon: typeof Clock; label: string; value: number | string; sub: string; delta?: { now: number; before: number } }) {
  const change = delta ? Math.round(((delta.now - delta.before) / delta.before) * 100) : null;
  return (
    <div className="card p-4">
      <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Icon size={13} /> {label}</p>
      <p className="text-[24px] font-bold leading-tight mt-1">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
      {change !== null && <p className="text-[11px] mt-1 text-gray-600 dark:text-gray-300">{change >= 0 ? '▲' : '▼'} {Math.abs(change)}% last 7 days vs the 7 before</p>}
    </div>
  );
}

type Series = readonly { key: string; label: string; color: string }[];
type DaySeries = readonly { key: keyof Day; label: string; color: string }[];

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string; series: Series }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((t, p) => t + Number(p.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-gray-100 dark:border-white/10 bg-white dark:bg-navy-700 shadow-lg px-3 py-2 text-[11px] min-w-[170px]">
      <p className="font-semibold mb-1">{label ? longDay(label) : ''} · {total} total</p>
      {[...series].reverse().map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value ?? 0;
        return (
          <p key={s.key} className="flex items-center justify-between gap-3 text-gray-600 dark:text-gray-300">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.label}</span><b className="text-gray-900 dark:text-white">{v}</b>
          </p>
        );
      })}
    </div>
  );
}

function Legend({ series }: { series: Series }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

function StackedDaily({ title, subtitle, data, series, c }: { title: string; subtitle: string; data: Day[]; series: DaySeries; c: typeof PALETTE.light }) {
  const [asTable, setAsTable] = useState(false);
  const totals = series.map((s) => ({ ...s, n: data.reduce((t, d) => t + Number(d[s.key]), 0) }));
  const grand = totals.reduce((t, s) => t + s.n, 0);
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">{title}</p>
          <p className="text-[11px] text-gray-500">{subtitle} · {grand} in this period{grand ? ` — ${totals.filter((s) => s.n).map((s) => `${s.label.toLowerCase()} ${pct(s.n, grand)}%`).join(', ')}` : ''}</p>
        </div>
        <button onClick={() => setAsTable((v) => !v)} className="btn-ghost text-[11px] flex items-center gap-1" aria-pressed={asTable}>
          {asTable ? <><BarChart3 size={13} /> Chart</> : <><Table2 size={13} /> Table</>}
        </button>
      </div>
      <Legend series={series} />
      {asTable ? (
        <div className="overflow-x-auto max-h-72">
          <table className="w-full text-[11px]">
            <thead><tr className="text-gray-500 text-left"><th className="py-1 pr-3 font-medium">Day</th>{series.map((s) => <th key={s.key} className="py-1 pr-3 font-medium text-right">{s.label}</th>)}<th className="py-1 font-medium text-right">Total</th></tr></thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day} className="border-t border-gray-100 dark:border-white/5">
                  <td className="py-1 pr-3">{longDay(d.day)}</td>
                  {series.map((s) => <td key={s.key} className="py-1 pr-3 text-right tabular-nums">{Number(d[s.key])}</td>)}
                  <td className="py-1 text-right font-semibold tabular-nums">{series.reduce((t, s) => t + Number(d[s.key]), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : grand === 0 ? (
        <p className="text-[12px] text-gray-400 text-center py-10">No calls reported in this period yet — numbers appear as agents end their shifts.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip series={series} />} cursor={{ fill: c.grid }} />
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} stroke={c.surface} strokeWidth={1}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- agents
function AgentsSection({ agents, c }: { agents: Agent[]; c: typeof PALETTE.light }) {
  const rows = agents.filter((a) => a.shifts > 0 || a.contacts_logged > 0 || a.outreach_calls > 0);
  if (!rows.length) {
    return <div className="card p-4"><p className="text-[13px] font-semibold">Agent performance</p><p className="text-[12px] text-gray-400 py-6 text-center">No shifts in this period yet.</p></div>;
  }
  const hrs = (a: Agent) => a.minutes / 60;
  const best = (f: (a: Agent) => number, min = 1) => {
    const top = [...rows].filter((a) => f(a) >= min).sort((x, y) => f(y) - f(x))[0];
    return top ? { name: top.name.split(/\s+/)[0], v: f(top) } : null;
  };
  const onTime = best((a) => (a.shifts >= 2 ? (a.on_time / a.shifts) * 100 : -1), 0);
  const mostOut = best((a) => a.calls_out);
  const mostOutreach = best((a) => a.outreach_interested);
  const mostSolved = best((a) => a.solved_on_call);
  const series = [{ key: 'calls_in', label: 'Calls received', color: c.blue }, { key: 'calls_out', label: 'Calls made', color: c.orange }] as const;
  const chartData = rows.map((a) => ({ name: a.name.split(/\s+/)[0], calls_in: a.calls_in, calls_out: a.calls_out }));

  return (
    <div className="card p-4 space-y-4">
      <div>
        <p className="text-[13px] font-semibold">Agent performance</p>
        <p className="text-[11px] text-gray-500">On time = started within 10 minutes of the shift start. Calls are what each agent reported at the end of their shifts.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Highlight label="Most on time" who={onTime?.name} value={onTime ? `${Math.round(onTime.v)}% of shifts` : 'Needs 2+ shifts'} />
        <Highlight label="Most calls made" who={mostOut?.name} value={mostOut ? `${mostOut.v} calls` : '—'} />
        <Highlight label="Most outreach interest" who={mostOutreach?.name} value={mostOutreach ? `${mostOutreach.v} drivers interested` : '—'} />
        <Highlight label="Most solved on the spot" who={mostSolved?.name} value={mostSolved ? `${mostSolved.v} callers` : '—'} />
      </div>

      <div className="space-y-2">
        <Legend series={series} />
        <div style={{ height: Math.max(120, rows.length * 44) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid horizontal={false} stroke={c.grid} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11, fill: c.axis }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: c.grid }} content={({ active, payload, label }) => active && payload?.length ? (
                <div className="rounded-lg border border-gray-100 dark:border-white/10 bg-white dark:bg-navy-700 shadow-lg px-3 py-2 text-[11px]">
                  <p className="font-semibold mb-1">{label}</p>
                  {series.map((s) => <p key={s.key} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.label}: <b className="text-gray-900 dark:text-white">{payload.find((p) => p.dataKey === s.key)?.value ?? 0}</b></p>)}
                </div>
              ) : null} />
              {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[0, 4, 4, 0]} isAnimationActive={false} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-[11px] min-w-[860px]">
          <thead>
            <tr className="text-left text-gray-500">
              {['Agent', 'Shifts', 'On time', 'Avg late', 'Hours', 'Received', 'Made', 'Made / hour', 'Missed', 'Logged', 'Solved on spot', 'Cases closed', 'Outreach', 'Not ended', 'Happy callers'].map((h, i) => (
                <th key={h} className={`py-1.5 pr-3 font-medium ${i ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const ot = pct(a.on_time, a.shifts);
              return (
                <tr key={a.id} className="border-t border-gray-100 dark:border-white/5">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{a.name}{!a.is_active && <span className="text-gray-400 font-normal"> (left)</span>}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.shifts}</td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{a.shifts ? <>{a.on_time}/{a.shifts} <span className={ot !== null && ot < 80 ? 'text-red-600 font-semibold' : 'text-gray-500'}>({ot}%)</span></> : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.avg_late == null ? '—' : `${a.avg_late} min`}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{durationLabel(a.minutes)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.calls_in}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.calls_out}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{hrs(a) ? (a.calls_out / hrs(a)).toFixed(1) : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.calls_missed}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.contacts_logged}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.contacts_logged ? `${pct(a.solved_on_call, a.contacts_logged)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{a.cases_closed}</td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{a.outreach_calls}{a.outreach_calls ? <span className="text-gray-500"> · {a.outreach_interested} yes</span> : ''}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${a.not_ended ? 'text-red-600 font-semibold' : ''}`}>{a.not_ended}</td>
                  <td className="py-2 text-right tabular-nums">{a.rated ? `${pct(a.happy, a.rated)}% of ${a.rated}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Highlight({ label, who, value }: { label: string; who?: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3">
      <p className="text-[10px] text-gray-500 flex items-center gap-1"><Award size={11} /> {label}</p>
      <p className="text-[13px] font-semibold mt-0.5">{who ?? '—'}</p>
      <p className="text-[11px] text-gray-500">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------- topics
function TopicsCard({ data, c }: { data: Analytics; c: typeof PALETTE.light }) {
  const rows = data.by_category.map((r) => ({ label: CATEGORY_LABEL[r.category as CallTicketCategory] ?? r.category, n: r.n }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((t, r) => t + r.n, 0);
  return (
    <div className="card p-4 space-y-3">
      <div>
        <p className="text-[13px] font-semibold">What calls are about</p>
        <p className="text-[11px] text-gray-500">{total} contacts logged, by Script Book section</p>
      </div>
      {rows.length === 0 ? <p className="text-[12px] text-gray-400 text-center py-8">No contacts logged in this period.</p> : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[130px_1fr_56px] items-center gap-2 text-[11px] group" title={`${r.label}: ${r.n}`}>
              <span className="truncate text-gray-600 dark:text-gray-300">{r.label}</span>
              <div className="h-3.5 rounded-r bg-transparent"><div className="h-full rounded-r-[4px]" style={{ width: `${(r.n / max) * 100}%`, background: c.blue, minWidth: 3 }} /></div>
              <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{r.n} <span className="text-gray-400">{pct(r.n, total)}%</span></span>
            </div>
          ))}
        </div>
      )}
      {data.by_situation.length > 0 && (
        <div className="pt-2 border-t border-gray-100 dark:border-white/5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Top situations</p>
          <ol className="text-[11px] space-y-0.5 text-gray-600 dark:text-gray-300">
            {data.by_situation.slice(0, 5).map((s, i) => <li key={s.situation}>{i + 1}. {s.situation} <span className="text-gray-400">· {s.n}</span></li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- heatmap
function Heatmap({ cells, dark }: { cells: Analytics['heatmap']; dark: boolean }) {
  const [hover, setHover] = useState<{ dow: number; hour: number; n: number } | null>(null);
  const grid = new Map(cells.map((x) => [`${x.dow}-${x.hour}`, x.n]));
  const max = Math.max(0, ...cells.map((x) => x.n));
  const color = (n: number) => (n === 0 ? (dark ? 'rgba(255,255,255,0.04)' : '#f3f4f6') : BLUE_RAMP[Math.min(BLUE_RAMP.length - 1, Math.floor((n / max) * (BLUE_RAMP.length - 1e-9)))]);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const busiest = [...cells].sort((a, b) => b.n - a.n)[0];
  return (
    <div className="card p-4 space-y-3">
      <div>
        <p className="text-[13px] font-semibold">Busiest hours</p>
        <p className="text-[11px] text-gray-500">Contacts logged by day and hour (Kigali time){busiest ? ` · busiest: ${DOW[busiest.dow - 1]} ${String(busiest.hour).padStart(2, '0')}:00` : ''}</p>
      </div>
      {max === 0 ? <p className="text-[12px] text-gray-400 text-center py-8">No contacts logged in this period.</p> : (
        <>
          <div className="overflow-x-auto">
            <div className="grid gap-[2px] min-w-[480px]" style={{ gridTemplateColumns: '32px repeat(24, minmax(0, 1fr))' }} onMouseLeave={() => setHover(null)}>
              <span />
              {hours.map((h) => <span key={h} className="text-[9px] text-gray-400 text-center">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
              {DOW.map((d, di) => (
                <div key={d} className="contents">
                  <span className="text-[10px] text-gray-500 self-center">{d}</span>
                  {hours.map((h) => {
                    const n = grid.get(`${di + 1}-${h}`) ?? 0;
                    return (
                      <span key={h} role="img" aria-label={`${d} ${h}:00 — ${n} contacts`} onMouseEnter={() => setHover({ dow: di + 1, hour: h, n })}
                        className={`h-5 rounded-[3px] ${hover?.dow === di + 1 && hover.hour === h ? 'ring-2 ring-gray-900 dark:ring-white' : ''}`} style={{ background: color(n) }} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <span>{hover ? <><b className="text-gray-800 dark:text-gray-100">{DOW[hover.dow - 1]} {String(hover.hour).padStart(2, '0')}:00–{String((hover.hour + 1) % 24).padStart(2, '0')}:00</b> · {hover.n} contacts</> : 'Hover a square for the number'}</span>
            <span className="flex items-center gap-1">0 {BLUE_RAMP.map((b) => <span key={b} className="w-3 h-2.5 rounded-sm" style={{ background: b }} />)} {max}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- quality
function QualityCard({ q }: { q: Analytics['quality'] }) {
  const rated = q.happy + q.neutral + q.unhappy;
  const parts = [
    { key: 'happy', label: 'Happy', n: q.happy, color: STATUS.good, icon: Smile },
    { key: 'neutral', label: 'Neutral', n: q.neutral, color: STATUS.warning, icon: Meh },
    { key: 'unhappy', label: 'Unhappy', n: q.unhappy, color: STATUS.critical, icon: Frown },
  ];
  const met = pct(q.response_met, q.cases);
  return (
    <div className="card p-4 space-y-4">
      <p className="text-[13px] font-semibold">Quality</p>
      <div className="grid grid-cols-3 gap-2">
        <div><p className="text-[20px] font-bold leading-tight">{pct(q.solved_on_call, q.contacts) ?? '—'}{q.contacts ? '%' : ''}</p><p className="text-[11px] text-gray-500">solved on the spot</p></div>
        <div><p className="text-[20px] font-bold leading-tight">{met ?? '—'}{q.cases ? '%' : ''}</p><p className="text-[11px] text-gray-500">cases answered within 2 h ({q.response_met}/{q.cases})</p></div>
        <div><p className="text-[20px] font-bold leading-tight">{q.emergencies}</p><p className="text-[11px] text-gray-500">emergencies</p></div>
      </div>
      <div className="space-y-2">
        <p className="text-[11px] text-gray-500">Caller satisfaction when cases were closed · {rated} rated</p>
        {rated === 0 ? <p className="text-[12px] text-gray-400">No ratings yet.</p> : (
          <>
            <div className="flex h-3 rounded-[4px] overflow-hidden gap-[2px]">
              {parts.filter((p) => p.n).map((p) => <div key={p.key} title={`${p.label}: ${p.n}`} style={{ width: `${(p.n / rated) * 100}%`, background: p.color }} />)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {parts.map((p) => <span key={p.key} className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300"><p.icon size={12} style={{ color: p.color }} /> {p.label} <b>{p.n}</b> <span className="text-gray-400">({pct(p.n, rated)}%)</span></span>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- outreach
function OutreachFunnel({ o, dark }: { o: Analytics['outreach']; dark: boolean }) {
  const ramp = dark ? FUNNEL_DARK : FUNNEL_LIGHT;
  const stages = [
    { label: 'Non-Insider drivers', n: o.drivers },
    { label: 'Called at least once', n: o.called },
    { label: 'Reached (answered)', n: o.reached },
    { label: 'Interested', n: o.interested },
  ];
  const max = Math.max(1, o.drivers);
  return (
    <div className="card p-4 space-y-3">
      <div>
        <p className="text-[13px] font-semibold flex items-center gap-1.5"><Megaphone size={14} /> Non-Insider outreach</p>
        <p className="text-[11px] text-gray-500">Since the campaign started · {o.calls_in_period} outreach calls in this period</p>
      </div>
      <div className="space-y-1.5">
        {stages.map((s, i) => (
          <div key={s.label} className="grid grid-cols-[130px_1fr_70px] items-center gap-2 text-[11px]">
            <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
            <div className="h-4"><div className="h-full rounded-r-[4px]" style={{ width: `${(s.n / max) * 100}%`, background: ramp[i], minWidth: s.n ? 3 : 0 }} /></div>
            <span className="text-right tabular-nums">{s.n}{i > 0 && stages[i - 1].n ? <span className="text-gray-400"> {pct(s.n, stages[i - 1].n)}%</span> : ''}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-500 pt-2 border-t border-gray-100 dark:border-white/5">
        Fleet results: <b className="text-gray-800 dark:text-gray-100">{o.branded}</b> Non-Insider cars branded · <b className="text-gray-800 dark:text-gray-100">{o.device_installed}</b> devices installed
      </p>
    </div>
  );
}

