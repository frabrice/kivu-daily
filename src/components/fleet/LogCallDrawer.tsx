import { useState } from 'react';
import { CarFront, PhoneCall, KeyRound } from 'lucide-react';
import { supabase, Driver } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { CALL_OUTCOMES, CallOutcome, OUTCOME_LABEL } from '../../lib/paymentCalls';
import { kigaliToday } from '../../lib/kigali';
import Modal from '../Modal';

// Log a call with a driver about money (MD, 26 Nov 2026): what they said,
// a promise with its amount and hour, or taking the car back / giving it back.
// Times are Kigali time (UTC+2).

type Mode = 'call' | 'take' | 'return';
const kigaliNow = () => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm" in Kigali
const toIso = (local: string) => new Date(`${local}:00+02:00`).toISOString();
const rwf = (n: number) => `${n.toLocaleString()} RWF`;

export default function LogCallDrawer({ driver, owes, mode: initialMode = 'call', canTake, onClose, onSaved }: {
  driver: Driver; owes: number; mode?: Mode; canTake: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { realProfile } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [outcome, setOutcome] = useState<CallOutcome>('promised');
  const [amount, setAmount] = useState(owes > 0 ? String(owes) : '');
  const today = kigaliToday();
  const [promisedAt, setPromisedAt] = useState(() => (kigaliNow() < `${today}T17:00` ? `${today}T17:00` : kigaliNow()));
  const [happenedAt, setHappenedAt] = useState(kigaliNow());
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const blocker = mode === 'call' && outcome === 'promised'
    ? (!promisedAt ? 'Enter when they will pay.' : Number(amount) < 0 ? 'Enter a valid amount.' : null)
    : null;

  const save = async () => {
    setBusy(true); setErr('');
    const row = {
      driver_id: driver.id,
      created_by: realProfile?.id,
      owed_at_call: owes,
      outcome: mode === 'take' ? 'car_taken' : mode === 'return' ? 'car_returned' : outcome,
      promised_amount: mode === 'call' && outcome === 'promised' && Number(amount) > 0 ? Number(amount) : null,
      promised_at: mode === 'call' && outcome === 'promised' ? toIso(promisedAt) : null,
      car_location: mode !== 'call' ? location.trim() || null : null,
      note: note.trim() || null,
      happened_at: mode === 'call' ? new Date().toISOString() : toIso(happenedAt),
    };
    const { error } = await supabase.from('driver_payment_calls').insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
    onClose();
  };

  const tab = (k: Mode, label: string, Icon: typeof PhoneCall) => (
    <button key={k} type="button" onClick={() => setMode(k)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-small font-medium ${mode === k ? 'bg-surface-2 shadow-sm text-fg' : 'text-fg-muted'}`}>
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title={mode === 'call' ? 'Log a call' : mode === 'take' ? 'Take the car back' : 'Give the car back'} subtitle={`${driver.full_name}${driver.vehicle?.plate_number ? ` · ${driver.vehicle.plate_number}` : ''}${owes > 0 ? ` · owes ${rwf(owes)}` : ''}`} maxWidth="max-w-md">
      <div className="space-y-3 text-small">
        {canTake && initialMode !== 'return' && (
          <div className="flex gap-1 p-0.5 bg-inset rounded-lg">{tab('call', 'Log a call', PhoneCall)}{tab('take', 'Take the car', CarFront)}</div>
        )}

        {mode === 'call' && (<>
          <div>
            <p className="text-caption font-medium text-fg-muted mb-1.5">What happened</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CALL_OUTCOMES.map((o) => (
                <button key={o} type="button" onClick={() => setOutcome(o)}
                  className={`px-2.5 py-2 rounded-lg border text-left ${outcome === o ? 'border-brand bg-brand/10 font-medium' : 'border-line hover:bg-hover'}`}>{OUTCOME_LABEL[o]}</button>
              ))}
            </div>
          </div>
          {outcome === 'promised' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-caption font-medium text-fg-muted">Amount promised (RWF)</span>
                <input className="input w-full mt-1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} /></label>
              <label className="block"><span className="text-caption font-medium text-fg-muted">Will pay by (date & hour)</span>
                <input type="datetime-local" className="input w-full mt-1" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} /></label>
              <p className="col-span-2 text-micro text-fg-subtle">You'll get an email 30 minutes before, and another if the time passes without the money.</p>
            </div>
          )}
          {outcome === 'paid' && <p className="text-micro text-fg-subtle">Remember to log the payment itself with "Log Deposit", so it counts.</p>}
        </>)}

        {mode !== 'call' && (<>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-caption font-medium text-fg-muted">{mode === 'take' ? 'Taken on' : 'Given back on'}</span>
              <input type="datetime-local" className="input w-full mt-1" value={happenedAt} onChange={(e) => setHappenedAt(e.target.value)} /></label>
            <label className="block"><span className="text-caption font-medium text-fg-muted">{mode === 'take' ? 'Where the car is now' : 'Where it was'}</span>
              <input className="input w-full mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={mode === 'take' ? 'e.g. parked at the office' : 'optional'} /></label>
          </div>
          <p className="text-micro text-fg-subtle flex items-start gap-1"><KeyRound size={11} className="mt-0.5 shrink-0" />
            {mode === 'take'
              ? 'The driver stays on the car and their contract doesn\'t change; the car shows as taken back until you give it back. You and Fleet are emailed.'
              : 'The car is back with the driver.'}
          </p>
        </>)}

        <label className="block"><span className="text-caption font-medium text-fg-muted">Note</span>
          <textarea className="input w-full mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'call' ? 'What they said, e.g. "at the garage, will send by MoMo"' : 'optional'} /></label>

        {err && <p className="text-danger">{err}</p>}
        {blocker && <p className="text-caption text-attention">{blocker}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className={mode === 'take' ? 'btn-primary bg-danger' : 'btn-primary'} disabled={busy || !!blocker} onClick={save}>
            {busy ? 'Saving…' : mode === 'call' ? 'Save the call' : mode === 'take' ? 'Car taken back' : 'Car given back'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
