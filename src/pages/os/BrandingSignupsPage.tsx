import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, CalendarDays, CheckCircle2, Coins, Loader2, Paintbrush, Phone, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import Modal from '../../components/Modal';
import { EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs, rwf } from '../../ui/kit';
import { kigaliToday } from '../../lib/kigali';
import { ACTION_LABEL, BrandingSignup, SIGNUP_STATUS, SignupStatus, wantsLabel } from '../../lib/tripCalls';

// Trips > Branding sign-ups (Rodrigue, duty 'branding_signups'): Non-Insider
// drivers who said yes on a call after a trip. Agreed -> Contacted -> Paid
// (recorded in the Finance ledger, checked, for the MD to approve) ->
// Completed (car branded / device installed; the calls stop).

type View = 'open' | SignupStatus;
const ACCOUNTS: [string, string][] = [['momo', 'Mobile Money'], ['bank_of_kigali', 'Bank of Kigali'], ['equity', 'Equity'], ['im_bank', 'I&M']];
const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });

export default function BrandingSignupsPage() {
  usePageTitle('Branding sign-ups');
  const a = useAccess();
  const canAct = a.isMd || a.in('finance', 'fleet') || a.duties.has('branding_signups');
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<BrandingSignup[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('open');
  const [acting, setActing] = useState<{ s: BrandingSignup; action: 'contacted' | 'paid' | 'completed' | 'cancel' | 'note' } | null>(null);
  const openId = params.get('s');

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from('branding_signups').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setRows((s.data as BrandingSignup[]) ?? []);
    setNames(Object.fromEntries(((p.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name.trim().split(/\s+/)[0]])));
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`branding-signups-${Math.random().toString(36).slice(2)}`).on('postgres_changes', { event: '*', schema: 'public', table: 'branding_signups' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const list = useMemo(() => (rows ?? []).filter((s) => (view === 'open' ? ['agreed', 'contacted', 'paid'].includes(s.status) : s.status === view)), [rows, view]);
  const month = kigaliToday().slice(0, 7);
  const count = (st: SignupStatus) => (rows ?? []).filter((s) => s.status === st).length;
  const paidMonth = (rows ?? []).filter((s) => s.paid_at && s.paid_at.slice(0, 7) === month).reduce((t, s) => t + Number(s.paid_amount ?? 0), 0);
  const selected = openId ? (rows ?? []).find((s) => s.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
      <PageHeader icon={Paintbrush} title="Branding sign-ups" subtitle="Non-Insider drivers who agreed to branding or our device on a Call Center call. Contact them, record the payment, then mark completed once the car is branded and the device installed."
        actions={<Link to="/call-center/trip-calls" className="btn-secondary">Calls after trips</Link>} />
      <StatGrid cols={4}>
        <StatCard icon={Phone} label="To contact" value={count('agreed')} tone={count('agreed') ? 'danger' : undefined} sub="Agreed on the call, not contacted yet" />
        <StatCard icon={CalendarDays} label="Waiting for payment" value={count('contacted')} />
        <StatCard icon={Wallet} label="Paid, to install" value={count('paid')} tone={count('paid') ? 'attention' : undefined} sub={`${rwf(paidMonth)} paid this month`} />
        <StatCard icon={BadgeCheck} label="Completed" value={count('completed')} tone="success" sub={`${count('cancelled')} not going ahead`} />
      </StatGrid>
      <UnderlineTabs value={view} onChange={setView} tabs={[
        { key: 'open', label: 'Open', count: count('agreed') + count('contacted') + count('paid') },
        { key: 'agreed', label: 'Agreed', count: count('agreed'), tone: 'danger' }, { key: 'contacted', label: 'Contacted', count: count('contacted') },
        { key: 'paid', label: 'Paid', count: count('paid') }, { key: 'completed', label: 'Completed', count: count('completed') }, { key: 'cancelled', label: 'Not going ahead', count: count('cancelled') },
      ]} />

      {!rows ? <div className="h-32 skeleton rounded-card" /> : list.length === 0
        ? <EmptyState icon={CheckCircle2} title="Nothing here" body="A sign-up appears the moment a driver says yes on a Call Center call after a trip." />
        : (
          <div className="space-y-2">
            {list.map((s) => (
              <div key={s.id} className={`card p-3 ${s.id === openId ? 'ring-2 ring-brand' : ''}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <button className="flex-1 min-w-[220px] text-left" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('s', s.id); return n; }, { replace: true })}>
                    <p className="font-semibold">{s.driver_name} <span className="font-mono text-caption text-fg-muted ml-1">{s.vehicle_plate ?? ''}</span></p>
                    <p className="text-caption text-fg-muted">{wantsLabel(s)} · {rwf(s.price)} · agreed {at(s.created_at)}{s.agent_id ? ` with ${names[s.agent_id] ?? '—'}` : ''}</p>
                    <p className="mt-1 flex flex-wrap gap-1 items-center">
                      <Label tone={SIGNUP_STATUS[s.status].tone}>{SIGNUP_STATUS[s.status].label}</Label>
                      {s.appointment_date && s.status !== 'completed' && <Label tone="info" icon={CalendarDays}>{day(s.appointment_date)}</Label>}
                      {s.paid_amount ? <Label tone="accent" icon={Coins}>{rwf(s.paid_amount)} paid</Label> : null}
                      <span className="text-caption text-fg-muted">{s.status === 'cancelled' ? s.cancelled_reason : SIGNUP_STATUS[s.status].next}</span>
                    </p>
                  </button>
                  {s.driver_phone && <a href={`tel:${s.driver_phone}`} className="btn-secondary h-8"><Phone size={13} /> {s.driver_phone}</a>}
                  {canAct && !['completed', 'cancelled'].includes(s.status) && (
                    <div className="flex flex-wrap gap-1.5">
                      {s.status === 'agreed' && <button className="btn-secondary h-8" onClick={() => setActing({ s, action: 'contacted' })}>Contacted</button>}
                      {s.status !== 'paid' && <button className="btn-secondary h-8" onClick={() => setActing({ s, action: 'paid' })}>Paid</button>}
                      <button className="btn-primary h-8" onClick={() => setActing({ s, action: 'completed' })}>Completed</button>
                      <button className="btn-ghost h-8" onClick={() => setActing({ s, action: 'note' })}>Note</button>
                      <button className="btn-ghost h-8 text-danger" onClick={() => setActing({ s, action: 'cancel' })}>Not going ahead</button>
                    </div>
                  )}
                </div>
                {s.id === openId && (
                  <div className="mt-3 border-t border-line-muted pt-2">
                    {s.notes && <p className="text-small mb-2"><b>From the call:</b> {s.notes}</p>}
                    <ul className="space-y-1">
                      {[...s.history].reverse().map((h, i) => (
                        <li key={i} className="text-caption"><span className="text-fg-muted">{at(h.at)} · {h.by_name ?? '—'}</span> · <b>{ACTION_LABEL[h.action] ?? h.action}</b>
                          {h.amount ? ` · ${rwf(h.amount)}${h.account ? ` (${ACCOUNTS.find(([k]) => k === h.account)?.[1] ?? h.account})` : ''}` : ''}{h.appointment ? ` · date ${day(h.appointment)}` : ''}{h.note ? ` · ${h.note}` : ''}</li>
                      ))}
                    </ul>
                    {s.finance_transaction_id && <Link to="/finance/ledger" className="link text-caption">Payment in the Finance ledger</Link>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      {selected && !list.includes(selected) && <p className="text-caption text-fg-muted">The sign-up you opened is in the "{SIGNUP_STATUS[selected.status].label}" tab.</p>}
      {acting && <ActModal s={acting.s} action={acting.action} onClose={() => setActing(null)} onSaved={() => { setActing(null); load(); }} />}
    </div>
  );
}

function ActModal({ s, action, onClose, onSaved }: { s: BrandingSignup; action: 'contacted' | 'paid' | 'completed' | 'cancel' | 'note'; onClose: () => void; onSaved: () => void }) {
  const today = kigaliToday();
  const needsPay = action === 'paid' || (action === 'completed' && s.status !== 'paid');
  const [note, setNote] = useState('');
  const [appointment, setAppointment] = useState(s.appointment_date ?? '');
  const [amount, setAmount] = useState(String(s.price));
  const [account, setAccount] = useState('momo');
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const title = { contacted: 'Contacted the driver', paid: 'Record the payment', completed: 'Mark completed', cancel: 'Not going ahead', note: 'Add a note' }[action];
  const save = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('update_branding_signup', {
      p_id: s.id, p_action: action, p_note: note || null, p_appointment: appointment || null,
      p_amount: needsPay ? Number(amount.replace(/[^\d]/g, '')) : null, p_account: needsPay ? account : null, p_date: needsPay ? date : null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title={title} subtitle={`${s.driver_name} · ${s.vehicle_plate ?? 'no plate'} · ${wantsLabel(s)} · ${rwf(s.price)}`} maxWidth="max-w-md">
      <div className="space-y-3 text-small">
        {(action === 'contacted' || action === 'note') && <label className="block"><span className="text-caption font-semibold text-fg-muted">Date agreed for the work</span>
          <input type="date" className="input w-full mt-1" value={appointment} min={today} onChange={(e) => setAppointment(e.target.value)} /></label>}
        {needsPay && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-caption font-semibold text-fg-muted">Amount paid (RWF)</span>
                <input className="input w-full mt-1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label className="block"><span className="text-caption font-semibold text-fg-muted">Paid on</span>
                <input type="date" className="input w-full mt-1" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
            </div>
            <label className="block"><span className="text-caption font-semibold text-fg-muted">Into</span>
              <select className="input w-full mt-1" value={account} onChange={(e) => setAccount(e.target.value)}>{ACCOUNTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <p className="text-caption text-fg-muted">Recorded in the Finance ledger as income, checked, for the MD to approve.</p>
          </>
        )}
        {action === 'completed' && <p className="text-caption">The car is marked {[s.wants_branding && 'branded', s.wants_device && 'with our device installed'].filter(Boolean).join(' and ')} in Branding & devices, and the Call Center stops calling this driver about it.</p>}
        <label className="block"><span className="text-caption font-semibold text-fg-muted">{action === 'cancel' ? 'Why not? *' : 'Note'}</span>
          <textarea className="input w-full mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === 'contacted' ? 'e.g. Pays Monday by MoMo, comes Tuesday 10:00' : ''} /></label>
        {err && <p className="text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={busy || (action === 'cancel' && note.trim().length < 3) || (action === 'note' && note.trim().length < 2)} className="btn-primary">{busy && <Loader2 size={14} className="animate-spin" />} Save</button>
        </div>
      </div>
    </Modal>
  );
}
