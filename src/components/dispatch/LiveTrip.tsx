import { useEffect, useRef, useState } from 'react';
import { Ban, CheckCircle2, Clock, Copy, Loader2, MessageCircle, Phone, Repeat, Send, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Label } from '../../ui/kit';
import { CANCELLED_BY, Dispatch, PAY_LABEL, STEPS, callDispatch, clientMessage, fmtRwf, isRunning, kDayTime, localPhone, statusOf, whatsappLink } from '../../lib/dispatch';

// One booking, live: status, driver, car, trip code, the message for the
// client, cancel and book again. Asks the app every 5 seconds while the
// trip runs and the page is visible (Dispatch page, daily report).
export default function LiveTrip({ d, onChange, onBookAgain, onClose, canCancel, bare }: {
  d: Dispatch; onChange: (d: Dispatch) => void; onBookAgain: (d: Dispatch) => void; onClose?: () => void; canCancel: boolean; bare?: boolean;
}) {
  const st = statusOf(d.status);
  const running = isRunning(d);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const live = useRef(d);
  live.current = d;

  // While it runs: ask the app every 5 seconds (while the page is visible), and listen for changes.
  useEffect(() => {
    if (!running) return;
    const tick = async () => {
      if (document.hidden) return;
      const r = await callDispatch<{ dispatch: Dispatch }>({ action: 'status', id: live.current.id });
      if (r.ok && r.dispatch) onChange(r.dispatch);
    };
    const t = setInterval(tick, 5000);
    const ch = supabase.channel(`dispatch-${d.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dispatches', filter: `id=eq.${d.id}` }, (p) => onChange(p.new as Dispatch))
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, [d.id, running, onChange]);

  const doCancel = async () => {
    setBusy(true); setErr(null);
    const r = await callDispatch<{ dispatch: Dispatch }>({ action: 'cancel', id: d.id, reason });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Not cancelled.'); return; }
    setCancelling(false);
    if (r.dispatch) onChange(r.dispatch);
  };
  const msg = clientMessage(d);
  const copy = async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };
  const stepAt = STEPS.indexOf(d.status as (typeof STEPS)[number]);
  const noDriver = d.status === 'cancelled' && d.cancelled_by === 'system';

  const body = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label tone={st.tone} icon={running ? Loader2 : d.status === 'completed' ? CheckCircle2 : d.status === 'cancelled' || d.status === 'failed' ? Ban : undefined}>{st.label}</Label>
        {d.sandbox && <Label tone="info">Test</Label>}
        {d.scheduled_pickup_time && <span className="text-caption text-fg-muted flex items-center gap-1"><Clock size={12} /> Pickup {kDayTime(d.scheduled_pickup_time)}</span>}
        <span className="text-caption text-fg-subtle ml-auto">{d.partner_reference}{d.platform_trip_id ? ` · trip #${d.platform_trip_id}` : ''}</span>
      </div>
      {st.hint && running && <p className="text-caption text-fg-muted">{st.hint}</p>}
      {d.status === 'failed' && d.error && <p className="text-small text-danger">{d.error}</p>}
      {d.status === 'unknown' && d.error && <p className="text-small text-attention">{d.error}</p>}
      {d.status === 'cancelled' && <p className="text-small text-fg-muted">Cancelled by {CANCELLED_BY[d.cancelled_by ?? ''] ?? d.cancelled_by ?? '—'}{d.cancellation_reason ? `: ${d.cancellation_reason}` : ''}.</p>}

      {stepAt >= 0 && (
        <div className="flex gap-1">{STEPS.map((s, i) => <span key={s} title={statusOf(s).label} className={`h-1.5 flex-1 rounded-full ${i <= stepAt ? 'bg-brand' : 'bg-line'}`} />)}</div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-line p-3 space-y-1 text-small">
          <p className="text-caption text-fg-muted">Client</p>
          <p className="font-semibold">{d.client_name}</p>
          <a className="text-brand flex items-center gap-1" href={`tel:${d.client_phone}`}><Phone size={12} /> {localPhone(d.client_phone)}</a>
          <p className="text-caption text-fg-muted pt-1"><span className="font-semibold text-[#2563eb]">A</span> {d.pickup_address}</p>
          <p className="text-caption text-fg-muted"><span className="font-semibold text-[#ea580c]">B</span> {d.destination_address}</p>
          <p className="text-caption text-fg-muted">{d.vehicle_type} · {PAY_LABEL[d.payment_method]} · {fmtRwf(d.fare ?? d.estimated_fare)}{d.status === 'completed' ? ' final' : ' estimated'}</p>
        </div>
        <div className="rounded-lg border border-line p-3 space-y-1 text-small">
          <p className="text-caption text-fg-muted">Driver</p>
          {d.driver_name ? (
            <>
              <p className="font-semibold">{d.driver_name}{d.driver_rating ? <span className="text-caption text-fg-muted font-normal"> · ★ {Number(d.driver_rating).toFixed(1)}</span> : null}</p>
              {d.driver_phone && <a className="text-brand flex items-center gap-1" href={`tel:${d.driver_phone}`}><Phone size={12} /> {localPhone(d.driver_phone)}</a>}
              <p className="text-fg-muted">{[d.vehicle_label, d.vehicle_plate].filter(Boolean).join(' · ')}</p>
            </>
          ) : <p className="text-fg-muted">{running ? 'Not yet: waiting for a driver to accept.' : 'No driver.'}</p>}
          {d.trip_code && (
            <div className="pt-1">
              <p className="text-caption text-fg-muted">Trip code (the client tells the driver)</p>
              <p className="text-h2 font-bold tracking-[0.2em] tabular-nums">{d.trip_code}</p>
            </div>
          )}
        </div>
      </div>

      {d.status !== 'failed' && (
        <div className="rounded-lg bg-inset p-3 space-y-2">
          <p className="text-caption text-fg-muted">Tell or send the client</p>
          <p className="text-small whitespace-pre-wrap">{msg}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary text-caption" onClick={copy}><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
            <a className="btn-secondary text-caption" href={whatsappLink(d.client_phone, msg)} target="_blank" rel="noreferrer"><MessageCircle size={12} /> WhatsApp</a>
            <a className="btn-secondary text-caption" href={`sms:${d.client_phone}?body=${encodeURIComponent(msg)}`}><Send size={12} /> SMS</a>
          </div>
        </div>
      )}

      {err && <p className="text-small text-danger">{err}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {(noDriver || d.status === 'failed' || d.status === 'cancelled') && <button className="btn-primary" onClick={() => onBookAgain(d)}><Repeat size={14} /> Book again</button>}
        {running && d.platform_trip_id && canCancel && !['in_progress', 'driver_completed'].includes(d.status) && (
          cancelling ? (
            <div className="flex flex-wrap items-center gap-2 w-full justify-end">
              <input className="input flex-1 min-w-[180px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. client changed plans" autoFocus />
              <button className="btn-secondary" onClick={() => setCancelling(false)}>Keep it</button>
              <button className="btn-danger" disabled={busy} onClick={doCancel}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Cancel the trip</button>
            </div>
          ) : <button className="btn-secondary" onClick={() => setCancelling(true)}><Ban size={14} /> Cancel trip</button>
        )}
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <div className={`card p-4 border-2 ${running ? 'border-brand/50' : 'border-line'}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-ui font-semibold">Your booking for {d.client_name}</p>
        {onClose && <button className="btn-ghost p-1" onClick={onClose} aria-label="Close"><X size={16} /></button>}
      </div>
      {body}
    </div>
  );
}
