import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Calendar, Car, CircleSlash, FileWarning, Gauge, History, LayoutGrid, Pencil, Truck, Users2, Wallet, Wrench } from 'lucide-react';
import { EntityViewProps } from '../../os/peek';
import { EntityLink, useEntityMeta } from '../../os/EntityLink';
import { useAuth } from '../../lib/auth';
import { supabase, FinanceTransaction, VehicleOwner } from '../../lib/supabase';
import { useFleetData, canEditFleet, computeDepositStanding, formatDateLabelSafe, pauseOn, PAUSE_REASON_LABEL, shiftLabel } from '../../lib/fleet';
import { TYPE_META } from '../../lib/finance';
import { addDays, carDay, CarDayState, PerfData, today } from '../../lib/performance';
import { Box, Details, EmptyState, Heatmap, Label, ObjectLayout, PageHeader, StatCard, StatGrid, Timeline, TimelineItem, UnderlineTabs, rwf } from '../../ui/kit';
import VehicleDrawer from '../../components/fleet/VehicleDrawer';

type Tab = 'overview' | 'money';
const COLOR: Record<CarDayState | 'none', string> = { working: '#2a78d6', unpaid: '#eb6834', paused: '#1baf7a', rest: 'rgb(var(--c-line-strong))', no_driver: '#a3a3a3', none: 'rgb(var(--c-line-muted))' };
const STATE_LABEL: Record<CarDayState | 'none', string> = { working: 'Working, driver paid up', unpaid: 'Driver not paid up', paused: 'Driver on days off', rest: 'Rest day', no_driver: 'No driver', none: 'Not on the road yet' };

// A car: who drives it, how many days it actually worked, what it earned
// for the owner, licences and garage days.
export default function CarEntity({ id, mode }: EntityViewProps) {
  const { profile } = useAuth();
  const fleet = useFleetData();
  const { vehicles, drivers, deposits, fines, contractEvents, loading, reload } = fleet;
  const car = vehicles.find((v) => v.id === id) ?? null;
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const canEdit = canEditFleet(profile);
  const isMoneyPerson = profile?.role === 'managing_director' || profile?.department?.slug === 'finance';
  useEntityMeta('car', id, mode, car?.plate_number, [car?.make, car?.model].filter(Boolean).join(' '));

  const money = useQuery({
    queryKey: ['car-money', id], enabled: isMoneyPerson,
    queryFn: async () => {
      const [tx, owner] = await Promise.all([
        supabase.from('finance_transactions').select('*').eq('linked_vehicle_id', id).order('transaction_date', { ascending: false }),
        car?.owner_id ? supabase.from('vehicle_owners').select('*').eq('id', car.owner_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      return { tx: (tx.data as FinanceTransaction[]) ?? [], owner: (owner.data as VehicleOwner | null) ?? null };
    },
  });

  const t = today();
  const data = useMemo(() => ({ drivers, deposits, events: contractEvents }) as unknown as PerfData, [drivers, deposits, contractEvents]);
  const days = useMemo(() => {
    if (!car) return [];
    return Array.from({ length: 91 }, (_, i) => { const day = addDays(t, i - 90); return { day, state: (carDay(car, data, day) ?? 'none') as CarDayState | 'none' }; });
  }, [car, data, t]);

  if (loading) return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-card" />)}</div>;
  if (!car) return <EmptyState icon={Car} title="Car not found" />;

  const onCar = drivers.filter((d) => d.vehicle_id === id);
  const counted = days.filter((d) => d.state !== 'none' && d.state !== 'rest');
  const worked = counted.filter((d) => d.state === 'working').length;
  const util = counted.length ? Math.round((worked / counted.length) * 100) : null;
  const noDriver = days.filter((d) => d.state === 'no_driver').length;
  const garage = days.filter((d) => onCar.some((dr) => ['garage', 'accident'].includes(pauseOn(dr.pauses, d.day)?.reason ?? ''))).length;
  const collected30 = deposits.filter((x) => onCar.some((d) => d.id === x.driver_id) && x.paid_date > addDays(t, -30)).reduce((s, x) => s + Number(x.amount), 0);
  const expiry = car.rura_license_expiry_date;
  const expired = !!expiry && expiry < t;
  const expiresSoon = !!expiry && !expired && expiry <= addDays(t, 30);
  const todayState = days[days.length - 1]?.state ?? 'none';
  const weeklyWorked = Array.from({ length: 8 }, (_, w) => days.slice(w * 7 + 35, w * 7 + 42).filter((d) => d.state === 'working').length);
  const owner = money.data?.owner ?? null;
  const tx = money.data?.tx ?? [];

  const status = todayState === 'working' ? <Label tone="success">Working</Label> : todayState === 'no_driver' ? <Label tone="danger">No driver</Label>
    : todayState === 'unpaid' ? <Label tone="danger">Driver not paid up</Label> : todayState === 'paused' ? <Label tone="attention">Driver on days off</Label> : todayState === 'rest' ? <Label>Rest day</Label> : <Label>Not on the road</Label>;

  const timeline: TimelineItem[] = [
    ...tx.map((x) => ({ id: `t${x.id}`, at: x.created_at ?? x.transaction_date, icon: Banknote, tone: (x.direction === 'in' ? 'success' : 'neutral') as TimelineItem['tone'], title: <>{TYPE_META[x.type]?.label ?? x.type}: <b>{rwf(x.amount)}</b> · {x.status}</>, body: x.description ?? undefined })),
    ...fines.filter((f) => f.vehicle_id === id).map((f) => ({ id: `f${f.id}`, at: f.created_at, icon: FileWarning, tone: 'danger' as const, title: <>Fine {rwf(f.amount)}{f.driver ? <> · <EntityLink type="driver" id={f.driver_id} label={f.driver.full_name} /></> : null}</>, body: f.reason ?? undefined })),
    ...onCar.flatMap((d) => (d.pauses ?? []).map((p) => ({ id: `p${p.id}`, at: p.created_at, icon: Wrench, tone: 'accent' as const, title: <><EntityLink type="driver" id={d.id} label={d.full_name} /> off: {PAUSE_REASON_LABEL[p.reason]}</>, body: `${formatDateLabelSafe(p.start_date)}${p.end_date ? ` → ${formatDateLabelSafe(p.end_date)}` : ' (open)'}` }))),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, mode === 'peek' ? 8 : 40);

  const header = (
    <PageHeader
      avatar={<span className="w-11 h-11 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0"><Car size={20} className="text-fg-muted" /></span>}
      title={<span className="font-mono">{car.plate_number}</span>} labels={<>{status}{expired && <Label tone="danger" icon={FileWarning}>Licence expired</Label>}{expiresSoon && <Label tone="attention" icon={FileWarning}>Licence expires soon</Label>}</>}
      meta={<>
        <span>{[car.make, car.model, car.color].filter(Boolean).join(' · ') || 'No make/model'}</span>
        {owner && <span>Owner <EntityLink type="owner" id={owner.id} label={owner.full_name} /></span>}
        {car.operation_start_date && <span>on the road since {formatDateLabelSafe(car.operation_start_date)}</span>}
      </>}
      actions={mode === 'page' && canEdit ? <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={14} /> Edit</button> : undefined}
    />
  );

  const stats = (
    <StatGrid cols={mode === 'peek' ? 2 : 4}>
      <StatCard label="Days worked (90 days)" icon={Gauge} value={util === null ? '—' : `${util}%`} tone={util !== null && util < 70 ? 'danger' : 'success'} spark={weeklyWorked} sub={`${worked} of ${counted.length} days`} />
      <StatCard label="Days with no driver" icon={CircleSlash} value={noDriver} tone={noDriver ? 'danger' : undefined} sub="Last 90 days" />
      <StatCard label="Garage & accident days" icon={Wrench} value={garage} sub="Last 90 days" />
      <StatCard label="Paid by its drivers (30 days)" icon={Wallet} value={rwf(collected30)} sub={car.weekly_owner_payout_amount ? `Owner gets ${rwf(car.weekly_owner_payout_amount)}/week` : undefined} />
    </StatGrid>
  );

  const calendar = (
    <Box title="Car calendar" icon={Calendar} right={<span className="text-caption text-fg-muted">Last 13 weeks</span>}>
      <Heatmap cells={days.map((d) => ({ day: d.day, state: d.state, title: `${new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${STATE_LABEL[d.state]}` }))}
        legend={(['working', 'unpaid', 'paused', 'rest', 'no_driver'] as const).map((s) => ({ state: s, label: STATE_LABEL[s].split(',')[0], color: COLOR[s] }))} />
    </Box>
  );

  const driversBox = (
    <Box title="Drivers" icon={Users2} padded={false}>
      {onCar.length === 0 ? <p className="p-4 text-body text-fg-muted">No driver is assigned to this car.</p> : (
        <ul className="divide-y divide-line-muted">
          {onCar.map((d) => {
            const s = d.start_date ? computeDepositStanding(d, deposits.filter((x) => x.driver_id === d.id)) : null;
            const ended = d.contract_status === 'ended';
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <Truck size={15} className="text-fg-subtle" />
                <div className="flex-1 min-w-0"><EntityLink type="driver" id={d.id} label={d.full_name} /><p className="text-caption text-fg-muted">{d.shift ? `${shiftLabel(d.shift)} shift` : 'No shift'}{d.start_date ? ` · since ${formatDateLabelSafe(d.start_date)}` : ''}</p></div>
                {ended ? <Label>Ended</Label> : s && !s.isCleared ? <Label tone="danger">Owes {rwf(s.owes)}</Label> : <Label tone="success">Paid up</Label>}
              </li>
            );
          })}
        </ul>
      )}
    </Box>
  );

  const side = (
    <Box title="Details">
      <Details items={[
        { label: 'Make and model', value: [car.make, car.model].filter(Boolean).join(' ') || null },
        { label: 'Colour', value: car.color },
        { label: 'Device', value: car.device_label },
        { label: 'Owner', value: owner ? <EntityLink type="owner" id={owner.id} label={owner.full_name} /> : null },
        { label: 'Owner payout', value: car.weekly_owner_payout_amount ? `${rwf(car.weekly_owner_payout_amount)} a week` : null },
        { label: 'Management fee', value: car.monthly_management_fee_amount ? `${rwf(car.monthly_management_fee_amount)} a month` : null },
        { label: 'Given on', value: car.given_date ? formatDateLabelSafe(car.given_date) : null },
        { label: 'On the road since', value: car.operation_start_date ? formatDateLabelSafe(car.operation_start_date) : null },
        { label: 'RURA licence', value: `${String(car.rura_license_status ?? '').replace(/_/g, ' ') || '—'}${expiry ? ` · expires ${formatDateLabelSafe(expiry)}` : ''}` },
        { label: 'Notes', value: car.notes },
      ]} />
    </Box>
  );

  const drawer = editing && <VehicleDrawer vehicle={car} startEditing canEdit={canEdit} onClose={() => setEditing(false)} onSaved={reload} onCreated={() => undefined} />;

  if (mode === 'peek') return <div className="p-4 space-y-4">{header}{stats}{driversBox}{calendar}{side}{drawer}</div>;

  const ownerIn = tx.filter((x) => x.type === 'vehicle_owner_payment');
  return (
    <div className="animate-fade-in">
      {header}
      <UnderlineTabs value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview', icon: LayoutGrid },
        ...(isMoneyPerson ? [{ key: 'money' as const, label: 'Money', icon: Banknote, count: tx.length }] : []),
      ]} />
      {tab === 'overview' && <ObjectLayout side={side} main={<>{stats}{driversBox}{calendar}<Box title="Activity" icon={History}><Timeline items={timeline} /></Box></>} />}
      {tab === 'money' && (
        <div className="space-y-4">
          <StatGrid cols={3}>
            <StatCard label="Paid to the owner" value={rwf(ownerIn.filter((x) => x.status === 'posted' || x.status === 'approved').reduce((s, x) => s + x.amount, 0))} sub={`${ownerIn.length} payments`} />
            <StatCard label="Owner payments waiting" value={rwf(ownerIn.filter((x) => x.status === 'pending' || x.status === 'checked').reduce((s, x) => s + x.amount, 0))} tone="attention" />
            <StatCard label="Kivu margin from this car" value={rwf(tx.filter((x) => x.type === 'management_margin').reduce((s, x) => s + x.amount, 0))} tone="success" />
          </StatGrid>
          <Box title="Transactions" icon={Banknote} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-body min-w-[640px]">
                <thead><tr className="text-caption text-fg-muted text-left border-b border-line-muted">{['Date', 'Type', 'Description', 'Status', 'Amount'].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i === 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {tx.map((x) => (
                    <tr key={x.id} className="border-b border-line-muted last:border-0 hover:bg-hover/50">
                      <td className="px-4 py-2 whitespace-nowrap">{formatDateLabelSafe(x.transaction_date)}</td>
                      <td className="px-4 py-2">{TYPE_META[x.type]?.label ?? x.type}</td>
                      <td className="px-4 py-2 text-fg-muted">{x.description}</td>
                      <td className="px-4 py-2"><Label tone={x.status === 'posted' || x.status === 'approved' ? 'success' : x.status === 'rejected' ? 'danger' : 'attention'}>{x.status}</Label></td>
                      <td className={`px-4 py-2 text-right tabular-nums font-medium ${x.direction === 'in' ? 'text-success' : ''}`}>{x.direction === 'in' ? '+' : '−'}{rwf(x.amount)}</td>
                    </tr>
                  ))}
                  {tx.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-fg-muted">No transactions linked to this car.</td></tr>}
                </tbody>
              </table>
            </div>
          </Box>
        </div>
      )}
      {drawer}
    </div>
  );
}
