import { useMemo, useState } from 'react';
import {
  Banknote, BedDouble, CalendarOff, Car, CircleDollarSign, FileText, Gavel, History, LayoutGrid, PauseCircle, Pencil, Phone, Truck,
  UserX, Wallet, XCircle, RotateCcw, FileSignature, SunMoon,
} from 'lucide-react';
import { EntityViewProps } from '../../os/peek';
import { EntityLink, useEntityMeta } from '../../os/EntityLink';
import { useAuth } from '../../lib/auth';
import { useDuties } from '../../lib/callTickets';
import {
  useFleetData, canEditFleet, canRecordPause, computeDepositStanding, STAGES, effectiveStage, REST_DAYS, PAUSE_REASON_LABEL, formatDateLabelSafe,
  fineAmountPaid, pauseOn, shiftLabel } from '../../lib/fleet';
import { addDays, driverDay, endDateOf, onContract, today } from '../../lib/performance';
import { Box, Details, EmptyState, Heatmap, HeatCell, Label, ObjectLayout, PageHeader, StatCard, StatGrid, Timeline, TimelineItem, UnderlineTabs, rwf } from '../../ui/kit';
import DriverProfilePage from '../fleet/DriverProfilePage';
import DriverDrawer from '../../components/fleet/DriverDrawer';
import LogDepositDrawer from '../../components/fleet/LogDepositDrawer';
import PauseDrawer from '../../components/fleet/PauseDrawer';
import DriverCasesList from '../../components/callTickets/DriverCasesList';
import DriverDocumentsSection from '../../components/fleet/DriverDocumentsSection';
import EndContractDrawer from '../../components/fleet/EndContractDrawer';
import RenewContractDrawer from '../../components/fleet/RenewContractDrawer';
import ChangeShiftDrawer from '../../components/fleet/ChangeShiftDrawer';
import { AddLegalDocModal, LegalDocsBox } from '../../components/legal/LegalDocFields';
import { LEGAL_KIND, LegalKind, missingForDriver, useLegalDocs } from '../../lib/legalDocs';

type Tab = 'overview' | 'money' | 'contract' | 'cases' | 'documents';
const DAY_COLOR = { paid: '#2a78d6', unpaid: '#eb6834', paused: '#1baf7a', rest: 'rgb(var(--c-line-strong))', none: 'rgb(var(--c-line-muted))' };

// A driver as one object: who they are, how they pay, their days off,
// fines, cases and contract - with everything Fleet can do to them.
export default function DriverEntity({ id, mode }: EntityViewProps) {
  const { profile } = useAuth();
  const duties = useDuties();
  const fleet = useFleetData();
  const { drivers, vehicles, deposits, fines, finePayments, contractEvents, driverDocuments, loading, reload } = fleet;
  const driver = drivers.find((d) => d.id === id) ?? null;
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [shifting, setShifting] = useState(false);
  const [adding, setAdding] = useState<LegalKind | null>(null);
  const legal = useLegalDocs();
  const canEdit = canEditFleet(profile);
  const canPause = canRecordPause(profile, duties);
  useEntityMeta('driver', id, mode, driver?.full_name, driver?.vehicle?.plate_number);

  const t = today();
  const deps = useMemo(() => deposits.filter((d) => d.driver_id === id), [deposits, id]);
  const myEvents = useMemo(() => contractEvents.filter((e) => e.driver_id === id), [contractEvents, id]);
  const days = useMemo(() => {
    if (!driver?.start_date) return [] as { day: string; state: keyof typeof DAY_COLOR }[];
    const end = endDateOf(driver, myEvents);
    const out: { day: string; state: keyof typeof DAY_COLOR }[] = [];
    for (let i = 90; i >= 0; i--) {
      const day = addDays(t, -i);
      out.push({ day, state: onContract(driver, end, day) ? driverDay(driver, deps, day) : 'none' });
    }
    return out;
  }, [driver, deps, myEvents, t]);

  if (loading) return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-card" />)}</div>;
  if (!driver) return <EmptyState icon={Truck} title="Driver not found" body="They may have been removed, or you don't have access." />;

  const standing = computeDepositStanding(driver, deps);
  const myLegal = legal.docs.filter((x) => x.driver_id === id);
  const missingDoc = legal.loading ? null : missingForDriver(driver, legal.docs);
  const isEnded = driver.contract_status === 'ended';
  const stage = STAGES.find((s) => s.key === effectiveStage(driver));
  const last30 = days.slice(-30);
  const count = (list: typeof days, s: string) => list.filter((d) => d.state === s).length;
  const paid90 = count(days, 'paid'), unpaid90 = count(days, 'unpaid');
  const reliability = paid90 + unpaid90 ? Math.round((paid90 / (paid90 + unpaid90)) * 100) : null;
  const myFines = fines.filter((f) => f.driver_id === id);
  const finesOwed = myFines.reduce((s, f) => s + Math.max(0, f.amount - fineAmountPaid(f.id, finePayments)), 0);
  const car = driver.vehicle_id ? vehicles.find((v) => v.id === driver.vehicle_id) ?? null : null;
  const coDriver = driver.vehicle_id ? drivers.find((d) => d.vehicle_id === driver.vehicle_id && d.id !== id && d.contract_status === 'active') ?? null : null;
  const pausedNow = pauseOn(driver.pauses, t);
  const weekly = Array.from({ length: 8 }, (_, w) => deps.filter((d) => d.paid_date > addDays(t, -7 * (8 - w)) && d.paid_date <= addDays(t, -7 * (7 - w))).reduce((s, d) => s + Number(d.amount), 0));

  const status = isEnded ? <Label tone="neutral" icon={UserX}>Contract ended</Label>
    : pausedNow ? <Label tone="attention" icon={PauseCircle}>Paused · {PAUSE_REASON_LABEL[(pausedNow.reason ?? 'other') as keyof typeof PAUSE_REASON_LABEL]}</Label>
    : !driver.start_date ? <Label>Not started</Label>
    : standing.isCleared ? <Label tone="success">Paid up</Label> : <Label tone="danger">Not paid up</Label>;

  const cells: HeatCell[] = days.map((d) => ({
    day: d.day, state: d.state,
    title: `${new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${{ paid: 'Paid for', unpaid: 'Driven without payment', paused: 'Day off (paused)', rest: 'Rest day', none: 'Not on contract' }[d.state]}`,
  }));

  const timeline: TimelineItem[] = [
    ...deps.map((d) => ({ id: `d${d.id}`, at: d.created_at, icon: Banknote, tone: (d.status === 'pending' ? 'attention' : 'success') as TimelineItem['tone'], title: <>Paid <b>{rwf(Number(d.amount))}</b>{d.status === 'pending' ? ' · waiting for Finance to confirm' : ''}</>, body: d.paid_date !== d.created_at.slice(0, 10) ? `Payment date ${formatDateLabelSafe(d.paid_date)}` : undefined })),
    ...(driver.pauses ?? []).map((p) => ({ id: `p${p.id}`, at: p.created_at, icon: CalendarOff, tone: (p.approval_status === 'rejected' ? 'danger' : 'accent') as TimelineItem['tone'], title: <>Days off: {PAUSE_REASON_LABEL[p.reason]} · {formatDateLabelSafe(p.start_date)}{p.end_date ? ` → ${formatDateLabelSafe(p.end_date)}` : ' (open)'}</>, body: `${p.approval_status === 'pending' ? 'Waiting for approval' : p.approval_status === 'approved' ? 'Approved' : 'Rejected'}${p.note ? ` · ${p.note}` : ''}` })),
    ...myFines.map((f) => ({ id: `f${f.id}`, at: f.created_at, icon: Gavel, tone: 'danger' as const, title: <>Fined <b>{rwf(f.amount)}</b></>, body: f.reason })),
    ...myEvents.map((e) => ({ id: `e${e.id}`, at: e.created_at, icon: History, tone: 'neutral' as const, title: <>Contract {e.event_type}</>, body: [e.reason, e.details].filter(Boolean).join(' — ') })),
    { id: 'start', at: driver.created_at, icon: Truck, tone: 'neutral' as const, title: <>Added to Kivu Daily</> },
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, mode === 'peek' ? 8 : 40);

  const restDay = driver.rest_day ? REST_DAYS.find((r) => r.key === driver.rest_day)?.label : null;
  const side = (
    <Box title="Details" padded>
      <Details items={[
        { label: 'Car', value: car ? <EntityLink type="car" id={car.id} label={car.plate_number} /> : 'No car' },
        { label: 'Shift', value: driver.shift ? `${shiftLabel(driver.shift)} shift` : null },
        { label: 'Shares the car with', value: coDriver ? <EntityLink type="driver" id={coDriver.id} label={coDriver.full_name} /> : null },
        { label: 'Phone', value: <a href={`tel:${driver.phone}`} className="link flex items-center gap-1"><Phone size={12} />{driver.phone}</a> },
        { label: 'Stage', value: stage ? <span style={{ color: stage.color }} className="font-medium">{stage.label}</span> : null },
        { label: 'Started', value: driver.start_date ? formatDateLabelSafe(driver.start_date) : 'Not set' },
        { label: 'Rest day', value: restDay ? <span className="flex items-center gap-1"><BedDouble size={12} />{restDay}</span> : 'Not set' },
        { label: 'Initial deposit', value: driver.initial_deposit_paid ? `${rwf(driver.initial_deposit_amount ?? 0)}${driver.initial_deposit_date ? ` · ${formatDateLabelSafe(driver.initial_deposit_date)}` : ''}` : 'Not paid' },
        { label: 'Notes', value: driver.notes },
      ]} />
    </Box>
  );

  const stats = (
    <StatGrid cols={mode === 'peek' ? 2 : 4}>
      <StatCard label="Owes now" icon={Wallet} value={rwf(standing.owes)} tone={standing.owes ? 'danger' : undefined} sub={standing.weekBehind ? `${rwf(standing.weekBehind)} behind this week` : 'Nothing behind this week'} />
      <StatCard label="Paid on time (90 days)" icon={CircleDollarSign} value={reliability === null ? '—' : `${reliability}%`} tone={reliability !== null && reliability < 80 ? 'danger' : 'success'} sub={`${paid90} paid · ${unpaid90} driven unpaid`} />
      <StatCard label="Days lost (30 days)" icon={XCircle} value={count(last30, 'unpaid')} tone={count(last30, 'unpaid') ? 'danger' : undefined} sub={`${count(last30, 'paused')} days off · ${count(last30, 'rest')} rest days`} />
      <StatCard label="Paid in total" icon={Banknote} value={rwf(standing.totalPaid)} spark={weekly} sub={finesOwed ? `${rwf(finesOwed)} fines unpaid` : 'Last 8 weeks'} />
    </StatGrid>
  );

  const calendar = (
    <Box title="Payment calendar" icon={LayoutGrid} right={<span className="text-caption text-fg-muted">Last 13 weeks</span>}>
      <Heatmap cells={cells} legend={[
        { state: 'paid', label: 'Paid for', color: DAY_COLOR.paid }, { state: 'unpaid', label: 'Unpaid', color: DAY_COLOR.unpaid },
        { state: 'paused', label: 'Day off', color: DAY_COLOR.paused }, { state: 'rest', label: 'Rest day', color: DAY_COLOR.rest },
      ]} />
    </Box>
  );

  const header = (
    <PageHeader
      avatar={<span className="w-11 h-11 rounded-full bg-accent/15 text-accent-fg flex items-center justify-center text-ui font-semibold shrink-0">{driver.full_name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>}
      title={driver.full_name} labels={<>{status}{missingDoc && <button onClick={() => (mode === 'page' ? setTab('contract') : setAdding(missingDoc))}><Label tone="danger" icon={FileSignature}>{LEGAL_KIND[missingDoc].missing}</Label></button>}</>}
      meta={<>
        {car ? <EntityLink type="car" id={car.id} label={car.plate_number} /> : <span>No car</span>}
        {driver.shift && <span>{shiftLabel(driver.shift)} shift</span>}
        {driver.start_date && <span>since {formatDateLabelSafe(driver.start_date)}</span>}
      </>}
      actions={mode === 'page' && <>
        {canEdit && !isEnded && <button onClick={() => setLogging(true)} className="btn-primary"><Banknote size={14} /> Log payment</button>}
        {canPause && !isEnded && <button onClick={() => setPausing(true)} className="btn-secondary"><CalendarOff size={14} /> Days off</button>}
        {canEdit && <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={14} /> Edit</button>}
        {canEdit && !isEnded && driver.vehicle_id && driver.start_date && <button onClick={() => setShifting(true)} className="btn-secondary"><SunMoon size={14} /> Change shift</button>}
        {canEdit && !isEnded && <button onClick={() => setEnding(true)} className="btn-danger"><UserX size={14} /> End contract</button>}
        {canEdit && isEnded && <button onClick={() => setRenewing(true)} className="btn-primary"><RotateCcw size={14} /> Renew contract</button>}
      </>}
    />
  );

  const drawers = <>
    {editing && <DriverDrawer driver={driver} startEditing vehicles={vehicles} drivers={drivers} driverDocuments={driverDocuments} canEdit={canEdit} onClose={() => setEditing(false)} onSaved={reload} />}
    {logging && <LogDepositDrawer driver={driver} deposits={deposits} onClose={() => setLogging(false)} onSaved={reload} />}
    {pausing && <PauseDrawer driver={driver} drivers={drivers} onClose={() => setPausing(false)} onSaved={() => { setPausing(false); reload(); }} />}
    {ending && <EndContractDrawer driver={driver} deposits={deposits} fines={fines} finePayments={finePayments} onClose={() => setEnding(false)} onSaved={reload} />}
    {shifting && <ChangeShiftDrawer driver={driver} drivers={drivers} deposits={deposits} onClose={() => setShifting(false)} onSaved={() => { reload(); legal.reload(); }} />}
    {adding && <AddLegalDocModal kind={adding} driverId={driver.id} name={driver.full_name} onClose={() => setAdding(null)} onSaved={legal.reload} />}
    {renewing && <RenewContractDrawer driver={driver} drivers={drivers} vehicles={vehicles} deposits={deposits} contractEvents={contractEvents} onClose={() => setRenewing(false)} onSaved={reload} />}
  </>;

  if (mode === 'peek') {
    return (
      <div className="p-4 space-y-4">
        {header}
        {stats}
        {calendar}
        <Box title="Latest" icon={History}><Timeline items={timeline} /></Box>
        {side}
        {drawers}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {header}
      <UnderlineTabs value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview', icon: LayoutGrid },
        { key: 'money', label: 'Payments & contract', icon: Wallet, count: deps.length },
        { key: 'contract', label: 'Contract papers', icon: FileSignature, count: missingDoc ? 1 : myLegal.length, tone: missingDoc ? 'danger' : undefined },
        { key: 'cases', label: 'Calls & cases', icon: FileText },
        { key: 'documents', label: 'Documents', icon: Car, count: driverDocuments.filter((d) => d.driver_id === id).length },
      ]} />
      {tab === 'overview' && (
        <ObjectLayout side={side} main={<>
          {stats}
          {calendar}
          <Box title="Activity" icon={History}><Timeline items={timeline} /></Box>
        </>} />
      )}
      {tab === 'money' && (
        <DriverProfilePage embedded driver={driver} drivers={drivers} deposits={deposits} fines={fines} finePayments={finePayments} contractEvents={contractEvents} vehicles={vehicles}
          canEdit={canEdit} onBack={() => setTab('overview')} onEdit={() => setEditing(true)} reload={reload} />
      )}
      {tab === 'contract' && (
        <Box title="Contract papers" icon={FileSignature}>
          <LegalDocsBox docs={myLegal} missing={missingDoc} canAdd={canEdit} onAdd={setAdding}
            addKinds={isEnded ? ['driver_termination_letter', 'driver_contract'] : ['driver_contract', 'driver_contract_amendment']} />
        </Box>
      )}
      {tab === 'cases' && <Box title="Calls and cases about this driver" icon={FileText}><DriverCasesList driverId={id} /></Box>}
      {tab === 'documents' && <Box title="Documents" icon={Car}><DriverDocumentsSection driverId={id} documents={driverDocuments.filter((d) => d.driver_id === id)} canEdit={canEdit} onSaved={reload} /></Box>}
      {drawers}
    </div>
  );
}
