import { useEffect, useMemo, useState } from 'react';
import { CarFront, CheckCircle2, ChevronRight, Megaphone, Phone, PhoneForwarded, Search, Target } from 'lucide-react';
import { supabase, PlatformDriver, ScriptCard } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useScriptCards } from '../../lib/callTickets';
import {
  BRANDING_PRICE, BUCKET_LABEL, bucketFor, DAILY_GOAL, DEVICE_PRICE, ONLINE_STATUS, OUTCOME_LABEL, OUTCOMES,
  OutreachCall, OutreachOutcome, QueueBucket, rwf, useOutreach,
} from '../../lib/outreach';
import ScriptCardView from '../../components/callTickets/ScriptCardView';

const BUCKET_ORDER: QueueBucket[] = ['callback_due', 'never', 'retry', 'later', 'done'];

// Call Center: use quiet time to call Non-Insider drivers - new app
// features, the device and branding. Queue on the left, the driver and
// the script on the right, log the outcome and move to the next driver.
export default function OutreachPage() {
  const { profile } = useAuth();
  const { drivers, calls, loading, reload } = useOutreach();
  const { cards } = useScriptCards();
  const script = useMemo(() => cards.filter((c) => c.section_key === 'outreach'), [cards]);
  const [bucket, setBucket] = useState<QueueBucket>('callback_due');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const lastByDriver = useMemo(() => {
    const m = new Map<string, OutreachCall>();
    for (const c of calls) if (!m.has(c.platform_driver_id)) m.set(c.platform_driver_id, c);
    return m;
  }, [calls]);

  const queue = useMemo(() => {
    const now = Date.now();
    const grouped: Record<QueueBucket, PlatformDriver[]> = { callback_due: [], never: [], retry: [], later: [], done: [] };
    for (const d of drivers) grouped[bucketFor(d, lastByDriver.get(d.id), now)].push(d);
    // Unknown survey answers first among drivers never called; earliest call-back first.
    const unknown = (d: PlatformDriver) => (d.car?.willing_to_buy_device == null ? 0 : 1) + (d.car?.allows_branding == null ? 0 : 1);
    grouped.never.sort((a, b) => unknown(a) - unknown(b));
    const cb = (d: PlatformDriver) => new Date(lastByDriver.get(d.id)?.callback_at ?? 0).getTime();
    grouped.callback_due.sort((a, b) => cb(a) - cb(b));
    grouped.later.sort((a, b) => cb(a) - cb(b));
    return grouped;
  }, [drivers, lastByDriver]);

  // Open on the first non-empty bucket.
  useEffect(() => {
    if (loading) return;
    if (!queue[bucket].length) {
      const first = BUCKET_ORDER.find((b) => queue[b].length);
      if (first && first !== bucket) setBucket(first);
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = q.trim().toLowerCase();
  const list = term
    ? drivers.filter((d) => [d.full_name, d.phone, d.car?.plate_number].some((v) => v?.toLowerCase().replace(/\s/g, '').includes(term.replace(/\s/g, ''))))
    : queue[bucket];
  const selected = drivers.find((d) => d.id === selectedId) ?? null;

  const today = new Date().toDateString();
  const mineToday = calls.filter((c) => c.agent_id === profile?.id && new Date(c.created_at).toDateString() === today);
  const teamToday = calls.filter((c) => new Date(c.created_at).toDateString() === today);
  const reachedDrivers = new Set(calls.filter((c) => !['no_answer', 'wrong_number'].includes(c.outcome)).map((c) => c.platform_driver_id)).size;
  const interestedDrivers = new Set(calls.filter((c) => c.outcome.startsWith('interested')).map((c) => c.platform_driver_id)).size;

  const goNext = () => {
    const pool = queue[bucket].filter((d) => d.id !== selectedId);
    setSelectedId(pool[0]?.id ?? null);
  };

  if (loading) return <div className="card p-10 text-center text-[12px] text-gray-400">Loading Non-Insider drivers…</div>;

  const pct = Math.min(100, Math.round((mineToday.length / DAILY_GOAL) * 100));
  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-[220px]">
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand-600 dark:text-brand-300 flex items-center justify-center"><Target size={18} /></div>
          <div className="flex-1">
            <p className="text-[12px] font-semibold">Your outreach today: {mineToday.length} of {DAILY_GOAL}</p>
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 mt-1.5 overflow-hidden" role="progressbar" aria-valuenow={mineToday.length} aria-valuemax={DAILY_GOAL}>
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <Stat n={mineToday.filter((c) => c.outcome.startsWith('interested')).length} label="interested (you, today)" />
        <Stat n={teamToday.length} label="team calls today" />
        <Stat n={`${reachedDrivers}/${drivers.length}`} label="drivers reached so far" />
        <Stat n={interestedDrivers} label="interested so far" />
      </div>

      <div className="rounded-xl bg-brand/5 border border-brand/20 px-4 py-3 text-[12px] flex flex-wrap gap-x-6 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold"><Megaphone size={14} className="text-brand-600 dark:text-brand-300" /> The offer</span>
        <span><b>Device</b> — {rwf(DEVICE_PRICE)}, one-time. More clients, online more.</span>
        <span><b>Branding</b> — {rwf(BRANDING_PRICE)}, one-time, paid by the driver. Branded drivers become <b>priority drivers</b>.</span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-4 items-start">
        <div className="card p-3 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-8" placeholder="Name, phone or plate" aria-label="Search Non-Insider drivers" />
          </div>
          {!term && (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Outreach queue">
              {BUCKET_ORDER.map((b) => (
                <button key={b} role="tab" aria-selected={bucket === b} onClick={() => setBucket(b)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium border ${bucket === b ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>
                  {BUCKET_LABEL[b]} <span className="opacity-70">{queue[b].length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-1">
            {list.length === 0 && <p className="text-[12px] text-gray-400 text-center py-6">{term ? 'No driver matches.' : bucket === 'callback_due' ? 'No call-backs due right now.' : 'Nobody here.'}</p>}
            {list.map((d) => {
              const last = lastByDriver.get(d.id);
              return (
                <button key={d.id} onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 border transition-colors ${selectedId === d.id ? 'border-brand bg-brand/5' : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium truncate">{d.full_name}</p>
                    <ChevronRight size={13} className="text-gray-300 shrink-0" />
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">{d.car?.plate_number ?? 'No car'} · {d.phone}</p>
                  {last && (
                    <p className="text-[10px] text-gray-400 truncate">
                      {OUTCOME_LABEL[last.outcome]} · {new Date(last.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {last.outcome === 'callback' && last.callback_at && ` → ${new Date(last.callback_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {selected ? (
          <DriverCall key={selected.id} driver={selected} history={calls.filter((c) => c.platform_driver_id === selected.id)} script={script}
            onLogged={async () => { await reload(); goNext(); }} />
        ) : (
          <div className="card p-6 space-y-4">
            <div>
              <p className="text-[14px] font-semibold flex items-center gap-2"><PhoneForwarded size={16} className="text-brand-600 dark:text-brand-300" /> Pick a driver to call</p>
              <p className="text-[12px] text-gray-500 mt-1">Start with call-backs that are due, then drivers nobody has called yet. Log every call — even no answer — so nobody gets called twice the same day.</p>
            </div>
            {queue[bucket][0] && <button onClick={() => setSelectedId(queue[bucket][0].id)} className="btn-primary">Call the next driver</button>}
            <ScriptSteps script={script} />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return <div><p className="text-[16px] font-bold leading-tight">{n}</p><p className="text-[10px] text-gray-500">{label}</p></div>;
}

function ScriptSteps({ script }: { script: ScriptCard[] }) {
  const [open, setOpen] = useState<string | null>(script[0]?.id ?? null);
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

function DriverCall({ driver, history, script, onLogged }: { driver: PlatformDriver; history: OutreachCall[]; script: ScriptCard[]; onLogged: () => void }) {
  const [outcome, setOutcome] = useState<OutreachOutcome | null>(null);
  const [online, setOnline] = useState<string>(history[0]?.online_status ?? '');
  const [area, setArea] = useState(history.find((h) => h.usual_area)?.usual_area ?? '');
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const car = driver.car;

  const yesNo = (v: boolean | null | undefined) => (v == null ? 'Not asked yet' : v ? 'Yes' : 'No');
  const save = async () => {
    if (!outcome) { setError('Pick how the call went.'); return; }
    if (outcome === 'callback' && !callbackAt) { setError('Set when to call back.'); return; }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('log_outreach_call', {
      p: { platform_driver_id: driver.id, outcome, online_status: online, usual_area: area, note, callback_at: callbackAt ? new Date(callbackAt).toISOString() : null },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSaved(outcome.startsWith('interested') ? 'Saved — the Fleet Manager has been told.' : 'Saved.');
    setTimeout(onLogged, 600);
  };

  const toneClass = (tone: string, active: boolean) => active
    ? tone === 'good' ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
      : tone === 'bad' ? 'border-red-400 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200'
      : 'border-brand bg-brand/10 text-brand-800 dark:text-brand-200'
    : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-brand/40';

  return (
    <div className="grid xl:grid-cols-2 gap-4 items-start">
      <div className="card p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold truncate">{driver.full_name}</p>
            <p className="text-[12px] text-gray-500 flex items-center gap-1.5"><CarFront size={13} /> {car ? `${car.plate_number}${car.make ? ` · ${car.make} ${car.model ?? ''}` : ''}${car.color ? ` · ${car.color}` : ''}` : 'No car linked'}{driver.is_owner ? ' · owner' : ''}</p>
          </div>
          <a href={`tel:${driver.phone}`} className="btn-primary flex items-center gap-1.5 shrink-0"><Phone size={14} /> {driver.phone}</a>
        </div>

        {car && (
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[['Branded', car.is_branded || car.branding_status === 'branded'], ['Allows branding', car.allows_branding], ['Wants device', car.willing_to_buy_device]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-2">
                <p className="text-[12px] font-semibold">{yesNo(v as boolean | null)}</p>
                <p className="text-[10px] text-gray-500">{l as string}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">How did the call go? *</p>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Outcome">
            {OUTCOMES.map((o) => (
              <button key={o.key} role="radio" aria-checked={outcome === o.key} onClick={() => setOutcome(o.key)}
                className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${toneClass(o.tone, outcome === o.key)}`}>
                <span className="block text-[12px] font-medium">{o.label}</span>
                <span className="block text-[10px] opacity-70">{o.hint}</span>
              </button>
            ))}
          </div>
          {outcome === 'callback' && (
            <label className="block"><span className="block text-[11px] font-medium mb-1 text-gray-500">Call back on *</span>
              <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className="input" />
            </label>
          )}
          {outcome && !['no_answer', 'wrong_number'].includes(outcome) && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[11px] font-medium mb-1 text-gray-500">Online on Kivu Ride</span>
                <select value={online} onChange={(e) => setOnline(e.target.value)} className="input">
                  <option value="">Didn't say</option>
                  {ONLINE_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="block"><span className="block text-[11px] font-medium mb-1 text-gray-500">Usually works around</span>
                <input value={area} onChange={(e) => setArea(e.target.value)} className="input" placeholder="e.g. Kimironko, Nyabugogo" />
              </label>
            </div>
          )}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input resize-none" placeholder="What they said — questions, objections, best time to reach them" aria-label="Note" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {saved && <p className="text-[11px] text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> {saved}</p>}
          <button onClick={save} disabled={busy || !!saved} className="btn-primary w-full disabled:opacity-50">{busy ? 'Saving…' : 'Log call & next driver'}</button>
        </div>

        {history.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-gray-100 dark:border-white/5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Earlier outreach calls</p>
            {history.map((h) => (
              <p key={h.id} className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="text-gray-400">{new Date(h.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span> · {OUTCOME_LABEL[h.outcome]}{h.note ? ` — ${h.note}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="card p-4"><ScriptSteps script={script} /></div>
    </div>
  );
}
