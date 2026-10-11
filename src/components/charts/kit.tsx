import { ReactNode, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, LucideIcon, Table2 } from 'lucide-react';
import { useTheme } from '../../lib/theme';

// Shared pieces for analytics pages (Performance hub, agent pages). Same
// validated palette and look as Call Analytics.
export const PALETTE = {
  light: { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', violet: '#4a3aa7', other: '#a3a3a3', surface: '#ffffff', grid: '#f1f5f9', axis: '#9ca3af' },
  dark: { blue: '#3987e5', orange: '#d95926', aqua: '#199e70', yellow: '#c98500', violet: '#9085e9', other: '#6b7f95', surface: '#17263A', grid: 'rgba(255,255,255,0.06)', axis: '#5d7791' },
};
export type Palette = typeof PALETTE.light;
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };

export function usePalette(): Palette {
  const { theme } = useTheme();
  return PALETTE[theme === 'dark' ? 'dark' : 'light'];
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
export const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const kigaliDay = (iso: string | Date) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
export const rwfShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;

// Every Kigali day from `from` to `to` inclusive (YYYY-MM-DD).
export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 800) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export function RangeTabs<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit" role="radiogroup" aria-label="Period">
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium ${value === o.v ? 'bg-white dark:bg-navy-700 shadow-sm text-brand-600 dark:text-brand-300' : 'text-gray-500'}`}>{o.label}</button>
      ))}
    </div>
  );
}

// A headline number. `compare` is shown under it ("Team average 74%").
export function Kpi({ icon: Icon, label, value, sub, compare, tone }: {
  icon?: LucideIcon; label: string; value: ReactNode; sub?: ReactNode; compare?: ReactNode; tone?: 'good' | 'bad';
}) {
  return (
    <div className="card p-4">
      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">{Icon && <Icon size={13} />} {label}</p>
      <p className={`text-[22px] font-bold leading-tight mt-1 tabular-nums ${tone === 'bad' ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
      {compare && <p className="text-[11px] mt-1 text-gray-600 dark:text-gray-300">{compare}</p>}
    </div>
  );
}

export function Delta({ now, before, unit = '%', goodWhenUp = true, label = 'vs the period before' }: { now: number; before: number; unit?: string; goodWhenUp?: boolean; label?: string }) {
  if (!before) return null;
  const change = Math.round(((now - before) / Math.abs(before)) * 100);
  const good = change === 0 ? null : (change > 0) === goodWhenUp;
  return (
    <span className={good === null ? 'text-gray-500' : good ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
      {change > 0 ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}{unit} {label}
    </span>
  );
}

export type Series = readonly { key: string; label: string; color: string }[];

export function Legend({ series }: { series: Series }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

// Card with a title and a Chart/Table switch; `table` renders the same data as rows.
export function ChartCard({ title, subtitle, children, table, legend, right }: { title: string; subtitle?: ReactNode; children: ReactNode; table?: ReactNode; legend?: Series; right?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="card p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{title}</p>
          {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
          {table && (
            <button onClick={() => setAsTable((v) => !v)} className="btn-ghost text-[11px] flex items-center gap-1" aria-pressed={asTable}>
              {asTable ? <><BarChart3 size={13} /> Chart</> : <><Table2 size={13} /> Table</>}
            </button>
          )}
        </div>
      </div>
      {legend && !asTable && <Legend series={legend} />}
      {asTable && table ? <div className="overflow-x-auto max-h-80">{table}</div> : children}
    </div>
  );
}

function TipBox({ title, rows }: { title: string; rows: { label: string; color?: string; value: ReactNode }[] }) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-white/10 bg-white dark:bg-navy-700 shadow-lg px-3 py-2 text-[11px] min-w-[160px]">
      <p className="font-semibold mb-1">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-3 text-gray-600 dark:text-gray-300">
          <span className="flex items-center gap-1.5">{r.color && <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />}{r.label}</span><b className="text-gray-900 dark:text-white tabular-nums">{r.value}</b>
        </p>
      ))}
    </div>
  );
}

type Row = Record<string, string | number | null>;

// Bars per day (stacked when there are several series).
export function DailyBars({ data, series, c, height = 240, stacked = true, format = (n: number) => String(n), xKey = 'day', xFormat = shortDay, tipTitle = (x: string) => longDay(x) }: {
  data: Row[]; series: Series; c: Palette; height?: number; stacked?: boolean; format?: (n: number) => string; xKey?: string; xFormat?: (x: string) => string; tipTitle?: (x: string) => string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }} barCategoryGap="18%" barGap={2}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey={xKey} tickFormatter={xFormat} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tickFormatter={(v) => format(Number(v))} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} width={44} />
          <Tooltip cursor={{ fill: c.grid }} content={({ active, payload, label }) => active && payload?.length ? (
            <TipBox title={tipTitle(String(label))} rows={[...series].reverse().map((s) => ({ label: s.label, color: s.color, value: format(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)) }))} />
          ) : null} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId={stacked ? 'a' : undefined} fill={s.color} stroke={stacked ? c.surface : undefined} strokeWidth={stacked ? 1 : 0}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Lines over days - for rates (on-time %, payment rate) where a bar would mislead.
export function DailyLines({ data, series, c, height = 220, format = (n: number) => String(n), domain }: {
  data: Row[]; series: Series; c: Palette; height?: number; format?: (n: number) => string; domain?: [number, number];
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis domain={domain} tickFormatter={(v) => format(Number(v))} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} width={44} />
          <Tooltip cursor={{ stroke: c.axis, strokeDasharray: '3 3' }} content={({ active, payload, label }) => active && payload?.length ? (
            <TipBox title={longDay(String(label))} rows={series.map((s) => {
              const v = payload.find((p) => p.dataKey === s.key)?.value;
              return { label: s.label, color: s.color, value: v == null ? '—' : format(Number(v)) };
            })} />
          ) : null} />
          {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={data.length <= 31 ? { r: 3, strokeWidth: 2, fill: c.surface } : false} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Horizontal bars for a ranking (one value per row), drawn in HTML.
export function RankBars({ rows, color, format = (n: number) => String(n), empty = 'Nothing yet.', onRowClick }: {
  rows: { key: string; label: string; n: number; sub?: string }[]; color: string; format?: (n: number) => string; empty?: string; onRowClick?: (key: string) => void;
}) {
  if (!rows.length) return <p className="text-[12px] text-gray-400 text-center py-6">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.n)));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} onClick={onRowClick ? () => onRowClick(r.key) : undefined} title={`${r.label}: ${format(r.n)}`}
          className={`grid grid-cols-[minmax(90px,150px)_1fr_auto] items-center gap-2 text-[11px] ${onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03] rounded' : ''}`}>
          <span className="truncate text-gray-700 dark:text-gray-200">{r.label}</span>
          <div className="h-3.5"><div className="h-full rounded-r-[4px]" style={{ width: `${(Math.abs(r.n) / max) * 100}%`, background: color, minWidth: r.n ? 3 : 0 }} /></div>
          <span className="text-right tabular-nums text-gray-700 dark:text-gray-200 whitespace-nowrap">{format(r.n)}{r.sub && <span className="text-gray-400"> {r.sub}</span>}</span>
        </div>
      ))}
    </div>
  );
}

// Simple data table used as the "Table" side of a ChartCard.
export function MiniTable({ head, rows }: { head: string[]; rows: (string | number | ReactNode)[][] }) {
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-gray-500 text-left">{head.map((h, i) => <th key={h} className={`py-1 pr-3 font-medium ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-gray-100 dark:border-white/5">
            {r.map((v, j) => <td key={j} className={`py-1 pr-3 ${j ? 'text-right tabular-nums' : ''}`}>{v}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-gray-400 text-center py-10">{children}</p>;
}
