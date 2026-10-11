import { useMemo, useState } from 'react';
import { BadgeCheck, CalendarOff, Gavel, UserRound, Wallet, XCircle } from 'lucide-react';
import { ChartCard, Kpi, pct, RankBars, rwf, rwfShort, usePalette } from '../../components/charts/kit';
import { PAUSE_REASON_LABEL } from '../../lib/fleet';
import { PauseReason } from '../../lib/supabase';
import { driverRows, DriverRow, PerfData, Period } from '../../lib/performance';

type SortKey = 'reliability' | 'lost' | 'paused' | 'collected' | 'owes' | 'name';

// Every driver over the period: days paid for, days lost (driven without
// paying), days off and why, money paid, fines and what they owe now.
export default function DriversTab({ data, period: p }: { data: PerfData; period: Period }) {
  const c = usePalette();
  const [sort, setSort] = useState<SortKey>('lost');
  const [showEnded, setShowEnded] = useState(false);
  const all = useMemo(() => driverRows(data, p), [data, p]);
  const rows = all.filter((r) => showEnded || !r.end);
  const active = all.filter((r) => !r.end && r.driver.vehicle_id);

  const sum = (f: (r: DriverRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const paid = sum((r) => r.paid), lost = sum((r) => r.unpaid), paused = sum((r) => r.paused);
  const collectedN = sum((r) => r.collected), fines = sum((r) => r.fines), finesUnpaid = sum((r) => r.finesUnpaid);
  const byReason = Object.entries(rows.reduce<Record<string, number>>((acc, r) => {
    for (const [k, n] of Object.entries(r.pausedBy)) acc[k] = (acc[k] ?? 0) + (n ?? 0);
    return acc;
  }, {})).map(([k, n]) => ({ key: k, label: PAUSE_REASON_LABEL[k as PauseReason] ?? k, n })).sort((a, b) => b.n - a.n);
  const reliability = (r: DriverRow) => (r.paid + r.unpaid ? r.paid / (r.paid + r.unpaid) : 1);

  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case 'reliability': return reliability(a) - reliability(b);
      case 'lost': return b.unpaid - a.unpaid;
      case 'paused': return b.paused - a.paused;
      case 'collected': return b.collected - a.collected;
      case 'owes': return b.standing.owes - a.standing.owes;
      default: return a.driver.full_name.localeCompare(b.driver.full_name);
    }
  });
  const label = (r: DriverRow) => `${r.driver.full_name.split(/\s+/).slice(0, 2).join(' ')}`;
  const th = (k: SortKey | null, text: string, right = true) => (
    <th className={`py-1.5 pr-3 font-medium ${right ? 'text-right' : ''}`}>
      {k ? <button onClick={() => setSort(k)} className={`hover:text-brand-600 ${sort === k ? 'text-brand-600 dark:text-brand-300' : ''}`}>{text}{sort === k ? ' ↓' : ''}</button> : text}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={UserRound} label="Drivers on the road" value={active.length} sub={`${active.filter((r) => r.standing.isCleared).length} paid up today`} />
        <Kpi icon={BadgeCheck} label="Days paid for" value={paid + lost ? `${pct(paid, paid + lost)}%` : '—'} sub={`${paid} of ${paid + lost} working days were paid by the day they were driven`} />
        <Kpi icon={XCircle} label="Days lost" value={lost} tone={lost ? 'bad' : undefined} sub="Working days driven without paying" />
        <Kpi icon={CalendarOff} label="Days off (paused)" value={paused} sub={byReason[0] ? `Mostly ${byReason[0].label.toLowerCase()} (${byReason[0].n})` : 'No pauses in this period'} />
        <Kpi icon={Wallet} label="Paid in by drivers" value={rwfShort(collectedN)} sub={rwf(collectedN)} />
        <Kpi icon={Gavel} label="Fines" value={rwfShort(fines)} sub={fines ? `${rwf(finesUnpaid)} still unpaid` : 'No fines in this period'} tone={finesUnpaid ? 'bad' : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Most days lost" subtitle="Working days driven without paying">
          <RankBars rows={rows.filter((r) => r.unpaid).sort((a, b) => b.unpaid - a.unpaid).slice(0, 10).map((r) => ({ key: r.driver.id, label: label(r), n: r.unpaid }))} color={c.orange} empty="No days lost in this period." />
        </ChartCard>
        <ChartCard title="Days off by reason" subtitle="Paused days (sick, garage...)">
          <RankBars rows={byReason} color={c.aqua} empty="No days off in this period." />
        </ChartCard>
        <ChartCard title="Paid in by driver" subtitle="Deposits in this period">
          <RankBars rows={rows.filter((r) => r.collected).sort((a, b) => b.collected - a.collected).slice(0, 10).map((r) => ({ key: r.driver.id, label: label(r), n: r.collected }))} color={c.blue} format={rwfShort} empty="No deposits in this period." />
        </ChartCard>
      </div>

      <div className="card p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold">Every driver</p>
            <p className="text-[11px] text-gray-500">Paid = the day was covered by what they had paid by then. Click a column to sort.</p>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show ended contracts</label>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-[11px] min-w-[920px]">
            <thead><tr className="text-left text-gray-500">
              {th('name', 'Driver', false)}<th className="py-1.5 pr-3 font-medium">Car</th>{th('reliability', 'Paid on time')}<th className="py-1.5 pr-3 font-medium text-right">Days paid</th>
              {th('lost', 'Days lost')}{th('paused', 'Days off')}{th('collected', 'Paid in')}<th className="py-1.5 pr-3 font-medium text-right">Fines unpaid</th>{th('owes', 'Owes now')}<th className="py-1.5 font-medium text-right">Today</th>
            </tr></thead>
            <tbody>
              {sorted.map((r) => {
                const rel = pct(r.paid, r.paid + r.unpaid);
                const reasons = Object.entries(r.pausedBy).map(([k, n]) => `${PAUSE_REASON_LABEL[k as PauseReason]} ${n}`).join(', ');
                return (
                  <tr key={r.driver.id} className={`border-t border-gray-100 dark:border-white/5 ${r.end ? 'opacity-60' : ''}`}>
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.driver.full_name}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{r.driver.vehicle?.plate_number ?? '—'}{r.driver.shift ? ` · ${r.driver.shift === 'day' ? 'Day' : 'Night'}` : ''}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${rel !== null && rel < 80 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>{rel === null ? '—' : `${rel}%`}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.paid}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${r.unpaid ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{r.unpaid || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" title={reasons}>{r.paused || '—'}{reasons && <span className="block text-[10px] text-gray-400">{reasons}</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.collected ? rwf(r.collected) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.finesUnpaid ? rwf(r.finesUnpaid) : '—'}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${r.standing.owes ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-400'}`}>{r.end ? '—' : r.standing.owes ? rwf(r.standing.owes) : '—'}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {r.end ? <span className="text-gray-400">Ended {r.end}</span>
                        : r.standing.pausedToday ? <span className="text-amber-700 dark:text-amber-300">Paused</span>
                        : r.standing.isCleared ? <span className="text-emerald-700 dark:text-emerald-400">Paid up</span>
                        : <span className="text-red-600 dark:text-red-400">Not paid up</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="text-[12px] text-gray-400 text-center py-6">No drivers on contract in this period.</p>}
      </div>
    </div>
  );
}
