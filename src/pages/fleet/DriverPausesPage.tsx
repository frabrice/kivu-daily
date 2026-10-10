import { useEffect, useMemo, useState } from 'react';
import { CalendarOff, PauseCircle } from 'lucide-react';
import { supabase, Driver, PauseReason } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useDuties } from '../../lib/callTickets';
import { canRecordPause, canReviewPause, countWorkingDays, DAILY_DEPOSIT_RATE, PAUSE_REASONS, useFleetData } from '../../lib/fleet';
import PauseList, { isPausedOn } from '../../components/fleet/PauseList';
import PauseDrawer from '../../components/fleet/PauseDrawer';

const kigaliToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;

// Driver days off: pauses waiting for approval, who is paused now, this
// month's days off per driver (and the 30,000/day not charged), history.
export default function DriverPausesPage({ data }: { data?: ReturnType<typeof useFleetData> } = {}) {
  return data ? <View data={data} /> : <WithData />;
}
function WithData() { return <View data={useFleetData()} />; }

function View({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const duties = useDuties();
  const { drivers, loading, reload } = data;
  const [names, setNames] = useState<Record<string, string>>({});
  const [pickId, setPickId] = useState('');
  const [pausing, setPausing] = useState<Driver | null>(null);
  const [month, setMonth] = useState(kigaliToday().slice(0, 7));
  useEffect(() => {
    supabase.from('profiles').select('id, full_name').then(({ data: p }) => setNames(Object.fromEntries(((p as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name.trim()]))));
  }, []);

  const canRecord = canRecordPause(profile, duties);
  const canReview = canReviewPause(profile);
  const today = kigaliToday();
  const pauses = useMemo(() => drivers.flatMap((d) => d.pauses ?? []), [drivers]);
  const pending = pauses.filter((p) => p.approval_status === 'pending');
  const now = pauses.filter((p) => isPausedOn(p, today));

  // Paused working days in the month (up to today), per driver and reason.
  const summary = useMemo(() => {
    const from = `${month}-01`;
    const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toLocaleDateString('en-CA');
    const to = last < today ? last : today;
    const rows = new Map<string, { driver: Driver; byReason: Partial<Record<PauseReason, number>>; days: number }>();
    for (const d of drivers) for (const p of d.pauses ?? []) {
      if (p.approval_status === 'rejected') continue;
      const s = p.start_date > from ? p.start_date : from;
      const e = [p.end_date ?? to, to].sort()[0];
      if (s > e) continue;
      const n = countWorkingDays(s, e, d.rest_day);
      if (!n) continue;
      const r = rows.get(d.id) ?? { driver: d, byReason: {}, days: 0 };
      r.byReason[p.reason] = (r.byReason[p.reason] ?? 0) + n;
      r.days += n;
      rows.set(d.id, r);
    }
    return [...rows.values()].sort((a, b) => b.days - a.days);
  }, [drivers, month, today]);
  const totalDays = summary.reduce((s, r) => s + r.days, 0);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>;
  const active = drivers.filter((d) => d.contract_status === 'active').sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><CalendarOff size={16} className="text-amber-600 dark:text-amber-300" /> Driver days off</h2>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-2xl">Paused days (sick, car in the garage…) cost nothing and the driver isn't chased while paused. Janviere and Bertrand record pauses; the MD or Finance approves them.</p>
        </div>
        {canRecord && (
          <div className="flex gap-2">
            <select value={pickId} onChange={(e) => setPickId(e.target.value)} className="input py-1.5 text-[12px] w-56" aria-label="Driver to pause">
              <option value="">Choose a driver…</option>
              {active.map((d) => <option key={d.id} value={d.id}>{d.full_name.trim()}{d.vehicle?.plate_number ? ` · ${d.vehicle.plate_number}` : ''}</option>)}
            </select>
            <button onClick={() => setPausing(drivers.find((d) => d.id === pickId) ?? null)} disabled={!pickId} className="btn-primary flex items-center gap-1.5 disabled:opacity-50"><PauseCircle size={14} /> Pause days</button>
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <section className="card p-4 space-y-2">
          <p className="text-[13px] font-semibold">Waiting for approval ({pending.length})</p>
          <p className="text-[11px] text-gray-500">{canReview ? 'Approve, or reject with a reason — a rejected pause\'s days count again.' : 'The MD or Finance approves these.'}</p>
          <PauseList pauses={pending} drivers={drivers} names={names} canRecord={canRecord} canReview={canReview} showDriver onChanged={reload} />
        </section>
      )}

      <section className="card p-4 space-y-2">
        <p className="text-[13px] font-semibold">Paused today ({now.length})</p>
        <PauseList pauses={now} drivers={drivers} names={names} canRecord={canRecord} canReview={canReview} showDriver onChanged={reload} />
      </section>

      <section className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold">Days off in {new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
            <p className="text-[11px] text-gray-500">{totalDays} working days paused · {rwf(totalDays * DAILY_DEPOSIT_RATE)} not charged (30,000 a day). Owner payments and salaries are unchanged.</p>
          </div>
          <input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => setMonth(e.target.value || today.slice(0, 7))} className="input py-1 text-[12px] w-auto" aria-label="Month" />
        </div>
        {summary.length === 0 ? <p className="text-[12px] text-gray-400">No days off this month.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[640px]">
              <thead><tr className="text-left text-gray-500 text-[11px]">
                <th className="py-1.5 pr-3 font-medium">Driver</th>
                {PAUSE_REASONS.map((r) => <th key={r.key} className="py-1.5 pr-3 font-medium text-right">{r.label}</th>)}
                <th className="py-1.5 pr-3 font-medium text-right">Days</th>
                <th className="py-1.5 font-medium text-right">Not charged</th>
              </tr></thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.driver.id} className="border-t border-gray-100 dark:border-white/5">
                    <td className="py-1.5 pr-3 font-medium">{r.driver.full_name}<span className="block text-[10px] text-gray-500 font-normal">{r.driver.vehicle?.plate_number ?? ''}</span></td>
                    {PAUSE_REASONS.map((x) => <td key={x.key} className="py-1.5 pr-3 text-right tabular-nums">{r.byReason[x.key] ?? '—'}</td>)}
                    <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">{r.days}</td>
                    <td className="py-1.5 text-right tabular-nums">{rwf(r.days * DAILY_DEPOSIT_RATE)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-4 space-y-2">
        <p className="text-[13px] font-semibold">All pauses</p>
        <PauseList pauses={pauses.filter((p) => !isPausedOn(p, today) && p.approval_status !== 'pending')} drivers={drivers} names={names} canRecord={canRecord} canReview={canReview} showDriver onChanged={reload} />
      </section>

      {pausing && <PauseDrawer driver={pausing} drivers={drivers} onClose={() => setPausing(null)} onSaved={() => { setPausing(null); setPickId(''); reload(); }} />}
    </div>
  );
}

