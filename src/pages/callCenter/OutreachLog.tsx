import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react';
import { PlatformDriver } from '../../lib/supabase';
import {
  ANSWER_LABEL, ANSWERS, APP_STATUS, APP_STATUS_SHORT, CATEGORIES, CATEGORY_LABEL, categoryOf, OutreachCall, OutreachStatus, RESULT_LABEL, RESULTS,
} from '../../lib/outreach';

type Period = 'all' | 'today' | 'yesterday' | 'week' | '7d' | 'month' | 'custom';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Pick dates' },
];
const PAGE_SIZES = [25, 50, 100];

const kigaliDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// [from, to] inclusive, as Kigali days; null = no limit.
function periodRange(p: Period, today: string, from: string, to: string): [string | null, string | null] {
  if (p === 'today') return [today, today];
  if (p === 'yesterday') return [addDays(today, -1), addDays(today, -1)];
  if (p === 'week') { const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; return [addDays(today, -dow), today]; }
  if (p === '7d') return [addDays(today, -6), today];
  if (p === 'month') return [`${today.slice(0, 8)}01`, today];
  if (p === 'custom') return [from || null, to || null];
  return [null, null];
}

// Every outreach call: all of them by default, newest first, page by page.
// Filters narrow it down; the per-agent summary always matches the filters.
export default function OutreachLog({ calls, drivers, statuses, names }: {
  calls: OutreachCall[]; drivers: PlatformDriver[]; statuses: Record<string, OutreachStatus>; names: Record<string, string>;
}) {
  const today = kigaliDay(new Date().toISOString());
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [agent, setAgent] = useState('');
  const [result, setResult] = useState('');
  const [round, setRound] = useState('');
  const [app, setApp] = useState('');
  const [device, setDevice] = useState('');
  const [branding, setBranding] = useState('');
  const [category, setCategory] = useState('');
  const [onlyYes, setOnlyYes] = useState(false);
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [q, setQ] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const [rangeFrom, rangeTo] = periodRange(period, today, from, to);
  const term = q.trim().toLowerCase().replace(/\s/g, '');
  const match = (f: string, v: string | null | undefined) => !f || (f === 'none' ? !v : v === f);

  // Everything except the agent filter - the summary table uses this so it
  // keeps showing every agent while one of them is selected.
  const base = useMemo(() => calls.filter((c) => {
    const day = kigaliDay(c.created_at);
    if (rangeFrom && day < rangeFrom) return false;
    if (rangeTo && day > rangeTo) return false;
    if (result && c.result !== result) return false;
    if (round && String(c.round) !== round) return false;
    if (!match(app, c.app_status) || !match(device, c.device_answer) || !match(branding, c.branding_answer)) return false;
    if (onlyYes && !c.interested) return false;
    if (onlyNotes && !c.note?.trim()) return false;
    if (category && categoryOf(statuses[c.platform_driver_id]) !== category) return false;
    if (term) {
      const d = driverById.get(c.platform_driver_id);
      if (![d?.full_name, d?.phone, d?.car?.plate_number, c.note].some((v) => v?.toLowerCase().replace(/\s/g, '').includes(term))) return false;
    }
    return true;
  }), [calls, rangeFrom, rangeTo, result, round, app, device, branding, onlyYes, onlyNotes, category, term, statuses, driverById]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const list = base.filter((c) => !agent || (c.agent_id ?? '') === agent);
    return oldestFirst ? [...list].reverse() : list;
  }, [base, agent, oldestFirst]);

  // Back to page 1 whenever the filters change.
  useEffect(() => { setPage(0); }, [period, from, to, agent, result, round, app, device, branding, category, onlyYes, onlyNotes, term, oldestFirst, pageSize]);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const pageRows = shown.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const summary = useMemo(() => {
    const byAgent = new Map<string, OutreachCall[]>();
    for (const c of base) { const k = c.agent_id ?? ''; byAgent.set(k, [...(byAgent.get(k) ?? []), c]); }
    return [...byAgent.entries()].map(([id, list]) => ({
      id, name: names[id] ?? 'Unknown', calls: list.length,
      reached: list.filter((c) => c.result === 'reached').length,
      noAnswer: list.filter((c) => c.result === 'no_answer').length,
      yes: list.filter((c) => c.interested).length,
      device: list.filter((c) => c.device_answer === 'yes').length,
      branding: list.filter((c) => c.branding_answer === 'yes').length,
      coming: list.filter((c) => c.app_status === 'will_come').length,
    })).sort((a, b) => b.calls - a.calls);
  }, [base, names]);

  const agentOptions = useMemo(() => [...new Set(calls.map((c) => c.agent_id ?? ''))]
    .map((id) => ({ id, name: names[id] ?? 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name)), [calls, names]);
  const rounds = useMemo(() => [...new Set(calls.map((c) => c.round))].sort((a, b) => b - a), [calls]);

  const active = [agent, result, round, app, device, branding, category, term].filter(Boolean).length + (onlyYes ? 1 : 0) + (onlyNotes ? 1 : 0) + (period !== 'all' ? 1 : 0);
  const clear = () => { setPeriod('all'); setFrom(''); setTo(''); setAgent(''); setResult(''); setRound(''); setApp(''); setDevice(''); setBranding(''); setCategory(''); setOnlyYes(false); setOnlyNotes(false); setQ(''); };

  const when = (iso: string) => {
    const d = new Date(iso);
    const day = kigaliDay(iso);
    const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });
    if (day === today) return `Today ${t}`;
    if (day === addDays(today, -1)) return `Yesterday ${t}`;
    return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Kigali' })} ${t}`;
  };

  const downloadCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ['Date', 'Time', 'Agent', 'Driver', 'Phone', 'Plate', 'Round', 'Result', 'Updated app', 'Device', 'Branding', 'Said yes', 'Note'];
    const lines = shown.map((c) => {
      const d = driverById.get(c.platform_driver_id);
      const t = new Date(c.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });
      return [kigaliDay(c.created_at), t, c.agent_id ? names[c.agent_id] ?? '' : '', d?.full_name ?? '', d?.phone ?? '', d?.car?.plate_number ?? '', `R${c.round}`,
        RESULT_LABEL[c.result], c.app_status ? APP_STATUS_SHORT[c.app_status] : '', c.device_answer ? ANSWER_LABEL[c.device_answer] : '',
        c.branding_answer ? ANSWER_LABEL[c.branding_answer] : '', c.interested ? 'Yes' : '', c.note ?? ''].map((v) => esc(String(v))).join(',');
    });
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `outreach-calls-${rangeFrom ?? 'start'}-to-${rangeTo ?? today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sel = (label: string, value: string, set: (v: string) => void, options: { key: string; label: string }[], notAsked = false) => (
    <label className="block min-w-0"><span className="block text-micro text-fg-muted mb-0.5">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} className="input py-1 text-caption">
        <option value="">Any</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        {notAsked && <option value="none">Not asked</option>}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1 rounded-md text-caption font-medium border ${period === p.key ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-line text-fg-muted hover:border-brand/40'}`}>{p.label}</button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-1.5 ml-1">
              <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="input py-1 text-caption" aria-label="From" />
              <span className="text-caption text-fg-subtle">to</span>
              <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="input py-1 text-caption" aria-label="To" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {sel('Agent', agent, setAgent, agentOptions.map((a) => ({ key: a.id, label: a.name })))}
          {sel('Result', result, setResult, RESULTS.map((r) => ({ key: r.key, label: r.label })))}
          {sel('Round', round, setRound, rounds.map((r) => ({ key: String(r), label: `Round ${r}` })))}
          {sel('Updated app', app, setApp, APP_STATUS.map((a) => ({ key: a.key, label: a.short })), true)}
          {sel('Device', device, setDevice, ANSWERS, true)}
          {sel('Branding', branding, setBranding, ANSWERS, true)}
          {sel('Driver now', category, setCategory, CATEGORIES.map((c) => ({ key: c.key, label: c.label })))}
          <label className="block min-w-0"><span className="block text-micro text-fg-muted mb-0.5">Sort</span>
            <select value={oldestFirst ? 'old' : 'new'} onChange={(e) => setOldestFirst(e.target.value === 'old')} className="input py-1 text-caption">
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Driver, phone, plate or note" className="input pl-8 py-1.5 text-small" />
          </div>
          <label className="flex items-center gap-1.5 text-caption text-fg-muted "><input type="checkbox" checked={onlyYes} onChange={(e) => setOnlyYes(e.target.checked)} /> Said yes to something</label>
          <label className="flex items-center gap-1.5 text-caption text-fg-muted "><input type="checkbox" checked={onlyNotes} onChange={(e) => setOnlyNotes(e.target.checked)} /> Has a note</label>
          {active > 0 && <button onClick={clear} className="btn-ghost text-caption flex items-center gap-1"><X size={12} /> Clear {active} filter{active === 1 ? '' : 's'}</button>}
          <div className="ml-auto flex items-center gap-3">
            <p className="text-small text-fg-muted tabular-nums">{shown.length} of {calls.length} call{calls.length === 1 ? '' : 's'}</p>
            <button onClick={downloadCsv} disabled={!shown.length} className="btn-ghost text-caption flex items-center gap-1 border border-line "><Download size={12} /> CSV</button>
          </div>
        </div>

        {summary.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-small min-w-[560px]">
              <thead><tr className="text-left text-fg-muted text-caption">
                {['Agent', 'Calls', 'Reached', 'No answer', 'Said yes', 'Device yes', 'Branding yes', 'Coming to office'].map((h, i) => <th key={h} className={`py-1.5 pr-3 font-medium ${i ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.id} onClick={() => setAgent(agent === s.id ? '' : s.id)} className={`border-t border-line-muted cursor-pointer ${agent === s.id ? 'bg-brand/5' : 'hover:bg-hover '}`}>
                    <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                    {[s.calls, s.reached, s.noAnswer, s.yes, s.device, s.branding, s.coming].map((n, i) => <td key={i} className="py-1.5 pr-3 text-right tabular-nums">{n}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-micro text-fg-subtle mt-1">Click an agent to see only their calls.</p>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        {shown.length === 0 ? <p className="text-small text-fg-subtle text-center py-8">No outreach calls match these filters.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-small min-w-[880px]">
              <thead><tr className="text-left text-fg-muted text-caption">
                {['When', 'Agent', 'Driver', 'Round', 'Result', 'Updated app', 'Device', 'Branding', 'Driver now', 'Note'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {pageRows.map((c) => {
                  const d = driverById.get(c.platform_driver_id);
                  return (
                    <tr key={c.id} className="border-t border-line-muted align-top">
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{when(c.created_at)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{c.agent_id ? names[c.agent_id] ?? '—' : '—'}</td>
                      <td className="py-1.5 pr-3"><span className="font-medium">{d?.full_name ?? '—'}</span><span className="block text-micro text-fg-muted">{d?.car?.plate_number ?? ''} {d?.phone ?? ''}</span></td>
                      <td className="py-1.5 pr-3">R{c.round}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{RESULT_LABEL[c.result]}{c.result === 'callback' && c.callback_at ? <span className="block text-micro text-fg-muted">→ {new Date(c.callback_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> : null}</td>
                      <td className="py-1.5 pr-3">{c.app_status ? APP_STATUS_SHORT[c.app_status] : '—'}</td>
                      <td className="py-1.5 pr-3">{c.device_answer ? ANSWER_LABEL[c.device_answer] : '—'}</td>
                      <td className="py-1.5 pr-3">{c.branding_answer ? ANSWER_LABEL[c.branding_answer] : '—'}</td>
                      <td className="py-1.5 pr-3 text-caption text-fg-muted whitespace-nowrap">{CATEGORY_LABEL[categoryOf(statuses[c.platform_driver_id])].split(' — ')[0]}</td>
                      <td className="py-1.5 text-fg-muted max-w-[260px]">{c.note ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <p className="text-caption text-fg-muted tabular-nums">Showing {safePage * pageSize + 1}–{Math.min(shown.length, (safePage + 1) * pageSize)} of {shown.length}</p>
            <label className="flex items-center gap-1.5 text-caption text-fg-muted">Per page
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="input py-0.5 text-caption w-auto">
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setPage(safePage - 1)} disabled={safePage === 0} className="btn-ghost p-1 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={14} /></button>
              {pageNumbers(safePage, pages).map((n, i) => n < 0
                ? <span key={`gap${i}`} className="px-1 text-caption text-fg-subtle">…</span>
                : <button key={n} onClick={() => setPage(n)} aria-current={n === safePage ? 'page' : undefined}
                    className={`min-w-[26px] h-[26px] rounded-md text-caption tabular-nums ${n === safePage ? 'bg-brand text-white font-semibold' : 'text-fg-muted hover:bg-hover '}`}>{n + 1}</button>)}
              <button onClick={() => setPage(safePage + 1)} disabled={safePage >= pages - 1} className="btn-ghost p-1 disabled:opacity-30" aria-label="Next page"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 0-based page numbers with gaps (-1): 1 … 4 5 6 … 12
function pageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const set = new Set([0, total - 1, current - 1, current, current + 1].filter((n) => n >= 0 && n < total));
  const sorted = [...set].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((n, i) => { if (i && n - sorted[i - 1] > 1) out.push(-1); out.push(n); });
  return out;
}
