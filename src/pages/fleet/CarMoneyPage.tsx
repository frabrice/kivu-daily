import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Car, CarFront, TrendingDown, UserX, Users2, Wallet } from 'lucide-react';
import { supabase, DriverCarAssignment, FinanceTransaction } from '../../lib/supabase';
import { mondayOf, shiftDay, useFleetData } from '../../lib/fleet';
import { CAUSES, CAUSE_LABEL, CarEconomics, computeLeakage, shareOf, targetShareOf } from '../../lib/financeOverview';
import { SHIFT_LABEL, SHIFT_STATUS, useFreelance } from '../../lib/freelance';
import { kigaliToday } from '../../lib/meetings';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, Label, PageHeader, StatCard, StatGrid } from '../../ui/kit';
import { ChartCard, DailyBars, RangeTabs, usePalette } from '../../components/charts/kit';

// Car by car: what each managed car should have brought vs what it did,
// who drove it (who paid, who defaulted, who replaced whom), freelance
// shifts that covered it, and the money lost on it - the same calculation
// as the Finance overview. Owner payouts (and so Kivu Ride's share) are
// shown to the MD and Finance only.

type Period = 'week' | 'last_week' | 'month' | 'all';
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const td = 'px-3 py-2';
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export default function CarMoneyPage() {
  usePageTitle('Cars: should vs did');
  const a = useAccess();
  const c = usePalette();
  const fleet = useFleetData();
  const fl = useFreelance(400);
  const t = kigaliToday();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>('month');
  const [extra, setExtra] = useState<{ assignments: DriverCarAssignment[]; transactions: FinanceTransaction[]; owners: { id: string; full_name: string }[] } | null>(null);
  const load = useCallback(async () => {
    const [as, tx, ow] = await Promise.all([
      supabase.from('driver_car_assignments').select('*').order('from_date'),
      supabase.from('finance_transactions').select('*').eq('type', 'vehicle_owner_payment'),
      supabase.from('vehicle_owners').select('id, full_name'),
    ]);
    setExtra({ assignments: (as.data as DriverCarAssignment[]) ?? [], transactions: (tx.data as FinanceTransaction[]) ?? [], owners: (ow.data as { id: string; full_name: string }[]) ?? [] });
  }, []);
  useEffect(() => { load(); }, [load]);
  const seesOwner = a.isMd || a.dept === 'finance' || a.plan === 'full';
  const range = useMemo(() => {
    const mon = mondayOf(t);
    if (period === 'week') return { from: mon, to: t };
    if (period === 'last_week') return { from: shiftDay(mon, -7), to: shiftDay(mon, -1) };
    if (period === 'month') return { from: `${t.slice(0, 7)}-01`, to: t };
    return { from: '2026-01-01', to: t };
  }, [period, t]);
  const leak = useMemo(() => {
    if (fleet.loading || !extra || fl.loading) return null;
    return computeLeakage({
      vehicles: fleet.vehicles, drivers: fleet.drivers, deposits: fleet.deposits, transactions: extra.transactions, assignments: extra.assignments,
      events: fleet.contractEvents.map((e) => ({ driver_id: e.driver_id, event_type: e.event_type, event_date: e.event_date })), owners: extra.owners, freelance: fl.shifts,
    }, range, t);
  }, [fleet.loading, fleet.vehicles, fleet.drivers, fleet.deposits, fleet.contractEvents, extra, fl.loading, fl.shifts, range, t]);
  if (!leak) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;
  const open = params.get('car') ? leak.cars.find((x) => x.vehicle.id === params.get('car')) : null;
  const replacedBy = (driverId: string) => fleet.drivers.find((d) => d.replaced_driver_id === driverId);
  const defaulted = (car: CarEconomics) => car.drivers.filter((r) => r.lost > 0 && r.cause !== 'paused');
  const tabs = <RangeTabs value={period} onChange={setPeriod} options={[{ v: 'week', label: 'This week' }, { v: 'last_week', label: 'Last week' }, { v: 'month', label: 'This month' }, { v: 'all', label: 'All time' }]} />;

  if (open) {
    const car = open;
    const rows = extra!.assignments.filter((x) => x.vehicle_id === car.vehicle.id);
    const span = (driverId: string) => { const r = rows.filter((x) => x.driver_id === driverId); return r.length ? `${r[0].from_date} → ${r[r.length - 1].to_date ?? 'now'}` : ''; };
    const shifts = fl.shifts.filter((s) => s.vehicle_id === car.vehicle.id && s.day >= range.from && s.day <= range.to);
    const weekRows = car.weeks.map((w) => ({ day: w.week, should: Math.round(w.expected), did: Math.round(w.collected) }));
    const kept = pct(car.collected, car.expected);
    return (
      <div className="animate-fade-in">
        <button onClick={() => setParams({})} className="text-caption text-fg-muted hover:text-fg flex items-center gap-1 mb-2"><ArrowLeft size={12} /> All cars</button>
        <PageHeader icon={Car} title={car.vehicle.plate_number} labels={<Label tone={car.status === 'on_target' ? 'success' : car.status === 'below' ? 'attention' : 'danger'}>{car.status === 'on_target' ? 'On target' : car.status === 'below' ? 'Below target' : 'Losing money'}</Label>}
          meta={<><span>Owner: {car.ownerName}</span><span>{car.days} days in this period</span>{car.vehicle.operation_start_date && <span>On the road since {car.vehicle.operation_start_date}</span>}</>} actions={tabs} />
        <StatGrid cols={5}>
          <StatCard icon={Wallet} label="Should have collected" value={rwf(car.expected)} sub="360,000 a week for two seats" />
          <StatCard label="Collected" value={rwf(car.collected)} sub={kept !== null ? `${kept}% of what it should` : ''} tone={kept !== null && kept < 90 ? 'danger' : undefined} />
          {seesOwner && <StatCard label="Kivu Ride's share" value={rwf(shareOf(car))} sub={`should be ${rwf(targetShareOf(car))} after the owner`} tone={shareOf(car) < targetShareOf(car) ? 'attention' : 'success'} />}
          <StatCard icon={TrendingDown} label="Lost" value={rwf(car.lost)} sub={CAUSES.filter((x) => car.byCause[x.key] > 0).map((x) => `${x.label} ${short(car.byCause[x.key])}`).join(' · ') || 'nothing'} tone={car.lost > 0 ? 'danger' : undefined} />
          <StatCard icon={CarFront} label="Freelance shifts" value={car.freelanceShifts} sub={car.freelanceCollected ? `${rwf(car.freelanceCollected)} collected` : 'none'} />
        </StatGrid>
        {weekRows.length > 1 && (
          <div className="mb-4"><ChartCard title="Week by week: should vs did" legend={[{ key: 'should', label: 'Should collect', color: c.other }, { key: 'did', label: 'Collected', color: c.aqua }]}>
            <DailyBars data={weekRows} c={c} stacked={false} xFormat={(x) => `wk ${new Date(`${x}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`} format={short} series={[{ key: 'should', label: 'Should collect', color: c.other }, { key: 'did', label: 'Collected', color: c.aqua }]} />
          </ChartCard></div>
        )}
        <Box title={`Drivers who drove it (${car.drivers.length})`} icon={Users2} padded={false} className="mb-4">
          <div className="overflow-x-auto"><table className="w-full text-small min-w-[820px]">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Driver', 'On this car', 'Days', 'Should pay', 'Paid', 'Lost', 'How it went', 'Replaced by'].map((h, k) => <th key={h} className={`${td} ${k >= 2 && k <= 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>{car.drivers.map((r) => {
              const rep = replacedBy(r.driver.id);
              const how = r.cause === 'left_owing' ? <Label tone="danger">Left owing</Label> : r.cause === 'owes' ? <Label tone="danger">Defaulted</Label> : r.cause === 'paused' ? <Label tone="attention">Paused days</Label> : r.ended ? <Label>Ended, paid up</Label> : <Label tone="success">Paying on time</Label>;
              return (
                <tr key={r.driver.id} className="border-t border-line-muted">
                  <td className={`${td} font-medium`}><Link to={`/fleet/drivers/${r.driver.id}`} className="hover:underline">{r.driver.full_name}</Link><span className="block text-caption text-fg-muted">{r.driver.shift ? SHIFT_LABEL[(r.driver.shift === 'full' ? 'full' : r.driver.shift) as 'day' | 'night' | 'full'] : ''}</span></td>
                  <td className={`${td} text-caption whitespace-nowrap`}>{span(r.driver.id)}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.days}</td><td className={`${td} text-right tabular-nums`}>{short(r.expected)}</td>
                  <td className={`${td} text-right tabular-nums`}>{short(r.collected)}</td><td className={`${td} text-right tabular-nums ${r.lost > 0 ? 'text-danger font-medium' : ''}`}>{r.lost > 0 ? short(r.lost) : '—'}</td>
                  <td className={td}>{how}</td><td className={`${td} text-caption`}>{rep ? rep.full_name : '—'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Box>
        <Box title={`Freelance shifts on this car (${shifts.length})`} icon={CarFront} padded={false}>
          {shifts.length ? <table className="w-full text-small"><tbody>{shifts.map((s) => (
            <tr key={s.id} className="border-t border-line-muted first:border-t-0"><td className={td}>{s.day}</td><td className={td}>{SHIFT_LABEL[s.shift]}</td><td className={td}>{fl.freelancers.find((f) => f.id === s.freelancer_id)?.full_name}</td>
              <td className={`${td} text-caption text-fg-muted`}>{s.covering_driver_id ? `for ${fleet.drivers.find((d) => d.id === s.covering_driver_id)?.full_name ?? ''}` : 'empty seat'}</td>
              <td className={`${td} text-right tabular-nums`}>{s.paid_amount !== null ? rwf(Number(s.paid_amount)) : '—'}</td><td className={td}><Label tone={SHIFT_STATUS[s.status].tone}>{SHIFT_STATUS[s.status].label}</Label></td></tr>
          ))}</tbody></table> : <p className="p-5 text-small text-fg-muted">No freelance shift in this period.</p>}
        </Box>
      </div>
    );
  }

  const cars = leak.cars;
  const tot = { should: cars.reduce((s, x) => s + x.expected, 0), did: cars.reduce((s, x) => s + x.collected, 0), lost: cars.reduce((s, x) => s + x.lost, 0) };
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Car} title="Cars: should vs did" subtitle="Every managed car: what it should have collected, what it did, who defaulted, who replaced them and what freelancers saved. Not a single day should be lost." actions={tabs} />
      <StatGrid cols={4}>
        <StatCard icon={Wallet} label="Should have collected" value={rwf(tot.should)} sub={`${cars.length} cars`} />
        <StatCard label="Collected" value={rwf(tot.did)} sub={`${pct(tot.did, tot.should) ?? '—'}%`} tone={(pct(tot.did, tot.should) ?? 100) < 90 ? 'danger' : undefined} />
        {seesOwner ? <StatCard label="Kivu Ride's share" value={rwf(shareOf(leak))} sub={`should be ${rwf(targetShareOf(leak))}`} /> : <StatCard label="Freelance shifts" value={cars.reduce((s, x) => s + x.freelanceShifts, 0)} />}
        <StatCard icon={TrendingDown} label="Lost" value={rwf(tot.lost)} sub={CAUSES.filter((x) => leak.byCause[x.key] > 0).map((x) => `${x.label} ${short(leak.byCause[x.key])}`).join(' · ')} tone={tot.lost ? 'danger' : undefined} />
      </StatGrid>
      <Box title="Car by car" icon={Car} padded={false}>
        <div className="overflow-x-auto"><table className="w-full text-small min-w-[900px]">
          <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Car', 'Should', 'Did', 'Kept', ...(seesOwner ? ['Our share'] : []), 'Lost', 'Main loss', 'Drivers', 'Defaulted', 'Freelance'].map((h, k) => <th key={h} className={`${td} ${k >= 1 && k <= (seesOwner ? 5 : 4) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>{cars.map((x) => {
            const k = pct(x.collected, x.expected);
            const main = CAUSES.map((cz) => ({ cz, n: x.byCause[cz.key] })).sort((p, q) => q.n - p.n)[0];
            return (
              <tr key={x.vehicle.id} onClick={() => setParams({ car: x.vehicle.id })} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                <td className={td}><b>{x.vehicle.plate_number}</b><span className="block text-caption text-fg-muted">{x.ownerName}</span></td>
                <td className={`${td} text-right tabular-nums`}>{short(x.expected)}</td><td className={`${td} text-right tabular-nums`}>{short(x.collected)}</td>
                <td className={`${td} text-right tabular-nums font-semibold ${k === null ? '' : k >= 98 ? 'text-success' : k >= 85 ? 'text-attention' : 'text-danger'}`}>{k === null ? '—' : `${k}%`}</td>
                {seesOwner && <td className={`${td} text-right tabular-nums`}>{short(shareOf(x))}</td>}
                <td className={`${td} text-right tabular-nums ${x.lost ? 'text-danger' : ''}`}>{x.lost ? short(x.lost) : '—'}</td>
                <td className={`${td} text-caption`}>{main && main.n > 0 ? CAUSE_LABEL[main.cz.key] : '—'}</td>
                <td className={`${td} tabular-nums`}>{x.drivers.length}</td>
                <td className={`${td} tabular-nums ${defaulted(x).length ? 'text-danger' : ''}`}>{defaulted(x).length ? <span className="inline-flex items-center gap-1"><UserX size={12} />{defaulted(x).length}</span> : '—'}</td>
                <td className={`${td} tabular-nums text-caption`}>{x.freelanceShifts ? `${x.freelanceShifts} · ${short(x.freelanceCollected)}` : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {!seesOwner && <p className="px-4 py-2 text-caption text-fg-muted border-t border-line-muted">Kivu Ride's share after the owner is shown to the MD and Finance.</p>}
      </Box>
    </div>
  );
}
