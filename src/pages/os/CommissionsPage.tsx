import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, Coins, Eye, PhoneCall, Smartphone, Wallet } from 'lucide-react';
import { usePageTitle } from '../../os/workspace';
import { useAccess } from '../../os/access';
import { kigaliToday } from '../../lib/kigali';
import { CTrip, Company, Followup, METHOD_LABEL, exemptMap, loadCommissions, summarise } from '../../lib/commissions';
import CommissionPreview from '../../components/commissions/CommissionPreview';
import { ChartCard, DailyBars, Empty, Kpi, MiniTable, RankBars, STATUS, dayList, longDay, usePalette } from '../../components/charts/kit';
import { Label, PageHeader } from '../../ui/kit';

// Trips > Commissions: what the 10% on completed trips should bring, what
// the app already took, what drivers owe from cash trips, and who to call.
// Sums in lib/commissions.ts. Reports are exported from the preview, where
// Finance and the MD leave company trips (and any other) out of commission.

const FIRST_DAY = '2026-05-31';
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fullDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const OUTCOME: Record<string, string> = { paid: 'Paid', promised: 'Promised', no_answer: 'No answer', refused: 'Refused', wrong_number: 'Wrong number' };

export default function CommissionsPage() {
  usePageTitle('Commissions');
  const a = useAccess();
  const c = usePalette();
  const [params, setParams] = useSearchParams();
  const today = kigaliToday();
  const from = isDay(params.get('from')) ? params.get('from')! : addDays(today, -1);
  const to = isDay(params.get('to')) && params.get('to')! >= from ? params.get('to')! : from;
  const only = params.get('who') === 'ours' ? 'ours' : 'all';
  const setQ = (patch: Record<string, string | null>) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });

  const [data, setData] = useState<{ trips: CTrip[]; followups: Followup[]; companies: Company[] } | null>(null);
  const [preview, setPreview] = useState(false);
  const [tick, setTick] = useState(0);
  const canEdit = a.isMd || a.dept === 'finance';
  useEffect(() => { let on = true; loadCommissions(from, to).then((d) => on && setData(d)); return () => { on = false; }; }, [from, to, tick]);
  useEffect(() => { setData(null); }, [from, to]);

  const days = useMemo(() => dayList(from, to), [from, to]);
  const scoped = useMemo(() => (data ? (only === 'ours' ? data.trips.filter((t) => t.kivu_driver_id) : data.trips) : []), [data, only]);
  const s = useMemo(() => (data ? summarise(scoped, data.followups, days, exemptMap(scoped)) : null), [data, scoped, days]);
  const period = from === to ? fullDay(from) : `${fullDay(from)} to ${fullDay(to)}`;
  const quick: [string, string, string][] = [['Yesterday', addDays(today, -1), addDays(today, -1)], ['Today', today, today], ['Last 7 days', addDays(today, -6), today], ['This month', `${today.slice(0, 8)}01`, today], ['All time', FIRST_DAY, today]];
  const series = [
    { key: 'byApp', label: 'Taken by the app', color: c.blue },
    { key: 'paid', label: 'Cash: recorded paid', color: c.aqua },
    { key: 'owed', label: 'Cash: still to collect', color: STATUS.critical },
  ] as const;

  return (
    <div className="space-y-4">
      <PageHeader icon={Coins} title="Commissions" subtitle={`${period} · 10% of every completed trip: expected, taken by the app, and what drivers still owe from cash trips`}
        actions={<button onClick={() => setPreview(true)} disabled={!s} className="btn-primary"><Eye size={14} /> Preview &amp; export</button>} />

      {preview && data && (
        <CommissionPreview trips={scoped} followups={data.followups} companies={data.companies} days={days} from={from} to={to} period={period}
          canEdit={canEdit} onClose={() => setPreview(false)} onSaved={() => setTick((n) => n + 1)} />
      )}
      <div className="card p-3 flex flex-wrap items-center gap-2 text-small">
        {quick.map(([l, f, t]) => (
          <button key={l} className={`px-2.5 py-1 rounded-md border ${from === f && to === t ? 'border-brand text-brand bg-brand/5 font-medium' : 'border-line text-fg-muted hover:border-brand/40'}`} onClick={() => setQ({ from: f, to: t })}>{l}</button>
        ))}
        <div className="flex gap-0.5 p-0.5 bg-inset rounded-lg" role="radiogroup" aria-label="Drivers">
          {([['all', 'All drivers'], ['ours', 'Our drivers']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={only === k} onClick={() => setQ({ who: k === 'all' ? null : k })} className={`px-2.5 py-1 rounded-md font-medium ${only === k ? 'bg-surface-3 shadow-sm text-brand' : 'text-fg-muted'}`}>{l}</button>
          ))}
        </div>
        <span className="flex items-center gap-1.5 sm:ml-auto flex-wrap">
          <CalendarDays size={14} className="text-fg-subtle" />
          <input type="date" className="input !w-auto py-1" value={from} min={FIRST_DAY} max={today} aria-label="From" onChange={(e) => e.target.value && setQ({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} />
          <span className="text-fg-subtle">to</span>
          <input type="date" className="input !w-auto py-1" value={to} min={from} max={today} aria-label="To" onChange={(e) => e.target.value && setQ({ to: e.target.value })} />
        </span>
      </div>

      {!s ? <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi icon={Coins} label="Expected (10%)" value={rwf(s.total.expected)} sub={`${s.total.trips} completed trips · ${rwf(s.total.fares)} in fares`} />
            <Kpi icon={Smartphone} label="Taken by the app" value={rwf(s.total.byApp)} sub="Paid by Mobile Money, card or a company account" />
            <Kpi icon={Wallet} label="Cash commission" value={rwf(s.total.cash)} sub={`Drivers hold the cash fare and owe this · ${s.total.expected ? Math.round((s.total.cash / s.total.expected) * 100) : 0}% of the total`} />
            <Kpi icon={PhoneCall} label="Recorded paid" value={rwf(s.total.paid)} sub="From the Call Center's commission follow-up" />
            <Kpi icon={Wallet} label="Still to collect" value={rwf(s.total.owed)} tone={s.total.owed ? 'bad' : undefined} sub={`${s.drivers.filter((r) => r.owed > 0).length} drivers`} />
            <Kpi icon={Coins} label="Collected so far" value={s.total.expected ? `${Math.round(((s.total.byApp + Math.min(s.total.paid, s.total.cash)) / s.total.expected) * 100)}%` : '—'} sub="Taken by the app + recorded paid, out of expected" />
          </div>

          {s.exempt.trips > 0 && (
            <p className="text-small rounded-md border border-line-muted px-3 py-2">
              <b>{s.exempt.trips} trip{s.exempt.trips === 1 ? '' : 's'} left out of commission</b> ({rwf(s.exempt.fares)} in fares): company trips, paid to Kivu Ride and driven by our own drivers{s.exempt.rows.some((x) => !x.trip.company) ? ', and trips Finance left out' : ''}.{' '}
              <button className="link" onClick={() => setPreview(true)}>See them in the preview</button>
            </p>
          )}

          <p className="text-caption text-fg-muted rounded-md bg-inset px-3 py-2">
            "Recorded paid" only counts what the Call Center logs in <Link className="link" to="/call-center/commissions">Commission follow-up</Link>. The exact amounts in each driver's app wallet need KivuRide to give our key the finance permissions (<code>finance.view</code>, <code>driver_finance.view</code>).
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Commission per day" subtitle="Taken by the app, cash recorded paid, cash still to collect" legend={series}
              table={<MiniTable head={['Day', 'Trips', 'Expected', 'By the app', 'Paid', 'To collect']} rows={s.days.filter((d) => d.trips || d.paid).map((d) => [longDay(d.day), d.trips, rwf(d.expected), rwf(d.byApp), rwf(d.paid), rwf(d.owed)])} />}>
              {s.total.trips ? <DailyBars data={s.days} series={series} c={c} format={(n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))} /> : <Empty>No completed trips in this period.</Empty>}
            </ChartCard>
            <ChartCard title="How riders paid" subtitle="Commission by payment method">
              <RankBars rows={s.methods.map((m) => ({ key: m.method, label: METHOD_LABEL[m.method] ?? m.method, n: Math.round(m.commission), sub: `(${m.trips} trips)` }))} color={c.blue} format={rwf} empty="No completed trips in this period." />
            </ChartCard>
          </div>

          <div className="card overflow-x-auto">
            <div className="px-4 pt-4 pb-2 flex flex-wrap items-center gap-2">
              <p className="text-body font-semibold flex-1">Drivers · who to call first</p>
              {(a.isMd || a.dept === 'call_center') && <Link to="/call-center/commissions" className="btn-secondary h-8 text-small"><PhoneCall size={13} /> Commission follow-up</Link>}
            </div>
            {s.drivers.length === 0 ? <Empty>No completed trips in this period.</Empty> : (
              <table className="w-full text-small min-w-[880px]">
                <thead><tr className="text-caption text-fg-subtle text-left border-b border-line-muted">
                  {['Driver', 'Trips', 'Fares', 'Expected', 'By the app', 'Cash commission', 'Recorded paid', 'Still to collect', 'Last follow-up'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-line-muted">
                  {s.drivers.map((r) => (
                    <tr key={r.key} className="hover:bg-hover">
                      <td className="px-3 py-2"><p className="font-medium">{r.name}{r.ours && <span className="ml-1.5"><Label tone="accent">Ours</Label></span>}</p>{r.phone && <a href={`tel:${r.phone}`} className="text-caption text-fg-muted">{r.phone}</a>}</td>
                      <td className="px-3 py-2 tabular-nums">{r.trips}<span className="text-fg-subtle"> · {r.cashTrips} cash</span></td>
                      <td className="px-3 py-2 tabular-nums">{rwf(r.fares)}</td>
                      <td className="px-3 py-2 tabular-nums">{rwf(r.expected)}</td>
                      <td className="px-3 py-2 tabular-nums text-fg-muted">{rwf(r.byApp)}</td>
                      <td className="px-3 py-2 tabular-nums">{rwf(r.cash)}</td>
                      <td className="px-3 py-2 tabular-nums">{rwf(r.paid)}</td>
                      <td className={`px-3 py-2 tabular-nums font-semibold ${r.owed ? 'text-danger' : 'text-fg-muted'}`}>{rwf(r.owed)}</td>
                      <td className="px-3 py-2 text-caption text-fg-muted">{r.last ? `${longDay(r.last.day)} · ${OUTCOME[r.last.outcome] ?? r.last.outcome}${r.last.promised_date ? ` (promised ${longDay(r.last.promised_date)})` : ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
