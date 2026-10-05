import { useEffect, useState } from 'react';
import { Clock, LogOut, Monitor, PlayCircle, Users2 } from 'lucide-react';
import { supabase, CallTicket, Profile } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { CallCenterShift, CallCountKey, durationLabel, INCOMING_TYPES, OUTGOING_TYPES, ShiftReport, ShiftSlot, ShiftStats, SLOT_LABEL, SLOTS, STATIONS, suggestSlot } from '../../lib/shifts';
import { STATUS_META } from '../../lib/callTickets';
import Modal from '../Modal';

// Shown instead of the app until a Call Center agent starts their shift.
export function StartShiftScreen({ onStarted }: { onStarted: () => void }) {
  const { profile, signOut } = useAuth();
  const [station, setStation] = useState(STATIONS[0]);
  const [slot, setSlot] = useState<ShiftSlot>(suggestSlot());
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

  const chip = (active: boolean) => `px-3 py-2 rounded-lg text-[12px] font-medium border transition-all ${active ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-brand/40'}`;
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="card p-6 w-full max-w-md space-y-5">
        <div>
          <p className="text-[16px] font-semibold flex items-center gap-2"><PlayCircle size={18} className="text-brand-600 dark:text-brand-300" /> Start your shift</p>
          <p className="text-[12px] text-gray-500 mt-1">Hi {profile?.full_name.trim().split(/\s+/)[0]} — your shift time starts now. Before you sign out you'll end it with a short shift report.</p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-500 mb-1.5 flex items-center gap-1"><Clock size={12} /> Shift</p>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Shift">
            {SLOTS.map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={slot === s.key} onClick={() => setSlot(s.key)} className={chip(slot === s.key)}>
                {s.label}<span className="block text-[10px] font-normal opacity-70">{s.hours}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-500 mb-1.5 flex items-center gap-1"><Monitor size={12} /> Computer</p>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Computer">
            {STATIONS.map((s) => <button key={s} type="button" role="radio" aria-checked={station === s} onClick={() => setStation(s)} className={chip(station === s)}>{s}</button>)}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-gray-500 mb-1.5 flex items-center gap-1" htmlFor="partner"><Users2 size={12} /> Working with <span className="font-normal text-gray-400">(optional)</span></label>
          <select id="partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="input">
            <option value="">Nobody / not sure</option>
            {colleagues.map((c) => <option key={c.id} value={c.id}>{c.full_name.trim()}</option>)}
          </select>
        </div>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <button onClick={start} disabled={busy} className="btn-primary w-full disabled:opacity-50">{busy ? 'Starting…' : 'Start shift'}</button>
        <button onClick={signOut} className="text-[11px] text-gray-400 hover:underline w-full">Not you? Sign out</button>
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
    <button onClick={onEnd} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 hover:bg-emerald-100" title="End shift">
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

  useEffect(() => {
    supabase.rpc('shift_stats', { p_shift_id: shift.id }).then(({ data }) => {
      const st = (data as Partial<ShiftStats>) ?? {};
      setStats(st);
      // Outreach calls are logged one by one, so start from that number.
      if (st.outreach_calls) setReport((r) => (r.out_noninsider === undefined ? { ...r, out_noninsider: st.outreach_calls } : r));
    });
    supabase.from('call_tickets').select('*').in('status', ['open', 'in_progress', 'waiting_on_caller', 'resolved']).order('created_at')
      .then(({ data }) => setOpenCases((data as CallTicket[]) ?? []));
  }, [shift.id]);

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
    const { error: err } = await supabase.rpc('end_call_center_shift', { p_shift_id: shift.id, p_report: { ...report, calls_received: totalIn, calls_made: totalOut, messages_handled: report.messages_handled ?? 0 }, p_handover_note: handoverNote, p_items: items });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onEnded();
  };

  const label = 'block text-[11px] font-medium mb-1 text-gray-500';
  const mins = (Date.now() - new Date(shift.started_at).getTime()) / 60000;
  const statTile = (n: number | undefined, l: string) => (
    <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-2 text-center"><p className="text-[15px] font-bold">{n ?? '…'}</p><p className="text-[10px] text-gray-500">{l}</p></div>
  );

  return (
    <Modal open onClose={onClose} title="End your shift" subtitle={`${SLOT_LABEL[shift.slot]} · ${shift.station} · started ${new Date(shift.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${durationLabel(mins)} so far`} maxWidth="max-w-lg">
      <div className="space-y-4">
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Logged in Kivu Daily this shift</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {statTile(stats?.contacts_logged, 'Contacts')}
            {statTile(stats?.solved_on_call, 'Solved')}
            {statTile(stats?.handed_on, 'Handed on')}
            {statTile(stats?.cases_closed, 'Closed')}
            {statTile(stats?.driver_calls, 'Driver calls')}
            {statTile(stats?.outreach_calls, 'Outreach')}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Your calls this shift * <span className="normal-case font-normal">— check your phone's call log, put 0 where you had none</span></p>
          <fieldset className="rounded-lg border border-gray-100 dark:border-white/10 p-2.5">
            <legend className="px-1 text-[11px] font-semibold">Calls you received <span className="font-normal text-gray-500">· {totalIn} total</span></legend>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {INCOMING_TYPES.map((t) => <div key={t.key}><span className={label}>{t.label}</span>{num(t.key)}</div>)}
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-gray-100 dark:border-white/10 p-2.5">
            <legend className="px-1 text-[11px] font-semibold">Calls you made <span className="font-normal text-gray-500">· {totalOut} total</span></legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {OUTGOING_TYPES.map((t) => <div key={t.key}><span className={label}>{t.label}</span>{num(t.key)}</div>)}
            </div>
            {!!stats?.outreach_calls && <p className="text-[10px] text-gray-500 mt-1.5">You logged {stats.outreach_calls} Non-Insider outreach calls ({stats.outreach_interested ?? 0} interested) — add any you didn't log.</p>}
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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Handover to the next shift</p>
          <textarea value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} rows={2} className="input resize-none" placeholder="Urgent or safety cases, promises made to callers, anything unusual" aria-label="Handover note" />
          {openCases.length > 0 && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {openCases.map((t) => (
                <div key={t.id} className="rounded-lg border border-gray-100 dark:border-white/10 p-2">
                  <p className="text-[11px]"><span className="font-mono text-gray-400">{t.reference}</span> · <b>{t.caller_name}</b> · {STATUS_META[t.status].label}</p>
                  <input value={actions[t.id] ?? ''} onChange={(e) => setActions((a) => ({ ...a, [t.id]: e.target.value }))} className="input mt-1 text-[12px]" placeholder="Last action and exact next action" aria-label={`Next action for ${t.reference}`} />
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <p className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Keep working</button>
          <button onClick={submit} disabled={busy} className="btn-primary flex items-center gap-1.5 disabled:opacity-50"><LogOut size={14} /> {busy ? 'Saving…' : 'End shift'}</button>
        </div>
      </div>
    </Modal>
  );
}
