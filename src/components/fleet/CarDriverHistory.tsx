import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { supabase, Driver, DriverCarAssignment, DriverContractEvent, Vehicle } from '../../lib/supabase';
import { EntityLink } from '../../os/EntityLink';
import { Box, Label } from '../../ui/kit';
import { daysUntilDate, driverShiftShort, formatDateLabelSafe, modelOf, modelOn, shiftDay } from '../../lib/fleet';
import { todayStr } from '../../lib/utils';

// Every driver who has ever been on a car (driver_car_assignments: one row
// per stretch on a car, opened and closed whenever a driver's car changes),
// newest first: when, how long, on which model, and how it ended - moved to
// another car, contract ended, or still on it.
export default function CarDriverHistory({ carId, drivers, vehicles, contractEvents, compact = false }: {
  carId: string; drivers: Driver[]; vehicles: Vehicle[]; contractEvents: DriverContractEvent[]; compact?: boolean;
}) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['car-driver-history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('driver_car_assignments').select('*').order('from_date');
      if (error) throw new Error(error.message);
      return (data ?? []) as DriverCarAssignment[];
    },
  });
  const t = todayStr();
  const byId = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const plate = (vid: string | null) => vehicles.find((v) => v.id === vid)?.plate_number ?? null;

  const stints = useMemo(() => (rows ?? [])
    .filter((r) => r.vehicle_id === carId)
    .map((r) => {
      const d = byId.get(r.driver_id) ?? null;
      const to = r.to_date;
      // What came next for this driver: their next car, or the contract ending.
      const next = to ? (rows ?? []).find((x) => x.driver_id === r.driver_id && x.from_date > r.from_date && x.from_date <= shiftDay(to, 1) && x.vehicle_id && x.vehicle_id !== carId) : null;
      const ended = to ? contractEvents.find((e) => e.driver_id === r.driver_id && e.event_type === 'ended' && e.event_date >= shiftDay(to, -1) && e.event_date <= shiftDay(to, 2)) : null;
      const model = d ? modelOf(modelOn(d, to && to < t ? to : t)) : null;
      return { r, d, to, days: daysUntilDate(r.from_date, to ?? t) + 1, next, ended, model };
    })
    .sort((a, b) => (b.to ?? '9999').localeCompare(a.to ?? '9999') || b.r.from_date.localeCompare(a.r.from_date)), [rows, carId, byId, contractEvents, t]);

  const people = new Set(stints.map((s) => s.r.driver_id)).size;
  const since = stints.length ? stints.reduce((m, s) => (s.r.from_date < m ? s.r.from_date : m), stints[0].r.from_date) : null;
  const shown = compact ? stints.slice(0, 5) : stints;

  return (
    <Box title="Everyone who drove this car" icon={History} padded={false}
      right={stints.length ? <span className="text-caption text-fg-muted">{people} driver{people === 1 ? '' : 's'}{since ? ` since ${formatDateLabelSafe(since)}` : ''}</span> : undefined}>
      {isLoading ? <div className="p-4"><div className="h-10 skeleton rounded" /></div>
        : stints.length === 0 ? <p className="p-4 text-body text-fg-muted">No driver has been recorded on this car yet.</p> : (
        <ul className="divide-y divide-line-muted">
          {shown.map(({ r, d, to, days, next, ended, model }) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-body">{d ? <EntityLink type="driver" id={d.id} label={d.full_name} /> : <span className="text-fg-muted">A driver no longer in Kivu Daily</span>}</p>
                <p className="text-caption text-fg-muted">
                  {formatDateLabelSafe(r.from_date)} → {to ? formatDateLabelSafe(to) : 'now'} · {days} day{days === 1 ? '' : 's'}
                  {d && (model ? ` · ${model.label}${d.model === 'one_shift' && d.shift ? ` (${driverShiftShort(d)})` : ''}` : '')}
                </p>
                {to && (next || ended) && (
                  <p className="text-caption text-fg-subtle">
                    {ended ? `Contract ended${ended.reason ? `: ${ended.reason}` : ''}` : next ? <>Moved to <EntityLink type="car" id={next.vehicle_id!} label={plate(next.vehicle_id) ?? 'another car'} /></> : null}
                  </p>
                )}
              </div>
              {!to ? <Label tone="success">On it now</Label> : null}
            </li>
          ))}
          {compact && stints.length > shown.length && <li className="px-4 py-2 text-caption text-fg-muted">And {stints.length - shown.length} more on the car's page.</li>}
        </ul>
      )}
    </Box>
  );
}
