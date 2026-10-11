import { useMemo } from 'react';
import { Car, FileWarning, Gauge, ParkingCircleOff, Wrench } from 'lucide-react';
import { ChartCard, DailyBars, Kpi, MiniTable, longDay, pct, RankBars, usePalette } from '../../components/charts/kit';
import { addDays, CAR_STATE_LABEL, carDay, CarDayState, endDateOf, fleetDays, onContract, PerfData, Period, today } from '../../lib/performance';
import { pauseOn } from '../../lib/fleet';

// Every car: was it working, off for a reason, held back by an unpaid
// driver, or without a driver - day by day - plus garage days and licences.
export default function FleetTab({ data, period: p }: { data: PerfData; period: Period }) {
  const c = usePalette();
  const t = today();
  const days = useMemo(() => fleetDays(data, p.from, p.to), [data, p.from, p.to]);
  const series = [
    { key: 'working', label: CAR_STATE_LABEL.working, color: c.blue },
    { key: 'unpaid', label: CAR_STATE_LABEL.unpaid, color: c.orange },
    { key: 'paused', label: CAR_STATE_LABEL.paused, color: c.aqua },
    { key: 'rest', label: CAR_STATE_LABEL.rest, color: c.yellow },
    { key: 'no_driver', label: CAR_STATE_LABEL.no_driver, color: c.other },
  ] as const;

  const cars = useMemo(() => data.vehicles.map((v) => {
    const count: Record<CarDayState, number> = { working: 0, paused: 0, rest: 0, unpaid: 0, no_driver: 0 };
    let garage = 0;
    const drivers = data.drivers.filter((d) => d.vehicle_id === v.id);
    for (let day = p.from; day <= p.to; day = addDays(day, 1)) {
      const s = carDay(v, data, day);
      if (s) count[s] += 1;
      if (drivers.some((d) => onContract(d, endDateOf(d, data.events), day) && ['garage', 'accident'].includes(pauseOn(d.pauses, day)?.reason ?? ''))) garage += 1;
    }
    const total = count.working + count.paused + count.unpaid + count.no_driver;
    const onNow = drivers.filter((d) => onContract(d, endDateOf(d, data.events), t));
    return { v, count, total, garage, onNow, util: total ? count.working / total : null };
  }), [data, p.from, p.to, t]);

  const carDays = cars.reduce((s, x) => s + x.total, 0);
  const working = cars.reduce((s, x) => s + x.count.working, 0);
  const noDriver = cars.reduce((s, x) => s + x.count.no_driver, 0);
  const garage = cars.reduce((s, x) => s + x.garage, 0);
  const soon = addDays(t, 30);
  const licences = data.vehicles.filter((v) => v.rura_license_expiry_date && v.rura_license_expiry_date <= soon).sort((a, b) => (a.rura_license_expiry_date ?? '').localeCompare(b.rura_license_expiry_date ?? ''));
  const noLicence = data.vehicles.filter((v) => !v.rura_license_expiry_date).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Car} label="Cars" value={data.vehicles.length} sub={`${cars.filter((x) => x.onNow.length).length} with a driver today`} />
        <Kpi icon={Gauge} label="Car-days worked" value={carDays ? `${pct(working, carDays)}%` : '—'} sub={`${working} of ${carDays} car-days with a paid-up driver`} />
        <Kpi icon={ParkingCircleOff} label="Car-days without a driver" value={noDriver} tone={noDriver ? 'bad' : undefined} sub="Earn nothing for us or the owner" />
        <Kpi icon={Wrench} label="Garage & accident days" value={garage} sub="Days a car's driver was paused for the garage or an accident" />
      </div>

      <ChartCard title="Cars per day" subtitle="What each car did that day" legend={series}
        table={<MiniTable head={['Day', 'Working', 'Not paid up', 'Days off', 'Rest day', 'No driver']} rows={[...days].reverse().map((d) => [longDay(d.day), d.working, d.unpaid, d.paused, d.rest, d.no_driver])} />}>
        <DailyBars data={days as unknown as Record<string, number | string>[]} series={series} c={c} height={260} />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Car-days worked, by car" subtitle="Share of the period each car worked with a paid-up driver">
          <RankBars rows={[...cars].filter((x) => x.total).sort((a, b) => (b.util ?? 0) - (a.util ?? 0)).map((x) => ({ key: x.v.id, label: x.v.plate_number, n: Math.round((x.util ?? 0) * 100), sub: `${x.count.working}/${x.total} days` }))} color={c.blue} format={(n) => `${n}%`} empty="No cars in this period." />
        </ChartCard>
        <div className="card p-4 space-y-2">
          <p className="text-[13px] font-semibold flex items-center gap-1.5"><FileWarning size={14} /> RURA licences</p>
          {licences.length === 0 ? <p className="text-[12px] text-gray-500">No licence expires in the next 30 days.{noLicence ? ` ${noLicence} car${noLicence === 1 ? ' has' : 's have'} no expiry date recorded.` : ''}</p> : (
            <>
              <ul className="space-y-1 text-[12px]">
                {licences.map((v) => {
                  const expired = (v.rura_license_expiry_date ?? '') < t;
                  return <li key={v.id} className="flex justify-between gap-2"><span className="font-medium">{v.plate_number}</span><span className={expired ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-amber-700 dark:text-amber-400'}>{expired ? 'Expired' : 'Expires'} {longDay(v.rura_license_expiry_date!)}</span></li>;
                })}
              </ul>
              {noLicence > 0 && <p className="text-[11px] text-gray-500">{noLicence} car{noLicence === 1 ? ' has' : 's have'} no expiry date recorded.</p>}
            </>
          )}
        </div>
      </div>

      <div className="card p-4 space-y-2">
        <p className="text-[13px] font-semibold">Every car</p>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-[11px] min-w-[860px]">
            <thead><tr className="text-left text-gray-500">
              {['Car', 'Drivers today', 'Worked', 'Not paid up', 'Days off', 'No driver', 'Garage / accident', 'Owner payout / week'].map((h, i) => <th key={h} className={`py-1.5 pr-3 font-medium ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {[...cars].sort((a, b) => (a.util ?? 2) - (b.util ?? 2)).map((x) => (
                <tr key={x.v.id} className="border-t border-gray-100 dark:border-white/5">
                  <td className="py-2 pr-3 whitespace-nowrap"><span className="font-medium">{x.v.plate_number}</span><span className="block text-[10px] text-gray-400">{[x.v.make, x.v.model].filter(Boolean).join(' ')}</span></td>
                  <td className="py-2 pr-3">{x.onNow.length ? x.onNow.map((d) => `${d.full_name.split(/\s+/)[0]}${d.shift ? ` (${d.shift})` : ''}`).join(', ') : <span className="text-red-600 dark:text-red-400">None</span>}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{x.count.working}{x.util !== null && <span className="text-gray-400"> · {Math.round(x.util * 100)}%</span>}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${x.count.unpaid ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{x.count.unpaid || '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{x.count.paused || '—'}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${x.count.no_driver ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{x.count.no_driver || '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{x.garage || '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{x.v.weekly_owner_payout_amount ? Number(x.v.weekly_owner_payout_amount).toLocaleString('en-US') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-400">Based on which car each driver is on now; a driver who moved cars counts on their current car.</p>
      </div>
    </div>
  );
}
