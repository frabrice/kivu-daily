import { useState } from 'react';
import { Trash2, Flag, Pencil, CalendarDays, Sun, Moon, SunMoon, BedDouble, FileText, UserX, ArrowRightLeft } from 'lucide-react';
import { supabase, Driver, DriverShift, DriverStage, Vehicle, DriverModel, DriverRestDay, DriverDocument, PaymentDay } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo, todayStr } from '../../lib/utils';
import { effectiveStage, MANUAL_STAGES, REST_DAYS, availableForReplacement, formatRwf, formatDateLabelSafe, shiftLabel, driverShiftShort, carSeats, seatFree, DRIVER_MODELS, modelWeekly } from '../../lib/fleet';
import Modal from '../Modal';
import DateInput from '../DateInput';
import SearchableSelect from '../SearchableSelect';
import FlagToITDrawer from '../FlagToITDrawer';
import VehicleDrawer from './VehicleDrawer';
import DriverDocumentsSection from './DriverDocumentsSection';
import { LegalDocFields } from '../legal/LegalDocFields';
import { LegalDraft, draftError, emptyDraft, uploadDraft, useLegalDocs } from '../../lib/legalDocs';
import { KIND_LABEL, OtherMoney, linkOtherMoney, nameMatch, useOtherMoney } from '../../lib/otherMoney';

// Editing only - clicking a driver on the Pipeline now opens the full
// DriverProfilePage instead of a view mode here; this drawer's only job
// is Add Driver and the pencil-triggered edit form.
export default function DriverDrawer({
  driver,
  startEditing,
  vehicles,
  drivers,
  driverDocuments,
  canEdit,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  startEditing: boolean;
  vehicles: Vehicle[];
  drivers: Driver[];
  driverDocuments: DriverDocument[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [fullName, setFullName] = useState(driver?.full_name ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [email, setEmail] = useState(driver?.email ?? '');
  const [startDate, setStartDate] = useState(driver?.start_date ?? todayStr());
  const [initialDepositPaid, setInitialDepositPaid] = useState(driver?.initial_deposit_paid ?? false);
  const [initialDepositDate, setInitialDepositDate] = useState(driver?.initial_deposit_date ?? '');
  const [initialDepositAmount, setInitialDepositAmount] = useState(driver?.initial_deposit_amount ? String(driver.initial_deposit_amount) : String(modelWeekly(driver?.model ?? 'one_shift')));
  const [stage, setStage] = useState<DriverStage>(driver ? effectiveStage(driver) : 'applying');
  const [notes, setNotes] = useState(driver?.notes ?? '');
  const [vehicleId, setVehicleId] = useState(driver?.vehicle_id ?? '');
  // One shift: 'day' or 'night' on a car; a whole-car model is always 'full'.
  const [shift, setShift] = useState<'day' | 'night' | ''>(driver?.shift === 'day' || driver?.shift === 'night' ? driver.shift : '');
  const [model, setModel] = useState<DriverModel>(driver?.model ?? 'one_shift');
  const [restDay, setRestDay] = useState<DriverRestDay | ''>(driver?.rest_day ?? '');
  const [paymentDay, setPaymentDay] = useState<PaymentDay | ''>(driver?.payment_day ?? '');
  const [replacedDriverId, setReplacedDriverId] = useState(driver?.replaced_driver_id ?? '');
  // Collateral (MD, 27 Nov 2026): security money held, never counted as paying for days.
  const [collateralAmount, setCollateralAmount] = useState(driver?.collateral_amount ? String(driver.collateral_amount) : '');
  const [collateralDate, setCollateralDate] = useState(driver?.collateral_date ?? '');
  // Money already recorded under Deposits -> Record other money for this
  // person: connected here so it is counted once (as their start deposit,
  // a payment, or their collateral), never again as "not in the system".
  const { items: otherMoney } = useOtherMoney();
  const [picked, setPicked] = useState<string[]>([]);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [depositMethod, setDepositMethod] = useState<'momo' | 'bank'>('momo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  // A car whose seat is taken can still be picked (MD, 27 Nov 2026): Kivu
  // Daily asks whether to replace the driver on it, and whether to move them
  // to another car. If not moved, they stay with no car.
  const [replacing, setReplacing] = useState<string[]>([]);
  const [moves, setMoves] = useState<Record<string, { vehicleId: string; shift: DriverShift }>>({});
  const [ask, setAsk] = useState<{ seat: DriverShift; ids: string[] } | null>(null);
  // A driver put on a car must have their signed and stamped contract on
  // file for this contract (MD, 15 Oct 2026). The id is fixed up front so
  // the file and the driver are saved under the same id.
  const [driverId] = useState(() => driver?.id ?? crypto.randomUUID());
  const [inserted, setInserted] = useState(false);
  const [contract, setContract] = useState<LegalDraft>(emptyDraft(todayStr()));
  const { docs: legalDocs } = useLegalDocs();
  const hasContract = legalDocs.some((x) => x.driver_id === driverId && x.kind === 'driver_contract' && (!x.period_start || x.period_start === startDate));
  const needContract = editing && !!vehicleId && !!startDate && driver?.contract_status !== 'ended' && !hasContract;
  // Optional (MD, 23 Nov 2026): the car can be linked without it; it then
  // shows under Admin -> Missing. Only a contract that is attached is checked.
  const withContract = needContract && !!contract.file;

  const replacementOptions = availableForReplacement(drivers, driver?.id).map((d) => ({ id: d.id, label: d.full_name, sublabel: d.phone }));
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  // The drivers as they will be after this save: anyone being replaced is
  // off this car (on the car they are moved to, or on none).
  const pool = drivers.map((d) => (replacing.includes(d.id) ? { ...d, vehicle_id: moves[d.id]?.vehicleId ?? null, shift: moves[d.id]?.shift ?? null } : d));
  const byId = (id: string) => drivers.find((d) => d.id === id);
  // A car has a day seat and a night seat; a driver on both shifts takes the whole car.
  const seats = vehicleId ? carSeats(vehicleId, pool, driver?.id) : null;
  // Who sits where this driver wants to go.
  const sittingOn = (seat: DriverShift): Driver[] => {
    if (!seats) return [];
    const list = seat === 'full' ? [seats.day, seats.night] : [seats[seat]];
    return [...new Map(list.filter((d): d is Driver => !!d).map((d) => [d.id, d])).values()];
  };
  const pickCar = (id: string) => { setVehicleId(id); setShift(''); setReplacing([]); setMoves({}); setAsk(null); };
  const confirmReplace = () => {
    if (!ask) return;
    setReplacing((r) => [...new Set([...r, ...ask.ids])]);
    if (ask.seat !== 'full') setShift(ask.seat);
    setAsk(null);
  };
  const carLabel = (v: Vehicle) => `${v.plate_number}${v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}`;
  // Cars a replaced driver can be moved to: a free seat that fits how they drive.
  const moveOptions = (d: Driver) => vehicles.filter((v) => v.id !== vehicleId).flatMap((v) => (
    d.shift === 'full'
      ? (seatFree(v.id, 'full', pool, d.id) ? [{ value: `${v.id}|full`, label: `${carLabel(v)} (whole car)` }] : [])
      : (['day', 'night'] as const).filter((sh) => seatFree(v.id, sh, pool, d.id)).map((sh) => ({ value: `${v.id}|${sh}`, label: `${carLabel(v)} · ${shiftLabel(sh)}` }))
  ));
  const setMove = (id: string, value: string) => setMoves((m) => {
    const next = { ...m };
    if (!value) delete next[id];
    else { const [vid, sh] = value.split('|'); next[id] = { vehicleId: vid, shift: sh as DriverShift }; }
    return next;
  });
  const terms = DRIVER_MODELS[model];
  const weekly = modelWeekly(model);
  // Once a contract has started, its model changes with "Change model" on the
  // driver's page (or a renewal), so the days before keep their terms (rate_history).
  const modelLocked = !!driver?.start_date && driver.start_date <= todayStr();
  const wholeCarFree = !!vehicleId && seatFree(vehicleId, 'full', pool, driver?.id);
  const pickModel = (m: DriverModel) => {
    // Keep the upfront amount in step with the model unless someone typed their own.
    if (!initialDepositAmount || (Object.keys(DRIVER_MODELS) as DriverModel[]).some((k) => String(modelWeekly(k)) === initialDepositAmount)) setInitialDepositAmount(String(modelWeekly(m)));
    setModel(m);
  };

  const waiting = otherMoney.filter((m) => !m.driver_id);
  const scored = waiting.map((m) => ({ m, score: fullName.trim() ? nameMatch(m.payer_name, fullName) : 0 }))
    .sort((a, b) => b.score - a.score || b.m.received_on.localeCompare(a.m.received_on));
  const matches = scored.filter((x) => x.score > 0 || picked.includes(x.m.id));
  const shownWaiting = showAllWaiting ? scored : matches;
  const pickedRows = waiting.filter((m) => picked.includes(m.id));
  const pickedDeposits = pickedRows.filter((m) => m.kind === 'deposit');
  const pickedCollateral = pickedRows.filter((m) => m.kind === 'collateral');
  const total = (rs: OtherMoney[]) => rs.reduce((t, m) => t + Number(m.amount), 0);
  const earliest = (rs: OtherMoney[]) => rs.map((m) => m.received_on).sort()[0] ?? '';
  // A driver who already has a start deposit saved: connected deposits are logged as payments instead.
  const depositsAsPayments = !!driver?.initial_deposit_paid;
  const togglePick = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    const rows = waiting.filter((m) => next.includes(m.id));
    const dep = rows.filter((m) => m.kind === 'deposit');
    const col = rows.filter((m) => m.kind === 'collateral');
    const m = waiting.find((x) => x.id === id);
    if (m?.kind === 'deposit' && !depositsAsPayments) {
      setInitialDepositPaid(dep.length > 0);
      setInitialDepositAmount(dep.length ? String(total(dep)) : String(modelWeekly(model)));
      setInitialDepositDate(dep.length ? earliest(dep) : '');
    }
    if (m?.kind === 'collateral') {
      const had = Number(driver?.collateral_amount ?? 0);
      setCollateralAmount(col.length ? String(total(col) + had) : (had ? String(had) : ''));
      const first = [earliest(col), driver?.collateral_date ?? ''].filter(Boolean).sort()[0] ?? '';
      setCollateralDate(col.length ? first : (driver?.collateral_date ?? ''));
    }
  };

  const save = async () => {
    if (!fullName.trim() || !phone.trim()) return;
    if (Number(collateralAmount) > 0 && !collateralDate) { setError('Enter the date the collateral was received.'); return; }
    if (vehicleId && !terms.wholeCar && !shift) {
      setError('Pick the day or the night shift for this driver on the car.');
      return;
    }
    if (vehicleId && terms.wholeCar && !wholeCarFree) {
      setError(`${terms.label} needs the car to itself, and another driver is on it.`);
      return;
    }
    if (initialDepositPaid && !initialDepositDate) {
      setError('Enter the date the initial deposit was paid.');
      return;
    }
    if (initialDepositPaid && !Number(initialDepositAmount)) {
      setError('Enter how much the initial deposit was.');
      return;
    }
    if (terms.restDay && !restDay) {
      setError('Every driver on this model must be assigned a weekly rest day.');
      return;
    }
    if (stage === 'active' && !vehicleId) {
      setError('Pick their car to make them Active. A driver without a car shows as Ready.');
      return;
    }
    if (withContract) {
      const cErr = draftError('driver_contract', contract);
      if (cErr) { setError(cErr); return; }
    }
    setSaving(true);
    setError('');
    const up = withContract ? await uploadDraft('driver_contract', driverId, contract) : null;
    if (up && 'error' in up) { setSaving(false); setError(up.error); return; }
    // First free the seat: whoever is being replaced moves to the car picked for them, or to none.
    for (const id of replacing) {
      const d = byId(id);
      if (!d || d.vehicle_id !== vehicleId) continue;
      const to = moves[id];
      const { error: mErr } = await supabase.from('drivers').update({
        vehicle_id: to?.vehicleId ?? null,
        shift: to?.shift ?? null,
        ...(!to && d.stage === 'active' ? { stage: 'ready' } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (mErr) { setSaving(false); setError(`Couldn't take ${d.full_name} off the car: ${mErr.message}`); return; }
    }
    const payload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      start_date: startDate || null,
      initial_deposit_paid: initialDepositPaid,
      initial_deposit_date: initialDepositPaid ? initialDepositDate : null,
      initial_deposit_amount: initialDepositPaid ? Number(initialDepositAmount) : null,
      stage,
      notes: notes.trim() || null,
      vehicle_id: vehicleId || null,
      shift: vehicleId ? (terms.wholeCar ? 'full' : shift || null) : null,
      rest_day: terms.restDay ? restDay || null : null,
      replaced_driver_id: replacedDriverId || null,
      ...((Number(collateralAmount) || null) !== (driver?.collateral_amount ?? null) || (collateralDate || null) !== (driver?.collateral_date ?? null)
        ? { collateral_amount: Number(collateralAmount) > 0 ? Number(collateralAmount) : null, collateral_date: Number(collateralAmount) > 0 ? collateralDate || null : null } : {}),
      // Sent only when it changed, so saving never depends on the column being there.
      ...(paymentDay !== (driver?.payment_day ?? '') ? { payment_day: paymentDay || null } : {}),
      updated_at: new Date().toISOString(),
      // Before the contract starts the model is free to change: its terms are the contract's first entry.
      ...(modelLocked ? {} : {
        model,
        rate_history: startDate ? [{ from: startDate, daily: terms.daily, model, rest_day: terms.restDay ? restDay || null : null }] : [],
      }),
    };
    const { error: err } = driver || inserted
      ? await supabase.from('drivers').update(payload).eq('id', driverId)
      : await supabase.from('drivers').insert({ ...payload, id: driverId, created_by: profile!.id });
    if (err) {
      setSaving(false);
      setError(err.message);
      return;
    }
    if (!driver) setInserted(true);
    if (picked.length) {
      // Connected deposits for a driver who already had a start deposit become payments.
      if (depositsAsPayments && pickedDeposits.length) {
        const { error: pErr } = await supabase.from('driver_deposits').insert(pickedDeposits.map((m) => ({
          driver_id: driverId, amount: Number(m.amount), paid_date: m.received_on, payment_method: depositMethod, created_by: profile!.id,
        })));
        if (pErr) { setSaving(false); onSaved(); setError(`The driver is saved, but the payments weren't logged: ${pErr.message}`); return; }
      }
      const lErr = await linkOtherMoney(driverId, picked);
      if (lErr) { setSaving(false); onSaved(); setError(`The driver is saved, but the money wasn't marked as connected: ${lErr}. Press save again.`); return; }
      setPicked([]);
    }
    if (up) {
      const { error: docErr } = await supabase.rpc('add_driver_document', { p_driver: driverId, p_kind: 'driver_contract', d: up.doc });
      if (docErr) {
        setSaving(false);
        onSaved();
        setError(`The driver is saved, but the contract wasn't: ${docErr.message}. Press save again, or add it from their page (Contract papers).`);
        return;
      }
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!driver) return;
    setSaving(true);
    await supabase.from('drivers').delete().eq('id', driver.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={driver ? driver.full_name : 'Add Driver'}
      subtitle={driver ? timeAgo(driver.updated_at) + ' updated' : undefined}
      maxWidth="max-w-lg"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Full Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} className="input" placeholder="Jean Baptiste" />
          </div>
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} className="input" placeholder="+250 7XX XXX XXX" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} className="input" placeholder="jean@example.com" />
          </div>
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted flex items-center gap-1"><CalendarDays size={11} /> Start Date</label>
            <DateInput value={startDate} onChange={setStartDate} disabled={!editing} />
          </div>
        </div>
        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value as DriverStage)} disabled={!editing} className="input">
            {MANUAL_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <p className={`text-micro mt-1 ${stage === 'active' && !vehicleId ? 'text-attention' : 'text-fg-subtle'}`}>
            {stage === 'active'
              ? (vehicleId ? 'Active: on the car below and driving.' : 'To be Active they need a car — pick it under Assigned Vehicle.')
              : 'A driver also becomes Active on their own once they have a car and a paid deposit.'}
          </p>
        </div>

        {!driver && (
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted">Replacing (optional)</label>
            <SearchableSelect
              options={replacementOptions}
              value={replacedDriverId}
              onChange={setReplacedDriverId}
              placeholder={replacementOptions.length === 0 ? 'No ended-contract drivers available' : 'Search ended-contract drivers…'}
              emptyLabel="No matching drivers"
              disabled={!editing}
            />
            <p className="text-micro text-fg-subtle mt-1">If this driver is replacing someone whose contract ended, pick them here. They'll no longer show up here once picked.</p>
          </div>
        )}

        <div>
          <p className="block text-caption font-medium mb-1.5 text-fg-muted">Model <span className="text-red-500">*</span></p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(DRIVER_MODELS) as DriverModel[]).map((k) => {
              const m = DRIVER_MODELS[k];
              return (
                <button key={k} type="button" disabled={!editing || modelLocked} onClick={() => pickModel(k)} aria-pressed={model === k}
                  className={`p-2 rounded-lg border text-left text-caption disabled:cursor-not-allowed ${model === k ? 'border-brand bg-brand/10' : 'border-line disabled:opacity-40'}`}>
                  <span className="block font-medium">{m.label}</span>
                  <span className="block text-micro text-fg-subtle mt-0.5">{formatRwf(modelWeekly(k))}/week · {m.restDay ? '6 days' : '7 days'}{m.salary ? '' : ' · no salary'}</span>
                </button>
              );
            })}
          </div>
          <p className="text-micro text-fg-subtle mt-1">
            {modelLocked ? 'The contract has started: change the model with “Change model” on the driver’s page, so past days keep their terms.'
              : `${terms.label}: ${formatRwf(terms.daily)} a ${terms.restDay ? 'working day, one rest day free' : 'day, every day'}${terms.wholeCar ? ', the car alone' : ', sharing the car (day or night)'}${terms.salary ? `, salary ${formatRwf(terms.salary)} a month` : ', no monthly salary'}.`}
          </p>
        </div>

        {terms.restDay ? (
          <div className={`p-2.5 rounded-lg border space-y-2 ${restDay ? 'border-indigo-300 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/5' : 'border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'}`}>
            <label className="block text-caption font-medium mb-1.5 flex items-center gap-1"><BedDouble size={11} /> Weekly Rest Day <span className="text-red-500">*</span></label>
            <select value={restDay} onChange={(e) => setRestDay(e.target.value as DriverRestDay)} disabled={!editing || modelLocked} className="input">
              <option value="">Select a day…</option>
              {REST_DAYS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <p className="text-micro text-fg-subtle">{modelLocked ? 'To change it, use “Change model” on the driver’s page.' : `Every driver on ${terms.label.toLowerCase()} has one fixed day off each week.`}</p>
          </div>
        ) : (
          <p className="p-2.5 rounded-lg border border-line text-caption text-fg-muted flex items-center gap-1.5"><BedDouble size={11} /> {terms.label}: no rest day, every day is a working day.</p>
        )}

        {!driver && startDate && (restDay || !terms.restDay) && (
          <div className="p-2.5 rounded-lg border border-brand/30 bg-brand/5">
            <p className="text-caption font-medium mb-1">Payment rule</p>
            <p className="text-micro text-fg-muted leading-relaxed">
              Pays for each day before driving it: {formatRwf(terms.daily)} a {terms.restDay ? 'working day' : 'day'}, at the latest on the morning of that day — first for {formatDateLabelSafe(startDate)}.
              Any amount is welcome (a week is {formatRwf(weekly)}); a day not paid by the end of that day is lost and the car is taken back.
            </p>
          </div>
        )}

        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Usual pay day</label>
          <select value={paymentDay} onChange={(e) => setPaymentDay(e.target.value as PaymentDay | '')} disabled={!editing} className="input">
            <option value="">Not set</option>
            {REST_DAYS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <p className="text-micro text-fg-subtle mt-1">The day they usually pay on — a reminder for whoever follows up payments. Being cleared to drive still depends on what they have paid.</p>
        </div>

        {editing && waiting.length > 0 && (
          <div className={`p-2.5 rounded-lg border space-y-2 ${matches.length ? 'border-attention/40 bg-attention-muted' : 'border-line'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-caption font-medium">Money already received from {fullName.trim() ? fullName.trim().split(' ')[0] : 'this person'}?</p>
                <p className="text-micro text-fg-subtle">
                  {matches.length ? 'Recorded under Deposits → Other money with a similar name. Tick what is theirs so it is counted once.' : `${waiting.length} payment${waiting.length === 1 ? '' : 's'} recorded under Other money ${waiting.length === 1 ? 'is' : 'are'} not connected to a driver yet.`}
                </p>
              </div>
              <button type="button" onClick={() => setShowAllWaiting((v) => !v)} className="text-micro text-brand-600 dark:text-brand-300 hover:underline whitespace-nowrap">{showAllWaiting ? 'Only similar names' : `Show all ${waiting.length}`}</button>
            </div>
            {shownWaiting.length > 0 && (
              <div className="space-y-1">
                {shownWaiting.map(({ m }) => (
                  <label key={m.id} className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 cursor-pointer ${picked.includes(m.id) ? 'border-brand bg-brand/10' : 'border-line bg-surface hover:bg-hover'}`}>
                    <input type="checkbox" checked={picked.includes(m.id)} onChange={() => togglePick(m.id)} className="w-4 h-4 accent-brand" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-caption font-medium truncate">{m.payer_name} <span className="text-micro font-semibold text-fg-muted">· {KIND_LABEL[m.kind]}</span></span>
                      <span className="block text-micro text-fg-subtle truncate">{formatDateLabelSafe(m.received_on)}{m.reason ? ` · ${m.reason}` : ''}</span>
                    </span>
                    <span className="text-caption font-semibold tabular-nums whitespace-nowrap">{formatRwf(Number(m.amount))}</span>
                  </label>
                ))}
              </div>
            )}
            {pickedRows.length > 0 && (
              <div className="text-micro text-fg-muted space-y-1">
                {pickedDeposits.length > 0 && (depositsAsPayments ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{formatRwf(total(pickedDeposits))} is logged as {pickedDeposits.length === 1 ? 'a payment' : 'payments'} on the day received (they already have a start deposit), paid by</span>
                    <select value={depositMethod} onChange={(e) => setDepositMethod(e.target.value as 'momo' | 'bank')} className="input !py-0.5 !w-auto text-micro"><option value="momo">MoMo</option><option value="bank">Bank</option></select>
                  </div>
                ) : <p>{formatRwf(total(pickedDeposits))} becomes the start deposit below.</p>)}
                {pickedCollateral.length > 0 && <p>{formatRwf(total(pickedCollateral))} becomes their collateral below — not counted as paying for days.</p>}
                <p>Once saved, {pickedRows.length === 1 ? 'it shows' : 'they show'} as connected to this driver and {pickedRows.length === 1 ? 'is' : 'are'} not counted again as other money.</p>
              </div>
            )}
          </div>
        )}

        <div className={`p-2.5 rounded-lg border space-y-2 ${Number(collateralAmount) > 0 ? 'border-accent/40 bg-accent/5' : 'border-line'}`}>
          <p className="text-caption font-medium">Collateral (optional)</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-micro font-medium mb-1 text-fg-muted">Amount (RWF)</label>
              <input inputMode="numeric" value={collateralAmount} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ''); setCollateralAmount(v); if (v && !collateralDate) setCollateralDate(todayStr()); }} disabled={!editing || pickedCollateral.length > 0} className="input" placeholder="e.g. 100000" />
            </div>
            <div>
              <label className="block text-micro font-medium mb-1 text-fg-muted flex items-center gap-1"><CalendarDays size={10} /> Received on</label>
              <DateInput value={collateralDate} onChange={setCollateralDate} disabled={!editing || !collateralAmount || pickedCollateral.length > 0} />
            </div>
          </div>
          <p className="text-micro text-fg-subtle">Security money we hold — it never counts as paying for days. Given back at the end of the contract unless they owe money, have fines or damaged the car. Collateral drivers are on Solo car and pay no start deposit.</p>
        </div>

        <div className={`p-2.5 rounded-lg border space-y-2 ${initialDepositPaid ? 'border-brand/30 bg-brand/5' : 'border-line '}`}>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={initialDepositPaid}
              onChange={(e) => {
                setInitialDepositPaid(e.target.checked);
                if (e.target.checked && !initialDepositDate) setInitialDepositDate(todayStr());
              }}
              disabled={!editing}
              className="w-4 h-4 accent-brand"
            />
            <span className="text-caption font-medium">Initial deposit paid</span>
          </label>
          {initialDepositPaid && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-micro font-medium mb-1 text-fg-muted flex items-center gap-1"><CalendarDays size={10} /> Date Paid</label>
                <DateInput value={initialDepositDate} onChange={setInitialDepositDate} disabled={!editing} />
              </div>
              <div>
                <label className="block text-micro font-medium mb-1 text-fg-muted">Amount (RWF)</label>
                <input type="number" value={initialDepositAmount} onChange={(e) => setInitialDepositAmount(e.target.value)} disabled={!editing} className="input" />
              </div>
              <p className="text-micro text-fg-subtle col-span-2">What was paid before the first shift (any amount; {formatRwf(weekly)} covers a week). From then on each day is paid before it is driven; payroll counts from Start Date.</p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Assigned Vehicle</label>
          <select value={vehicleId} onChange={(e) => pickCar(e.target.value)} disabled={!editing} className="input">
            <option value="">No vehicle assigned</option>
            {vehicles.map((v) => {
              const others = drivers.filter((d) => d.vehicle_id === v.id && d.id !== driver?.id && d.contract_status === 'active');
              const full = !seatFree(v.id, 'day', drivers, driver?.id) && !seatFree(v.id, 'night', drivers, driver?.id) && v.id !== driver?.vehicle_id;
              return (
                <option key={v.id} value={v.id}>
                  {carLabel(v)}
                  {others.length > 0 ? ` (${others.map((d) => `${d.full_name}: ${driverShiftShort(d)}`).join(', ')})` : ''}
                  {full ? ' — taken' : ''}
                </option>
              );
            })}
          </select>
          {editing && (
            <button type="button" onClick={() => setAddVehicleOpen(true)} className="text-micro text-brand-600 dark:text-brand-300 hover:underline mt-1.5">
              + Add a new vehicle
            </button>
          )}

          {selectedVehicle && (
            <div className="mt-2 p-2.5 rounded-lg bg-inset space-y-2">
              {(selectedVehicle.make || selectedVehicle.model || selectedVehicle.color) && (
                <p className="text-micro text-fg-muted ">
                  {[selectedVehicle.make, selectedVehicle.model, selectedVehicle.color].filter(Boolean).join(' · ')}
                </p>
              )}
              {terms.wholeCar ? (
                <div className="space-y-1.5">
                  <p className={`text-micro flex items-center gap-1.5 ${wholeCarFree ? 'text-fg-muted' : 'text-danger'}`}>
                    <SunMoon size={12} />
                    {wholeCarFree
                      ? `${terms.label}: has this car alone, day and night. No other driver can be on it.`
                      : `${terms.label} needs the car to itself: ${sittingOn('full').map((d) => d.full_name).join(' and ')} ${sittingOn('full').length > 1 ? 'are' : 'is'} on it.`}
                  </p>
                  {!wholeCarFree && editing && !ask && (
                    <button type="button" onClick={() => setAsk({ seat: 'full', ids: sittingOn('full').map((d) => d.id) })} className="btn-secondary text-caption">
                      <ArrowRightLeft size={12} /> Replace {sittingOn('full').map((d) => d.full_name).join(' and ')}
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-micro font-medium text-fg-muted mb-1">Shift</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['day', 'night'] as const).map((s) => {
                      const free = seatFree(vehicleId, s, pool, driver?.id);
                      const taken = seats?.full ?? seats?.[s];
                      return (
                        <button key={s} type="button" disabled={!editing}
                          onClick={() => (free ? setShift(s) : setAsk({ seat: s, ids: sittingOn(s).map((d) => d.id) }))}
                          className={`p-2 rounded-lg border text-left text-caption disabled:cursor-not-allowed ${shift === s ? 'border-brand bg-brand/10' : free ? 'border-line' : 'border-dashed border-line text-fg-muted'}`}>
                          <span className="flex items-center gap-1.5 font-medium">{s === 'day' ? <Sun size={12} /> : <Moon size={12} />}{shiftLabel(s)}</span>
                          <span className="block text-micro text-fg-subtle mt-0.5">{!free && taken ? `${taken.full_name} · tap to replace` : `${formatRwf(weekly)}/week`}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {ask && (
                <div className="p-2.5 rounded-lg border border-attention/40 bg-attention-muted space-y-2">
                  <p className="text-caption">
                    <b>{ask.ids.map((id) => byId(id)?.full_name).join(' and ')}</b> {ask.ids.length > 1 ? 'are' : 'is'} on {selectedVehicle.plate_number}
                    {ask.seat === 'full' ? '' : ` (${shiftLabel(ask.seat).toLowerCase()})`}. Replace them with {fullName.trim() || 'this driver'}?
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={confirmReplace} className="btn-primary text-caption">Yes, replace</button>
                    <button type="button" onClick={() => setAsk(null)} className="btn-ghost text-caption">No</button>
                  </div>
                </div>
              )}

              {replacing.map((id) => {
                const d = byId(id);
                if (!d) return null;
                const opts = moveOptions(d);
                const cur = moves[id] ? `${moves[id].vehicleId}|${moves[id].shift}` : '';
                return (
                  <div key={id} className="p-2.5 rounded-lg border border-line bg-surface space-y-1.5">
                    <p className="text-caption flex items-center gap-1.5"><UserX size={12} className="text-attention" /> <b>{d.full_name}</b> comes off {selectedVehicle.plate_number}. Give them another car?</p>
                    <select value={cur} onChange={(e) => setMove(id, e.target.value)} className="input">
                      <option value="">No — leave {d.full_name.split(' ')[0]} without a car</option>
                      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <p className="text-micro text-fg-subtle">
                      {opts.length === 0 ? 'No other car has a free seat for them right now.' : cur ? 'They move when you save.' : 'Their contract keeps running; they show as Ready until they get a car.'}
                      {' '}<button type="button" onClick={() => { setReplacing((r) => r.filter((x) => x !== id)); setMove(id, ''); setShift(''); }} className="text-brand-600 dark:text-brand-300 hover:underline">Undo</button>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="block text-caption font-medium mb-1.5 text-fg-muted">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Onboarding progress, issues, follow-ups…" />
        </div>

        {driver && (
          <div>
            <label className="block text-caption font-medium mb-1.5 text-fg-muted flex items-center gap-1"><FileText size={11} /> Onboarding Documents</label>
            <DriverDocumentsSection
              driverId={driver.id}
              documents={driverDocuments.filter((doc) => doc.driver_id === driver.id)}
              canEdit={canEdit && editing}
              onSaved={onSaved}
            />
          </div>
        )}

        {needContract && <LegalDocFields kind="driver_contract" draft={contract} onChange={setContract} title="Signed and stamped contract (optional — if you don't have it now, it shows under Admin → Missing)" />}
        {editing && !vehicleId && <p className="text-caption text-fg-muted">The signed and stamped contract is asked for when the driver is put on a car.</p>}
        {editing && vehicleId && hasContract && <p className="text-caption text-success">Signed and stamped contract on file for this contract.</p>}

        {error && <div className="text-caption text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-line-muted ">
            {driver ? (
              <div className="flex gap-2">
                <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                  <Trash2 size={13} /> Remove
                </button>
                <button onClick={() => setFlagOpen(true)} disabled={saving} className="btn-ghost text-fg-muted flex items-center gap-1.5">
                  <Flag size={13} /> Flag to IT
                </button>
              </div>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (driver ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !!ask || !fullName.trim() || !phone.trim() || (!!vehicleId && terms.wholeCar && !wholeCarFree) ||(initialDepositPaid && (!initialDepositDate || !Number(initialDepositAmount))) || (terms.restDay && !restDay)} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : driver ? 'Save Changes' : 'Add Driver'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-line-muted ">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>

      {flagOpen && driver && (
        <FlagToITDrawer
          entityType="driver"
          entityId={driver.id}
          entityLabel={`Driver: ${driver.full_name}`}
          onClose={() => setFlagOpen(false)}
        />
      )}

      {addVehicleOpen && (
        <VehicleDrawer
          vehicle={null}
          startEditing
          canEdit={canEdit}
          onClose={() => setAddVehicleOpen(false)}
          onSaved={() => {}}
          onCreated={(v) => setVehicleId(v.id)}
        />
      )}
    </Modal>
  );
}
