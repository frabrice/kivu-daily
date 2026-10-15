import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, BadgeCheck, Car, CircleSlash, Coins, Gauge, HandCoins, Info, Landmark, Plus, Receipt,
  ScrollText, Scale, Smartphone, TrendingDown, TrendingUp, Wallet, Wrench,
} from 'lucide-react';
import { supabase, DriverCarAssignment, FinanceTransaction } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useFinanceData, TYPE_META, STATUS_META } from '../../lib/finance';
import { PerfEvent, today as kigaliToday } from '../../lib/performance';
import { PAUSE_REASON_LABEL } from '../../lib/fleet';
import {
  CAUSES, CAUSE_LABEL, CAR_STATUS, COMMISSIONS_START, IN_GROUPS, OUT_GROUPS, CarEconomics, CarStatus, InGroup, LossCause, OutGroup, PeriodKey, Range,
  commissionWeeks, computeLeakage, firstDayOf, insightsOf, isManaged, managementFees, moneySummary, onboardingFees, rangeOf, shareOf, targetShareOf,
} from '../../lib/financeOverview';
import { RangeTabs, usePalette } from '../../components/charts/kit';
import Modal from '../../components/Modal';
import { EntityLink } from '../../os/EntityLink';
import { usePageTitle } from '../../os/workspace';
import { Box, Label, PageHeader, StatCard, StatGrid, rwf } from '../../ui/kit';

// Finance overview (MD, 15 Oct 2026): the first page for the MD's Finance
// and for the Finance team. What we made, spent and lost; where the money
// comes from; and, car by car, why 360,000 a week didn't all come in.

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayY = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2 whitespace-nowrap';
const num = `${td} text-right tabular-nums`;

type Panel =
  | { kind: 'fees' } | { kind: 'onboarding' } | { kind: 'commissions' } | { kind: 'log'; week?: string }
  | { kind: 'car'; id: string } | { kind: 'cause'; cause: LossCause } | { kind: 'out'; group: OutGroup } | { kind: 'in'; group: InGroup };

export default function FinanceOverview() {
  usePageTitle('Finance');
  const { profile } = useAuth();
  const c = usePalette();
  const fin = useFinanceData();
  const t = kigaliToday();
  const [extra, setExtra] = useState<{ events: PerfEvent[]; assignments: DriverCarAssignment[] } | null>(null);
  const loadExtra = useCallback(async () => {
    const [ev, as] = await Promise.all([
      supabase.from('driver_contract_events').select('driver_id, event_type, event_date'),
      supabase.from('driver_car_assignments').select('*').order('from_date'),
    ]);
    setExtra({ events: (ev.data as PerfEvent[]) ?? [], assignments: (as.data as DriverCarAssignment[]) ?? [] });
  }, []);
  useEffect(() => { loadExtra(); }, [loadExtra]);

  const [pk, setPk] = useState<PeriodKey>('all');
  const [custom, setCustom] = useState<Range>({ from: `${t.slice(0, 7)}-01`, to: t });
  const firstDay = useMemo(() => firstDayOf(fin.vehicles, fin.transactions), [fin.vehicles, fin.transactions]);
  const range = rangeOf(pk, t, custom, firstDay ?? undefined);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [statusFilter, setStatusFilter] = useState<CarStatus | null>(null);

  const input = useMemo(() => ({
    vehicles: fin.vehicles, drivers: fin.drivers, deposits: fin.deposits, transactions: fin.transactions,
    assignments: extra?.assignments ?? [], events: extra?.events ?? [], owners: fin.owners,
  }), [fin.vehicles, fin.drivers, fin.deposits, fin.transactions, fin.owners, extra]);
  const ready = !fin.loading && !!extra;
  const leak = useMemo(() => (ready ? computeLeakage(input, range, t) : null), [ready, input, range.from, range.to, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const insights = useMemo(() => (leak ? insightsOf(leak) : []), [leak]);
  const ms = useMemo(() => moneySummary(fin.transactions, range), [fin.transactions, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const fees = useMemo(() => (ready ? managementFees(input, range, t) : []), [ready, input, range.from, range.to, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const onboarding = useMemo(() => onboardingFees(input, range), [input, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => commissionWeeks(fin.transactions, range.from, range.to, t), [fin.transactions, range.from, range.to, t]);
  const allWeeks = useMemo(() => commissionWeeks(fin.transactions, COMMISSIONS_START, t, t), [fin.transactions, t]);
  const missingWeeks = allWeeks.filter((w) => w.state === 'missing');

  if (!ready || !leak) return <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 skeleton rounded-card" />)}</div>;

  const reload = () => { fin.reload(); loadExtra(); };
  const net = ms.madeTotal - ms.spentTotal;
  const causeColor: Record<LossCause, string> = { empty: c.orange, left_owing: 'rgb(var(--c-danger))', owes: c.yellow, paused: c.violet };
  const counts = { losing: 0, below: 0, on_target: 0 } as Record<CarStatus, number>;
  for (const x of leak.cars) counts[x.status] += 1;
  const cars = statusFilter ? leak.cars.filter((x) => x.status === statusFilter) : leak.cars;
  const feesPaid = fees.filter((f) => f.paid);
  const feesLate = fees.filter((f) => !f.paid && f.lateDays > 0);
  const commissionsIn = weeks.reduce((s, w) => s + Number(w.row?.amount ?? 0), 0);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const periodLabel = pk === 'all' ? 'All time' : pk === 'week' ? 'This week' : pk === 'month' ? 'This month' : pk === 'last_month' ? 'Last month' : 'Custom';

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Wallet} title="Finance"
        subtitle={`${periodLabel}: ${dayY(range.from)} – ${dayY(range.to)}${range.to > t ? ` (losses counted up to today)` : ''}`}
        actions={<>
          <button onClick={() => setPanel({ kind: 'log', week: missingWeeks[0]?.week })} className="btn-primary"><Plus size={14} /> Log app commissions</button>
          <Link to="/finance/ledger" className="btn-secondary"><ScrollText size={14} /> Ledger</Link>
        </>} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <RangeTabs<PeriodKey> value={pk} onChange={setPk} options={[{ v: 'all', label: 'All time' }, { v: 'week', label: 'This week' }, { v: 'month', label: 'This month' }, { v: 'last_month', label: 'Last month' }, { v: 'custom', label: 'Custom' }]} />
        {pk === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((x) => ({ ...x, from: e.target.value }))} className="input !w-auto" aria-label="From" />
            <span className="text-fg-muted">–</span>
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((x) => ({ ...x, to: e.target.value }))} className="input !w-auto" aria-label="To" />
          </div>
        )}
        {missingWeeks.length > 0 && (
          <button onClick={() => setPanel({ kind: 'commissions' })} className="ml-auto"><Label tone="attention" icon={AlertTriangle}>{missingWeeks.length} week{missingWeeks.length === 1 ? '' : 's'} of app commissions not entered</Label></button>
        )}
      </div>

      {/* ------------------------------------------------ made / spent / lost / net */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <HeadCard icon={ArrowDownCircle} label="Made" value={ms.madeTotal} tone="success"
          sub={ms.toReceive ? `${rwf(ms.toReceive)} still to receive` : 'Money received in this period'}
          lines={IN_GROUPS.filter((g) => ms.made[g.key].total || g.key !== 'other').map((g) => ({
            label: g.label, value: ms.made[g.key].total,
            onClick: () => (g.key === 'fees' ? setPanel({ kind: 'fees' }) : g.key === 'onboarding' ? setPanel({ kind: 'onboarding' }) : g.key === 'commissions' ? setPanel({ kind: 'commissions' }) : g.key === 'collections' ? scrollTo('leakage') : setPanel({ kind: 'in', group: g.key })),
          }))} />
        <HeadCard icon={ArrowUpCircle} label="Spent" value={ms.spentTotal} tone="neutral"
          sub={`${rwf(ms.paidTotal)} paid · ${rwf(ms.toPay)} still to pay`}
          lines={OUT_GROUPS.filter((g) => ms.spent[g.key].total || g.key !== 'other').map((g) => ({ label: g.label, value: ms.spent[g.key].total, onClick: () => setPanel({ kind: 'out', group: g.key }) }))} />
        <HeadCard icon={TrendingDown} label="Lost" value={leak.lost} tone="danger"
          sub={leak.expected ? `${pctOf(leak.lost, leak.expected)}% of the ${rwf(leak.expected)} the cars should have brought` : 'No car days in this period'}
          lines={CAUSES.map((x) => ({ label: x.label, value: leak.byCause[x.key], color: causeColor[x.key], onClick: () => setPanel({ kind: 'cause', cause: x.key }) }))} />
        <HeadCard icon={net >= 0 ? TrendingUp : TrendingDown} label="Net" value={net} tone={net >= 0 ? 'success' : 'danger'}
          sub="Made minus spent"
          lines={[{ label: 'Made', value: ms.madeTotal }, { label: 'Spent', value: -ms.spentTotal }, ...(leak.lost ? [{ label: 'If nothing had been lost', value: net + leak.lost }] : [])]} />
      </div>

      {/* ------------------------------------------------ money in */}
      <h2 className="section-title mb-2.5 flex items-center gap-2"><ArrowDownCircle size={15} /> Money in</h2>
      <StatGrid cols={4}>
        <StatCard icon={HandCoins} label="Management fees" onClick={() => setPanel({ kind: 'fees' })}
          value={fees.length ? `${feesPaid.length}/${fees.length} paid` : '—'} tone={feesLate.length ? 'danger' : fees.length ? 'success' : undefined}
          sub={fees.length ? `${rwf(feesPaid.reduce((s, f) => s + f.amount, 0))} of ${rwf(fees.reduce((s, f) => s + f.amount, 0))}${feesLate.length ? ` · ${feesLate.length} late` : ''}` : 'No fees due in this period'} />
        <StatCard icon={BadgeCheck} label="Onboarding fees" onClick={() => setPanel({ kind: 'onboarding' })}
          value={rwf(onboarding.reduce((s, o) => s + Number(o.row.amount), 0))}
          sub={onboarding.length ? `${onboarding.length} car${onboarding.length === 1 ? '' : 's'} onboarded · 140,000 each` : 'No car onboarded in this period'} />
        <StatCard icon={Wallet} label="Fleet collections" onClick={() => scrollTo('leakage')}
          value={rwf(leak.collected)} tone={leak.lost ? 'attention' : 'success'}
          sub={leak.expected ? `${pctOf(leak.collected, leak.expected)}% of ${rwf(leak.expected)} expected` : 'No car days in this period'} />
        <StatCard icon={Smartphone} label="App commissions" onClick={() => setPanel({ kind: 'commissions' })}
          value={rwf(commissionsIn)} tone={weeks.some((w) => w.state === 'missing') ? 'attention' : undefined}
          sub={weeks.length ? `${weeks.filter((w) => w.state === 'entered').length} of ${weeks.length} week${weeks.length === 1 ? '' : 's'} entered${weeks.some((w) => w.state === 'missing') ? ' · some missing' : ''}` : 'Entered every Friday'} />
      </StatGrid>

      {/* ------------------------------------------------ leakage */}
      <section id="leakage" className="scroll-mt-20 mb-6">
        <h2 className="section-title mb-2.5 flex items-center gap-2"><Gauge size={15} /> Fleet collections — should have vs collected</h2>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
          <Box title="Every car should bring 360,000 a week" icon={Scale} className="xl:col-span-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Figure label="Should have collected" value={leak.expected} />
              <Figure label="Collected" value={leak.collected} tone="success" sub={`${pctOf(leak.collected, leak.expected)}%`} />
              <Figure label="Owners are paid" value={leak.ownerCost} sub="fixed, whatever comes in" />
              <Figure label="Kivu kept" value={shareOf(leak)} tone={shareOf(leak) < 0 ? 'danger' : undefined} sub={`of ${rwf(targetShareOf(leak))} it should`} />
            </div>
            <div className="flex h-3.5 rounded-full overflow-hidden bg-inset mb-3" role="img" aria-label="Collected and lost, by cause">
              <span style={{ width: `${pctOf(leak.collected, leak.expected)}%`, background: 'rgb(var(--c-success))' }} title={`Collected ${rwf(leak.collected)}`} />
              {CAUSES.map((x) => leak.byCause[x.key] > 0 && <span key={x.key} style={{ width: `${(leak.byCause[x.key] / Math.max(1, leak.expected)) * 100}%`, background: causeColor[x.key] }} className="border-l-2 border-surface" title={`${x.label} ${rwf(leak.byCause[x.key])}`} />)}
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {[...CAUSES].sort((a, b) => leak.byCause[b.key] - leak.byCause[a.key]).map((x) => (
                <li key={x.key}>
                  <button onClick={() => setPanel({ kind: 'cause', cause: x.key })} className="w-full flex items-start gap-2 text-left rounded px-1.5 py-1 -mx-1.5 hover:bg-hover">
                    <span className="w-2.5 h-2.5 rounded-sm mt-1 shrink-0" style={{ background: causeColor[x.key] }} />
                    <span className="flex-1 min-w-0"><span className="text-body font-medium">{x.label}</span><span className="block text-caption text-fg-muted">{x.help}</span></span>
                    <span className="text-body tabular-nums font-semibold">{rwf(leak.byCause[x.key])}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Box>
          <Box title="What's going wrong" icon={AlertTriangle}>
            {insights.length ? (
              <ul className="space-y-2.5">
                {insights.map((x, i) => (
                  <li key={i} className="flex gap-2 text-body">
                    {x.tone === 'info' ? <Info size={15} className="text-link shrink-0 mt-0.5" /> : <AlertTriangle size={15} className={`${x.tone === 'danger' ? 'text-danger' : 'text-attention'} shrink-0 mt-0.5`} />}
                    <span>{x.text}{x.car && <> <button onClick={() => setPanel({ kind: 'car', id: x.car! })} className="link text-caption">See the car</button></>}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-body text-fg-muted">Nothing lost in this period — every car brought what it should.</p>}
          </Box>
        </div>

        <Box title="Car by car" icon={Car} padded={false}
          right={<div className="flex flex-wrap gap-1">
            {(['losing', 'below', 'on_target'] as CarStatus[]).map((s) => (
              <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)} aria-pressed={statusFilter === s} className={statusFilter && statusFilter !== s ? 'opacity-50' : ''}>
                <Label tone={CAR_STATUS[s].tone}>{counts[s]} {CAR_STATUS[s].label.toLowerCase()}</Label>
              </button>
            ))}
          </div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-body min-w-[960px]">
              <thead><tr className="text-caption text-fg-muted text-left bg-inset">
                {['Car', 'Owner', 'Status', 'Should have', 'Collected', 'Owner paid', 'Kivu kept', 'Lost', 'Main cause', 'Seats'].map((h, i) => <th key={h} className={`${th} ${i >= 3 && i <= 7 ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {cars.map((x) => {
                  const main = (Object.entries(x.byCause) as [LossCause, number][]).sort((a, b) => b[1] - a[1])[0];
                  const share = shareOf(x);
                  return (
                    <tr key={x.vehicle.id} onClick={() => setPanel({ kind: 'car', id: x.vehicle.id })} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                      <td className={`${td} font-mono font-medium`}>{x.vehicle.plate_number}</td>
                      <td className={`${td} max-w-[180px] truncate`}>{x.ownerName}</td>
                      <td className={td}><Label tone={CAR_STATUS[x.status].tone} title={CAR_STATUS[x.status].help}>{CAR_STATUS[x.status].label}</Label></td>
                      <td className={num}>{rwf(x.expected)}</td>
                      <td className={num}>{rwf(x.collected)}</td>
                      <td className={num}>{rwf(x.ownerCost)}</td>
                      <td className={`${num} font-semibold ${share < 0 ? 'text-danger' : ''}`}>{rwf(share)}<span className="block text-caption font-normal text-fg-muted">of {rwf(targetShareOf(x))}</span></td>
                      <td className={`${num} ${x.lost ? 'text-danger' : 'text-fg-muted'}`}>{rwf(x.lost)}</td>
                      <td className={td}>{main && main[1] > 0 ? <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: causeColor[main[0]] }} />{CAUSE_LABEL[main[0]]}</span> : <span className="text-fg-subtle">—</span>}</td>
                      <td className={`${td} text-caption text-fg-muted`}>{x.oneSeatDays || x.noDriverDays ? `${x.oneSeatDays ? `${x.oneSeatDays}d one driver` : ''}${x.oneSeatDays && x.noDriverDays ? ' · ' : ''}${x.noDriverDays ? `${x.noDriverDays}d none` : ''}` : 'Full'}</td>
                    </tr>
                  );
                })}
                {!cars.length && <tr><td colSpan={10} className="px-4 py-8 text-center text-fg-muted">No managed cars on the road in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </Box>

        {leak.unlinked.length > 0 && <UnlinkedBox leak={leak} vehicles={fin.vehicles.filter(isManaged)} onSaved={loadExtra} />}
      </section>

      {/* ------------------------------------------------ money out */}
      <h2 className="section-title mb-2.5 flex items-center gap-2"><ArrowUpCircle size={15} /> Money out</h2>
      <StatGrid cols={5}>
        {OUT_GROUPS.map((g) => {
          const b = ms.spent[g.key];
          const icon = { owners: HandCoins, onboarding: Wrench, drivers: Car, staff: Coins, other: Receipt }[g.key];
          return <StatCard key={g.key} icon={icon} label={g.label} value={rwf(b.total)} onClick={() => setPanel({ kind: 'out', group: g.key })}
            tone={b.open ? 'attention' : undefined} sub={b.total ? `${rwf(b.done)} paid${b.open ? ` · ${rwf(b.open)} to pay` : ''}` : 'Nothing in this period'} />;
        })}
      </StatGrid>

      {fin.accounts.length > 0 && <>
        <h2 className="section-title mb-2.5 flex items-center gap-2"><Landmark size={15} /> Bank balances now</h2>
        <StatGrid cols={4}>
          {fin.accounts.map((a) => <StatCard key={a.id} icon={Landmark} label={a.name} value={rwf(fin.balances[a.key] ?? 0)} to="/finance/accounts" />)}
        </StatGrid>
      </>}

      {/* ------------------------------------------------ panels */}
      {panel?.kind === 'fees' && <FeesPanel fees={fees} range={range} onClose={() => setPanel(null)} />}
      {panel?.kind === 'onboarding' && <OnboardingPanel items={onboarding} onClose={() => setPanel(null)} />}
      {panel?.kind === 'commissions' && <CommissionsPanel weeks={allWeeks} onLog={(week) => setPanel({ kind: 'log', week })} onClose={() => setPanel(null)} />}
      {panel?.kind === 'log' && <LogCommissionsPanel weeks={allWeeks} week={panel.week} accounts={fin.accounts} profileId={profile?.id ?? null} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); reload(); }} />}
      {panel?.kind === 'car' && (() => { const x = leak.cars.find((y) => y.vehicle.id === panel.id); return x ? <CarPanel car={x} colors={causeColor} onClose={() => setPanel(null)} /> : null; })()}
      {panel?.kind === 'cause' && <CausePanel cause={panel.cause} leak={leak} onCar={(id) => setPanel({ kind: 'car', id })} onClose={() => setPanel(null)} />}
      {panel?.kind === 'out' && <RowsPanel title={OUT_GROUPS.find((g) => g.key === panel.group)!.label} rows={ms.spent[panel.group].rows} byOwner={panel.group === 'owners'} onClose={() => setPanel(null)} />}
      {panel?.kind === 'in' && <RowsPanel title={IN_GROUPS.find((g) => g.key === panel.group)!.label} rows={ms.made[panel.group].rows} onClose={() => setPanel(null)} />}
    </div>
  );
}

// ------------------------------------------------------------ pieces
function HeadCard({ icon: Icon, label, value, tone, sub, lines }: {
  icon: LucideIcon; label: string; value: number; tone: 'success' | 'danger' | 'neutral'; sub: string;
  lines: { label: string; value: number; color?: string; onClick?: () => void }[];
}) {
  const max = Math.max(1, ...lines.map((l) => Math.abs(l.value)));
  return (
    <section className="card p-4 min-w-0">
      <p className="flex items-center gap-1.5 text-caption text-fg-muted"><Icon size={14} /> {label}</p>
      <p className={`text-h1 font-semibold leading-tight tabular-nums mt-1 ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : ''}`}>{rwf(value)}</p>
      <p className="text-caption text-fg-muted mt-0.5">{sub}</p>
      <ul className="mt-3 pt-3 border-t border-line-muted space-y-0.5">
        {lines.map((l) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5 min-w-0 flex-1">{l.color && <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: l.color }} />}<span className="truncate">{l.label}</span></span>
              <span className="w-12 h-1.5 rounded-full bg-inset overflow-hidden shrink-0" aria-hidden="true"><span className="block h-full rounded-full" style={{ width: `${(Math.abs(l.value) / max) * 100}%`, background: l.color ?? 'rgb(var(--c-line-strong))' }} /></span>
              <span className="tabular-nums w-[104px] text-right shrink-0">{rwf(l.value)}</span>
            </>
          );
          return <li key={l.label}>{l.onClick
            ? <button onClick={l.onClick} className="w-full flex items-center gap-2 text-caption rounded px-1 -mx-1 py-0.5 hover:bg-hover text-left">{body}</button>
            : <div className="flex items-center gap-2 text-caption px-1 -mx-1 py-0.5">{body}</div>}</li>;
        })}
      </ul>
    </section>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="min-w-0">
      <p className="text-caption text-fg-muted truncate">{label}</p>
      <p className={`text-h3 font-semibold tabular-nums leading-tight ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : ''}`}>{rwf(value)}</p>
      {sub && <p className="text-caption text-fg-muted truncate">{sub}</p>}
    </div>
  );
}

function Table({ head, right = [], children, minW = 640 }: { head: string[]; right?: number[]; children: ReactNode; minW?: number }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-body" style={{ minWidth: minW }}>
        <thead><tr className="text-caption text-fg-muted text-left bg-inset">{head.map((h, i) => <th key={h + i} className={`${th} ${right.includes(i) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const statusLabel = (s: FinanceTransaction['status']) => <Label tone={s === 'posted' || s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : s === 'checked' ? 'accent' : 'neutral'}>{STATUS_META[s].label}</Label>;

function FeesPanel({ fees, range, onClose }: { fees: ReturnType<typeof managementFees>; range: Range; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Management fees" subtitle={`30,000 per car, due on the same date every month · ${day(range.from)} – ${day(range.to)}`} maxWidth="max-w-2xl">
      {fees.length ? (
        <Table head={['Car', 'Owner', 'Due', 'Amount', 'Paid', 'Next due']} right={[3]}>
          {fees.map((f) => (
            <tr key={`${f.vehicle.id}${f.due}`} className="border-t border-line-muted">
              <td className={`${td} font-mono`}><EntityLink type="car" id={f.vehicle.id} label={f.vehicle.plate_number} className="font-mono" /></td>
              <td className={`${td} max-w-[200px] truncate`}>{f.ownerName}</td>
              <td className={td}>{dayY(f.due)}</td>
              <td className={num}>{rwf(f.amount)}</td>
              <td className={td}>{f.paid ? <Label tone="success">Paid {f.paidOn ? day(f.paidOn) : ''}</Label> : f.lateDays > 0 ? <Label tone="danger">Not paid · {f.lateDays} day{f.lateDays === 1 ? '' : 's'} late</Label> : <Label>Not due yet</Label>}</td>
              <td className={td}>{dayY(f.nextDue)}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-body text-fg-muted">No management fee falls due in this period.</p>}
      <p className="text-caption text-fg-muted mt-3">Mark a fee as received in the <Link to="/finance/ledger?type=revenue" className="link">ledger</Link> (check it, then the MD approves).</p>
    </Modal>
  );
}

function OnboardingPanel({ items, onClose }: { items: ReturnType<typeof onboardingFees>; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Onboarding fees" subtitle="140,000 per new car (device 120,000 + branding 20,000) against device 90,000, branding 15,000 and uniforms 15,000" maxWidth="max-w-2xl">
      {items.length ? (
        <Table head={['Car', 'Owner', 'Onboarded', 'Fee', 'Paid', 'Costs', 'Kivu keeps']} right={[3, 5, 6]}>
          {items.map((o) => {
            const cost = o.costs.reduce((s, x) => s + Number(x.amount), 0);
            return (
              <tr key={o.row.id} className="border-t border-line-muted">
                <td className={td}>{o.vehicle ? <EntityLink type="car" id={o.vehicle.id} label={o.vehicle.plate_number} className="font-mono" /> : '—'}</td>
                <td className={`${td} max-w-[200px] truncate`}>{o.ownerName}</td>
                <td className={td}>{dayY(o.row.transaction_date)}</td>
                <td className={num}>{rwf(Number(o.row.amount))}</td>
                <td className={td}>{o.paid ? <Label tone="success">Paid {o.paidOn ? day(o.paidOn) : ''}</Label> : <Label tone="attention">Not received</Label>}</td>
                <td className={num} title={o.costs.map((x) => `${x.description}: ${rwf(Number(x.amount))}`).join('\n')}>{rwf(cost)}</td>
                <td className={`${num} font-semibold`}>{rwf(Number(o.row.amount) - cost)}</td>
              </tr>
            );
          })}
        </Table>
      ) : <p className="text-body text-fg-muted">No car was onboarded in this period.</p>}
    </Modal>
  );
}

function CommissionsPanel({ weeks, onLog, onClose }: { weeks: ReturnType<typeof commissionWeeks>; onLog: (week: string) => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="App commissions" subtitle="Collected through the app, entered every Friday for the Monday–Sunday week before" maxWidth="max-w-xl">
      <Table head={['Week', 'Due', 'Amount', 'Status', '']} right={[2]} minW={520}>
        {[...weeks].reverse().map((w) => (
          <tr key={w.week} className="border-t border-line-muted">
            <td className={td}>{day(w.week)} – {day(w.sunday)}</td>
            <td className={td}>Fri {day(w.dueOn)}</td>
            <td className={num}>{w.row ? rwf(Number(w.row.amount)) : '—'}</td>
            <td className={td}>{w.row ? statusLabel(w.row.status) : w.state === 'missing' ? <Label tone="danger">Not entered</Label> : <Label>Not due yet</Label>}</td>
            <td className={`${td} text-right`}>{!w.row && <button onClick={() => onLog(w.week)} className="btn-ghost text-caption"><Plus size={12} /> Log</button>}</td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}

function LogCommissionsPanel({ weeks, week, accounts, profileId, onClose, onSaved }: {
  weeks: ReturnType<typeof commissionWeeks>; week?: string; accounts: { id: string; name: string; key: string }[]; profileId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const open = weeks.filter((w) => !w.row);
  const [wk, setWk] = useState(week ?? open[0]?.week ?? '');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts.find((a) => a.key === 'equity')?.id ?? accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = Number(amount.replace(/[^\d.]/g, ''));
  const save = async () => {
    if (!wk) { setError('Choose the week.'); return; }
    if (amount.trim() === '' || Number.isNaN(n) || n < 0) { setError('Enter the amount (0 if there were none).'); return; }
    if (!accountId) { setError('Choose the account it landed in.'); return; }
    setBusy(true); setError('');
    const now = new Date().toISOString();
    const { error: err } = await supabase.from('finance_transactions').insert({
      type: 'app_commission', direction: 'in', amount: n, account_id: accountId, transaction_date: wk,
      description: `App commissions — week of ${day(wk)}${note.trim() ? ` · ${note.trim()}` : ''}`, counterparty: 'Kivu Ride app',
      status: 'checked', prepared_by: profileId, created_by: profileId, checked_by: profileId, checked_at: now, updated_at: now,
    });
    setBusy(false);
    if (err) { setError(err.message.includes('finance_app_commission_week') ? 'This week is already entered.' : err.message); return; }
    onSaved();
  };
  const label = 'block text-caption font-medium mb-1 text-fg-muted';
  return (
    <Modal open onClose={onClose} title="Log app commissions" subtitle="One entry per week. It goes to the MD for approval like any other entry." maxWidth="max-w-md">
      <div className="space-y-3">
        <label className="block"><span className={label}>Week *</span>
          <select value={wk} onChange={(e) => setWk(e.target.value)} className="input">
            {!open.length && <option value="">Every week is entered</option>}
            {open.map((w) => <option key={w.week} value={w.week}>{day(w.week)} – {day(w.sunday)}{w.state === 'missing' ? ' (overdue)' : ''}</option>)}
          </select>
        </label>
        <label className="block"><span className={label}>Commissions collected (RWF) *</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="input tabular-nums" placeholder="e.g. 85,000 — or 0 if none" />
        </label>
        <label className="block"><span className={label}>Landed in *</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <label className="block"><span className={label}>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="e.g. 212 trips" />
        </label>
        {error && <p className="text-caption text-danger bg-danger-muted rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line-muted">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={busy || !open.length} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

function CarPanel({ car, colors, onClose }: { car: CarEconomics; colors: Record<LossCause, string>; onClose: () => void }) {
  const st = CAR_STATUS[car.status];
  return (
    <Modal open onClose={onClose} title={car.vehicle.plate_number} subtitle={`${car.ownerName} · owner paid ${rwf(car.weeklyPayout)}/week · ${car.days} day${car.days === 1 ? '' : 's'} in this period`} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Label tone={st.tone}>{st.label}</Label><span className="text-caption text-fg-muted">{st.help}</span>
          <EntityLink type="car" id={car.vehicle.id} label="Open the car" className="ml-auto text-caption" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Figure label="Should have" value={car.expected} />
          <Figure label="Collected" value={car.collected} tone="success" sub={`${pctOf(car.collected, car.expected)}%`} />
          <Figure label="Owner paid" value={car.ownerCost} />
          <Figure label="Kivu kept" value={shareOf(car)} tone={shareOf(car) < 0 ? 'danger' : undefined} sub={`of ${rwf(targetShareOf(car))}`} />
        </div>
        {car.lost > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
            {CAUSES.filter((x) => car.byCause[x.key] > 0).map((x) => <span key={x.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: colors[x.key] }} />{x.label}: <b className="tabular-nums">{rwf(car.byCause[x.key])}</b></span>)}
            {car.ownerPausedShifts > 0 && <span className="text-fg-muted">{car.ownerPausedShifts} paused shift-day{car.ownerPausedShifts === 1 ? '' : 's'} with the owner's payment paused too (not a loss)</span>}
          </div>
        )}
        <div>
          <h3 className="text-body font-semibold mb-1.5">Week by week</h3>
          <Table head={['Week', 'Days', 'Should have', 'Collected', 'Owner paid', 'Kivu kept', 'Lost']} right={[1, 2, 3, 4, 5, 6]}>
            {car.weeks.map((w) => (
              <tr key={w.week} className="border-t border-line-muted">
                <td className={td}>{day(w.week)}</td>
                <td className={num}>{w.days}</td>
                <td className={num}>{rwf(w.expected)}</td>
                <td className={num}>{rwf(w.collected)}</td>
                <td className={num}>{rwf(w.ownerCost)}</td>
                <td className={`${num} font-semibold ${shareOf(w) < 0 ? 'text-danger' : ''}`}>{rwf(shareOf(w))}</td>
                <td className={`${num} ${w.lost ? 'text-danger' : 'text-fg-muted'}`}>{rwf(w.lost)}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div>
          <h3 className="text-body font-semibold mb-1.5">Drivers on this car</h3>
          {car.drivers.length ? (
            <Table head={['Driver', 'Days on the car', 'Should have', 'Paid', 'Not paid', '']} right={[1, 2, 3, 4]}>
              {car.drivers.map((r) => (
                <tr key={r.driver.id} className="border-t border-line-muted">
                  <td className={td}><EntityLink type="driver" id={r.driver.id} label={r.driver.full_name} />{r.ended && <span className="ml-1.5"><Label>Left</Label></span>}</td>
                  <td className={num}>{r.days}</td>
                  <td className={num}>{rwf(r.expected)}</td>
                  <td className={num}>{rwf(r.collected)}</td>
                  <td className={`${num} ${r.lost ? 'text-danger' : 'text-fg-muted'}`}>{rwf(r.lost)}</td>
                  <td className={`${td} text-caption text-fg-muted`}>{r.cause ? CAUSE_LABEL[r.cause] : ''}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="text-body text-fg-muted">No driver on this car in this period.</p>}
          {(car.oneSeatDays > 0 || car.noDriverDays > 0) && <p className="text-caption text-fg-muted mt-2 flex items-center gap-1.5"><CircleSlash size={13} /> {car.oneSeatDays ? `${car.oneSeatDays} day${car.oneSeatDays === 1 ? '' : 's'} with one driver` : ''}{car.oneSeatDays && car.noDriverDays ? ' and ' : ''}{car.noDriverDays ? `${car.noDriverDays} day${car.noDriverDays === 1 ? '' : 's'} with no driver` : ''} — each empty shift loses 180,000 a week.</p>}
        </div>
      </div>
    </Modal>
  );
}

function CausePanel({ cause, leak, onCar, onClose }: { cause: LossCause; leak: ReturnType<typeof computeLeakage>; onCar: (id: string) => void; onClose: () => void }) {
  const meta = CAUSES.find((x) => x.key === cause)!;
  if (cause === 'empty') {
    const cars = leak.cars.filter((x) => x.byCause.empty > 0).sort((a, b) => b.byCause.empty - a.byCause.empty);
    return (
      <Modal open onClose={onClose} title={`${meta.label} — ${rwf(leak.byCause.empty)}`} subtitle={meta.help} maxWidth="max-w-xl">
        {cars.length ? (
          <Table head={['Car', 'Days with one driver', 'Days with none', 'Lost']} right={[1, 2, 3]} minW={480}>
            {cars.map((x) => (
              <tr key={x.vehicle.id} onClick={() => onCar(x.vehicle.id)} className="border-t border-line-muted cursor-pointer hover:bg-hover/60">
                <td className={`${td} font-mono`}>{x.vehicle.plate_number}</td>
                <td className={num}>{x.oneSeatDays}</td>
                <td className={num}>{x.noDriverDays}</td>
                <td className={`${num} text-danger`}>{rwf(x.byCause.empty)}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-body text-fg-muted">Every car had both shifts filled.</p>}
      </Modal>
    );
  }
  const rows = leak.drivers.filter((d) => d.cause === cause);
  return (
    <Modal open onClose={onClose} title={`${meta.label} — ${rwf(leak.byCause[cause])}`} subtitle={meta.help} maxWidth="max-w-xl">
      {rows.length ? (
        <Table head={['Driver', 'Car', cause === 'paused' ? 'Days off' : 'Days not paid', cause === 'paused' ? 'Why' : '', 'Lost']} right={[2, 4]} minW={520}>
          {rows.map((r) => (
            <tr key={r.driver.id} className="border-t border-line-muted">
              <td className={td}><EntityLink type="driver" id={r.driver.id} label={r.driver.full_name} /></td>
              <td className={`${td} font-mono text-caption`}>{r.cars.join(', ') || '—'}</td>
              <td className={num}>{r.days}</td>
              <td className={`${td} text-caption text-fg-muted`}>{r.reasons.map((x) => PAUSE_REASON_LABEL[x]).join(', ')}</td>
              <td className={`${num} text-danger`}>{rwf(r.amount)}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-body text-fg-muted">Nothing in this period.</p>}
      {cause === 'paused' && <p className="text-caption text-fg-muted mt-3">When a pause also pauses the owner's payment, those days aren't a loss and don't appear here. Finance or the MD can set that on the pause (Fleet → Days off).</p>}
    </Modal>
  );
}

function RowsPanel({ title, rows, byOwner, onClose }: { title: string; rows: FinanceTransaction[]; byOwner?: boolean; onClose: () => void }) {
  const owners = useMemo(() => {
    if (!byOwner) return [];
    const m = new Map<string, { name: string; total: number; paid: number }>();
    for (const r of rows) {
      const k = r.counterparty ?? '—';
      const x = m.get(k) ?? { name: k, total: 0, paid: 0 };
      x.total += Number(r.amount);
      if (r.status === 'posted' || r.status === 'approved') x.paid += Number(r.amount);
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows, byOwner]);
  const sorted = [...rows].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  return (
    <Modal open onClose={onClose} title={title} subtitle={`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · ${rwf(rows.reduce((s, r) => s + Number(r.amount), 0))}`} maxWidth="max-w-2xl">
      {byOwner && owners.length > 0 && (
        <div className="mb-4">
          <Table head={['Owner', 'Due', 'Paid', 'Still to pay']} right={[1, 2, 3]} minW={480}>
            {owners.map((o) => (
              <tr key={o.name} className="border-t border-line-muted">
                <td className={td}>{o.name}</td>
                <td className={num}>{rwf(o.total)}</td>
                <td className={num}>{rwf(o.paid)}</td>
                <td className={`${num} ${o.total - o.paid ? 'text-attention font-semibold' : 'text-fg-muted'}`}>{rwf(o.total - o.paid)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {sorted.length ? (
        <Table head={['Date', 'What', 'Type', 'Status', 'Amount']} right={[4]}>
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-line-muted">
              <td className={td}>{day(r.transaction_date)}</td>
              <td className={`${td} max-w-[300px]`}><span className="block truncate">{r.counterparty || r.description || '—'}</span>{r.counterparty && r.description && <span className="block truncate text-caption text-fg-muted">{r.description}</span>}</td>
              <td className={`${td} text-caption`}>{TYPE_META[r.type]?.label ?? r.type}</td>
              <td className={td}>{statusLabel(r.status)}</td>
              <td className={num}>{rwf(Number(r.amount))}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-body text-fg-muted">Nothing in this period.</p>}
      <p className="text-caption text-fg-muted mt-3">Open the <Link to="/finance/ledger" className="link">ledger</Link> to check, approve or pay an entry.</p>
    </Modal>
  );
}

// Drivers whose car for part of the period couldn't be proven from the
// records: Finance (or Fleet) sets it, and each car's numbers become exact.
function UnlinkedBox({ leak, vehicles, onSaved }: { leak: ReturnType<typeof computeLeakage>; vehicles: { id: string; plate_number: string }[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const set = async (id: string, vehicleId: string) => {
    if (!vehicleId) return;
    setBusy(id); setError('');
    const { error: err } = await supabase.rpc('set_assignment_car', { p_id: id, p_vehicle_id: vehicleId });
    setBusy(null);
    if (err) { setError(err.message); return; }
    onSaved();
  };
  return (
    <Box title="Car history to complete" icon={Info} className="mt-4" padded={false}>
      <p className="px-4 pt-3 text-caption text-fg-muted">These drivers were put on a car when they were added, and the records don't say which. Their days count on no car until it's set.</p>
      {error && <p className="mx-4 mt-2 text-caption text-danger bg-danger-muted rounded-lg px-3 py-2">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-body min-w-[640px]">
          <thead><tr className="text-caption text-fg-muted text-left">{['Driver', 'From', 'To', 'Days', 'Not paid', 'Car they drove'].map((h, i) => <th key={h} className={`${th} ${i === 3 || i === 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {leak.unlinked.map((u) => (
              <tr key={u.assignment.id} className="border-t border-line-muted">
                <td className={td}><EntityLink type="driver" id={u.driver.id} label={u.driver.full_name} /></td>
                <td className={td}>{dayY(u.assignment.from_date)}</td>
                <td className={td}>{u.assignment.to_date ? dayY(u.assignment.to_date) : 'now'}</td>
                <td className={num}>{u.days}</td>
                <td className={`${num} ${u.lost ? 'text-danger' : ''}`}>{rwf(u.lost)}</td>
                <td className={td}>
                  <select defaultValue="" disabled={busy === u.assignment.id} onChange={(e) => set(u.assignment.id, e.target.value)} className="input !py-1 !w-auto" aria-label={`Car ${u.driver.full_name} drove`}>
                    <option value="">Choose the car…</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Box>
  );
}
