import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, Coins, Hourglass, Scale, Target } from 'lucide-react';
import { ChartCard, DailyBars, Delta, Kpi, MiniTable, pct, RankBars, rwf, rwfShort, shortDay, usePalette } from '../../components/charts/kit';
import { TYPE_META } from '../../lib/finance';
import { FinanceTransactionType } from '../../lib/supabase';
import { DAILY_DEPOSIT_RATE } from '../../lib/fleet';
import { addDays, CASH_IN_TYPES, collected, driverDay, drives, endDateOf, kivuRevenue, moneyIn, moneyOut, onContract, PerfData, Period, weeksOf, within } from '../../lib/performance';

const weekLabel = (start: string) => `Week of ${shortDay(start)}`;

// Money in and out, Kivu's own revenue, and what drivers paid against what
// their working days cost - week by week.
export default function MoneyTab({ data, period: p }: { data: PerfData; period: Period }) {
  const c = usePalette();
  const tx = data.transactions;
  const inN = moneyIn(tx, p.from, p.to), outN = moneyOut(tx, p.from, p.to);
  const inPrev = moneyIn(tx, p.prevFrom, p.prevTo), outPrev = moneyOut(tx, p.prevFrom, p.prevTo);
  const rev = kivuRevenue(tx, p.from, p.to), revPrev = kivuRevenue(tx, p.prevFrom, p.prevTo);
  const pending = tx.filter((t) => t.status === 'pending' || t.status === 'checked');
  const pendingOwners = pending.filter((t) => t.type === 'vehicle_owner_payment').reduce((s, t) => s + Number(t.amount), 0);

  const weeks = useMemo(() => weeksOf(p.from, p.to).map((w) => {
    // Driver money counts only the days inside the period (the first week may be partial).
    const from = w.start > p.from ? w.start : p.from;
    const to = w.end < p.to ? w.end : p.to;
    let expected = 0;
    for (let day = from; day <= to; day = addDays(day, 1)) {
      for (const d of data.drivers) {
        if (!drives(d) || !onContract(d, endDateOf(d, data.events), day)) continue;
        const st = driverDay(d, data.deposits.filter((x) => x.driver_id === d.id), day);
        if (st === 'paid' || st === 'unpaid') expected += DAILY_DEPOSIT_RATE;
      }
    }
    const byType = (types: string[]) => tx.filter((t) => (t.status === 'posted' || t.status === 'approved') && t.direction === 'in' && types.includes(t.type) && within(t.transaction_date, w.start, w.end)).reduce((s, t) => s + Number(t.amount), 0);
    return {
      start: w.start, label: weekLabel(w.start),
      in: moneyIn(tx, w.start, w.end), out: moneyOut(tx, w.start, w.end),
      expected, collected: collected(data, from, to),
      margin: byType(['management_margin']), onboarding: byType(['onboarding_fee']), other: byType(['revenue']),
    };
  }), [data, tx, p.from, p.to]);

  const expected = weeks.reduce((s, w) => s + w.expected, 0);
  const got = weeks.reduce((s, w) => s + w.collected, 0);
  const spending = Object.entries(tx.filter((t) => (t.status === 'posted' || t.status === 'approved') && t.direction === 'out' && t.type !== 'transfer' && within(t.transaction_date, p.from, p.to))
    .reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.type]: (acc[t.type] ?? 0) + Number(t.amount) }), {}))
    .map(([k, n]) => ({ key: k, label: TYPE_META[k as FinanceTransactionType]?.label ?? k, n })).sort((a, b) => b.n - a.n);
  const income = Object.entries(tx.filter((t) => (t.status === 'posted' || t.status === 'approved') && t.direction === 'in' && CASH_IN_TYPES.includes(t.type) && within(t.transaction_date, p.from, p.to))
    .reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.type]: (acc[t.type] ?? 0) + Number(t.amount) }), {}))
    .map(([k, n]) => ({ key: k, label: TYPE_META[k as FinanceTransactionType]?.label ?? k, n })).sort((a, b) => b.n - a.n);
  const pendingByType = Object.entries(pending.reduce<Record<string, { n: number; amount: number }>>((acc, t) => {
    const x = acc[t.type] ?? { n: 0, amount: 0 };
    return { ...acc, [t.type]: { n: x.n + 1, amount: x.amount + Number(t.amount) } };
  }, {})).sort((a, b) => b[1].amount - a[1].amount);

  const cashSeries = [{ key: 'in', label: 'Money in', color: c.blue }, { key: 'out', label: 'Money out', color: c.orange }] as const;
  const revSeries = [{ key: 'margin', label: 'Management margin', color: c.blue }, { key: 'onboarding', label: 'Onboarding fees', color: c.orange }, { key: 'other', label: 'Other revenue', color: c.aqua }] as const;
  const driverSeries = [{ key: 'expected', label: 'Cost of days worked', color: c.other }, { key: 'collected', label: 'Paid in', color: c.blue }] as const;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={ArrowDownLeft} label="Money in" value={rwfShort(inN)} sub={`${rwf(inN)} · collections, fees, revenue`} compare={<Delta now={inN} before={inPrev} />} />
        <Kpi icon={ArrowUpRight} label="Money out" value={rwfShort(outN)} sub={`${rwf(outN)} · owners, payroll, suppliers`} compare={<Delta now={outN} before={outPrev} goodWhenUp={false} />} />
        <Kpi icon={Scale} label="Net cash" value={rwfShort(inN - outN)} tone={inN - outN < 0 ? 'bad' : undefined} sub="Approved and posted entries only; transfers between our banks left out" />
        <Kpi icon={Coins} label="Kivu's own revenue" value={rwfShort(rev)} sub="Margin, onboarding and other fees" compare={<Delta now={rev} before={revPrev} />} />
        <Kpi icon={Target} label="Drivers paid vs owed" value={expected ? `${pct(got, expected)}%` : '—'} sub={`${rwf(got)} paid for ${rwf(expected)} of working days`} tone={expected && got < expected ? 'bad' : undefined} />
        <Kpi icon={Hourglass} label="Waiting for approval" value={pending.length} sub={`${rwf(pending.reduce((s, t) => s + Number(t.amount), 0))} · owners ${rwf(pendingOwners)}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Money in and out per week" legend={cashSeries}
          table={<MiniTable head={['Week', 'In', 'Out', 'Net']} rows={[...weeks].reverse().map((w) => [w.label, rwf(w.in), rwf(w.out), rwf(w.in - w.out)])} />}>
          <DailyBars data={weeks} series={cashSeries} c={c} stacked={false} format={rwfShort} xKey="start" tipTitle={weekLabel} />
        </ChartCard>
        <ChartCard title="Kivu's own revenue per week" legend={revSeries}
          table={<MiniTable head={['Week', 'Margin', 'Onboarding', 'Other']} rows={[...weeks].reverse().map((w) => [w.label, rwf(w.margin), rwf(w.onboarding), rwf(w.other)])} />}>
          <DailyBars data={weeks} series={revSeries} c={c} format={rwfShort} xKey="start" tipTitle={weekLabel} />
        </ChartCard>
      </div>

      <ChartCard title="Drivers: paid in vs cost of days worked" subtitle={`Each working day costs ${rwf(DAILY_DEPOSIT_RATE)}; rest days and paused days cost nothing`} legend={driverSeries}
        table={<MiniTable head={['Week', 'Cost of days worked', 'Paid in', 'Rate']} rows={[...weeks].reverse().map((w) => [w.label, rwf(w.expected), rwf(w.collected), w.expected ? `${pct(w.collected, w.expected)}%` : '—'])} />}>
        <DailyBars data={weeks} series={driverSeries} c={c} stacked={false} format={rwfShort} xKey="start" tipTitle={weekLabel} />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Where money came from" subtitle="This period">
          <RankBars rows={income} color={c.blue} format={rwfShort} empty="No money in this period." />
        </ChartCard>
        <ChartCard title="Where money went" subtitle="This period">
          <RankBars rows={spending} color={c.orange} format={rwfShort} empty="No money out this period." />
        </ChartCard>
        <div className="card p-4 space-y-2">
          <p className="text-body font-semibold">Waiting for approval</p>
          {pendingByType.length === 0 ? <p className="text-small text-fg-muted">Nothing waiting.</p> : (
            <ul className="space-y-1 text-small">
              {pendingByType.map(([k, x]) => <li key={k} className="flex justify-between gap-2"><span>{TYPE_META[k as FinanceTransactionType]?.label ?? k} <span className="text-fg-subtle">· {x.n}</span></span><b className="tabular-nums">{rwf(x.amount)}</b></li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
