import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Phone, Search, Send, ShieldCheck, User, X, Ban, CarTaxiFront } from 'lucide-react';
import {
  supabase, CallTicket, CallTicketCallerType, CallTicketCategory, CallTicketChannel, CallTicketOutcome, CallTicketPriority, ScriptCard,
} from '../../lib/supabase';
import {
  CALLER_TYPES, CATEGORY_LABEL, CHANNELS, STATUS_META, isUnresolved, personWithRole, phoneKey, TicketPerson, useDuties, useScriptCards, dateTimeLabel,
} from '../../lib/callTickets';
import Modal from '../Modal';
import AssigneePicker from './AssigneePicker';
import DriverLinkPicker, { DriverLink } from './DriverLinkPicker';
import ScriptCardView from './ScriptCardView';

type Outcome = 'assign' | 'resolved' | 'booking' | 'abusive';

const PROMISE_OPTIONS = [
  { hours: 1, label: 'within 1 hour' },
  { hours: 2, label: 'within 2 hours (standard)' },
  { hours: 4, label: 'within 4 hours' },
  { hours: 24, label: 'by tomorrow' },
];

const SERVICES = ['112 Police', '113 Traffic', '912 Ambulance', '111 Fire'];

// Logging a call the Script Book way: greet & identify (phone first, with
// the caller's history), classify (pick the situation - its script shows
// beside the form and the owner is pre-selected), verify, act (solve it or
// assign it), confirm the promised update time, record.
export default function NewCallDrawer({
  people,
  tickets,
  onClose,
  onSaved,
  initialOutcome,
}: {
  people: TicketPerson[];
  tickets: CallTicket[];
  onClose: () => void;
  onSaved: (reference: string, assigneeName: string | null, emergency: boolean) => void;
  initialOutcome?: Outcome;
}) {
  const { cards } = useScriptCards();
  const duties = useDuties();
  const [channel, setChannel] = useState<CallTicketChannel>('call');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callerEmail, setCallerEmail] = useState('');
  const [callerType, setCallerType] = useState<CallTicketCallerType>('passenger');
  const [card, setCard] = useState<ScriptCard | null>(null);
  const [situationQuery, setSituationQuery] = useState('');
  const [category, setCategory] = useState<CallTicketCategory>(initialOutcome === 'booking' ? 'booking' : 'general');
  const [priority, setPriority] = useState<CallTicketPriority>('normal');
  const [details, setDetails] = useState('');
  const [tripReference, setTripReference] = useState('');
  const [driverLink, setDriverLink] = useState<DriverLink | null>(null);
  const [actionsTaken, setActionsTaken] = useState('');
  const [verified, setVerified] = useState(false);
  const [location, setLocation] = useState('');
  const [injuries, setInjuries] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome ?? 'assign');
  const [resolution, setResolution] = useState('');
  const [bookingOutcome, setBookingOutcome] = useState<CallTicketOutcome>('booking_dispatched');
  const [assigneeId, setAssigneeId] = useState('');
  const [promiseHours, setPromiseHours] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const emergency = priority === 'emergency';
  const quickLog = outcome === 'booking' || outcome === 'abusive';

  // Caller history by phone number - avoid duplicates, update the caller.
  const history = useMemo(() => {
    const key = phoneKey(callerPhone);
    return key.length === 9 ? tickets.filter((t) => phoneKey(t.caller_phone) === key) : [];
  }, [callerPhone, tickets]);
  const openHistory = history.filter(isUnresolved);
  useEffect(() => {
    if (history[0] && !callerName.trim()) setCallerName(history[0].caller_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history[0]?.id]);

  const situations = useMemo(() => {
    const needle = situationQuery.trim().toLowerCase();
    const pool = cards.filter((c) => !c.is_quick);
    if (!needle) return [];
    return pool.filter((c) => [c.situation, c.section_title, c.say ?? '', ...c.steps].some((t) => t.toLowerCase().includes(needle))).slice(0, 8);
  }, [cards, situationQuery]);
  const sectionsList = useMemo(() => {
    const m = new Map<string, { key: string; title: string; order: number }>();
    for (const c of cards) if (!c.is_quick) m.set(c.section_key, { key: c.section_key, title: c.section_title, order: c.section_order });
    return [...m.values()].sort((a, b) => a.order - b.order);
  }, [cards]);
  const [browseSection, setBrowseSection] = useState<string | null>(null);

  const pickCard = (c: ScriptCard) => {
    setCard(c);
    setSituationQuery('');
    setBrowseSection(null);
    setCategory(c.section_key as CallTicketCategory);
    setPriority(c.default_priority);
    const owner = c.owner_duty ? duties[c.owner_duty]?.profile_id : null;
    if (owner) setAssigneeId(owner);
    if (c.default_priority === 'emergency') setOutcome('assign');
    else if (c.section_key === 'booking') setOutcome('booking');
    else setOutcome(c.owner_duty ? 'assign' : 'resolved');
    if (c.section_key === 'driver_support' || c.section_key === 'fleet_partner') setCallerType(c.section_key === 'driver_support' ? 'driver' : 'car_owner');
  };

  // Emergencies always get followed up: default to the MD duty if nobody picked.
  useEffect(() => {
    if (emergency) {
      setOutcome('assign');
      if (!assigneeId && duties.route_md?.profile_id) setAssigneeId(duties.route_md.profile_id);
    }
  }, [emergency, duties]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignee = people.find((p) => p.id === assigneeId);
  const serious = priority !== 'normal' || category === 'complaint' || category === 'emergency';
  const showVerify = callerType === 'driver' || category === 'driver_support';
  const promisedAt = new Date(Date.now() + promiseHours * 3600000);

  const canSave = callerPhone.trim()
    && (quickLog || (callerName.trim() && details.trim()))
    && (outcome === 'resolved' ? !!resolution.trim() : outcome === 'assign' ? !!assigneeId : true)
    && (!emergency || !!location.trim());

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const p = {
      channel, caller_phone: callerPhone, caller_name: callerName, caller_email: callerEmail, caller_type: callerType,
      script_card_id: card?.id ?? null, situation: card?.situation ?? null, category, priority,
      details: details.trim() || null, trip_reference: tripReference,
      driver_id: driverLink?.kind === 'internal' ? driverLink.id : null,
      platform_driver_id: driverLink?.kind === 'platform' ? driverLink.id : null,
      vehicle_plate: driverLink?.plate ?? null,
      actions_taken: actionsTaken, driver_verified: showVerify ? verified : null,
      emergency_details: emergency ? { location, injuries, services_called: services } : null,
      resolved_on_call: outcome === 'resolved',
      resolution_note: outcome === 'resolved' ? resolution : null,
      outcome_kind: outcome === 'booking' ? bookingOutcome : outcome === 'abusive' ? 'abusive_ended' : null,
      assignee_id: outcome === 'assign' ? assigneeId : null,
      promised_update_at: outcome === 'assign' ? promisedAt.toISOString() : null,
    };
    const { data, error: err } = await supabase.rpc('create_call_ticket', { p });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved((data as { reference: string }).reference, outcome === 'assign' && assignee ? personWithRole(assignee) : null, emergency);
  };

  const label = 'block text-[11px] font-medium mb-1.5 text-gray-500';
  const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5';

  return (
    <Modal open onClose={onClose} title={emergency ? 'EMERGENCY call' : 'New call'} subtitle="Greet · classify · verify · act · confirm · record" maxWidth="max-w-2xl">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-5">
          {emergency && (
            <div className="rounded-lg bg-red-600 text-white px-3 py-2 text-[12px] font-semibold flex items-center gap-2" role="alert">
              <AlertTriangle size={15} /> Emergency: public help first (112 / 113 / 912 / 111). The MD and Fleet Manager are alerted the moment you save.
            </div>
          )}

          {/* 1. Greet & identify */}
          <section className="space-y-3">
            <h3 className={sectionTitle}><User size={12} /> Caller</h3>
            <div className="flex gap-1 flex-wrap" role="radiogroup" aria-label="Channel">
              {CHANNELS.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={channel === c.key} onClick={() => setChannel(c.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${channel === c.key ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>{c.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="caller-phone">Phone number</label>
                <input id="caller-phone" value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} className="input" placeholder="078 000 0000" inputMode="tel" autoFocus />
              </div>
              <div>
                <label className={label} htmlFor="caller-name">Name{quickLog && <span className="text-gray-400 font-normal"> (optional)</span>}</label>
                <input id="caller-name" value={callerName} onChange={(e) => setCallerName(e.target.value)} className="input" placeholder="Full name" />
              </div>
            </div>
            {history.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-2.5 text-[11px] space-y-1">
                <p className="font-semibold flex items-center gap-1 text-amber-800 dark:text-amber-300"><History size={12} /> Contacted us {history.length}× before{openHistory.length ? ` — ${openHistory.length} still open` : ''}</p>
                {history.slice(0, 3).map((t) => (
                  <p key={t.id} className="text-gray-600 dark:text-gray-300">
                    <span className="font-mono">{t.reference}</span> · {t.situation ?? CATEGORY_LABEL[t.category]} · {STATUS_META[t.status].label} · {dateTimeLabel(t.created_at)}
                  </p>
                ))}
                {openHistory.length > 0 && <p className="text-amber-800 dark:text-amber-300">If they're calling about the same issue, update that case instead of logging a new one.</p>}
              </div>
            )}
            {!quickLog && (
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
            )}
          </section>

          {/* 2. Classify */}
          <section className="space-y-2">
            <h3 className={sectionTitle}><Search size={12} /> What's it about?</h3>
            {card ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-brand/30 bg-brand/5">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-400">{card.section_title}</p>
                  <p className="text-[12px] font-semibold">{card.situation}</p>
                </div>
                <button type="button" onClick={() => setCard(null)} className="btn-ghost p-1" aria-label="Change situation"><X size={13} /></button>
              </div>
            ) : (
              <>
                <input value={situationQuery} onChange={(e) => setSituationQuery(e.target.value)} className="input" placeholder='Type a word — "late", "refund", "breakdown", "login"…' aria-label="Find the situation" />
                {situations.length > 0 && (
                  <div className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-50 dark:divide-white/5 max-h-56 overflow-y-auto">
                    {situations.map((c) => (
                      <button key={c.id} type="button" onClick={() => pickCard(c)} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                        <span className="text-[12px] font-medium">{c.situation}</span>
                        <span className="text-[10px] text-gray-400 ml-1.5">{c.section_title}</span>
                        {c.default_priority === 'emergency' && <span className="text-[9px] font-bold text-white bg-red-600 px-1 rounded ml-1.5">EMERGENCY</span>}
                      </button>
                    ))}
                  </div>
                )}
                {!situationQuery && (
                  <div className="flex gap-1 flex-wrap">
                    {sectionsList.map((s) => (
                      <button key={s.key} type="button" onClick={() => setBrowseSection(browseSection === s.key ? null : s.key)}
                        className={`px-2 py-0.5 rounded-full text-[11px] border ${browseSection === s.key ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : s.key === 'emergency' ? 'border-red-300 text-red-600' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>{s.title}</button>
                    ))}
                  </div>
                )}
                {browseSection && !situationQuery && (
                  <div className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-50 dark:divide-white/5 max-h-56 overflow-y-auto">
                    {cards.filter((c) => !c.is_quick && c.section_key === browseSection).map((c) => (
                      <button key={c.id} type="button" onClick={() => pickCard(c)} className="w-full text-left px-3 py-2 text-[12px] hover:bg-gray-50 dark:hover:bg-white/[0.03]">{c.situation}</button>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">Priority</span>
              <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-white/5 flex-1 max-w-xs" role="radiogroup" aria-label="Priority">
                {(['normal', 'urgent', 'emergency'] as const).map((pr) => (
                  <button key={pr} type="button" role="radio" aria-checked={priority === pr} onClick={() => setPriority(pr)}
                    className={`py-1 rounded-md text-[11px] font-medium ${priority === pr ? (pr === 'emergency' ? 'bg-red-700 text-white' : pr === 'urgent' ? 'bg-red-500 text-white' : 'bg-white dark:bg-navy-800 shadow-sm') : 'text-gray-500'}`}>
                    {pr === 'normal' ? 'Normal' : pr === 'urgent' ? 'Urgent' : 'Emergency'}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 3. Details & verify */}
          {!quickLog && (
            <section className="space-y-3">
              <h3 className={sectionTitle}><Phone size={12} /> Details</h3>
              {emergency && (
                <div className="space-y-2 rounded-lg border border-red-200 dark:border-red-500/30 p-3">
                  <div><label className={label} htmlFor="em-location">Exact location and nearest landmark *</label><input id="em-location" value={location} onChange={(e) => setLocation(e.target.value)} className="input" /></div>
                  <div><label className={label} htmlFor="em-injuries">Injuries or danger reported</label><input id="em-injuries" value={injuries} onChange={(e) => setInjuries(e.target.value)} className="input" placeholder="e.g. driver hurt, passenger safe" /></div>
                  <div>
                    <span className={label}>Emergency service called</span>
                    <div className="flex flex-wrap gap-1">
                      {SERVICES.map((s) => (
                        <button key={s} type="button" aria-pressed={services.includes(s)} onClick={() => setServices((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                          className={`px-2 py-1 rounded-md text-[11px] border ${services.includes(s) ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>{s}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className={label} htmlFor="details">What the caller says happened — no assumptions</label>
                <textarea id="details" value={details} onChange={(e) => setDetails(e.target.value)} className="input resize-none" rows={4} placeholder="When, where, trip or car details, what they want us to do…" />
              </div>
              <div>
                <span className={label}>Driver or car involved</span>
                <DriverLinkPicker value={driverLink} onChange={setDriverLink} autoMatchPhone={callerPhone} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={label} htmlFor="trip-ref">Trip reference <span className="text-gray-400 font-normal">(if any)</span></label><input id="trip-ref" value={tripReference} onChange={(e) => setTripReference(e.target.value)} className="input" /></div>
                <div><label className={label} htmlFor="actions">What you already did</label><input id="actions" value={actionsTaken} onChange={(e) => setActionsTaken(e.target.value)} className="input" placeholder="e.g. called the driver, no answer" /></div>
              </div>
              {showVerify && (
                <label className={`flex items-start gap-2 text-[12px] p-2.5 rounded-lg border ${verified ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-500/5' : 'border-gray-200 dark:border-white/10'}`}>
                  <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-0.5" />
                  <span><ShieldCheck size={12} className="inline mr-1" /><b>Driver verified</b> — registered full name, phone number and plate all match. If they don't, don't discuss the account: log it as a verification case.</span>
                </label>
              )}
            </section>
          )}

          {/* 4. Act */}
          <section className="space-y-3">
            <h3 className={sectionTitle}>Outcome</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5" role="radiogroup" aria-label="Outcome">
              {([
                { key: 'assign', icon: Send, title: 'Needs someone else' },
                { key: 'resolved', icon: CheckCircle2, title: 'Solved on the call' },
                { key: 'booking', icon: CarTaxiFront, title: 'Booking' },
                { key: 'abusive', icon: Ban, title: 'Abusive — ended' },
              ] as const).map((o) => {
                const disabled = emergency && o.key !== 'assign';
                return (
                  <button key={o.key} type="button" role="radio" aria-checked={outcome === o.key} disabled={disabled} onClick={() => setOutcome(o.key)}
                    className={`text-left p-2.5 rounded-xl border transition-all disabled:opacity-40 ${outcome === o.key ? 'border-brand bg-brand/5 ring-1 ring-brand/30' : 'border-gray-200 dark:border-white/10 hover:border-brand/40'}`}>
                    <o.icon size={14} className={outcome === o.key ? 'text-brand-600 dark:text-brand-300' : 'text-gray-400'} />
                    <p className="text-[11px] font-semibold mt-1">{o.title}</p>
                  </button>
                );
              })}
            </div>

            {outcome === 'resolved' && (
              <div><label className={label} htmlFor="resolution">How you resolved it</label><textarea id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className="input resize-none" rows={2} placeholder="What you told or did for the caller" /></div>
            )}
            {outcome === 'booking' && (
              <div className="flex flex-wrap gap-1.5">
                {([['booking_dispatched', 'Dispatched & driver confirmed'], ['booking_declined_wait', 'Passenger declined the wait'], ['booking_no_driver', 'No driver available']] as const).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={bookingOutcome === k} onClick={() => setBookingOutcome(k)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border ${bookingOutcome === k ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>{l}</button>
                ))}
                <p className="text-[11px] text-gray-400 w-full">Dispatch itself happens in the operations platform — this just records the call.</p>
              </div>
            )}
            {outcome === 'abusive' && <p className="text-[11px] text-gray-500">Only after one calm warning (see “Upset or abusive caller” in the Script Book). Unless there was a threat — then log it as an emergency instead.</p>}
            {outcome === 'assign' && (
              <div className="space-y-2">
                <AssigneePicker people={people} value={assigneeId} onChange={setAssigneeId} />
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-gray-500">Tell the caller they'll hear back</span>
                  <select value={promiseHours} onChange={(e) => setPromiseHours(Number(e.target.value))} className="input py-1 text-[11px] w-auto" aria-label="Promised update time">
                    {PROMISE_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                  </select>
                  <span className="text-gray-400">({promisedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})</span>
                </div>
              </div>
            )}
          </section>

          {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={!canSave || saving} className={`flex items-center gap-1.5 disabled:opacity-50 ${emergency ? 'bg-red-600 hover:bg-red-700 text-white text-[12px] font-semibold px-4 py-2 rounded-lg' : 'btn-primary'}`}>
              {outcome === 'assign' ? <Send size={14} /> : <CheckCircle2 size={14} />}
              {saving ? 'Saving…' : outcome === 'assign' ? (assignee ? `Send to ${assignee.full_name.trim()}` : 'Send') : 'Save'}
            </button>
          </div>
        </div>

        {/* Script panel */}
        <aside className="lg:col-span-2">
          <div className="lg:sticky lg:top-0 rounded-xl border border-gray-100 dark:border-white/10 p-4 bg-gray-50/50 dark:bg-white/[0.02]">
            {card ? (
              <>
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{card.section_title}</p>
                <p className="text-[13px] font-semibold mb-3">{card.situation}</p>
                <ScriptCardView card={card} ownerLabel={card.owner_duty ? duties[card.owner_duty]?.label ?? null : null} compact />
              </>
            ) : (
              <div className="text-[12px] text-gray-500 space-y-2">
                <p className="font-semibold text-gray-700 dark:text-gray-200">Open with:</p>
                <p className="border-l-[3px] border-brand bg-brand/5 rounded-r-md px-3 py-2">“Thank you for contacting Kivu Ride on 6023. My name is [name]. How may I assist you today?”</p>
                <p>Then pick what the call is about — the script for that situation appears here, and the right person is pre-selected.</p>
                <p className="text-[11px] text-gray-400">Close with: “Thank you for choosing Kivu Ride. Your reference is [reference]. We will update you within two hours.”</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
