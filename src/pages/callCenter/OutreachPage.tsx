import { useEffect, useMemo, useState } from 'react';
import { Building2, CarFront, CheckCircle2, ChevronRight, Lock, Megaphone, Pencil, Phone, PhoneForwarded, RotateCcw, Search, Target, Undo2 } from 'lucide-react';
import { supabase, PlatformDriver, ScriptCard } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useScriptCards } from '../../lib/callTickets';
import {
  Answer, ANSWER_LABEL, ANSWERS, APP_STATUS, APP_STATUS_SHORT, APP_USAGE, APP_USAGE_LABEL, AppStatus, AppUsage, BRANDING_PRICE, CallResult,
  callbackDue, CATEGORIES, Category, CATEGORY_LABEL, categoryOf, claimedByOther, DAILY_GOAL, DEVICE_PRICE, doneThisRound, OutreachCall,
  OutreachRound, OutreachStatus, RESULT_LABEL, RESULTS, rwf, shortDate, useOutreach,
} from '../../lib/outreach';
import ScriptCardView from '../../components/callTickets/ScriptCardView';
import Modal from '../../components/Modal';
import OutreachLog from './OutreachLog';
import OutreachReport from './OutreachReport';

type View = 'round' | 'callbacks' | Category | 'all';
type AnswerFilter = '' | 'none' | string;

// Call Center: call every Non-Insider driver, round after round, and record
// the updated-app / device / branding answers. Categories and filters come
// straight from those answers.
export default function OutreachPage() {
  const { profile } = useAuth();
  const me = profile?.id;
  const { drivers, statuses, calls, round, names, loading, reload } = useOutreach();
  const { cards } = useScriptCards();
  const script = useMemo(() => cards.filter((c) => c.section_key === 'outreach'), [cards]);
  const [view, setView] = useState<View>('round');
  const [appF, setAppF] = useState<AnswerFilter>('');
  const [deviceF, setDeviceF] = useState<AnswerFilter>('');
  const [brandF, setBrandF] = useState<AnswerFilter>('');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<string | null>(null);
  const [nextMsg, setNextMsg] = useState('');
  const [newRound, setNewRound] = useState(false);
  const isMd = profile?.role === 'managing_director';
  const [tab, setTab] = useState<'call' | 'log' | 'report'>(isMd ? 'report' : 'call');
  const roundNo = round?.number ?? 1;

  const now = Date.now();
  const counts = useMemo(() => {
    const c: Record<string, number> = { round: 0, callbacks: 0, all: drivers.length };
    for (const d of drivers) {
      const s = statuses[d.id];
      c[categoryOf(s)] = (c[categoryOf(s)] ?? 0) + 1;
      if (!doneThisRound(s, roundNo)) c.round += 1;
      if (callbackDue(s, now)) c.callbacks += 1;
    }
    return c;
  }, [drivers, statuses, roundNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const matchAnswer = (f: AnswerFilter, v: string | null | undefined) => !f || (f === 'none' ? !v : v === f);
  const term = q.trim().toLowerCase().replace(/\s/g, '');
  const list = drivers.filter((d) => {
    const s = statuses[d.id];
    if (term) return [d.full_name, d.phone, d.car?.plate_number].some((v) => v?.toLowerCase().replace(/\s/g, '').includes(term));
    if (view === 'round' && doneThisRound(s, roundNo)) return false;
    if (view === 'callbacks' && !callbackDue(s, now)) return false;
    if (view !== 'round' && view !== 'callbacks' && view !== 'all' && categoryOf(s) !== view) return false;
    return matchAnswer(appF, s?.app_status) && matchAnswer(deviceF, s?.device_answer) && matchAnswer(brandF, s?.branding_answer);
  }).sort((a, b) => {
    // Round view: call-backs due, then never tried this round, then the rest.
    const sa = statuses[a.id], sb = statuses[b.id];
    const rank = (s?: OutreachStatus) => (callbackDue(s, now) ? 0 : s?.last_round === roundNo ? 2 : 1);
    return rank(sa) - rank(sb) || (sa?.last_called_at ?? '').localeCompare(sb?.last_called_at ?? '');
  });

  const open = async (id: string) => {
    setNextMsg('');
    setSelectedId(id);
    setBlockedBy(null);
    const { data, error } = await supabase.rpc('claim_outreach_driver', { p_driver: id });
    if (!error && data) setBlockedBy(data as string);
  };
  const callNext = async () => {
    setNextMsg('');
    const { data, error } = await supabase.rpc('next_outreach_driver');
    if (error) { setNextMsg(error.message); return; }
    if (!data) { setSelectedId(null); setNextMsg(`Everyone left in round ${roundNo} is being called, waiting for a call-back, or was tried in the last 2 hours. When the round is done, start the next one.`); return; }
    setBlockedBy(null);
    setSelectedId(data as string);
  };
  useEffect(() => () => { if (selectedId) supabase.rpc('release_outreach_claim', { p_driver: selectedId }); }, [selectedId]);

  const today = new Date().toDateString();
  const mineToday = calls.filter((c) => c.agent_id === me && new Date(c.created_at).toDateString() === today);
  const selected = drivers.find((d) => d.id === selectedId) ?? null;
  const pool = drivers.length - (counts.came ?? 0) - (counts.wrong_number ?? 0);
  const doneInRound = Math.max(0, pool - counts.round);

  if (loading) return <div className="card p-10 text-center text-[12px] text-gray-400">Loading Non-Insider drivers…</div>;

  const chip = (key: View, label: string, n: number | undefined, title?: string) => (
    <button key={key} role="tab" aria-selected={view === key} title={title} onClick={() => { setView(key); setQ(''); }}
      className={`px-2 py-1 rounded-md text-[11px] font-medium border text-left ${view === key && !term ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-brand/40'}`}>
      {label} <span className="opacity-70 tabular-nums">{n ?? 0}</span>
    </button>
  );
  const select = (label: string, value: string, set: (v: string) => void, options: { key: string; label: string }[]) => (
    <label className="block min-w-0"><span className="block text-[10px] text-gray-500 mb-0.5">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} className="input py-1 text-[11px]">
        <option value="">Any</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        <option value="none">Not asked yet</option>
      </select>
    </label>
  );

  const tabs = (
    <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit" role="tablist" aria-label="Outreach">
      {([['call', 'Call drivers'], ['log', 'Calls log'], ...(isMd ? [['report', 'Full report']] as const : [])] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium ${tab === k ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>{l}</button>
      ))}
    </div>
  );
  if (tab === 'log') return <div className="space-y-4">{tabs}<OutreachLog calls={calls} drivers={drivers} names={names} /></div>;
  if (tab === 'report' && isMd) return <div className="space-y-4">{tabs}<OutreachReport drivers={drivers} statuses={statuses} calls={calls} round={round} names={names} /></div>;

  return (
    <div className="space-y-4">
      {tabs}
      <RoundCard round={round} names={names} done={doneInRound} pool={pool} left={counts.round} onStartNext={() => setNewRound(true)} onSaved={reload} />

      <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-[220px] flex-1">
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand-600 dark:text-brand-300 flex items-center justify-center shrink-0"><Target size={18} /></div>
          <div className="flex-1">
            <p className="text-[12px] font-semibold">Your outreach calls today: {mineToday.length} of {DAILY_GOAL}</p>
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 mt-1.5 overflow-hidden" role="progressbar" aria-valuenow={mineToday.length} aria-valuemax={DAILY_GOAL}>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (mineToday.length / DAILY_GOAL) * 100)}%` }} />
            </div>
          </div>
        </div>
        <Stat n={mineToday.filter((c) => c.interested).length} label="said yes (you, today)" />
        <Stat n={counts.accepted ?? 0} label="expected at the office" />
        <Stat n={counts.came ?? 0} label="came to the office" />
      </div>

      <div className="rounded-xl bg-brand/5 border border-brand/20 px-4 py-3 text-[12px] flex flex-wrap gap-x-6 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold"><Megaphone size={14} className="text-brand-600 dark:text-brand-300" /> Three questions</span>
        <span><b>1. Updated app</b> — come to our office, IT installs it and shows the new features.</span>
        <span><b>2. Device</b> — {rwf(DEVICE_PRICE)}, one-time. More clients.</span>
        <span><b>3. Branding</b> — {rwf(BRANDING_PRICE)}, one-time, paid by the driver → <b>priority driver</b>.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,350px)_minmax(0,1fr)] gap-4 items-start">
        <div className="card p-3 space-y-3">
          <button onClick={callNext} className="btn-primary w-full flex items-center justify-center gap-1.5"><PhoneForwarded size={14} /> Call next driver</button>
          {nextMsg && <p className="text-[11px] text-gray-500 bg-gray-50 dark:bg-white/[0.03] rounded-lg p-2">{nextMsg}</p>}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-8" placeholder="Name, phone or plate" aria-label="Search Non-Insider drivers" />
          </div>
          <div role="tablist" aria-label="Outreach lists" className="space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {chip('round', `To call in round ${roundNo}`, counts.round)}
              {chip('callbacks', 'Call-backs due', counts.callbacks)}
            </div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => chip(c.key, c.label, counts[c.key], c.hint))}
              {chip('all', 'All', counts.all)}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {select('Updated app', appF, setAppF, APP_STATUS.map((a) => ({ key: a.key, label: a.short })))}
            {select('Device', deviceF, setDeviceF, ANSWERS)}
            {select('Branding', brandF, setBrandF, ANSWERS)}
          </div>
          <p className="text-[10px] text-gray-400">{list.length} driver{list.length === 1 ? '' : 's'}</p>
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-1">
            {list.length === 0 && <p className="text-[12px] text-gray-400 text-center py-6">{term ? 'No driver matches.' : view === 'round' ? `Round ${roundNo} is done — everyone has been reached.` : 'Nobody here.'}</p>}
            {list.map((d) => {
              const s = statuses[d.id];
              const lockedBy = claimedByOther(s, me) ? names[s!.claimed_by!] ?? 'another agent' : null;
              return (
                <button key={d.id} onClick={() => open(d.id)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 border transition-colors ${selectedId === d.id ? 'border-brand bg-brand/5' : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03]'} ${lockedBy ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium truncate">{d.full_name}</p>
                    {lockedBy ? <span className="text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-0.5 shrink-0"><Lock size={10} /> {lockedBy.split(/\s+/)[0]}</span> : <ChevronRight size={13} className="text-gray-300 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">{d.car?.plate_number ?? 'No car'} · {d.phone}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <AnswerChip label="App" value={s?.app_status ? APP_STATUS_SHORT[s.app_status] : null} tone={s?.app_status === 'not_interested' ? 'no' : s?.app_status ? 'yes' : null} />
                    <AnswerChip label="Device" value={s?.device_answer ? ANSWER_LABEL[s.device_answer] : null} tone={s?.device_answer ?? null} />
                    <AnswerChip label="Brand" value={s?.branding_answer ? ANSWER_LABEL[s.branding_answer] : null} tone={s?.branding_answer ?? null} />
                    {s?.came_to_office_on && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">✓ Came {shortDate(s.came_to_office_on)}</span>}
                  </div>
                  {s?.last_result && (
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">
                      R{s.last_round}: {RESULT_LABEL[s.last_result]}{s.last_called_at && ` · ${shortDate(s.last_called_at)}`}
                      {s.last_result === 'callback' && s.callback_at && ` → ${new Date(s.callback_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {selected ? (
          <DriverCall key={selected.id} driver={selected} status={statuses[selected.id]} history={calls.filter((c) => c.platform_driver_id === selected.id)}
            script={script} round={round} names={names} blockedBy={blockedBy}
            onSaved={async (next) => { await reload(); if (next) await callNext(); }} />
        ) : (
          <div className="card p-6 space-y-4">
            <div>
              <p className="text-[14px] font-semibold flex items-center gap-2"><PhoneForwarded size={16} className="text-brand-600 dark:text-brand-300" /> Press "Call next driver"</p>
              <p className="text-[12px] text-gray-500 mt-1">You get the next driver nobody else is calling — call-backs that are due first, then drivers not called yet this round. Log every call, even no answer. Use the categories and filters to find drivers by their answers.</p>
            </div>
            <ScriptSteps script={script} />
          </div>
        )}
      </div>

      {newRound && <NewRoundModal current={roundNo} left={counts.round} onClose={() => setNewRound(false)} onStarted={async () => { setNewRound(false); setView('round'); await reload(); }} />}
    </div>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return <div><p className="text-[16px] font-bold leading-tight tabular-nums">{n}</p><p className="text-[10px] text-gray-500">{label}</p></div>;
}

function AnswerChip({ label, value, tone }: { label: string; value: string | null; tone: Answer | 'yes' | 'no' | null }) {
  const cls = !value ? 'bg-gray-50 text-gray-400 dark:bg-white/5'
    : tone === 'yes' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
    : tone === 'thinking' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'
    : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{label}: {value ?? '—'}</span>;
}

function RoundCard({ round, names, done, pool, left, onStartNext, onSaved }: { round: OutreachRound | null; names: Record<string, string>; done: number; pool: number; left: number; onStartNext: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(round?.talking_points ?? '');
  const [error, setError] = useState('');
  useEffect(() => setText(round?.talking_points ?? ''), [round?.talking_points]);
  const save = async () => {
    const { error: err } = await supabase.rpc('set_outreach_talking_points', { p_talking_points: text });
    if (err) { setError(err.message); return; }
    setEditing(false);
    onSaved();
  };
  const pct = pool ? Math.round((done / pool) * 100) : 0;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold flex items-center gap-2"><RotateCcw size={15} className="text-brand-600 dark:text-brand-300" /> Call round {round?.number ?? 1}</p>
          <p className="text-[11px] text-gray-500">Started {round ? shortDate(round.started_at) : '—'}{round?.started_by && names[round.started_by] ? ` by ${names[round.started_by]}` : ''} · {done} of {pool} drivers reached · {left} left</p>
        </div>
        <button onClick={onStartNext} className={left === 0 ? 'btn-primary' : 'btn-ghost text-[12px]'}>Start round {(round?.number ?? 1) + 1}</button>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemax={pool} aria-label="Round progress">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="rounded-lg border-l-[3px] border-brand bg-brand/5 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tell them this round</p>
          {!editing && <button onClick={() => setEditing(true)} className="text-[11px] text-gray-500 hover:text-brand-600 flex items-center gap-1"><Pencil size={11} /> Edit</button>}
        </div>
        {editing ? (
          <div className="space-y-1.5 mt-1">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="input resize-none text-[12px]" aria-label="Talking points" />
            {error && <p className="text-[11px] text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end"><button onClick={() => { setEditing(false); setText(round?.talking_points ?? ''); }} className="btn-ghost text-[11px]">Cancel</button><button onClick={save} className="btn-primary text-[11px]">Save</button></div>
          </div>
        ) : <p className="text-[13px] mt-0.5">{round?.talking_points || 'Nothing written yet — press Edit.'}</p>}
      </div>
    </div>
  );
}

function NewRoundModal({ current, left, onClose, onStarted }: { current: number; left: number; onClose: () => void; onStarted: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    setBusy(true);
    const { error: err } = await supabase.rpc('start_outreach_round', { p_talking_points: text });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onStarted();
  };
  return (
    <Modal open onClose={onClose} title={`Start round ${current + 1}`} subtitle="Everyone who hasn't come to the office yet goes back on the list." maxWidth="max-w-md">
      <div className="space-y-3">
        {left > 0 && <p className="text-[12px] rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 px-3 py-2">{left} driver{left === 1 ? ' hasn\'t' : 's haven\'t'} been reached in round {current} yet. Starting now puts them in round {current + 1} with everyone else.</p>}
        <label className="block"><span className="block text-[11px] font-medium mb-1 text-gray-500">What to tell drivers this round *</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="input resize-none" placeholder="e.g. This week we gave our drivers on average 3 passengers a day. Branded drivers get priority — come to the office this week." />
        </label>
        <p className="text-[11px] text-gray-500">Ask IT or the MD for this week's numbers. Never promise a driver a number of trips.</p>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={start} disabled={busy || !text.trim()} className="btn-primary disabled:opacity-50">{busy ? 'Starting…' : `Start round ${current + 1}`}</button></div>
      </div>
    </Modal>
  );
}

function ScriptSteps({ script }: { script: ScriptCard[] }) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (!open && script[0]) setOpen(script[0].id); }, [script, open]);
  if (!script.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">The call, step by step</p>
      {script.map((c, i) => (
        <div key={c.id} className="rounded-lg border border-gray-100 dark:border-white/10">
          <button onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id} className="w-full flex items-center gap-2 px-3 py-2 text-left">
            <span className="w-5 h-5 rounded-full bg-brand/10 text-brand-700 dark:text-brand-300 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="text-[12px] font-medium flex-1">{c.situation}</span>
            <ChevronRight size={13} className={`text-gray-400 transition-transform ${open === c.id ? 'rotate-90' : ''}`} />
          </button>
          {open === c.id && <div className="px-3 pb-3"><ScriptCardView card={c} compact /></div>}
        </div>
      ))}
    </div>
  );
}

function Choice<T extends string>({ label, value, onChange, options, required }: { label: string; value: T | null; onChange: (v: T) => void; options: { key: T; label: string }[]; required?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-1">{label}{required && ' *'}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
            className={`px-2.5 py-1.5 rounded-lg border text-[12px] transition-colors ${value === o.key ? 'border-brand bg-brand/10 text-brand-800 dark:text-brand-200 font-medium' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-brand/40'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DriverCall({ driver, status, history, script, round, names, blockedBy, onSaved }: {
  driver: PlatformDriver; status: OutreachStatus | undefined; history: OutreachCall[]; script: ScriptCard[]; round: OutreachRound | null;
  names: Record<string, string>; blockedBy: string | null; onSaved: (next: boolean) => void;
}) {
  const [result, setResult] = useState<CallResult | null>(null);
  const [app, setApp] = useState<AppStatus | null>(status?.app_status ?? null);
  const [usage, setUsage] = useState<AppUsage | null>(status?.app_usage ?? null);
  const [device, setDevice] = useState<Answer | null>(status?.device_answer ?? null);
  const [brand, setBrand] = useState<Answer | null>(status?.branding_answer ?? null);
  const [area, setArea] = useState(status?.usual_area ?? '');
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const car = driver.car;
  const reached = result === 'reached' || result === 'callback';

  const save = async (next: boolean) => {
    if (!result) { setError('Did you reach the driver?'); return; }
    if (result === 'reached' && (!app || !device || !brand)) { setError('Answer all three questions — updated app, device and branding.'); return; }
    if (result === 'callback' && !callbackAt) { setError('Set when to call back.'); return; }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('log_outreach_call', {
      p: {
        platform_driver_id: driver.id, result, note, usual_area: area,
        app_status: reached ? app : null, app_usage: reached ? usage : null, device_answer: reached ? device : null, branding_answer: reached ? brand : null,
        callback_at: callbackAt ? new Date(callbackAt).toISOString() : null,
      },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSaved(device === 'yes' || brand === 'yes' ? 'Saved — the Fleet Manager has been told.' : 'Saved.');
    setTimeout(() => onSaved(next), 500);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <div className="card p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold truncate">{driver.full_name}</p>
            <p className="text-[12px] text-gray-500 flex items-center gap-1.5"><CarFront size={13} className="shrink-0" /> <span className="truncate">{car ? `${car.plate_number}${car.make ? ` · ${car.make} ${car.model ?? ''}` : ''}${car.color ? ` · ${car.color}` : ''}` : 'No car linked'}{driver.is_owner ? ' · owner' : ''}</span></p>
            <p className="text-[11px] text-gray-500 mt-0.5">{CATEGORY_LABEL[categoryOf(status)]}{status?.app_usage ? ` · uses the app ${APP_USAGE_LABEL[status.app_usage].toLowerCase()}` : ''}{status?.usual_area ? ` · works around ${status.usual_area}` : ''}</p>
          </div>
          <a href={`tel:${driver.phone}`} className="btn-primary flex items-center gap-1.5 shrink-0"><Phone size={14} /> {driver.phone}</a>
        </div>

        {blockedBy && (
          <p className="text-[12px] rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 px-3 py-2 flex items-center gap-1.5">
            <Lock size={13} /> {blockedBy} is calling this driver right now. Pick another driver so you don't both call them.
          </p>
        )}

        <CameToOffice driver={driver} status={status} names={names} onSaved={() => onSaved(false)} />

        {!status?.came_to_office_on && (
          <fieldset disabled={!!blockedBy || !!saved} className="space-y-3 disabled:opacity-60">
            <legend className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Log this call · round {round?.number ?? 1}</legend>
            <Choice label="Did you reach them?" value={result} onChange={setResult} options={RESULTS} required />
            {result === 'callback' && (
              <label className="block"><span className="block text-[11px] font-medium mb-1 text-gray-500">Call back on *</span>
                <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className="input" />
              </label>
            )}
            {reached && (
              <div className="space-y-3 rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3">
                {result === 'callback' && <p className="text-[11px] text-gray-500">Record any answers they already gave — the rest can wait for the call-back.</p>}
                <Choice label="1. The updated app" value={app} onChange={setApp} options={APP_STATUS} required={result === 'reached'} />
                <Choice label="How much do they use the Kivu Ride app?" value={usage} onChange={setUsage} options={APP_USAGE} />
                <Choice label={`2. Our device — ${rwf(DEVICE_PRICE)}, one-time`} value={device} onChange={setDevice} options={ANSWERS} required={result === 'reached'} />
                <Choice label={`3. Branding — ${rwf(BRANDING_PRICE)}, one-time, becomes a priority driver`} value={brand} onChange={setBrand} options={ANSWERS} required={result === 'reached'} />
                <label className="block"><span className="block text-[11px] font-medium mb-1 text-gray-500">Usually works around</span>
                  <input value={area} onChange={(e) => setArea(e.target.value)} className="input" placeholder="e.g. Kimironko, Nyabugogo" />
                </label>
              </div>
            )}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input resize-none" placeholder="What they said — questions, objections, the day they'll come to the office" aria-label="Note" />
            {error && <p className="text-[11px] text-red-600">{error}</p>}
            {saved && <p className="text-[11px] text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> {saved}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => save(false)} disabled={busy} className="btn-ghost flex-1">Save</button>
              <button type="button" onClick={() => save(true)} disabled={busy} className="btn-primary flex-[2]">{busy ? 'Saving…' : 'Save & call next driver'}</button>
            </div>
          </fieldset>
        )}

        {history.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-white/5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Earlier calls</p>
            {history.map((h) => (
              <div key={h.id} className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="text-gray-400">R{h.round} · {shortDate(h.created_at)}{h.agent_id && names[h.agent_id] ? ` · ${names[h.agent_id].split(/\s+/)[0]}` : ''}</span> — {RESULT_LABEL[h.result]}
                {(h.app_status || h.device_answer || h.branding_answer) && (
                  <span>: app {h.app_status ? APP_STATUS_SHORT[h.app_status].toLowerCase() : '—'}, device {h.device_answer ? ANSWER_LABEL[h.device_answer].toLowerCase() : '—'}, branding {h.branding_answer ? ANSWER_LABEL[h.branding_answer].toLowerCase() : '—'}</span>
                )}
                {h.note && <span className="text-gray-500"> — “{h.note}”</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card p-4"><ScriptSteps script={script} /></div>
    </div>
  );
}

function CameToOffice({ driver, status, names, onSaved }: { driver: PlatformDriver; status: OutreachStatus | undefined; names: Record<string, string>; onSaved: () => void }) {
  const todayIso = new Date().toLocaleDateString('en-CA');
  const [date, setDate] = useState(todayIso);
  const [error, setError] = useState('');
  const set = async (d: string | null) => {
    const { error: err } = await supabase.rpc('set_outreach_came_to_office', { p_driver: driver.id, p_date: d });
    if (err) { setError(err.message); return; }
    onSaved();
  };
  if (status?.came_to_office_on) {
    return (
      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5"><CheckCircle2 size={14} /> Came to the office on {shortDate(status.came_to_office_on)}{status.came_recorded_by && names[status.came_recorded_by] ? ` · recorded by ${names[status.came_recorded_by]}` : ''} — out of the call rounds.</p>
        <button onClick={() => set(null)} className="text-[11px] text-gray-500 hover:underline flex items-center gap-1"><Undo2 size={11} /> Undo</button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-gray-200 dark:border-white/10 px-3 py-2 flex flex-wrap items-center gap-2">
      <Building2 size={14} className="text-gray-400" />
      <span className="text-[12px] text-gray-600 dark:text-gray-300 flex-1 min-w-[160px]">IT says they came to the office?</span>
      <input type="date" value={date} max={todayIso} onChange={(e) => setDate(e.target.value)} className="input py-1 w-auto text-[12px]" aria-label="Date they came" />
      <button onClick={() => set(date)} className="btn-ghost text-[12px]">Mark as came</button>
      {error && <p className="text-[11px] text-red-600 w-full">{error}</p>}
    </div>
  );
}
