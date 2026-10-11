import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, CalendarOff, Car, CircleSlash, FileWarning, Gauge, History, Receipt, Truck, Wallet, Banknote, Gavel } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, computeDepositStanding, STAGES, effectiveStage, fineAmountPaid, PAUSE_REASON_LABEL, pauseOn, formatDateLabelSafe, canSeeDriverPayments } from '../../lib/fleet';
import { addDays, CAR_STATE_LABEL, fleetDays, PerfData, today } from '../../lib/performance';
import { ChartCard, DailyBars, MiniTable, longDay, usePalette } from '../../components/charts/kit';
import { EntityLink } from '../../os/EntityLink';
import { Box, Label, PageHeader, StatCard, StatGrid, Timeline, TimelineItem, rwf } from '../../ui/kit';

// Fleet at a glance: cars working, who's paid up, days off, fines,
// licences, the driver pipeline, and what needs someone today.
export default function FleetOverview() {
  const { profile } = useAuth();
  const c = usePalette();
  const showMoney = canSeeDriverPayments(profile);
  const { drivers, vehicles, deposits, fines, finePayments, contractEvents, loading } = useFleetData();
  const t = today();
  const data = useMemo(() => ({ drivers, vehicles, deposits, events: contractEvents }) as unknown as PerfData, [drivers, vehicles, deposits, contractEvents]);
  const days = useMemo(() => (loading ? [] : fleetDays(data, addDays(t, -29), t)), [data, loading, t]);

  if (loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-card" />)}</div>;

  const onRoad = drivers.filter((d) => d.contract_status === 'active' && d.vehicle_id && d.start_date);
  const rows = onRoad.map((d) => ({ d, s: computeDepositStanding(d, deposits.filter((x) => x.driver_id === d.id)) }));
  const notPaid = rows.filter((r) => !r.s.isCleared && !r.s.pausedToday).sort((a, b) => b.s.owes - a.s.owes);
  const owed = rows.reduce((s, r) => s + r.s.owes, 0);
  const pausedNow = onRoad.filter((d) => pauseOn(d.pauses, t));
  const pendingPauses = drivers.flatMap((d) => (d.pauses ?? []).filter((p) => p.approval_status === 'pending').map((p) => ({ d, p })));
  const longPauses = drivers.flatMap((d) => (d.pauses ?? []).filter((p) => p.approval_status !== 'rejected' && !p.end_date && p.start_date <= addDays(t, -3)).map((p) => ({ d, p })));
  const todayCars = days[days.length - 1];
  const noDriverCars = vehicles.filter((v) => !drivers.some((d) => d.vehicle_id === v.id && d.contract_status === 'active'));
  const finesUnpaid = fines.reduce((s, f) => s + Math.max(0, f.amount - fineAmountPaid(f.id, finePayments)), 0);
  const licences = vehicles.filter((v) => v.rura_license_expiry_date && v.rura_license_expiry_date <= addDays(t, 30)).sort((a, b) => (a.rura_license_expiry_date ?? '').localeCompare(b.rura_license_expiry_date ?? ''));
  const collected7 = deposits.filter((x) => x.paid_date > addDays(t, -7)).reduce((s, x) => s + Number(x.amount), 0);
  const collectedPrev7 = deposits.filter((x) => x.paid_date > addDays(t, -14) && x.paid_date <= addDays(t, -7)).reduce((s, x) => s + Number(x.amount), 0);
  const dailyCollected = Array.from({ length: 14 }, (_, i) => deposits.filter((x) => x.paid_date === addDays(t, i - 13)).reduce((s, x) => s + Number(x.amount), 0));
  const stageCounts = STAGES.map((s) => ({ ...s, n: drivers.filter((d) => effectiveStage(d) === s.key).length }));
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.n));
  const workingSpark = days.slice(-14).map((d) => d.working);

  const series = [
    { key: 'working', label: CAR_STATE_LABEL.working, color: c.blue },
    { key: 'unpaid', label: CAR_STATE_LABEL.unpaid, color: c.orange },
    { key: 'paused', label: CAR_STATE_LABEL.paused, color: c.aqua },
    { key: 'rest', label: CAR_STATE_LABEL.rest, color: c.yellow },
    { key: 'no_driver', label: CAR_STATE_LABEL.no_driver, color: c.other },
  ] as const;

  const recent: TimelineItem[] = [
    ...deposits.slice(0, 40).map((x) => ({ id: `d${x.id}`, at: x.created_at, icon: Banknote, tone: (x.status === 'pending' ? 'attention' : 'success') as TimelineItem['tone'], title: <>{(() => { const d = drivers.find((y) => y.id === x.driver_id); return d ? <EntityLink type="driver" id={d.id} label={d.full_name} /> : 'A driver'; })()} paid <b>{rwf(Number(x.amount))}</b></> })),
    ...drivers.flatMap((d) => (d.pauses ?? []).map((p) => ({ id: `p${p.id}`, at: p.created_at, icon: CalendarOff, tone: 'accent' as const, title: <><EntityLink type="driver" id={d.id} label={d.full_name} /> off: {PAUSE_REASON_LABEL[p.reason]}</> }))),
    ...fines.slice(0, 20).map((f) => ({ id: `f${f.id}`, at: f.created_at, icon: Gavel, tone: 'danger' as const, title: <>{f.driver ? <EntityLink type="driver" id={f.driver_id} label={f.driver.full_name} /> : 'A driver'} fined <b>{rwf(f.amount)}</b></> })),
  ].filter((x) => showMoney || x.id.startsWith('p')).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Truck} title="Fleet" subtitle={`${onRoad.length} drivers on the road · ${vehicles.length} cars`}
        actions={<><Link to="/fleet/drivers" className="btn-secondary"><Truck size={14} /> Drivers</Link><Link to="/fleet/cars" className="btn-secondary"><Car size={14} /> Cars</Link></>} />

      <StatGrid cols={4}>
        <StatCard to="/fleet/cars" icon={Gauge} label="Cars working today" value={`${todayCars?.working ?? 0}/${vehicles.length}`} spark={workingSpark} sub={todayCars?.rest ? `${todayCars.rest} on their rest day` : 'With a paid-up driver'} />
        {showMoney && <StatCard to="/fleet/deposits" icon={BadgeCheck} label="Drivers paid up" value={`${rows.length - notPaid.length}/${rows.length}`} tone={notPaid.length ? 'danger' : 'success'} sub={owed ? `${rwf(owed)} owed for days driven` : 'Nobody owes'} />}
        {showMoney && <StatCard to="/fleet/deposits" icon={Wallet} label="Collected (7 days)" value={rwf(collected7)} spark={dailyCollected} delta={collectedPrev7 ? { text: `${collected7 >= collectedPrev7 ? '▲' : '▼'} ${Math.abs(Math.round(((collected7 - collectedPrev7) / collectedPrev7) * 100))}%`, good: collected7 >= collectedPrev7 } : undefined} sub="vs the 7 days before" />}
        <StatCard to="/fleet/days-off" icon={CalendarOff} label="On days off now" value={pausedNow.length} sub={pendingPauses.length ? `${pendingPauses.length} waiting for approval` : 'None waiting for approval'} tone={pendingPauses.length ? 'attention' : undefined} />
        <StatCard to="/fleet/cars" icon={CircleSlash} label="Cars with no driver" value={noDriverCars.length} tone={noDriverCars.length ? 'danger' : undefined} sub="Earn nothing until assigned" />
        {showMoney && <StatCard to="/fleet/fines" icon={Receipt} label="Fines unpaid" value={rwf(finesUnpaid)} tone={finesUnpaid ? 'attention' : undefined} sub={`${fines.length} fines in total`} />}
        <StatCard to="/fleet/cars" icon={FileWarning} label="Licences due (30 days)" value={licences.length} tone={licences.some((v) => (v.rura_license_expiry_date ?? '') < t) ? 'danger' : licences.length ? 'attention' : undefined} sub={licences[0] ? `Next: ${licences[0].plate_number}` : 'All fine'} />
        <StatCard to="/fleet/drivers" icon={Truck} label="Ready to start" value={stageCounts.find((s) => s.key === 'ready')?.n ?? 0} sub="Drivers waiting for a car" />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2">
          <ChartCard title="Cars per day" subtitle="Last 30 days, from each car's drivers" legend={series}
            table={<MiniTable head={['Day', 'Working', 'Not paid up', 'Days off', 'Rest', 'No driver']} rows={[...days].reverse().map((d) => [longDay(d.day), d.working, d.unpaid, d.paused, d.rest, d.no_driver])} />}>
            <DailyBars data={days as unknown as Record<string, number | string>[]} series={series} c={c} height={230} />
          </ChartCard>
        </div>
        <Box title="Driver pipeline" icon={Truck} right={<Link to="/fleet/drivers" className="text-caption link">Open</Link>}>
          <div className="space-y-2">
            {stageCounts.map((s) => (
              <Link key={s.key} to="/fleet/drivers" className="grid grid-cols-[80px_1fr_28px] items-center gap-2 text-caption hover:bg-hover rounded px-1 -mx-1">
                <span className="text-fg-muted">{s.label}</span>
                <span className="h-3 rounded-r-[4px]" style={{ width: `${(s.n / maxStage) * 100}%`, minWidth: s.n ? 4 : 0, background: s.color }} />
                <span className="text-right tabular-nums font-medium">{s.n}</span>
              </Link>
            ))}
          </div>
        </Box>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Needs someone today" icon={AlertTriangle} padded={false}>
          <ul className="divide-y divide-line-muted">
            {showMoney && notPaid.map(({ d, s }) => (
              <li key={d.id} className="flex items-center gap-2 px-4 py-2 text-body"><Wallet size={14} className="text-danger" /><EntityLink type="driver" id={d.id} label={d.full_name} /><span className="text-caption text-fg-muted">{d.vehicle?.plate_number}</span><Label tone="danger">owes {rwf(s.owes)}</Label></li>
            ))}
            {noDriverCars.map((v) => (
              <li key={v.id} className="flex items-center gap-2 px-4 py-2 text-body"><CircleSlash size={14} className="text-danger" /><EntityLink type="car" id={v.id} label={v.plate_number} className="font-mono" /><span className="text-caption text-fg-muted">has no driver</span></li>
            ))}
            {pendingPauses.map(({ d, p }) => (
              <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-body"><CalendarOff size={14} className="text-attention" /><EntityLink type="driver" id={d.id} label={d.full_name} /><span className="text-caption text-fg-muted">{PAUSE_REASON_LABEL[p.reason]} — waiting for approval</span></li>
            ))}
            {longPauses.map(({ d, p }) => (
              <li key={`l${p.id}`} className="flex items-center gap-2 px-4 py-2 text-body"><CalendarOff size={14} className="text-attention" /><EntityLink type="driver" id={d.id} label={d.full_name} /><span className="text-caption text-fg-muted">off since {formatDateLabelSafe(p.start_date)} — check in</span></li>
            ))}
            {licences.map((v) => (
              <li key={`r${v.id}`} className="flex items-center gap-2 px-4 py-2 text-body"><FileWarning size={14} className={(v.rura_license_expiry_date ?? '') < t ? 'text-danger' : 'text-attention'} /><EntityLink type="car" id={v.id} label={v.plate_number} className="font-mono" /><span className="text-caption text-fg-muted">licence {(v.rura_license_expiry_date ?? '') < t ? 'expired' : 'expires'} {formatDateLabelSafe(v.rura_license_expiry_date!)}</span></li>
            ))}
            {(!showMoney || !notPaid.length) && !noDriverCars.length && !pendingPauses.length && !longPauses.length && !licences.length && <li className="px-4 py-8 text-center text-body text-fg-muted">Nothing needs anyone right now.</li>}
          </ul>
        </Box>
        <Box title="Latest" icon={History}><Timeline items={recent} empty="Nothing yet." /></Box>
      </div>
    </div>
  );
}

