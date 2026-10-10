import { useState } from 'react';
import {
  AlertTriangle, ArrowRightLeft, CalendarClock, Car, CheckCircle2, Clock, Hourglass, Mail, MessageSquarePlus, Phone, PlayCircle,
  RotateCcw, ShieldAlert, ShieldCheck, User, XCircle,
} from 'lucide-react';
import { supabase, CallTicket, CallTicketUpdate } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import {
  ageLabel, CALLER_TYPE_LABEL, CATEGORY_LABEL, CHANNELS, dateTimeLabel, isOverdue, isResponseOverdue, isUnresolved, needsMdAck,
  OUTCOME_LABEL, SATISFACTION, STATUS_META, TicketPerson,
} from '../../lib/callTickets';
import Modal from '../Modal';
import AssigneePicker from './AssigneePicker';

type Action = 'start' | 'waiting' | 'note' | 'resolve' | 'reassign' | 'close' | 'reopen' | 'acknowledge' | 'set_callback';
type FormAction = Exclude<Action, 'start' | 'acknowledge'>;

const ACTION_FORM: Record<FormAction, { title: string; placeholder: string; button: string; noteRequired: boolean }> = {
  note: { title: 'Add a note', placeholder: 'What you found, did, or need — the other side is emailed', button: 'Add note', noteRequired: true },
  waiting: { title: 'Pending — waiting on the caller', placeholder: 'What do we need from the caller? The Call Center will ring them', button: 'Mark pending', noteRequired: true },
  resolve: { title: 'Mark resolved', placeholder: 'What did you do? The Call Center reads this to the caller', button: 'Mark resolved', noteRequired: true },
  reassign: { title: 'Reassign', placeholder: 'Why it belongs with them', button: 'Reassign', noteRequired: true },
  close: { title: 'Close — caller informed', placeholder: 'Optional: what the caller said', button: 'Close case', noteRequired: false },
  reopen: { title: 'Reopen', placeholder: "What the caller says still isn't fixed", button: 'Reopen', noteRequired: true },
  set_callback: { title: 'Promised call-back time', placeholder: 'Optional note, e.g. "after 3pm, at work before"', button: 'Save call-back', noteRequired: false },
};

export default function TicketDrawer({
  ticket,
  updates,
  people,
  personName,
  onClose,
  onChanged,
}: {
  ticket: CallTicket;
  updates: CallTicketUpdate[];
  people: TicketPerson[];
  personName: (id: string | null | undefined) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const [action, setAction] = useState<FormAction | null>(null);
  const [note, setNote] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [satisfaction, setSatisfaction] = useState<'happy' | 'neutral' | 'unhappy' | ''>('');
  const [callbackAt, setCallbackAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isMD = profile?.role === 'managing_director';
  const isCC = profile?.department?.slug === 'call_center';
  const isMine = ticket.assignee_id === profile?.id;
  const open = isUnresolved(ticket);
  const overdue = isOverdue(ticket);
  const noResponse = isResponseOverdue(ticket);
  const awaitingAck = needsMdAck(ticket);
  const status = STATUS_META[ticket.status];
  const callbackDue = ticket.callback_at && new Date(ticket.callback_at).getTime() <= Date.now();

  const can = {
    start: (isMine || isMD) && (ticket.status === 'open' || ticket.status === 'waiting_on_caller'),
    waiting: (isMine || isMD) && open && ticket.status !== 'waiting_on_caller',
    resolve: (isMine || isMD) && open,
    reassign: (isMine || isMD || isCC) && open,
    close: (isCC || isMD) && ticket.status === 'resolved',
    reopen: (isCC || isMD) && !open && !ticket.resolved_on_call,
    acknowledge: isMD && awaitingAck,
    callback: (isCC || isMD || isMine) && ticket.status !== 'closed' && !ticket.resolved_on_call,
  };

  const run = async (a: Action) => {
    const form = a === 'start' || a === 'acknowledge' ? null : ACTION_FORM[a];
    if (form?.noteRequired && !note.trim()) { setError('Please write something first.'); return; }
    if (a === 'reassign' && !assigneeId) { setError('Choose who to reassign it to.'); return; }
    if (a === 'close' && !satisfaction) { setError('How did the caller feel about the outcome?'); return; }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('call_ticket_action', {
      p_ticket_id: ticket.id, p_action: a, p_note: note.trim() || null,
      p_assignee_id: a === 'reassign' ? assigneeId : null,
      p_extra: {
        ...(a === 'close' ? { satisfaction } : {}),
        ...(a === 'set_callback' ? { callback_at: callbackAt ? new Date(callbackAt).toISOString() : null } : {}),
      },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setAction(null);
    setNote('');
    setAssigneeId('');
    setSatisfaction('');
    onChanged();
  };

  const choose = (a: FormAction) => { setAction(action === a ? null : a); setError(''); };
  const who = ticket.driver
    ? `${ticket.driver.full_name}${ticket.driver.vehicle ? ` · ${ticket.driver.vehicle.plate_number}` : ''} (our driver)`
    : ticket.driver_label
      ? `${ticket.driver_label} (our driver)`
      : ticket.platform_driver
      ? `${ticket.platform_driver.full_name}${ticket.vehicle_plate ? ` · ${ticket.vehicle_plate}` : ''} (Non-Insider)`
      : ticket.vehicle_plate;
  const channelLabel = CHANNELS.find((c) => c.key === ticket.channel)?.label ?? ticket.channel;

  return (
    <Modal open onClose={onClose} title={ticket.reference}
      subtitle={`${ticket.situation ?? CATEGORY_LABEL[ticket.category]} · ${channelLabel} · logged ${dateTimeLabel(ticket.created_at)} by ${personName(ticket.created_by)}`} maxWidth="max-w-lg">
      <div className="space-y-5">
        {awaitingAck && (
          <div className="rounded-lg bg-red-700 text-white p-3 flex items-start gap-2" role="alert">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1 text-[12px]">
              <p className="font-semibold">Emergency — waiting for the MD to acknowledge</p>
              <p className="opacity-90">It can't be closed until the MD has seen it.</p>
            </div>
            {can.acknowledge && <button disabled={busy} onClick={() => run('acknowledge')} className="bg-white text-red-700 text-[12px] font-semibold px-3 py-1.5 rounded-md disabled:opacity-50">Acknowledge</button>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${status.chip}`}>{status.label}</span>
          {ticket.priority !== 'normal' && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full text-white ${ticket.priority === 'emergency' ? 'bg-red-700' : 'bg-red-500'}`}>{ticket.priority.toUpperCase()}</span>}
          {noResponse && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 flex items-center gap-1"><AlertTriangle size={11} /> No response in {ageLabel(ticket.assigned_at ?? ticket.created_at)}</span>}
          {!noResponse && overdue && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 flex items-center gap-1"><AlertTriangle size={11} /> Overdue · waiting {ageLabel(ticket.created_at)}</span>}
          {ticket.callback_at && ticket.status !== 'closed' && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${callbackDue ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'}`}>
              <CalendarClock size={11} /> Call back {dateTimeLabel(ticket.callback_at)}
            </span>
          )}
          {ticket.resolved_on_call && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{ticket.outcome_kind ? OUTCOME_LABEL[ticket.outcome_kind] : 'Solved on the call'}</span>}
          {ticket.satisfaction && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-white/5">Caller {ticket.satisfaction}</span>}
          {!ticket.resolved_on_call && <span className="text-[11px] text-gray-400 ml-auto">Assigned to <b className="text-gray-600 dark:text-gray-300">{personName(ticket.assignee_id)}</b></span>}
        </div>

        <section className="rounded-xl border border-gray-100 dark:border-white/10 p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center shrink-0"><User size={16} className="text-brand-600 dark:text-brand-300" /></div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold truncate">{ticket.caller_name}</p>
              <p className="text-[11px] text-gray-400">{CALLER_TYPE_LABEL[ticket.caller_type] ?? ticket.caller_type}{ticket.driver_verified ? ' · verified' : ''}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${ticket.caller_phone.replace(/[^\d+]/g, '')}`} className="btn-ghost flex items-center gap-1.5 text-[12px]"><Phone size={13} /> {ticket.caller_phone}</a>
            {ticket.caller_email && <a href={`mailto:${ticket.caller_email}`} className="btn-ghost flex items-center gap-1.5 text-[12px]"><Mail size={13} /> {ticket.caller_email}</a>}
          </div>
          {who && <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Car size={12} /> {who}</p>}
          {ticket.trip_reference && <p className="text-[11px] text-gray-500">Trip: {ticket.trip_reference}</p>}
          {ticket.driver_verified && <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><ShieldCheck size={12} /> Driver verified (name, phone, plate)</p>}
          {ticket.promised_update_at && open && <p className="text-[11px] text-gray-500">Caller promised an update by <b>{dateTimeLabel(ticket.promised_update_at)}</b></p>}
        </section>

        {ticket.emergency_details && (
          <section className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5 p-3 text-[12px] space-y-0.5">
            <h3 className="text-[11px] font-semibold text-red-700 dark:text-red-300 mb-1">Emergency details</h3>
            {ticket.emergency_details.location && <p><b>Location:</b> {ticket.emergency_details.location}</p>}
            {ticket.emergency_details.injuries && <p><b>Injuries / danger:</b> {ticket.emergency_details.injuries}</p>}
            {!!ticket.emergency_details.services_called?.length && <p><b>Service called:</b> {ticket.emergency_details.services_called.join(', ')}</p>}
            {ticket.md_acknowledged_at && <p className="text-[11px] text-gray-500 pt-1">Acknowledged by {personName(ticket.md_acknowledged_by)} · {dateTimeLabel(ticket.md_acknowledged_at)}</p>}
          </section>
        )}

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">What the caller said</h3>
          <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{ticket.details}</p>
          {ticket.actions_taken && (
            <p className="text-[12px] text-gray-500 mt-2"><b className="text-gray-600 dark:text-gray-300">Agent already did:</b> {ticket.actions_taken}</p>
          )}
        </section>

        {ticket.resolution_note && (
          <section className="rounded-xl bg-teal-50/70 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/20 p-3">
            <h3 className="text-[11px] font-semibold text-teal-700 dark:text-teal-300 mb-1 flex items-center gap-1"><CheckCircle2 size={12} /> Resolution{ticket.resolved_by ? ` — ${personName(ticket.resolved_by)}` : ''}</h3>
            <p className="text-[12px] whitespace-pre-wrap">{ticket.resolution_note}</p>
            {ticket.status === 'resolved' && <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 mt-1.5">Waiting for the Call Center to inform the caller and close it.</p>}
          </section>
        )}

        <section>
          <div className="flex flex-wrap gap-1.5">
            {can.start && <button disabled={busy} onClick={() => run('start')} className="btn-primary flex items-center gap-1.5 text-[12px] disabled:opacity-50"><PlayCircle size={14} /> Start working</button>}
            {can.resolve && <ActionButton active={action === 'resolve'} onClick={() => choose('resolve')} icon={CheckCircle2} label="Mark resolved" />}
            {can.waiting && <ActionButton active={action === 'waiting'} onClick={() => choose('waiting')} icon={Hourglass} label="Pending on caller" />}
            {can.close && <ActionButton active={action === 'close'} onClick={() => choose('close')} icon={XCircle} label="Close — caller informed" />}
            {can.reopen && <ActionButton active={action === 'reopen'} onClick={() => choose('reopen')} icon={RotateCcw} label="Reopen" />}
            {can.reassign && <ActionButton active={action === 'reassign'} onClick={() => choose('reassign')} icon={ArrowRightLeft} label="Reassign" />}
            {can.callback && <ActionButton active={action === 'set_callback'} onClick={() => choose('set_callback')} icon={CalendarClock} label="Call-back time" />}
            <ActionButton active={action === 'note'} onClick={() => choose('note')} icon={MessageSquarePlus} label="Add note" />
          </div>

          {action && (
            <div className="mt-3 rounded-xl border border-gray-200 dark:border-white/10 p-3 space-y-2.5">
              <p className="text-[12px] font-semibold">{ACTION_FORM[action].title}</p>
              {action === 'reassign' && <AssigneePicker people={people} value={assigneeId} onChange={setAssigneeId} excludeId={ticket.assignee_id} />}
              {action === 'set_callback' && (
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className="input w-auto" aria-label="Call-back date and time" />
                  {ticket.callback_at && <button type="button" onClick={() => setCallbackAt('')} className="btn-ghost text-[11px]">Clear</button>}
                </div>
              )}
              {action === 'close' && (
                <div>
                  <p className="text-[11px] text-gray-500 mb-1">How did the caller feel about the outcome?</p>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Caller satisfaction">
                    {SATISFACTION.map((s) => (
                      <button key={s.key} type="button" role="radio" aria-checked={satisfaction === s.key} onClick={() => setSatisfaction(s.key)}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border ${satisfaction === s.key ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>{s.label}</button>
                    ))}
                  </div>
                  {awaitingAck && <p className="text-[11px] text-red-600 mt-1.5">This emergency must be acknowledged by the MD before it can be closed.</p>}
                </div>
              )}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={action === 'set_callback' ? 2 : 3} className="input resize-none" placeholder={ACTION_FORM[action].placeholder} aria-label={ACTION_FORM[action].title} />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setAction(null); setError(''); }} className="btn-ghost text-[12px]">Cancel</button>
                <button disabled={busy} onClick={() => run(action)} className="btn-primary text-[12px] disabled:opacity-50">{busy ? 'Saving…' : ACTION_FORM[action].button}</button>
              </div>
            </div>
          )}
          {error && <div className="mt-2 text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
        </section>

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5"><Clock size={12} /> Timeline</h3>
          <ol className="relative border-l border-gray-200 dark:border-white/10 ml-1.5 space-y-3">
            {updates.map((u) => (
              <li key={u.id} className="ml-4">
                <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${dotColor(u.kind)}`} />
                <p className="text-[12px]"><b>{personName(u.author_id)}</b> {describe(u, personName)}</p>
                {u.body && <p className="text-[12px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap mt-0.5">{u.body}</p>}
                <p className="text-[10px] text-gray-400 mt-0.5">{dateTimeLabel(u.created_at)}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Modal>
  );
}

function ActionButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Clock; label: string }) {
  return (
    <button onClick={onClick} aria-expanded={active}
      className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 border transition-all ${active ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 hover:border-brand/40'}`}>
      <Icon size={13} /> {label}
    </button>
  );
}

function dotColor(kind: CallTicketUpdate['kind']) {
  return kind === 'resolved' ? 'bg-teal-500' : kind === 'closed' ? 'bg-gray-400' : kind === 'reopened' ? 'bg-red-500'
    : kind === 'acknowledged' ? 'bg-red-700' : kind === 'callback' ? 'bg-orange-400'
      : kind === 'reassigned' ? 'bg-purple-500' : kind === 'note' ? 'bg-blue-400' : 'bg-brand';
}

function describe(u: CallTicketUpdate, personName: (id: string | null | undefined) => string): string {
  switch (u.kind) {
    case 'created': return `logged the call and assigned it to ${personName(u.to_assignee)}`;
    case 'note': return 'added a note';
    case 'status': return u.to_status === 'in_progress' ? 'started working on it' : u.to_status === 'waiting_on_caller' ? 'marked it pending on the caller' : `set it to ${u.to_status}`;
    case 'reassigned': return `reassigned it from ${personName(u.from_assignee)} to ${personName(u.to_assignee)}`;
    case 'resolved': return u.to_status === 'closed' ? 'solved it on the call' : 'marked it resolved';
    case 'closed': return 'informed the caller and closed it';
    case 'reopened': return 'reopened it';
    case 'acknowledged': return 'acknowledged the emergency';
    case 'callback': return 'set a call-back time';
    default: return 'updated it';
  }
}
