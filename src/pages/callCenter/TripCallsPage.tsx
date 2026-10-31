import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Car, CheckCircle2, Loader2, MessageSquareQuote, Phone, PhoneCall, PhoneMissed, Star, ThumbsUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import Modal from '../../components/Modal';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs, rwf } from '../../ui/kit';
import { kigaliHour, kigaliToday } from '../../lib/kigali';
import { ANSWER, CallAnswer, DISPATCH, PITCH, REASON, TripCall, isYes } from '../../lib/tripCalls';

// Call Center > Calls after trips: every Non-Insider driver who completed a
// trip and is due a call (the rules are in migration 20261101170000).
// Record each call; a "yes" goes to Rodrigue as a branding sign-up.

type Tab = 'open' | 'done' | 'stats';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' }) : '—');
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function TripCallsPage() {
  usePageTitle('Calls after trips');
  const a = useAccess();
  const canLog = a.isMd || a.dept === 'call_center';
  const [tab, setTab] = useState<Tab>('open');
  const [calls, setCalls] = useState<TripCall[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState<TripCall | null>(null);
  const today = kigaliToday();

  const load = useCallback(async () => {
    const since = new Date(Date.parse(`${addDays(today, -30)}T00:00:00+02:00`)).toISOString();
    const [c, p] = await Promise.all([
      supabase.from('trip_calls').select('*').or(`status.eq.open,created_at.gte.${since}`).order('created_at', { ascending: false }).limit(1000),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setCalls((c.data as TripCall[]) ?? []);
    setNames(Object.fromEntries(((p.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name.trim().split(/\s+/)[0]])));
  }, [today]);
  useEffect(() => {
    load();
    const ch = supabase.channel(`trip-calls-${Math.random().toString(36).slice(2)}`).on('postgres_changes', { event: '*', schema: 'public', table: 'trip_calls' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const open = useMemo(() => (calls ?? []).filter((c) => c.status === 'open').sort((x, y) => x.created_at.localeCompare(y.created_at)), [calls]);
  const done = useMemo(() => (calls ?? []).filter((c) => c.status !== 'open'), [calls]);
  const quiet = (() => { const h = kigaliHour(Date.now()); return h >= 21 || h < 7; })();

  return (
    <div className="space-y-4">
      <PageHeader icon={PhoneCall} title="Calls after trips" subtitle="Non-Insider drivers who just completed a trip: ask how the app works for them, and offer branding and our device." />
      <UnderlineTabs value={tab} onChange={setTab} tabs={[
        { key: 'open', label: 'To call', count: open.length, tone: open.length ? 'danger' : undefined },
        { key: 'done', label: 'Called (30 days)', count: done.length },
        { key: 'stats', label: 'Results' },
      ]} />

      {tab === 'open' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-2">
            {quiet && open.length > 0 && <p className="text-caption rounded-md bg-attention/10 text-attention px-3 py-2">It's after 21:00: wait until 07:00 to call drivers.</p>}
            {!calls ? <div className="h-32 skeleton rounded-card" /> : open.length === 0
              ? <EmptyState icon={CheckCircle2} title="Nobody to call right now" body="A call appears here a few minutes after a Non-Insider driver completes a trip and is due one." />
              : open.map((c) => (
                <div key={c.id} className="card p-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <p className="font-semibold">{c.driver_name ?? `Driver #${c.platform_driver_id}`} <span className="font-mono text-caption text-fg-muted ml-1">{c.vehicle_plate ?? ''}</span></p>
                    <p className="text-caption text-fg-muted">
                      Trip {when(c.trip_completed_at)} · {DISPATCH[c.trip_dispatch ?? ''] ?? 'Trip'}{c.trip_fare ? ` · ${rwf(c.trip_fare)}` : ''}
                    </p>
                    {c.context && <p className="text-caption mt-0.5">{c.context}</p>}
                    <p className="mt-1 flex flex-wrap gap-1"><Label tone="info">{REASON[c.reason]}</Label>{c.trips_since > 1 && c.reason !== 'top_driver' && <Label>{c.trips_since} trips since</Label>}{c.attempts > 0 && <Label tone="attention" icon={PhoneMissed}>{c.attempts}× no answer</Label>}</p>
                  </div>
                  {c.driver_phone && <a href={`tel:${c.driver_phone}`} className="btn-secondary"><Phone size={14} /> {c.driver_phone}</a>}
                  {canLog && <button onClick={() => setLogging(c)} className="btn-primary">Record the call</button>}
                </div>
              ))}
          </div>
          <Box title="What to say" icon={MessageSquareQuote}>
            <ol className="list-decimal pl-4 space-y-1.5 text-small">{PITCH.map((p) => <li key={p}>{p}</li>)}</ol>
            <p className="text-caption text-fg-muted mt-3">Who gets a call: to start, the 10 Non-Insiders with the most trips this month (one time). Then: after their first trip; then after the next trip once 7 days have passed, or after 4 trips even the same day. Never while a sign-up is open, and not for 30 days after a "no".</p>
          </Box>
        </div>
      )}

      {tab === 'done' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-small min-w-[900px]">
            <thead><tr className="text-caption text-fg-subtle text-left border-b border-line-muted">{['When', 'Driver', 'Result', 'App rating', 'What they said', 'By'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-muted">
              {done.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{when(c.called_at ?? c.last_attempt_at ?? c.created_at)}</td>
                  <td className="px-3 py-2"><p className="font-medium">{c.driver_name ?? `#${c.platform_driver_id}`}</p><p className="text-caption text-fg-muted font-mono">{c.vehicle_plate ?? ''}</p></td>
                  <td className="px-3 py-2">{c.status === 'missed' ? <Label>Missed: {c.missed_reason}</Label> : c.answer ? <Label tone={ANSWER[c.answer].tone}>{ANSWER[c.answer].label}</Label> : '—'}
                    {c.signup_id && <Link to={`/trips/branding?s=${c.signup_id}`} className="block link text-caption mt-0.5">Sign-up</Link>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.rating ? <span className="text-attention">{'★'.repeat(c.rating)}<span className="text-fg-subtle">{'★'.repeat(5 - c.rating)}</span></span> : '—'}</td>
                  <td className="px-3 py-2 max-w-[360px]">{[c.experience, c.problems && `Problems: ${c.problems}`, c.no_reason && `Why no: ${c.no_reason}`, c.notes].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2 text-fg-muted">{names[c.called_by ?? c.last_attempt_by ?? ''] ?? '—'}</td>
                </tr>
              ))}
              {done.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-fg-muted">No calls recorded in the last 30 days.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stats' && <Results calls={done} names={names} />}

      {logging && <LogCallModal call={logging} onClose={() => setLogging(null)} onSaved={() => { setLogging(null); load(); }} />}
    </div>
  );
}

function Results({ calls, names }: { calls: TripCall[]; names: Record<string, string> }) {
  const reached = calls.filter((c) => c.outcome === 'reached');
  const yes = reached.filter((c) => isYes(c.answer));
  const rated = reached.filter((c) => c.rating);
  const avg = rated.length ? rated.reduce((s, c) => s + (c.rating ?? 0), 0) / rated.length : 0;
  const reasons = new Map<string, number>();
  for (const c of reached) if (c.answer === 'no' && c.no_reason) reasons.set(c.no_reason.trim().toLowerCase(), (reasons.get(c.no_reason.trim().toLowerCase()) ?? 0) + 1);
  const byAgent = new Map<string, { calls: number; reached: number; yes: number }>();
  for (const c of calls) {
    const k = c.called_by ?? c.last_attempt_by; if (!k) continue;
    const r = byAgent.get(k) ?? { calls: 0, reached: 0, yes: 0 };
    r.calls += 1; if (c.outcome === 'reached') r.reached += 1; if (isYes(c.answer)) r.yes += 1;
    byAgent.set(k, r);
  }
  const pct = (x: number, y: number) => (y ? `${Math.round((x / y) * 100)}%` : '—');
  return (
    <div className="space-y-4">
      <StatGrid cols={4}>
        <StatCard icon={PhoneCall} label="Calls due (30 days)" value={calls.length} sub={`${calls.filter((c) => c.status === 'missed').length} missed`} />
        <StatCard icon={Phone} label="Drivers reached" value={reached.length} sub={pct(reached.length, calls.length)} />
        <StatCard icon={ThumbsUp} label="Said yes" value={yes.length} tone={yes.length ? 'success' : undefined} sub={`${pct(yes.length, reached.length)} of drivers reached`} />
        <StatCard icon={Star} label="App rating" value={avg ? `${avg.toFixed(1)} / 5` : '—'} sub={`${rated.length} ratings`} />
      </StatGrid>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Box title="Why drivers said no" icon={Car}>
          {reasons.size ? <ul className="space-y-1 text-small">{[...reasons].sort((x, y) => y[1] - x[1]).map(([r, n]) => <li key={r} className="flex justify-between gap-2"><span>{r}</span><span className="tabular-nums text-fg-muted">{n}</span></li>)}</ul> : <p className="text-small text-fg-muted">No "no" answers yet.</p>}
        </Box>
        <Box title="By agent" icon={PhoneCall}>
          {byAgent.size ? (
            <table className="w-full text-small"><thead><tr className="text-caption text-fg-subtle text-left"><th className="py-1">Agent</th><th>Calls</th><th>Reached</th><th>Yes</th></tr></thead>
              <tbody>{[...byAgent].sort((x, y) => y[1].yes - x[1].yes || y[1].reached - x[1].reached).map(([k, r]) => <tr key={k} className="border-t border-line-muted"><td className="py-1">{names[k] ?? '—'}</td><td>{r.calls}</td><td>{r.reached}</td><td>{r.yes} <span className="text-fg-muted">({pct(r.yes, r.reached)})</span></td></tr>)}</tbody></table>
          ) : <p className="text-small text-fg-muted">No calls yet.</p>}
        </Box>
      </div>
    </div>
  );
}

function LogCallModal({ call, onClose, onSaved }: { call: TripCall; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<'reached' | 'no_answer' | 'wrong_number'>('reached');
  const [rating, setRating] = useState(0);
  const [experience, setExperience] = useState('');
  const [problems, setProblems] = useState('');
  const [answer, setAnswer] = useState<CallAnswer | null>(null);
  const [noReason, setNoReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = outcome !== 'reached' || (rating > 0 && answer && (answer !== 'no' || noReason.trim().length >= 3));
  const save = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('log_trip_call', { p_call: call.id, p_outcome: outcome, p_rating: outcome === 'reached' ? rating : null, p_experience: experience, p_problems: problems, p_answer: outcome === 'reached' ? answer : null, p_no_reason: noReason, p_notes: notes });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };
  const chip = (on: boolean) => `px-2.5 py-1.5 rounded-lg border text-small ${on ? 'border-brand bg-brand/10 text-brand font-medium' : 'border-line text-fg-muted hover:border-brand/40'}`;
  return (
    <Modal open onClose={onClose} title={`Call ${call.driver_name ?? `driver #${call.platform_driver_id}`}`} subtitle={`${call.driver_phone ?? 'no phone'} · ${call.vehicle_plate ?? 'no plate'} · trip ${when(call.trip_completed_at)}${call.context ? ` · ${call.context}` : ''}`} maxWidth="max-w-lg">
      <div className="space-y-4 text-small">
        <div className="flex flex-wrap gap-1.5">
          {([['reached', 'Spoke to them'], ['no_answer', 'No answer'], ['wrong_number', 'Wrong number']] as const).map(([k, l]) => <button key={k} onClick={() => setOutcome(k)} className={chip(outcome === k)}>{l}</button>)}
        </div>
        {outcome === 'reached' ? (
          <>
            <div>
              <p className="text-caption font-semibold text-fg-muted mb-1">How do they rate the app? *</p>
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} aria-label={`${n} stars`} className={`text-2xl leading-none ${n <= rating ? 'text-attention' : 'text-fg-subtle'}`}>★</button>)}</div>
            </div>
            <label className="block"><span className="text-caption font-semibold text-fg-muted">What they said about the app</span>
              <textarea className="input w-full mt-1" rows={2} value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="e.g. Easy to use, gets trips in the morning" /></label>
            <label className="block"><span className="text-caption font-semibold text-fg-muted">Problems they mentioned</span>
              <textarea className="input w-full mt-1" rows={2} value={problems} onChange={(e) => setProblems(e.target.value)} placeholder="e.g. GPS wrong in Kicukiro, payment slow" /></label>
            <div>
              <p className="text-caption font-semibold text-fg-muted mb-1">Branding and our device? *</p>
              <div className="flex flex-wrap gap-1.5">{(Object.keys(ANSWER) as CallAnswer[]).map((k) => <button key={k} onClick={() => setAnswer(k)} className={chip(answer === k)}>{ANSWER[k].label}</button>)}</div>
              {isYes(answer) && <p className="text-caption text-success mt-1.5">Rodrigue gets it right away and will call them to agree the payment and a date.</p>}
            </div>
            {answer === 'no' && <label className="block"><span className="text-caption font-semibold text-fg-muted">Why not? *</span>
              <input className="input w-full mt-1" value={noReason} onChange={(e) => setNoReason(e.target.value)} placeholder="e.g. Too expensive, not their car, will think after December" /></label>}
          </>
        ) : <p className="text-fg-muted">{outcome === 'no_answer' ? (call.attempts >= 2 ? 'This is the 3rd try: the call will be marked missed.' : 'Try again later in your shift. After 3 tries it is marked missed.') : 'The call is closed; the next trip can bring a new one.'}</p>}
        <label className="block"><span className="text-caption font-semibold text-fg-muted">Notes</span>
          <input className="input w-full mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={outcome === 'reached' ? 'e.g. Free on Tuesday morning' : 'Optional'} /></label>
        {err && <p className="text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={!ready || busy} className="btn-primary">{busy && <Loader2 size={14} className="animate-spin" />} Save</button>
        </div>
      </div>
    </Modal>
  );
}
