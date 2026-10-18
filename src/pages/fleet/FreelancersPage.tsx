import { useMemo, useState } from 'react';
import { Check, Plus, UserPlus, Users2, Wallet, X, AlertTriangle, CarFront } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { computeDepositStanding, useFleetData } from '../../lib/fleet';
import { FREELANCE_TARGET, FREELANCER_STATUS, Freelancer, FreelanceShift, SHIFT_LABEL, SHIFT_STATUS, useFreelance } from '../../lib/freelance';
import { kigaliToday } from '../../lib/meetings';
import { addDays } from '../../lib/it';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import Modal from '../../components/Modal';

// Freelance drivers: the pool that covers a shift the same day a driver
// doesn't pay or leaves, so no car loses a shift. Target 30,000 per shift;
// the freelancer keeps what they make above it.

const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const td = 'px-3 py-2';

export default function FreelancersPage() {
  usePageTitle('Freelance drivers');
  const a = useAccess();
  const fl = useFreelance();
  const fleet = useFleetData();
  const t = kigaliToday();
  const [adding, setAdding] = useState<Freelancer | 'new' | null>(null);
  const [assign, setAssign] = useState<{ vehicle_id?: string; covering_driver_id?: string; shift?: FreelanceShift['shift'] } | null>(null);
  const [pay, setPay] = useState<FreelanceShift | null>(null);
  const canEdit = a.isMd || a.dept === 'fleet' || a.dept === 'finance';
  const plate = (id: string) => fleet.vehicles.find((v) => v.id === id)?.plate_number ?? '—';
  const driverName = (id: string | null) => (id ? fleet.drivers.find((d) => d.id === id)?.full_name ?? '—' : '—');
  const fname = (id: string) => fl.freelancers.find((f) => f.id === id)?.full_name ?? '—';

  // Seats that need cover today: drivers not cleared to drive (unpaid week).
  const needCover = useMemo(() => {
    if (fleet.loading) return [];
    const byDriver = new Map<string, typeof fleet.deposits>();
    for (const d of fleet.deposits) byDriver.set(d.driver_id, [...(byDriver.get(d.driver_id) ?? []), d]);
    return fleet.drivers.filter((d) => d.contract_status === 'active' && d.vehicle_id && d.start_date && d.start_date <= t)
      .map((d) => ({ d, s: computeDepositStanding(d, byDriver.get(d.id) ?? [], t) }))
      .filter((x) => x.s.ruleInForce && !x.s.isCleared && !x.s.pausedToday)
      .filter((x) => !fl.shifts.some((s) => s.day === t && s.vehicle_id === x.d.vehicle_id && s.covering_driver_id === x.d.id && s.status !== 'cancelled'));
  }, [fleet.loading, fleet.drivers, fleet.deposits, fl.shifts, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = fl.shifts.filter((s) => s.day === t && s.status !== 'cancelled');
  const week = fl.shifts.filter((s) => s.day >= addDays(t, -6) && s.status !== 'cancelled');
  const paidOf = (list: FreelanceShift[]) => list.reduce((n, s) => n + Number(s.paid_amount ?? 0), 0);
  const stats = (id: string) => { const mine = fl.shifts.filter((s) => s.freelancer_id === id && s.status !== 'cancelled'); return { n: mine.length, paid: paidOf(mine), noShow: mine.filter((s) => s.status === 'no_show').length, last: mine[0]?.day ?? null }; };
  const noShow = (s: FreelanceShift) => supabase.from('freelance_shifts').update({ status: 'no_show' }).eq('id', s.id).then(() => fl.reload());
  const confirm = (s: FreelanceShift) => supabase.from('freelance_shifts').update({ confirmed_at: new Date().toISOString() }).eq('id', s.id).then(() => fl.reload());

  return (
    <div className="animate-fade-in">
      <PageHeader icon={UserPlus} title="Freelance drivers" subtitle="When a driver doesn't pay or leaves, a freelancer covers the shift the same day: 30,000 to Kivu Ride, the rest is theirs. No car loses a shift while we find a full driver."
        actions={canEdit && <><button onClick={() => setAdding('new')} className="btn-secondary"><Plus size={14} /> Add a freelancer</button><button onClick={() => setAssign({})} className="btn-primary"><CarFront size={14} /> Assign a shift</button></>} />
      <StatGrid cols={4}>
        <StatCard icon={Users2} label="Available now" value={fl.freelancers.filter((f) => f.status === 'available').length} sub={`${fl.freelancers.filter((f) => f.status !== 'inactive').length} in the pool`} tone={fl.freelancers.filter((f) => f.status === 'available').length < 2 ? 'attention' : undefined} />
        <StatCard icon={CarFront} label="Shifts covered this week" value={week.length} sub={`${today.length} today`} />
        <StatCard icon={Wallet} label="Collected this week" value={rwf(paidOf(week))} sub={`target ${rwf(week.length * FREELANCE_TARGET)}`} />
        <StatCard icon={AlertTriangle} label="Short or no-show (week)" value={week.filter((s) => s.status === 'short' || s.status === 'no_show').length} tone={week.some((s) => s.status === 'no_show') ? 'danger' : undefined} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Box title={`Seats to cover today (${needCover.length})`} icon={AlertTriangle} padded={false}>
          {needCover.length ? <ul className="divide-y divide-line-muted">{needCover.map(({ d, s }) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-small">
              <span className="flex-1"><b>{plate(d.vehicle_id!)}</b> · {SHIFT_LABEL[(d.shift ?? 'day') as FreelanceShift['shift']] ?? d.shift} · {d.full_name} not cleared ({rwf(s.owedNow)} due)</span>
              {canEdit && <button onClick={() => setAssign({ vehicle_id: d.vehicle_id!, covering_driver_id: d.id, shift: (d.shift === 'full' ? 'full' : d.shift === 'night' ? 'night' : 'day') })} className="btn-primary h-7">Assign a freelancer</button>}
            </li>
          ))}</ul> : <p className="p-5 text-small text-fg-muted">{fleet.loading ? 'Checking…' : 'Every driver on the road today has paid. Nothing to cover.'}</p>}
        </Box>
        <Box title={`Today's freelance shifts (${today.length})`} icon={CarFront} padded={false}>
          {today.length ? <ul className="divide-y divide-line-muted">{today.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-small">
              <span className="flex-1"><b>{plate(s.vehicle_id)}</b> · {SHIFT_LABEL[s.shift]} · {fname(s.freelancer_id)}{s.covering_driver_id ? <span className="text-caption text-fg-muted"> for {driverName(s.covering_driver_id)}</span> : null}</span>
              <Label tone={SHIFT_STATUS[s.status].tone}>{SHIFT_STATUS[s.status].label}{s.paid_amount !== null ? ` · ${rwf(Number(s.paid_amount))}` : ''}</Label>
              {canEdit && s.status === 'planned' && <><button onClick={() => setPay(s)} className="btn-primary h-7">Record payment</button><button onClick={() => noShow(s)} className="btn-ghost h-7 text-caption">No show</button></>}
              {(a.isMd || a.dept === 'finance') && (s.status === 'paid' || s.status === 'short') && !s.confirmed_at && <button onClick={() => confirm(s)} className="btn-secondary h-7"><Check size={12} /> Confirm received</button>}
              {s.confirmed_at && <span className="text-caption text-success">confirmed</span>}
            </li>
          ))}</ul> : <p className="p-5 text-small text-fg-muted">No freelancer on the road today.</p>}
        </Box>
      </div>

      <Box title="The pool" icon={Users2} padded={false} className="mb-4">
        <div className="overflow-x-auto"><table className="w-full text-small min-w-[720px]">
          <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Freelancer', 'Phone', 'Status', 'Shifts', 'Paid to us', 'Average', 'No-shows', 'Last shift', ''].map((h) => <th key={h} className={td}>{h}</th>)}</tr></thead>
          <tbody>{fl.freelancers.map((f) => { const x = stats(f.id); return (
            <tr key={f.id} className="border-t border-line-muted">
              <td className={`${td} font-medium`}>{f.full_name}</td><td className={td}>{f.phone}</td><td className={td}><Label tone={FREELANCER_STATUS[f.status].tone}>{FREELANCER_STATUS[f.status].label}</Label></td>
              <td className={`${td} tabular-nums`}>{x.n}</td><td className={`${td} tabular-nums`}>{rwf(x.paid)}</td><td className={`${td} tabular-nums`}>{x.n ? rwf(x.paid / x.n) : '—'}</td>
              <td className={`${td} tabular-nums ${x.noShow ? 'text-danger' : ''}`}>{x.noShow}</td><td className={td}>{x.last ?? '—'}</td>
              <td className={td}>{canEdit && <button onClick={() => setAdding(f)} className="btn-ghost text-caption">Edit</button>}</td>
            </tr>
          ); })}</tbody>
        </table></div>
        {!fl.freelancers.length && <p className="p-5 text-small text-fg-muted">The pool is empty. Add the freelancers you can call on short notice.</p>}
      </Box>

      <Box title="Recent shifts" icon={CarFront} padded={false}>
        <div className="overflow-x-auto"><table className="w-full text-small min-w-[720px]">
          <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Day', 'Car', 'Shift', 'Freelancer', 'Covering for', 'Paid', 'Status'].map((h) => <th key={h} className={td}>{h}</th>)}</tr></thead>
          <tbody>{fl.shifts.slice(0, 60).map((s) => (
            <tr key={s.id} className="border-t border-line-muted"><td className={td}>{s.day}</td><td className={td}>{plate(s.vehicle_id)}</td><td className={td}>{SHIFT_LABEL[s.shift]}</td><td className={td}>{fname(s.freelancer_id)}</td><td className={td}>{driverName(s.covering_driver_id)}</td>
              <td className={`${td} tabular-nums`}>{s.paid_amount !== null ? rwf(Number(s.paid_amount)) : '—'}</td><td className={td}><Label tone={SHIFT_STATUS[s.status].tone}>{SHIFT_STATUS[s.status].label}</Label></td></tr>
          ))}</tbody>
        </table></div>
      </Box>

      {adding && <FreelancerModal freelancer={adding === 'new' ? null : adding} onClose={() => setAdding(null)} onDone={fl.reload} />}
      {assign && <AssignModal init={assign} freelancers={fl.freelancers.filter((f) => f.status !== 'inactive')} vehicles={fleet.vehicles.filter((v) => v.operation_start_date)} drivers={fleet.drivers.filter((d) => d.contract_status === 'active')} onClose={() => setAssign(null)} onDone={fl.reload} />}
      {pay && <PayModal shift={pay} onClose={() => setPay(null)} onDone={fl.reload} />}
    </div>
  );
}

function FreelancerModal({ freelancer, onClose, onDone }: { freelancer: Freelancer | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ full_name: freelancer?.full_name ?? '', phone: freelancer?.phone ?? '', id_number: freelancer?.id_number ?? '', licence_number: freelancer?.licence_number ?? '', status: freelancer?.status ?? 'available', notes: freelancer?.notes ?? '' });
  const [error, setError] = useState('');
  const save = async () => {
    if (!f.full_name.trim() || !f.phone.trim()) { setError('Name and phone are needed.'); return; }
    const row = { full_name: f.full_name.trim(), phone: f.phone.trim(), id_number: f.id_number.trim() || null, licence_number: f.licence_number.trim() || null, status: f.status, notes: f.notes.trim() || null, updated_at: new Date().toISOString() };
    const res = freelancer ? await supabase.from('freelance_drivers').update(row).eq('id', freelancer.id) : await supabase.from('freelance_drivers').insert(row);
    if (res.error) { setError(res.error.message); return; }
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={freelancer ? freelancer.full_name : 'Add a freelancer'} maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className="text-caption text-fg-muted">Full name *</span><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="input" autoFocus /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-caption text-fg-muted">Phone *</span><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Status</span><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Freelancer['status'] })} className="input"><option value="available">Available</option><option value="busy">On a shift</option><option value="inactive">Inactive</option></select></label>
          <label className="block"><span className="text-caption text-fg-muted">ID number</span><input value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Driving licence</span><input value={f.licence_number} onChange={(e) => setF({ ...f, licence_number: e.target.value })} className="input" /></label>
        </div>
        <label className="block"><span className="text-caption text-fg-muted">Notes</span><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="input" /></label>
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={save} className="btn-primary">Save</button></div>
      </div>
    </Modal>
  );
}

function AssignModal({ init, freelancers, vehicles, drivers, onClose, onDone }: { init: { vehicle_id?: string; covering_driver_id?: string; shift?: FreelanceShift['shift'] }; freelancers: Freelancer[]; vehicles: { id: string; plate_number: string }[]; drivers: { id: string; full_name: string; vehicle_id: string | null }[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ day: kigaliToday(), vehicle_id: init.vehicle_id ?? '', shift: init.shift ?? 'day' as FreelanceShift['shift'], freelancer_id: '', covering_driver_id: init.covering_driver_id ?? '', target: String(FREELANCE_TARGET), note: '' });
  const [error, setError] = useState('');
  const save = async () => {
    if (!f.vehicle_id || !f.freelancer_id) { setError('Choose the car and the freelancer.'); return; }
    const { error: err } = await supabase.from('freelance_shifts').insert({ day: f.day, vehicle_id: f.vehicle_id, shift: f.shift, freelancer_id: f.freelancer_id, covering_driver_id: f.covering_driver_id || null, target: Number(f.target) || FREELANCE_TARGET, note: f.note.trim() || null });
    if (err) { setError(err.message.includes('duplicate') ? 'This car already has a freelancer for that shift.' : err.message); return; }
    await supabase.from('freelance_drivers').update({ status: 'busy' }).eq('id', f.freelancer_id);
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Assign a freelance shift" subtitle="The freelancer takes the car for the shift and pays the target; what they make above it is theirs." maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-caption text-fg-muted">Day</span><input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} className="input" /></label>
          <label className="block"><span className="text-caption text-fg-muted">Shift</span><select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value as FreelanceShift['shift'] })} className="input"><option value="day">Day</option><option value="night">Night</option><option value="full">Day & night</option></select></label>
          <label className="block"><span className="text-caption text-fg-muted">Car *</span><select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })} className="input"><option value="">Choose…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}</select></label>
          <label className="block"><span className="text-caption text-fg-muted">Freelancer *</span><select value={f.freelancer_id} onChange={(e) => setF({ ...f, freelancer_id: e.target.value })} className="input"><option value="">Choose…</option>{freelancers.map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.status === 'busy' ? ' (on a shift)' : ''}</option>)}</select></label>
          <label className="block col-span-2"><span className="text-caption text-fg-muted">Covering for</span><select value={f.covering_driver_id} onChange={(e) => setF({ ...f, covering_driver_id: e.target.value })} className="input"><option value="">An empty seat</option>{drivers.filter((d) => !f.vehicle_id || d.vehicle_id === f.vehicle_id).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
          <label className="block"><span className="text-caption text-fg-muted">Target (RWF)</span><input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value.replace(/[^\d]/g, '') })} className="input" inputMode="numeric" /></label>
        </div>
        <label className="block"><span className="text-caption text-fg-muted">Note</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="input" /></label>
        {!freelancers.length && <p className="text-caption text-attention">Add freelancers to the pool first.</p>}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost">Cancel</button><button onClick={save} className="btn-primary">Assign</button></div>
      </div>
    </Modal>
  );
}

function PayModal({ shift, onClose, onDone }: { shift: FreelanceShift; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(shift.target));
  const [method, setMethod] = useState<'momo' | 'cash' | 'bank'>('momo');
  const [error, setError] = useState('');
  const save = async () => {
    const { error: err } = await supabase.from('freelance_shifts').update({ paid_amount: Number(amount) || 0, payment_method: method }).eq('id', shift.id);
    if (err) { setError(err.message); return; }
    await supabase.from('freelance_drivers').update({ status: 'available' }).eq('id', shift.freelancer_id);
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Record the freelancer's payment" maxWidth="max-w-sm">
      <div className="space-y-3">
        <label className="block"><span className="text-caption text-fg-muted">Paid (RWF) — target {Number(shift.target).toLocaleString('en-US')}</span><input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} className="input" inputMode="numeric" autoFocus /></label>
        <div className="flex gap-1.5">{(['momo', 'cash', 'bank'] as const).map((m) => <button key={m} type="button" onClick={() => setMethod(m)} className={`px-2.5 py-1 rounded-full text-caption border ${method === m ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line text-fg-muted'}`}>{m === 'momo' ? 'MoMo' : m === 'cash' ? 'Cash' : 'Bank'}</button>)}</div>
        {Number(amount) < Number(shift.target) && <p className="text-caption text-attention">Below the target: it will show as paid short.</p>}
        {error && <p className="text-caption text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted"><button onClick={onClose} className="btn-ghost"><X size={13} /> Cancel</button><button onClick={save} className="btn-primary"><Check size={13} /> Save</button></div>
      </div>
    </Modal>
  );
}
