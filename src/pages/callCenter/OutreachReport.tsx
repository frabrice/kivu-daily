import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, Download, FileSpreadsheet, Phone, Search, Target, ThumbsUp, Users2 } from 'lucide-react';
import { PlatformDriver } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import {
  ANSWER_LABEL, APP_STATUS_SHORT, APP_USAGE_LABEL, CATEGORIES, Category, CATEGORY_LABEL, categoryOf, OutreachCall, OutreachRound,
  OutreachStatus, RESULT_LABEL, shortDate,
} from '../../lib/outreach';

// The MD's full Non-Insider outreach report: every driver with every answer,
// filters (above all: who said yes to the device or branding), analytics on
// the whole campaign, per-agent results, and downloads (Excel-ready CSV and
// a PDF report).

type Quick = 'interested' | 'device' | 'branding' | 'both' | 'came' | 'all';
const QUICK: { key: Quick; label: string }[] = [
  { key: 'interested', label: 'Device or branding: yes' },
  { key: 'device', label: 'Device: yes' },
  { key: 'branding', label: 'Branding: yes' },
  { key: 'both', label: 'Both: yes' },
  { key: 'came', label: 'Came to the office' },
  { key: 'all', label: 'All drivers' },
];

const PAL = {
  light: { yes: '#1baf7a', thinking: '#eda100', no: '#4a3aa7', none: '#d4d4d4', blue: '#2a78d6', grid: '#f1f5f9', axis: '#9ca3af', surface: '#ffffff' },
  dark: { yes: '#199e70', thinking: '#c98500', no: '#9085e9', none: '#4b5563', blue: '#3987e5', grid: 'rgba(255,255,255,0.06)', axis: '#5d7791', surface: '#17263A' },
};

export interface ReportRow {
  d: PlatformDriver;
  s: OutreachStatus | undefined;
  category: Category;
  calls: number;
  lastCall: OutreachCall | undefined;
  lastNote: string | null;
}

export function buildRows(drivers: PlatformDriver[], statuses: Record<string, OutreachStatus>, calls: OutreachCall[]): ReportRow[] {
  return drivers.map((d) => {
    const mine = calls.filter((c) => c.platform_driver_id === d.id);
    return { d, s: statuses[d.id], category: categoryOf(statuses[d.id]), calls: mine.length, lastCall: mine[0], lastNote: mine.find((c) => c.note)?.note ?? null };
  });
}

export default function OutreachReport({ drivers, statuses, calls, round, names }: {
  drivers: PlatformDriver[]; statuses: Record<string, OutreachStatus>; calls: OutreachCall[]; round: OutreachRound | null; names: Record<string, string>;
}) {
  const { theme } = useTheme();
  const c = PAL[theme === 'dark' ? 'dark' : 'light'];
  const rows = useMemo(() => buildRows(drivers, statuses, calls), [drivers, statuses, calls]);
  const [quick, setQuick] = useState<Quick>('interested');
  const [category, setCategory] = useState<Category | ''>('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const yesDevice = (r: ReportRow) => r.s?.device_answer === 'yes';
  const yesBrand = (r: ReportRow) => r.s?.branding_answer === 'yes';
  const term = q.trim().toLowerCase().replace(/\s/g, '');
  const shown = rows.filter((r) => {
    if (term && ![r.d.full_name, r.d.phone, r.d.car?.plate_number, r.s?.usual_area].some((v) => v?.toLowerCase().replace(/\s/g, '').includes(term))) return false;
    if (category && r.category !== category) return false;
    if (quick === 'interested') return yesDevice(r) || yesBrand(r);
    if (quick === 'device') return yesDevice(r);
    if (quick === 'branding') return yesBrand(r);
    if (quick === 'both') return yesDevice(r) && yesBrand(r);
    if (quick === 'came') return !!r.s?.came_to_office_on;
    return true;
  }).sort((a, b) => Number(yesDevice(b) || yesBrand(b)) - Number(yesDevice(a) || yesBrand(a)) || (b.s?.last_called_at ?? '').localeCompare(a.s?.last_called_at ?? ''));

  const total = rows.length;
  const called = rows.filter((r) => r.s?.last_called_at).length;
  const reached = rows.filter((r) => r.s?.ever_reached).length;
  const dev = rows.filter(yesDevice).length;
  const brand = rows.filter(yesBrand).length;
  const either = rows.filter((r) => yesDevice(r) || yesBrand(r)).length;
  const coming = rows.filter((r) => r.s?.app_status === 'will_come').length;
  const came = rows.filter((r) => r.s?.came_to_office_on).length;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  const funnel = [
    { name: 'Non-Insider drivers', n: total },
    { name: 'Called', n: called },
    { name: 'Reached', n: reached },
    { name: 'Said yes to device or branding', n: either },
    { name: 'Came to the office', n: came },
  ];
  const answerRows = [
    { q: 'Updated app', yes: rows.filter((r) => r.s?.app_status === 'will_come').length + rows.filter((r) => r.s?.app_status === 'has_latest').length, thinking: 0, no: rows.filter((r) => r.s?.app_status === 'not_interested').length, none: rows.filter((r) => !r.s?.app_status).length },
    { q: 'Device (120k)', yes: dev, thinking: rows.filter((r) => r.s?.device_answer === 'thinking').length, no: rows.filter((r) => r.s?.device_answer === 'no').length, none: rows.filter((r) => !r.s?.device_answer).length },
    { q: 'Branding (20k)', yes: brand, thinking: rows.filter((r) => r.s?.branding_answer === 'thinking').length, no: rows.filter((r) => r.s?.branding_answer === 'no').length, none: rows.filter((r) => !r.s?.branding_answer).length },
  ];
  const byDay = useMemo(() => {
    const m = new Map<string, { day: string; reached: number; no_answer: number; callback: number; wrong_number: number }>();
    for (const call of calls) {
      const day = new Date(call.created_at).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
      const e = m.get(day) ?? { day, reached: 0, no_answer: 0, callback: 0, wrong_number: 0 };
      e[call.result] += 1;
      m.set(day, e);
    }
    return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [calls]);
  const agents = useMemo(() => {
    const m = new Map<string, { name: string; calls: number; reached: number; yes: number; drivers: Set<string> }>();
    for (const call of calls) {
      const id = call.agent_id ?? '';
      const e = m.get(id) ?? { name: names[id] ?? 'Unknown', calls: 0, reached: 0, yes: 0, drivers: new Set<string>() };
      e.calls += 1; if (call.result === 'reached') e.reached += 1; if (call.device_answer === 'yes' || call.branding_answer === 'yes') e.yes += 1;
      e.drivers.add(call.platform_driver_id);
      m.set(id, e);
    }
    return [...m.values()].sort((a, b) => b.calls - a.calls);
  }, [calls, names]);
  const usage = Object.entries(APP_USAGE_LABEL).map(([k, label]) => ({ label, n: rows.filter((r) => r.s?.app_usage === k).length }));
  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if ((yesDevice(r) || yesBrand(r)) && r.s?.usual_area) m.set(r.s.usual_area.trim(), (m.get(r.s.usual_area.trim()) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const csv = () => {
    const head = ['Driver', 'Phone', 'Plate', 'Car', 'Category', 'Updated app', 'Uses app', 'Device (120k)', 'Branding (20k)', 'Came to office', 'Usual area', 'Calls', 'Last call', 'Last result', 'Last agent', 'Last note'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = shown.map((r) => [r.d.full_name, r.d.phone, r.d.car?.plate_number, [r.d.car?.make, r.d.car?.model].filter(Boolean).join(' '), CATEGORY_LABEL[r.category],
      r.s?.app_status ? APP_STATUS_SHORT[r.s.app_status] : '', r.s?.app_usage ? APP_USAGE_LABEL[r.s.app_usage] : '', r.s?.device_answer ? ANSWER_LABEL[r.s.device_answer] : '', r.s?.branding_answer ? ANSWER_LABEL[r.s.branding_answer] : '',
      r.s?.came_to_office_on ?? '', r.s?.usual_area ?? '', r.calls, r.s?.last_called_at?.slice(0, 10) ?? '', r.s?.last_result ? RESULT_LABEL[r.s.last_result] : '', r.s?.last_agent_id ? names[r.s.last_agent_id] ?? '' : '', r.lastNote ?? ''].map(esc).join(','));
    const blob = new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    save(blob, `Kivu-Ride-NonInsider-Outreach-${QUICK.find((x) => x.key === quick)?.label.replace(/[^a-z]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  const pdf = async () => {
    setBusy(true);
    try {
      const mod = await import('../../lib/outreachReportPdf');
      const blob = await mod.buildOutreachReport({ rows, calls, round, names, agents: agents.map((a) => ({ name: a.name, calls: a.calls, reached: a.reached, yes: a.yes, drivers: a.drivers.size })) });
      save(blob, `Kivu-Ride-NonInsider-Outreach-Report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold">Non-Insider outreach — full report</p>
          <p className="text-[11px] text-gray-500">All {total} Non-Insider drivers, every call since the campaign started · round {round?.number ?? 1}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={csv} className="btn-ghost border border-gray-200 dark:border-white/10 flex items-center gap-1.5"><FileSpreadsheet size={14} /> Download list (Excel)</button>
          <button onClick={pdf} disabled={busy} className="btn-primary flex items-center gap-1.5 disabled:opacity-50"><Download size={14} /> {busy ? 'Preparing…' : 'Download report (PDF)'}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Users2} label="Drivers called" value={`${called} / ${total}`} sub={`${reached} reached (${pct(reached, called)} of those called)`} />
        <Tile icon={ThumbsUp} label="Want our device" value={String(dev)} sub={`${pct(dev, reached)} of drivers reached · 120,000 RWF`} good />
        <Tile icon={Target} label="Want branding" value={String(brand)} sub={`${pct(brand, reached)} of drivers reached · 20,000 RWF`} good />
        <Tile icon={Building2} label="Came to the office" value={String(came)} sub={`${coming} more said they will come`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard title="From call to office" sub="Every Non-Insider driver, how far they've got.">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ left: 0, right: 48, top: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid horizontal={false} stroke={c.grid} />
                <XAxis type="number" tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: c.grid }} formatter={(v: unknown) => [String(v), 'Drivers']} />
                <Bar dataKey="n" fill={c.blue} radius={[0, 4, 4, 0]} isAnimationActive={false}><LabelList dataKey="n" position="right" style={{ fontSize: 10, fill: c.axis }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Answers to the three questions" sub="Latest answer per driver. Updated app: yes = coming for it or already has it."
          legend={[{ l: 'Yes', c: c.yes }, { l: 'Thinking', c: c.thinking }, { l: 'No', c: c.no }, { l: 'Not asked yet', c: c.none }]}>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={answerRows} layout="vertical" margin={{ left: 0, right: 12, top: 0, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid horizontal={false} stroke={c.grid} />
                <XAxis type="number" tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="q" width={100} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: c.grid }} />
                {(['yes', 'thinking', 'no', 'none'] as const).map((k, i, arr) => (
                  <Bar key={k} dataKey={k} name={k === 'none' ? 'Not asked yet' : k[0].toUpperCase() + k.slice(1)} stackId="a" fill={c[k]} stroke={c.surface} strokeWidth={1} radius={i === arr.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Outreach calls per day" sub="By result." legend={[{ l: 'Reached', c: c.yes }, { l: 'Call back later', c: c.thinking }, { l: 'No answer', c: c.none }, { l: 'Wrong number', c: c.no }]}>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay} margin={{ left: -18, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="day" tickFormatter={(d: string) => shortDate(d)} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: c.grid }} labelFormatter={(d) => shortDate(String(d))} />
                {([['reached', c.yes, 'Reached'], ['callback', c.thinking, 'Call back later'], ['no_answer', c.none, 'No answer'], ['wrong_number', c.no, 'Wrong number']] as const).map(([k, col, name], i, arr) => (
                  <Bar key={k} dataKey={k} name={name} stackId="d" fill={col} stroke={c.surface} strokeWidth={1} radius={i === arr.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Agents" sub="Every outreach call since the start.">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-gray-500 text-[11px]">{['Agent', 'Calls', 'Drivers', 'Reached', 'Said yes'].map((h, i) => <th key={h} className={`py-1.5 pr-3 font-medium ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>{agents.map((a) => (
              <tr key={a.name} className="border-t border-gray-100 dark:border-white/5">
                <td className="py-1.5 pr-3 font-medium">{a.name}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{a.calls}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{a.drivers.size}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{a.reached} <span className="text-gray-400">{pct(a.reached, a.calls)}</span></td>
                <td className="py-1.5 text-right tabular-nums">{a.yes}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="grid grid-cols-2 gap-3 pt-3 mt-2 border-t border-gray-100 dark:border-white/5 text-[11px]">
            <div><p className="font-semibold mb-1">How much they use our app</p>{usage.map((u) => <p key={u.label} className="flex justify-between text-gray-600 dark:text-gray-300"><span>{u.label}</span><b>{u.n}</b></p>)}</div>
            <div><p className="font-semibold mb-1">Where interested drivers work</p>{areas.length ? areas.map(([a, n]) => <p key={a} className="flex justify-between text-gray-600 dark:text-gray-300"><span className="truncate">{a}</span><b>{n}</b></p>) : <p className="text-gray-400">No areas recorded yet.</p>}</div>
          </div>
        </ChartCard>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map((x) => (
            <button key={x.key} onClick={() => setQuick(x.key)} aria-pressed={quick === x.key}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${quick === x.key ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>{x.label}</button>
          ))}
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')} className="input py-1 text-[11px] w-auto" aria-label="Category">
            <option value="">Any category</option>
            {CATEGORIES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-8 py-1.5 text-[12px] w-56" placeholder="Name, phone, plate or area" aria-label="Search" />
          </div>
        </div>
        <p className="text-[11px] text-gray-500">{shown.length} driver{shown.length === 1 ? '' : 's'} · "Download list" exports exactly this list.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[980px]">
            <thead><tr className="text-left text-gray-500 text-[11px]">
              {['Driver', 'Car', 'Category', 'Updated app', 'Device', 'Branding', 'Came', 'Area', 'Calls', 'Last call', 'Note'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.d.id} className="border-t border-gray-100 dark:border-white/5 align-top">
                  <td className="py-1.5 pr-3"><p className="font-medium">{r.d.full_name}</p><a href={`tel:${r.d.phone}`} className="text-[11px] text-brand-600 dark:text-brand-300 flex items-center gap-1"><Phone size={10} />{r.d.phone}</a></td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.d.car?.plate_number ?? '—'}<span className="block text-[10px] text-gray-500">{[r.d.car?.make, r.d.car?.model].filter(Boolean).join(' ')}</span></td>
                  <td className="py-1.5 pr-3">{CATEGORY_LABEL[r.category]}</td>
                  <td className="py-1.5 pr-3">{r.s?.app_status ? APP_STATUS_SHORT[r.s.app_status] : '—'}{r.s?.app_usage && <span className="block text-[10px] text-gray-500">uses: {APP_USAGE_LABEL[r.s.app_usage].toLowerCase()}</span>}</td>
                  <td className="py-1.5 pr-3"><Ans v={r.s?.device_answer} /></td>
                  <td className="py-1.5 pr-3"><Ans v={r.s?.branding_answer} /></td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.s?.came_to_office_on ? shortDate(r.s.came_to_office_on) : '—'}</td>
                  <td className="py-1.5 pr-3">{r.s?.usual_area ?? '—'}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.calls}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.s?.last_called_at ? <>{shortDate(r.s.last_called_at)}<span className="block text-[10px] text-gray-500">{r.s.last_result ? RESULT_LABEL[r.s.last_result] : ''}{r.s.last_agent_id && names[r.s.last_agent_id] ? ` · ${names[r.s.last_agent_id].split(/\s+/)[0]}` : ''}</span></> : '—'}</td>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300 max-w-[220px]">{r.lastNote ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Ans({ v }: { v: 'yes' | 'thinking' | 'no' | null | undefined }) {
  if (!v) return <span className="text-gray-400">—</span>;
  const cls = v === 'yes' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200' : v === 'thinking' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300';
  return <span className={`text-[11px] px-1.5 py-0.5 rounded ${cls}`}>{ANSWER_LABEL[v]}</span>;
}

function Tile({ icon: Icon, label, value, sub, good }: { icon: typeof Users2; label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className={`card p-4 ${good ? 'ring-1 ring-emerald-200 dark:ring-emerald-500/30' : ''}`}>
      <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Icon size={13} /> {label}</p>
      <p className="text-[22px] font-bold leading-tight mt-1 tabular-nums">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}

function ChartCard({ title, sub, legend, children }: { title: string; sub: string; legend?: { l: string; c: string }[]; children: React.ReactNode }) {
  return (
    <div className="card p-4 space-y-2">
      <div><p className="text-[13px] font-semibold">{title}</p><p className="text-[11px] text-gray-500">{sub}</p></div>
      {legend && <div className="flex flex-wrap gap-x-4 gap-y-1">{legend.map((x) => <span key={x.l} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: x.c }} />{x.l}</span>)}</div>}
      {children}
    </div>
  );
}
