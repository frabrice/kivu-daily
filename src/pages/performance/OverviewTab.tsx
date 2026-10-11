import { useMemo } from 'react';
import { AlertTriangle, BadgeCheck, CalendarOff, Car, ClipboardCheck, Coins, Megaphone, PhoneCall, Receipt, ShieldAlert, Wallet, XCircle } from 'lucide-react';
import { NavKey } from '../../components/AppShell';
import { ChartCard, DailyBars, Delta, Kpi, MiniTable, longDay, pct, rwf, rwfShort, usePalette } from '../../components/charts/kit';
import { CAR_STATE_LABEL, collected, driverRows, fleetDays, kDay, kivuRevenue, lostDays, PerfData, Period, personRows, today, within } from '../../lib/performance';
import { EntityLink } from '../../os/EntityLink';

type Tab = 'overview' | 'team' | 'drivers' | 'fleet' | 'money' | 'calls';

export default function OverviewTab({ data, period: p, onNavigate, onTab }: { data: PerfData; period: Period; onNavigate: (k: NavKey) => void; onTab: (t: Tab) => void }) {
  const c = usePalette();
  const t = today();

  const money = collected(data, p.from, p.to);
  const moneyPrev = collected(data, p.prevFrom, p.prevTo);
  const revenue = kivuRevenue(data.transactions, p.from, p.to);
  const revenuePrev = kivuRevenue(data.transactions, p.prevFrom, p.prevTo);

  const lost = useMemo(() => lostDays(data, p.from, p.to), [data, p.from, p.to]);
  const lostPrev = useMemo(() => lostDays(data, p.prevFrom, p.prevTo), [data, p.prevFrom, p.prevTo]);
  const lostN = lost.reduce((s, d) => s + d.lost, 0);
  const lostPrevN = lostPrev.reduce((s, d) => s + d.lost, 0);
  const pausedN = lost.reduce((s, d) => s + d.paused, 0);

  const fleet = useMemo(() => fleetDays(data, p.from, p.to), [data, p.from, p.to]);
  const todayFleet = fleet[fleet.length - 1];
  const carsToday = todayFleet ? todayFleet.working + todayFleet.paused + todayFleet.rest + todayFleet.unpaid + todayFleet.no_driver : 0;
  // Rest days are planned, so they don't count against the cars.
  const carDays = fleet.reduce((s, d) => s + d.working + d.paused + d.unpaid + d.no_driver, 0);
  const workingDays = fleet.reduce((s, d) => s + d.working, 0);

  const drivers = useMemo(() => driverRows(data, p), [data, p]);
  const active = drivers.filter((r) => !r.end && r.driver.vehicle_id);
  const cleared = active.filter((r) => r.standing.isCleared).length;
  const owedNow = active.reduce((s, r) => s + r.standing.owes, 0);

  const people = useMemo(() => personRows(data, p), [data, p]);
  const peoplePrev = useMemo(() => personRows(data, { ...p, from: p.prevFrom, to: p.prevTo }), [data, p]);
  const given = people.reduce((s, r) => s + r.given, 0);
  const done = people.reduce((s, r) => s + r.done, 0);
  const givenPrev = peoplePrev.reduce((s, r) => s + r.given, 0);
  const donePrev = peoplePrev.reduce((s, r) => s + r.done, 0);

  const shifts = data.shifts.filter((s) => within(kDay(s.started_at), p.from, p.to));
  const callsIn = shifts.reduce((s, x) => s + Number(x.report.calls_received ?? 0), 0);
  const callsOut = shifts.reduce((s, x) => s + Number(x.report.calls_made ?? 0), 0);
  const contacts = shifts.reduce((s, x) => s + (x.stats.contacts_logged ?? 0), 0);
  const solved = shifts.reduce((s, x) => s + (x.stats.solved_on_call ?? 0), 0);
  const outreach = data.outreach.filter((o) => within(kDay(o.created_at), p.from, p.to));
  const outreachYes = outreach.filter((o) => o.interested).length;

  const w = data.waiting;
  const waiting = [
    { n: w.pauses, label: `driver pause${w.pauses === 1 ? '' : 's'} to approve`, icon: CalendarOff, go: () => { try { localStorage.setItem('kivu-active-nav-fleet-tab', 'days_off'); } catch { /* ignore */ } onNavigate('fleet'); } },
    { n: w.emergencies, label: `emergenc${w.emergencies === 1 ? 'y' : 'ies'} not acknowledged`, icon: ShieldAlert, go: () => onNavigate('from_call_center') },
    { n: w.finance, label: `finance entr${w.finance === 1 ? 'y' : 'ies'} waiting (${rwf(w.financeAmount)})`, icon: Receipt, go: () => onNavigate('finance') },
    { n: w.deposits, label: `deposit${w.deposits === 1 ? '' : 's'} to confirm`, icon: Coins, go: () => onNavigate('finance') },
    { n: w.reviews, label: `finished task${w.reviews === 1 ? '' : 's'} to review`, icon: ClipboardCheck, go: () => onNavigate('dashboard') },
  ];
  const fleetSeries = [
    { key: 'working', label: CAR_STATE_LABEL.working, color: c.blue },
    { key: 'unpaid', label: CAR_STATE_LABEL.unpaid, color: c.orange },
    { key: 'paused', label: CAR_STATE_LABEL.paused, color: c.aqua },
    { key: 'rest', label: CAR_STATE_LABEL.rest, color: c.yellow },
    { key: 'no_driver', label: CAR_STATE_LABEL.no_driver, color: c.other },
  ] as const;
  const moneyDaily = lost.map((d) => ({ day: d.day, collected: data.deposits.filter((x) => x.paid_date === d.day).reduce((s, x) => s + Number(x.amount), 0) }));

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-body font-semibold mb-2">Waiting on you</p>
        {waiting.every((x) => !x.n) ? <p className="text-small text-fg-muted flex items-center gap-1.5"><BadgeCheck size={14} className="text-emerald-600" /> Nothing is waiting on you right now.</p> : (
          <div className="flex flex-wrap gap-2">
            {waiting.filter((x) => x.n).map((x) => (
              <button key={x.label} onClick={x.go} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 hover:border-brand/50 text-left">
                <x.icon size={15} className="text-amber-600 dark:text-amber-400" />
                <span className="text-small"><b className="tabular-nums">{x.n}</b> {x.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Wallet} label="Collected from drivers" value={rwfShort(money)} sub={rwf(money)} compare={<Delta now={money} before={moneyPrev} />} />
        <Kpi icon={Coins} label="Kivu's own revenue" value={rwfShort(revenue)} sub="Margin, fees and other income (approved/posted)" compare={<Delta now={revenue} before={revenuePrev} />} />
        <Kpi icon={BadgeCheck} label="Drivers paid up today" value={`${cleared}/${active.length}`} tone={active.length && cleared < active.length ? 'bad' : undefined} sub={owedNow ? `${rwf(owedNow)} owed for days already driven` : 'Nobody owes for days driven'} />
        <Kpi icon={Car} label="Cars working today" value={`${todayFleet?.working ?? 0}/${carsToday}`} sub={todayFleet?.rest ? `${todayFleet.rest} on their rest day · ${carDays ? `${pct(workingDays, carDays)}% of car-days worked` : ''}` : carDays ? `${pct(workingDays, carDays)}% of car-days worked in the period` : '—'} />
        <Kpi icon={XCircle} label="Driver days lost" value={lostN} tone={lostN ? 'bad' : undefined} sub={`Working days driven without payment · ${pausedN} paused days off`} compare={<Delta now={lostN} before={lostPrevN} goodWhenUp={false} />} />
        <Kpi icon={ClipboardCheck} label="Team tasks done" value={given ? `${pct(done, given)}%` : '—'} sub={`${done} of ${given} tasks`} compare={givenPrev ? <span className="text-fg-muted">{pct(donePrev, givenPrev)}% in the period before</span> : undefined} />
        <Kpi icon={PhoneCall} label="Calls handled" value={callsIn + callsOut} sub={`${callsIn} received · ${callsOut} made · ${contacts ? `${pct(solved, contacts)}% solved on the spot` : 'none logged'}`} />
        <Kpi icon={Megaphone} label="Outreach calls" value={outreach.length} sub={`${outreachYes} Non-Insider driver${outreachYes === 1 ? '' : 's'} said yes to something`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Cars per day" subtitle="What each car did that day, from its drivers' payments and days off" legend={fleetSeries}
          right={<button onClick={() => onTab('fleet')} className="text-caption text-brand-600 dark:text-brand-300 hover:underline">Fleet details</button>}
          table={<MiniTable head={['Day', 'Working', 'Not paid up', 'Days off', 'Rest day', 'No driver']} rows={[...fleet].reverse().map((d) => [longDay(d.day), d.working, d.unpaid, d.paused, d.rest, d.no_driver])} />}>
          <DailyBars data={fleet as unknown as Record<string, number | string>[]} series={fleetSeries} c={c} />
        </ChartCard>
        <ChartCard title="Collected from drivers per day" subtitle={`${rwf(money)} in ${p.days} days`}
          right={<button onClick={() => onTab('money')} className="text-caption text-brand-600 dark:text-brand-300 hover:underline">Money details</button>}
          table={<MiniTable head={['Day', 'Collected']} rows={[...moneyDaily].reverse().filter((d) => d.collected).map((d) => [longDay(d.day), rwf(d.collected)])} />}>
          <DailyBars data={moneyDaily} series={[{ key: 'collected', label: 'Collected', color: c.blue }]} c={c} format={rwfShort} tipTitle={(x) => longDay(x)} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Driver days lost per day" subtitle="Working days a driver drove without having paid for them (paused days don't count)"
          right={<button onClick={() => onTab('drivers')} className="text-caption text-brand-600 dark:text-brand-300 hover:underline">Driver details</button>}
          table={<MiniTable head={['Day', 'Lost', 'Paused']} rows={[...lost].reverse().map((d) => [longDay(d.day), d.lost, d.paused])} />}>
          {lostN === 0 ? <p className="text-small text-fg-subtle text-center py-10">No days lost in this period.</p> : <DailyBars data={lost} series={[{ key: 'lost', label: 'Days lost', color: c.orange }]} c={c} />}
        </ChartCard>
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-body font-semibold">Team at a glance</p>
            <button onClick={() => onTab('team')} className="text-caption text-brand-600 dark:text-brand-300 hover:underline">Team details</button>
          </div>
          {people.length === 0 ? <p className="text-small text-fg-subtle text-center py-8">No tasks in this period.</p> : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {people.map((r) => {
                const rate = pct(r.done, r.given) ?? 0;
                return (
                  <div key={r.id} className="grid grid-cols-[minmax(90px,150px)_1fr_auto] items-center gap-2 text-caption" title={`${r.name}: ${r.done} of ${r.given} done`}>
                    <span className="truncate text-fg-muted ">{r.name}</span>
                    <div className="h-3.5 rounded-[4px] bg-inset overflow-hidden"><div className="h-full rounded-r-[4px]" style={{ width: `${rate}%`, background: c.blue }} /></div>
                    <span className="tabular-nums text-right whitespace-nowrap">{rate}% <span className="text-fg-subtle">{r.done}/{r.given}</span>{r.missed ? <span className="text-red-600 dark:text-red-400"> · {r.missed} missed</span> : null}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {active.some((r) => !r.standing.isCleared) && (
        <div className="card p-4">
          <p className="text-body font-semibold flex items-center gap-1.5 mb-2"><AlertTriangle size={14} className="text-amber-600" /> Not paid up today ({t})</p>
          <div className="flex flex-wrap gap-2">
            {active.filter((r) => !r.standing.isCleared).sort((a, b) => b.standing.owes - a.standing.owes).map((r) => (
              <span key={r.driver.id} className="text-caption rounded-md bg-inset px-2 py-1">
                <EntityLink type="driver" id={r.driver.id} label={r.driver.full_name} /> · {r.driver.vehicle?.plate_number ?? '—'} · owes {rwf(r.standing.owes)}{r.standing.pausedToday ? ' · paused today' : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
