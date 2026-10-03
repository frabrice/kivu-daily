import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Phone, Send, User, AlertTriangle, Car } from 'lucide-react';
import { supabase, CallTicketCallerType, CallTicketCategory, CallTicketPriority } from '../../lib/supabase';
import { CALLER_TYPES, CATEGORIES, personWithRole, phoneKey, TicketPerson } from '../../lib/callTickets';
import Modal from '../Modal';
import AssigneePicker from './AssigneePicker';

interface DriverLite { id: string; full_name: string; phone: string | null; vehicle: { plate_number: string } | null }

// Logging an inbound call. The agent either solves it on the call (it's
// recorded and closed straight away) or hands it to the person in charge.
export default function NewCallDrawer({
  people,
  onClose,
  onSaved,
}: {
  people: TicketPerson[];
  onClose: () => void;
  onSaved: (reference: string, assigneeName: string | null) => void;
}) {
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerEmail, setCallerEmail] = useState('');
  const [callerType, setCallerType] = useState<CallTicketCallerType>('passenger');
  const [category, setCategory] = useState<CallTicketCategory>('app');
  const [priority, setPriority] = useState<CallTicketPriority>('normal');
  const [details, setDetails] = useState('');
  const [outcome, setOutcome] = useState<'resolved' | 'assign'>('assign');
  const [resolution, setResolution] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [drivers, setDrivers] = useState<DriverLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('drivers').select('id, full_name, phone, vehicle:vehicles(plate_number)').then(({ data }) => setDrivers((data as unknown as DriverLite[]) ?? []));
  }, []);

  // Recognise one of our drivers by phone number.
  const matchedDriver = useMemo(() => {
    const key = phoneKey(callerPhone);
    return key.length === 9 ? drivers.find((d) => phoneKey(d.phone) === key) ?? null : null;
  }, [callerPhone, drivers]);

  useEffect(() => {
    if (matchedDriver) {
      setCallerType('driver');
      if (!callerName.trim()) setCallerName(matchedDriver.full_name);
    }
    // Only react to a new match, not to the agent editing the name afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedDriver?.id]);

  const assignee = people.find((p) => p.id === assigneeId);
  const serious = priority === 'urgent' || category === 'complaint' || category === 'driver_behaviour';
  const canSave = callerName.trim() && callerPhone.trim() && details.trim()
    && (outcome === 'resolved' ? resolution.trim() : assigneeId);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const { data, error: err } = await supabase.rpc('create_call_ticket', {
      p_caller_name: callerName,
      p_caller_phone: callerPhone,
      p_caller_email: callerEmail,
      p_caller_type: callerType,
      p_driver_id: matchedDriver?.id ?? null,
      p_category: category,
      p_priority: priority,
      p_details: details,
      p_resolved_on_call: outcome === 'resolved',
      p_resolution_note: outcome === 'resolved' ? resolution : null,
      p_assignee_id: outcome === 'assign' ? assigneeId : null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved((data as { reference: string }).reference, outcome === 'assign' && assignee ? personWithRole(assignee) : null);
  };

  const label = 'block text-[11px] font-medium mb-1.5 text-gray-500';

  return (
    <Modal open onClose={onClose} title="New call" subtitle="Write down who called and what they need" maxWidth="max-w-lg">
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><User size={12} /> Caller</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="caller-phone">Phone number</label>
              <input id="caller-phone" value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} className="input" placeholder="078 000 0000" inputMode="tel" autoFocus />
            </div>
            <div>
              <label className={label} htmlFor="caller-name">Name</label>
              <input id="caller-name" value={callerName} onChange={(e) => setCallerName(e.target.value)} className="input" placeholder="Full name" />
            </div>
          </div>
          {matchedDriver && (
            <div className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-lg bg-brand/5 border border-brand/20 text-brand-700 dark:text-brand-300">
              <Car size={13} /> This is our driver <b>{matchedDriver.full_name}</b>{matchedDriver.vehicle ? ` · ${matchedDriver.vehicle.plate_number}` : ''} — the ticket will be linked to them.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="caller-type">Who is calling</label>
              <select id="caller-type" value={callerType} onChange={(e) => setCallerType(e.target.value as CallTicketCallerType)} className="input">
                {CALLER_TYPES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="caller-email">Email {serious ? <span className="text-amber-600">— ask for it, this is serious</span> : <span className="text-gray-400 font-normal">(optional)</span>}</label>
              <input id="caller-email" type="email" value={callerEmail} onChange={(e) => setCallerEmail(e.target.value)} className="input" placeholder="name@example.com" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Phone size={12} /> The issue</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="category">Category</label>
              <select id="category" value={category} onChange={(e) => setCategory(e.target.value as CallTicketCategory)} className="input">
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Priority</span>
              <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-white/5" role="radiogroup" aria-label="Priority">
                {(['normal', 'urgent'] as const).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => setPriority(p)}
                    className={`py-1.5 rounded-md text-[12px] font-medium transition-all ${priority === p ? (p === 'urgent' ? 'bg-red-500 text-white shadow-sm' : 'bg-white dark:bg-navy-800 shadow-sm') : 'text-gray-500'}`}>
                    {p === 'urgent' ? 'Urgent' : 'Normal'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="details">What happened — in the caller's words</label>
            <textarea id="details" value={details} onChange={(e) => setDetails(e.target.value)} className="input resize-none" rows={4}
              placeholder="When, where, trip or car details, what they want us to do…" />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Outcome</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Outcome">
            {([
              { key: 'resolved', icon: CheckCircle2, title: 'I resolved it on the call', sub: 'Record it and close it now' },
              { key: 'assign', icon: Send, title: 'Needs someone else', sub: 'Assign it to the person in charge' },
            ] as const).map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={outcome === o.key} onClick={() => setOutcome(o.key)}
                className={`text-left p-3 rounded-xl border transition-all ${outcome === o.key ? 'border-brand bg-brand/5 ring-1 ring-brand/30' : 'border-gray-200 dark:border-white/10 hover:border-brand/40'}`}>
                <o.icon size={16} className={outcome === o.key ? 'text-brand-600 dark:text-brand-300' : 'text-gray-400'} />
                <p className="text-[12px] font-semibold mt-1.5">{o.title}</p>
                <p className="text-[11px] text-gray-400">{o.sub}</p>
              </button>
            ))}
          </div>

          {outcome === 'resolved' ? (
            <div>
              <label className={label} htmlFor="resolution">How you resolved it</label>
              <textarea id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className="input resize-none" rows={3} placeholder="What you told or did for the caller" />
            </div>
          ) : (
            <div>
              <span className={label}>Assign to</span>
              <AssigneePicker people={people} value={assigneeId} onChange={setAssigneeId} />
              {priority === 'urgent' && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-2 flex items-center gap-1"><AlertTriangle size={12} /> Urgent: they'll get an email marked URGENT, and it's overdue after 24 hours.</p>
              )}
            </div>
          )}
        </section>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={!canSave || saving} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
            {outcome === 'resolved' ? <CheckCircle2 size={14} /> : <Send size={14} />}
            {saving ? 'Saving…' : outcome === 'resolved' ? 'Save & close' : assignee ? `Send to ${assignee.full_name.trim()}` : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
