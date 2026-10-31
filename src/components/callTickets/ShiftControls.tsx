import { useEffect, useState } from 'react';
import { Clock, Coins, LogOut, Monitor, PlayCircle, Plus, Users2 } from 'lucide-react';
import { supabase, CallTicket, Profile } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { CallCenterShift, CallCountKey, durationLabel, INCOMING_TYPES, OUTGOING_TYPES, ShiftReport, ShiftStats, SLOT_LABEL, SLOTS, STATIONS, suggestSlot } from '../../lib/shifts';
import { STATUS_META } from '../../lib/callTickets';
import Modal from '../Modal';

// Shown instead of the app until a Call Center agent starts their shift.
export function StartShiftScreen({ onStarted }: { onStarted: () => void }) {
  const { profile, signOut } = useAuth();
  const [station, setStation] = useState(STATIONS[0]);
  // Set from the time it starts (the server decides; this shows the same rule).
  const [slot, setSlot] = useState(suggestSlot());
  useEffect(() => { const t = setInterval(() => setSlot(suggestSlot()), 30_000); return () => clearInterval(t); }, []);
  const slotInfo = SLOTS.find((s) => s.key === slot)!;
  const [partnerId, setPartnerId] = useState('');
  const [colleagues, setColleagues] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('profiles').select('*, department:departments(slug)').eq('is_active', true).then(({ data }) => {
      setColleagues(((data as (Profile & { department: { slug: string } | null })[]) ?? []).filter((p) => p.department?.slug === 'call_center' && p.id !== profile?.id));
    });
  }, [profile?.id]);

  const start = async () => {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('start_call_center_shift', { p_station: station, p_slot: slot, p_partner_id: partnerId || null });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onStarted();
  };

  const chip = (active: boolean) => `px-3 py-2 rounded-lg text-small font-medium border transition-all ${active ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-line text-fg-muted hover:border-brand/40'}`;
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="card p-6 w-full max-w-md space-y-5">
        <div>
          <p className="text-title font-semibold flex items-center gap-2"><PlayCircle size={18} className="text-brand-600 dark:text-brand-300" /> Start your shift</p>
          <p className="text-small text-fg-muted mt-1">Hi {profile?.full_name.trim().split(/\s+/)[0]} — your shift time starts now. Before you sign out you'll end it with a short shift report.</p>
        </div>
        <div>
          <p className="text-caption font-medium text-fg-muted mb-1.5 flex items-center gap-1"><Clock size={12} /> Shift</p>
          <div className={chip(true)}>{slotInfo.label} <span className="font-normal opacity-70">{slotInfo.hours}</span></div>
          <p className="text-micro text-fg-subtle mt-1">Set from the time you start: 07:00–15:00, 15:00–23:00, 23:00–07:00.</p>
        </div>
        <div>
          <p className="text-caption font-medium text-fg-muted mb-1.5 flex items-center gap-1"><Monitor size={12} /> Computer</p>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Computer">
            {STATIONS.map((s) => <button key={s} type="button" role="radio" aria-checked={station === s} onClick={() => setStation(s)} className={chip(station === s)}>{s}</button>)}
          </div>
        </div>
        <div>
          <label className="text-caption font-medium text-fg-muted mb-1.5 flex items-center gap-1" htmlFor="partner"><Users2 size={12} /> Working with <span className="font-normal text-fg-subtle">(optional)</span></label>
          <select id="partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="input">
            <option value="">Nobody / not sure</option>
            {colleagues.map((c) => <option key={c.id} value={c.id}>{c.full_name.trim()}</option>)}
          </select>
        </div>
        {error && <p className="text-caption text-red-600">{error}</p>}
        <button onClick={start} disabled={busy} className="btn-primary w-full disabled:opacity-50">{busy ? 'Starting…' : 'Start shift'}</button>
        <button onClick={signOut} className="text-caption text-fg-subtle hover:underline w-full">Not you? Sign out</button>
      </div>
    </div>
  );
}

// Header chip: on shift since HH:MM, with End shift.
export function ShiftChip({ shift, onEnd }: { shift: CallCenterShift; onEnd: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  const mins = (Date.now() - new Date(shift.started_at).getTime()) / 60000;
  return (
    <button onClick={onEnd} className="flex items-center gap-1.5 text-caption font-medium px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 hover:bg-emerald-100" title="End shift">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      On shift · {durationLabel(mins)} · {shift.station}
      <span className="ml-1 underline">End shift</span>
    </button>
  );
}

// End-of-shift report. Numbers the system already knows are shown; the
// agent adds what only they know. Saving closes the shift and hands over.
export function EndShiftDrawer({ shift, onClose, onEnded }: { shift: CallCenterShift; onClose: () => void; onEnded: () => void }) {
  const [openCases, setOpenCases] = useState<CallTicket[]>([]);
  const [stats, setStats] = useState<Partial<ShiftStats> | null>(null);
  const [report, setReport] = useState<Partial<ShiftReport>>({});
  const [handoverNote, setHandoverNote] = useState('');
  const [actions, setActions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadStats = () => supabase.rpc('shift_stats', { p_shift_id: shift.id }).then(({ data }) => {
    const st = (data as Partial<ShiftStats>) ?? {};
    setStats(st);
    // Calls to Non-Insiders (outreach + after trips) are logged one by one, so start from that number.
    const noninsider = (st.outreach_calls ?? 0) + (st.trip_calls ?? 0);
    if (noninsider) setReport((r) => (r.out_noninsider === undefined ? { ...r, out_noninsider: noninsider } : r));
  });
  useEffect(() => {
    loadStats();
    supabase.from('call_tickets').select('*').in('status', ['open', 'in_progress', 'waiting_on_caller', 'resolved']).order('created_at')
      .then(({ data }) => setOpenCases((data as CallTicket[]) ?? []));
  }, [shift.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const num = (k: keyof ShiftReport) => (
    <input type="number" min={0} inputMode="numeric" value={(report[k] as number | undefined) ?? ''} aria-label={k}
      onChange={(e) => setReport((r) => ({ ...r, [k]: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) }))} className="input" />
  );
  const text = (k: keyof ShiftReport, placeholder: string, rows = 2) => (
    <textarea value={(report[k] as string | undefined) ?? ''} onChange={(e) => setReport((r) => ({ ...r, [k]: e.target.value }))} rows={rows} className="input resize-none" placeholder={placeholder} aria-label={k} />
  );

  const sum = (keys: readonly { key: CallCountKey }[]) => keys.reduce((t, k) => t + (report[k.key] ?? 0), 0);
  const totalIn = sum(INCOMING_TYPES);
  const totalOut = sum(OUTGOING_TYPES);

  const submit = async () => {
    const missing = [...INCOMING_TYPES, ...OUTGOING_TYPES].filter((k) => report[k.key] === undefined);
    if (missing.length || report.calls_missed === undefined) { setError('Fill in every call number — put 0 where you had none.'); return; }
    if (!report.worked_on?.trim()) { setError('Say what you worked on this shift.'); return; }
    setBusy(true);
    setError('');
    const items = openCases.map((t) => ({ ticket_id: t.id, reference: t.reference, caller: t.caller_name, status: t.status, next_action: (actions[t.id] ?? '').trim() }));
    const commission = { commission_calls: stats?.commission_calls ?? 0, commission_collected: stats?.commission_collected ?? 0, commission_promised: stats?.commission_promised ?? 0, commission_reminded: stats?.commission_reminded ?? 0 };
    const { error: err } = await supabase.rpc('end_call_center_shift', { p_shift_id: shift.id, p_report: { ...report, ...commission, calls_received: totalIn, calls_made: totalOut, messages_handled: report.messages_handled ?? 0 }, p_handover_note: handoverNote, p_items: items });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onEnded();
  };

  const label = 'block text-caption font-medium mb-1 text-fg-muted';
  const mins = (Date.now() - new Date(shift.started_at).getTime()) / 60000;
  const statTile = (n: number | undefined, l: string) => (
    <div className="rounded-lg bg-inset p-2 text-center"><p className="text-title font-bold">{n ?? '…'}</p><p className="text-micro text-fg-muted">{l}</p></div>
  );

  return (
    <Modal open onClose={onClose} title="End your shift" subtitle={`${SLOT_LABEL[shift.slot]} · ${shift.station} · started ${new Date(shift.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${durationLabel(mins)} so far`} maxWidth="max-w-lg">
      <div className="space-y-4">
        <section>
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">Logged in Kivu Daily this shift</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {statTile(stats?.contacts_logged, 'Contacts')}
            {statTile(stats?.solved_on_call, 'Solved')}
            {statTile(stats?.handed_on, 'Handed on')}
            {statTile(stats?.cases_closed, 'Closed')}
            {statTile(stats?.driver_calls, 'Driver calls')}
            {statTile(stats?.trip_calls, 'After-trip calls')}
          </div>
          {!!stats?.trip_calls && <p className="text-micro text-fg-muted mt-1.5">Calls after trips: {stats.trip_calls_reached ?? 0} reached, {stats.branding_yes ?? 0} said yes to branding or the device.</p>}
        </section>

        <CommissionSection stats={stats} onAdded={loadStats} />

        <section className="space-y-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">Your calls this shift * <span className="normal-case font-normal">— check your phone's call log, put 0 where you had none</span></p>
          <fieldset className="rounded-lg border border-line-muted p-2.5">
            <legend className="px-1 text-caption font-semibold">Calls you received <span className="font-normal text-fg-muted">· {totalIn} total</span></legend>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {INCOMING_TYPES.map((t) => <div key={t.key}><span className={label}>{t.label}</span>{num(t.key)}</div>)}
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-line-muted p-2.5">
            <legend className="px-1 text-caption font-semibold">Calls you made <span className="font-normal text-fg-muted">· {totalOut} total</span></legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {OUTGOING_TYPES.map((t) => <div key={t.key}><span className={label}>{t.label}</span>{num(t.key)}</div>)}
            </div>
            {!!((stats?.outreach_calls ?? 0) + (stats?.trip_calls ?? 0)) && <p className="text-micro text-fg-muted mt-1.5">You logged {(stats?.outreach_calls ?? 0) + (stats?.trip_calls ?? 0)} calls to Non-Insider drivers — add any you didn't log.</p>}
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <div><span className={label}>Missed calls</span>{num('calls_missed')}</div>
            <div><span className={label}>WhatsApp/SMS handled</span>{num('messages_handled')}</div>
          </div>
        </section>

        <section className="space-y-2">
          <div><span className={label}>What you worked on *</span>{text('worked_on', 'e.g. 14 driver check-ins, 3 payment reminders, explained the new booking screen to 6 drivers')}</div>
          <div><span className={label}>What got resolved</span>{text('resolved_summary', 'Issues you or others closed this shift')}</div>
          <div><span className={label}>What is still unresolved</span>{text('unresolved_summary', "Anything open and why")}</div>
          <div><span className={label}>Problems you hit</span>{text('problems', 'App, phone, internet, platform or process problems')}</div>
          <div><span className={label}>What drivers and passengers told you</span>{text('feedback', 'Complaints, requests, feature ideas, praise')}</div>
          <div><span className={label}>Your suggestions</span>{text('suggestions', 'How we could do better')}</div>
        </section>

        <section className="space-y-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">Handover to the next shift</p>
          <textarea value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} rows={2} className="input resize-none" placeholder="Urgent or safety cases, promises made to callers, anything unusual" aria-label="Handover note" />
          {openCases.length > 0 && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {openCases.map((t) => (
                <div key={t.id} className="rounded-lg border border-line-muted p-2">
                  <p className="text-caption"><span className="font-mono text-fg-subtle">{t.reference}</span> · <b>{t.caller_name}</b> · {STATUS_META[t.status].label}</p>
                  <input value={actions[t.id] ?? ''} onChange={(e) => setActions((a) => ({ ...a, [t.id]: e.target.value }))} className="input mt-1 text-small" placeholder="Last action and exact next action" aria-label={`Next action for ${t.reference}`} />
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <p className="text-caption text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted ">
          <button onClick={onClose} className="btn-ghost">Keep working</button>
          <button onClick={submit} disabled={busy} className="btn-primary flex items-center gap-1.5 disabled:opacity-50"><LogOut size={14} /> {busy ? 'Saving…' : 'End shift'}</button>
        </div>
      </div>
    </Modal>
  );
}

// Commission this shift: the calls logged in Commission follow-up (from the
// Kivu Ride dashboard's commission page), with a quick way to add any not
// logged yet. Saved with the shift report.
function CommissionSection({ stats, onAdded }: { stats: Partial<ShiftStats> | null; onAdded: () => void }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ driver_name: '', driver_phone: '', amount_owed: '', outcome: 'paid', amount_paid: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const digits = (v: string) => Number(v.replace(/[^\d]/g, '')) || 0;
  const add = async () => {
    if (!f.driver_name.trim()) { setErr("Type the driver's name."); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('commission_followups').insert({
      driver_name: f.driver_name.trim(), driver_phone: f.driver_phone.trim() || null, amount_owed: digits(f.amount_owed),
      outcome: f.outcome, amount_paid: f.outcome === 'paid' ? digits(f.amount_paid) : null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setF({ driver_name: '', driver_phone: '', amount_owed: '', outcome: 'paid', amount_paid: '' });
    onAdded();
  };
  const tile = (n: string | number | undefined, l: string) => (
    <div className="rounded-lg bg-inset p-2 text-center"><p className="text-title font-bold">{n ?? '…'}</p><p className="text-micro text-fg-muted">{l}</p></div>
  );
  return (
    <section className="space-y-2">
      <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle flex items-center gap-1.5"><Coins size={12} /> Commission this shift</p>
      <div className="grid grid-cols-4 gap-1.5">
        {tile(stats?.commission_calls, 'Drivers called')}
        {tile(stats ? Math.round(stats.commission_collected ?? 0).toLocaleString('en-US') : undefined, 'Collected (RWF)')}
        {tile(stats?.commission_promised, 'Promised')}
        {tile(stats?.commission_reminded, 'Reminded')}
      </div>
      {!adding ? (
        <button onClick={() => setAdding(true)} className="btn-ghost text-caption"><Plus size={12} /> Add a commission call you didn't log</button>
      ) : (
        <div className="rounded-lg border border-line-muted p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Driver name" value={f.driver_name} onChange={(e) => setF({ ...f, driver_name: e.target.value })} aria-label="Driver name" />
            <input className="input" placeholder="Phone" value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} aria-label="Phone" />
            <input className="input" inputMode="numeric" placeholder="Owed (RWF)" value={f.amount_owed} onChange={(e) => setF({ ...f, amount_owed: e.target.value })} aria-label="Amount owed" />
            <select className="input" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} aria-label="Outcome">
              <option value="paid">Paid</option><option value="promised">Promised to pay</option><option value="refused">Refused</option><option value="no_answer">No answer</option><option value="wrong_number">Wrong number</option>
            </select>
            {f.outcome === 'paid' && <input className="input col-span-2" inputMode="numeric" placeholder="Amount paid (RWF)" value={f.amount_paid} onChange={(e) => setF({ ...f, amount_paid: e.target.value })} aria-label="Amount paid" />}
          </div>
          {err && <p className="text-caption text-danger">{err}</p>}
          <div className="flex justify-end gap-2"><button className="btn-ghost text-caption" onClick={() => setAdding(false)}>Close</button><button className="btn-secondary text-caption" disabled={busy} onClick={add}>Add</button></div>
        </div>
      )}
    </section>
  );
}
