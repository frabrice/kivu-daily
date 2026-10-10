import { useState } from 'react';
import { PauseCircle, Upload } from 'lucide-react';
import { supabase, Driver, PauseReason } from '../../lib/supabase';
import { PAUSE_REASONS } from '../../lib/fleet';
import Modal from '../Modal';

const kigaliToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const minusDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - n); return x.toLocaleDateString('en-CA'); };

// Pause a driver's days (sick, car in the garage...). Those days count like
// the rest day: nothing owed, not chased. Takes effect at once; the MD or
// Finance approves or rejects it afterwards.
export default function PauseDrawer({ driver, drivers, onClose, onSaved }: { driver: Driver; drivers: Driver[]; onClose: () => void; onSaved: () => void }) {
  const today = kigaliToday();
  const [reason, setReason] = useState<PauseReason | null>(null);
  const [start, setStart] = useState(today);
  const [openEnded, setOpenEnded] = useState(true);
  const [end, setEnd] = useState(today);
  const [note, setNote] = useState('');
  const [wholeCar, setWholeCar] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const carMates = driver.vehicle_id ? drivers.filter((d) => d.id !== driver.id && d.vehicle_id === driver.vehicle_id && d.contract_status === 'active') : [];
  const garage = reason === 'garage' && !!driver.vehicle_id;

  const save = async () => {
    if (!reason) { setError('Choose why the driver is off.'); return; }
    if (reason === 'other' && !note.trim()) { setError('Explain the reason in the note.'); return; }
    if (!openEnded && end < start) { setError("The last day off can't be before the first."); return; }
    setBusy(true);
    setError('');
    let proofPath: string | null = null;
    if (file) {
      const path = `${driver.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('driver-pause-proofs').upload(path, file);
      if (upErr) { setBusy(false); setError(`Upload failed: ${upErr.message}`); return; }
      proofPath = path;
    }
    const { error: err } = await supabase.rpc('record_driver_pause', {
      p: { driver_id: driver.id, reason, note, start_date: start, end_date: openEnded ? null : end, whole_car: garage && wholeCar, proof_path: proofPath },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const label = 'block text-[11px] font-medium mb-1 text-gray-500';
  return (
    <Modal open onClose={onClose} title={`Pause ${driver.full_name.trim()}`} subtitle="Days off don't cost anything and the driver isn't chased while paused. The MD or Finance approves it afterwards." maxWidth="max-w-md">
      <div className="space-y-4">
        <div>
          <span className={label}>Why is the driver off? *</span>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Reason">
            {PAUSE_REASONS.map((r) => (
              <button key={r.key} type="button" role="radio" aria-checked={reason === r.key} onClick={() => setReason(r.key)}
                className={`px-2.5 py-2 rounded-lg border text-[12px] text-left ${reason === r.key ? 'border-brand bg-brand/10 text-brand-800 dark:text-brand-200 font-medium' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-brand/40'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {garage && (
          <label className="flex items-start gap-2 text-[12px] rounded-lg bg-gray-50 dark:bg-white/[0.03] p-2.5">
            <input type="checkbox" checked={wholeCar} onChange={(e) => setWholeCar(e.target.checked)} className="mt-0.5" />
            <span>Pause every driver on {driver.vehicle?.plate_number ?? 'this car'}{carMates.length ? ` (also ${carMates.map((d) => d.full_name.trim()).join(', ')})` : ''}</span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={label}>First day off *</span>
            <input type="date" value={start} min={minusDays(today, 14)} onChange={(e) => setStart(e.target.value)} className="input" />
          </label>
          <div>
            <span className={label}>Until</span>
            <div className="flex gap-1 mb-1.5">
              <button type="button" onClick={() => setOpenEnded(true)} aria-pressed={openEnded} className={`px-2 py-1 rounded-md text-[11px] border ${openEnded ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>They're back</button>
              <button type="button" onClick={() => setOpenEnded(false)} aria-pressed={!openEnded} className={`px-2 py-1 rounded-md text-[11px] border ${!openEnded ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>A date</button>
            </div>
            {!openEnded && <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="input" aria-label="Last day off" />}
          </div>
        </div>
        <p className="text-[11px] text-gray-500 -mt-2">{openEnded ? 'Days stop counting until someone presses Resume.' : 'Last day off, included. They count again from the next working day.'} Up to 14 days back.</p>

        <label className="block"><span className={label}>Note{reason === 'other' ? ' *' : ''}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input resize-none" placeholder="What happened — e.g. malaria, at the clinic; brakes, garage in Gikondo, back Friday" />
        </label>

        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
          <Upload size={14} className="text-gray-400" />
          <span className="text-gray-600 dark:text-gray-300">{file ? file.name : 'Proof (optional) — medical note, garage paper…'}</span>
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>

        {error && <p className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary flex items-center gap-1.5 disabled:opacity-50"><PauseCircle size={14} /> {busy ? 'Saving…' : 'Pause days'}</button>
        </div>
      </div>
    </Modal>
  );
}
