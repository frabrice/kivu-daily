import { useState } from 'react';
import { Check, FileText, PlayCircle, X } from 'lucide-react';
import { supabase, Driver, DriverPause } from '../../lib/supabase';
import { PAUSE_REASON_LABEL } from '../../lib/fleet';

const kigaliToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };

export function pauseSpan(p: DriverPause) {
  return `${dayLabel(p.start_date)} → ${p.end_date ? dayLabel(p.end_date) : 'until back'}`;
}
export function isPausedOn(p: DriverPause, d: string) {
  return p.approval_status !== 'rejected' && p.start_date <= d && (!p.end_date || d <= p.end_date);
}

const STATUS: Record<DriverPause['approval_status'], { label: string; cls: string }> = {
  pending: { label: 'Waiting for MD / Finance', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200' },
  rejected: { label: 'Rejected — days count', cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' },
};

// One row per pause (a car-in-the-garage pause covers both drivers - each
// shows here, and actions apply to the whole group).
export default function PauseList({ pauses, drivers, names, canRecord, canReview, showDriver, onChanged }: {
  pauses: DriverPause[]; drivers: Driver[]; names: Record<string, string>; canRecord: boolean; canReview: boolean; showDriver: boolean; onChanged: () => void;
}) {
  if (!pauses.length) return <p className="text-[12px] text-gray-400 py-3">No days off recorded.</p>;
  return (
    <div className="space-y-2">
      {[...pauses].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((p) => (
        <PauseRow key={p.id} p={p} driver={drivers.find((d) => d.id === p.driver_id)} names={names} canRecord={canRecord} canReview={canReview} showDriver={showDriver} onChanged={onChanged} />
      ))}
    </div>
  );
}

function PauseRow({ p, driver, names, canRecord, canReview, showDriver, onChanged }: {
  p: DriverPause; driver?: Driver; names: Record<string, string>; canRecord: boolean; canReview: boolean; showDriver: boolean; onChanged: () => void;
}) {
  const today = kigaliToday();
  const [mode, setMode] = useState<'' | 'resume' | 'reject'>('');
  const [back, setBack] = useState(today > p.start_date ? today : addDays(p.start_date, 1));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = isPausedOn(p, today);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true); setError('');
    const { error: err } = await fn();
    setBusy(false);
    if (err) { setError(err.message); return; }
    setMode(''); onChanged();
  };
  const openProof = async () => {
    const { data } = await supabase.storage.from('driver-pause-proofs').createSignedUrl(p.proof_path!, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  };
  const addProof = async (file: File) => {
    const path = `${p.driver_id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
    const { error: upErr } = await supabase.storage.from('driver-pause-proofs').upload(path, file);
    if (upErr) { setError(upErr.message); return; }
    await run(() => supabase.rpc('set_driver_pause_proof', { p_pause_id: p.id, p_path: path }));
  };

  return (
    <div className={`rounded-lg border p-3 ${active ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50/40 dark:bg-amber-500/5' : 'border-gray-100 dark:border-white/10'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold">
            {showDriver && <span>{driver?.full_name ?? 'Driver'} · </span>}{PAUSE_REASON_LABEL[p.reason]}
            {active && <span className="ml-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">paused now</span>}
          </p>
          <p className="text-[11px] text-gray-600 dark:text-gray-300">{pauseSpan(p)}{driver?.vehicle?.plate_number ? ` · ${driver.vehicle.plate_number}` : ''}</p>
          {p.note && <p className="text-[11px] text-gray-500 mt-0.5">“{p.note}”</p>}
          <p className="text-[10px] text-gray-400 mt-0.5">
            Recorded by {p.recorded_by ? names[p.recorded_by] ?? '—' : '—'}
            {p.reviewed_by && ` · ${p.approval_status} by ${names[p.reviewed_by] ?? '—'}`}{p.review_note && ` — ${p.review_note}`}
            {p.resumed_by && ` · resumed by ${names[p.resumed_by] ?? '—'}`}
          </p>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS[p.approval_status].cls}`}>{STATUS[p.approval_status].label}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {p.proof_path
          ? <button onClick={openProof} className="btn-ghost text-[11px] flex items-center gap-1"><FileText size={12} /> Proof</button>
          : (canRecord || canReview) && (
            <label className="btn-ghost text-[11px] flex items-center gap-1 cursor-pointer"><FileText size={12} /> Add proof
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && addProof(e.target.files[0])} />
            </label>
          )}
        {!p.end_date && p.approval_status !== 'rejected' && (canRecord || canReview) && (
          <button onClick={() => setMode(mode === 'resume' ? '' : 'resume')} className="btn-ghost text-[11px] flex items-center gap-1 text-brand-700 dark:text-brand-300"><PlayCircle size={12} /> Resume</button>
        )}
        {p.approval_status === 'pending' && canReview && (
          <>
            <button onClick={() => run(() => supabase.rpc('review_driver_pause', { p_pause_id: p.id, p_decision: 'approved' }))} disabled={busy} className="btn-ghost text-[11px] flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Check size={12} /> Approve</button>
            <button onClick={() => setMode(mode === 'reject' ? '' : 'reject')} className="btn-ghost text-[11px] flex items-center gap-1 text-red-600"><X size={12} /> Reject</button>
          </>
        )}
      </div>

      {mode === 'resume' && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block"><span className="block text-[10px] text-gray-500 mb-0.5">Back to work on</span>
            <input type="date" value={back} min={addDays(p.start_date, 1)} onChange={(e) => setBack(e.target.value)} className="input py-1 text-[12px] w-auto" />
          </label>
          <button onClick={() => run(() => supabase.rpc('resume_driver_pause', { p_pause_id: p.id, p_last_day_off: addDays(back, -1) }))} disabled={busy} className="btn-primary text-[11px]">{busy ? 'Saving…' : 'Resume counting'}</button>
          <p className="text-[10px] text-gray-500 w-full">Days count again from {dayLabel(back)}. Last day off: {dayLabel(addDays(back, -1))}.</p>
        </div>
      )}
      {mode === 'reject' && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input py-1 text-[12px] flex-1 min-w-[180px]" placeholder="Why it's rejected (the days will count again)" aria-label="Reason for rejecting" />
          <button onClick={() => run(() => supabase.rpc('review_driver_pause', { p_pause_id: p.id, p_decision: 'rejected', p_note: note }))} disabled={busy || !note.trim()} className="btn-primary text-[11px] disabled:opacity-50">Reject</button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}
