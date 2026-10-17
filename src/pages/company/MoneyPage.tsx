import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Banknote, Calculator, Coins, Landmark, Pencil, PiggyBank, Plus, Save, Scale, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { dayLabel, kigaliToday } from '../../lib/it';
import { BUDGET_KINDS, KIND, budgetMoney, monthsOf, usePlan } from '../../lib/companyPlan';
import {
  FUNDING_KIND, FUNDING_STATUS, Funding, MoneyData, ScenarioInputs, addMonthsKey, expectedFunding, incomeNow, latestCash, monthName, runScenario, rwf, rwfShort, useMoney,
} from '../../lib/companyMoney';
import { useAccess } from '../../os/access';
import { usePageTitle } from '../../os/workspace';
import { Box, EmptyState, Label, PageHeader, StatCard, StatGrid, UnderlineTabs } from '../../ui/kit';
import { ChartCard, DailyBars, usePalette } from '../../components/charts/kit';
import { CashCheckModal, FundingModal, MoneySettingsModal } from '../../components/company/MoneyModals';

// Company plan, phase 2: money. Runway (cash, costs, income), the funding
// pipeline, sources & uses, scenarios and all budgets together.

type Tab = 'runway' | 'funding' | 'sources' | 'scenarios' | 'budgets';
const th = 'px-3 py-2 font-medium whitespace-nowrap';
const td = 'px-3 py-2.5';
const Loading = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>;

export function CompanyMoney() {
  usePageTitle('Money');
  const a = useAccess();
  const money = useMoney();
  const plan = usePlan();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'runway';
  if (a.plan !== 'full') return <EmptyState icon={Wallet} title="Only the MD and full plan access see the money" />;
  if (money.loading || plan.loading || !money.settings) return <Loading />;
  return (
    <div className="animate-fade-in">
      <PageHeader icon={Landmark} title="Money" subtitle="Cash, what we earn and spend each month, how long the money lasts, and where new money comes from." />
      <UnderlineTabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { key: 'runway', label: 'Runway', icon: PiggyBank }, { key: 'funding', label: 'Funding', icon: Coins }, { key: 'sources', label: 'Sources & uses', icon: Scale },
        { key: 'scenarios', label: 'Scenarios', icon: Calculator }, { key: 'budgets', label: 'All budgets', icon: Wallet },
      ]} />
      {tab === 'runway' && <Runway money={money} plan={plan} />}
      {tab === 'funding' && <FundingTab money={money} plan={plan} />}
      {tab === 'sources' && <Sources money={money} plan={plan} />}
      {tab === 'scenarios' && <Scenarios money={money} />}
      {tab === 'budgets' && <AllBudgets plan={plan} />}
    </div>
  );
}
type Plan = ReturnType<typeof usePlan>;

// Approved budgets, spread month by month.
function budgetMonths(plan: Plan, statuses: string[]) {
  const out = new Map<string, Map<string, number>>(); // month -> kind -> amount
  for (const b of plan.budgets.filter((x) => statuses.includes(x.status))) {
    const lines = plan.lines.filter((l) => l.budget_id === b.id);
    monthsOf(b.start_month, b.months).forEach((m, idx) => {
      const n = lines.reduce((s, l) => s + (l.recurrence === 'monthly' ? (idx < l.months ? Number(l.amount) : 0) : idx === 0 ? Number(l.amount) : 0), 0);
      if (!n) return;
      const row = out.get(m) ?? new Map<string, number>();
      row.set(b.kind, (row.get(b.kind) ?? 0) + n);
      out.set(m, row);
    });
  }
  return out;
}

// ------------------------------------------------------------ runway
function Runway({ money, plan }: { money: MoneyData; plan: Plan }) {
  const c = usePalette();
  const [cash, setCash] = useState(false);
  const [settings, setSettings] = useState(false);
  const [weighted, setWeighted] = useState(true);
  const s = money.settings!;
  const live = money.live;
  const box = latestCash(money.checks);
  const inc = live ? incomeNow(live, s) : null;
  const costs = Number(s.monthly_costs);
  const net = (inc?.recurring ?? 0) - costs;
  const thisMonth = kigaliToday().slice(0, 7);
  const budgetsThisMonth = [...(budgetMonths(plan, ['approved']).get(thisMonth)?.values() ?? [])].reduce((x, y) => x + y, 0);
  const inflows = expectedFunding(money.funding, weighted);
  const projection = Array.from({ length: 13 }, (_, k) => addMonthsKey(thisMonth, k)).reduce<{ month: string; cash: number; funding: number }[]>((acc, m, k) => {
    const prev = k === 0 ? box.own : acc[k - 1].cash;
    const f = inflows.filter((x) => x.month === m).reduce((t, x) => t + x.amount, 0);
    acc.push({ month: m, cash: Math.round(k === 0 ? prev + f : prev + net + f), funding: Math.round(f) });
    return acc;
  }, []);
  const runsOut = projection.find((p) => p.cash < 0);
  const months = net >= 0 ? null : box.own > 0 ? box.own / -net : 0;
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={() => setCash(true)} className="btn-primary"><Banknote size={14} /> Record cash balances</button>
        <button onClick={() => setSettings(true)} className="btn-secondary"><Pencil size={14} /> Running costs</button>
      </div>
      {!box.list.length && <p className="mb-3 text-small rounded-lg bg-attention-muted px-3 py-2"><b>No cash balances yet.</b> Record what is in each account today (from the statements) to see the runway. The ledger in Kivu Daily only started on {dayLabel(live?.ledger_since ?? null, true)} and holds fleet money, so it can't tell the cash by itself.</p>}
      <StatGrid cols={5}>
        <StatCard icon={PiggyBank} label="Cash (Kivu Ride's own)" value={rwf(box.own)} sub={box.asOf ? `as of ${dayLabel(box.asOf)}${box.held ? ` · ${rwfShort(box.held)} held for owners/drivers` : ''}` : 'not recorded yet'} />
        <StatCard icon={TrendingDown} label="Running costs / month" value={rwf(costs)} sub={budgetsThisMonth ? `approved budgets this month: ${rwfShort(budgetsThisMonth)}` : s.notes ?? 'your figure — edit in Running costs'} />
        <StatCard icon={TrendingUp} label="Own income / month" value={rwf(inc?.recurring ?? 0)} sub="last 30 days, without one-off fees" />
        <StatCard icon={Scale} label={net >= 0 ? 'Monthly surplus' : 'Monthly burn'} value={rwf(Math.abs(net))} tone={net >= 0 ? 'success' : 'danger'} sub={net >= 0 ? 'income covers costs' : 'costs above income'} />
        <StatCard icon={AlertTriangle} label="Runway" value={months === null ? 'Not burning' : !box.list.length ? '—' : `${months.toFixed(1)} months`} tone={months !== null && months < 6 ? 'danger' : undefined} sub={runsOut ? `cash runs out around ${monthName(runsOut.month)}` : months === null ? 'cash grows each month' : 'with expected funding: lasts 12+ months'} />
      </StatGrid>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Box title="Where our own income comes from (30 days)" icon={TrendingUp}>
          {inc ? (
            <table className="w-full text-small"><tbody>
              <tr className="border-b border-line-muted"><td className="py-1.5">Managed cars — our margin</td><td className="py-1.5 text-right tabular-nums">{rwf(inc.managedMargin)}</td></tr>
              <tr className="border-b border-line-muted"><td className="py-1.5">Management fees & other revenue</td><td className="py-1.5 text-right tabular-nums">{rwf(inc.fees)}</td></tr>
              <tr className="border-b border-line-muted"><td className="py-1.5">App commission <span className="text-caption text-fg-muted">({live!.completed_30d} trips × {rwf(inc.avgFare)} × {Number(s.commission_pct)}%, estimate)</span></td><td className="py-1.5 text-right tabular-nums">{rwf(inc.commission)}</td></tr>
              <tr className="font-semibold"><td className="py-1.5">Every month</td><td className="py-1.5 text-right tabular-nums">{rwf(inc.recurring)}</td></tr>
              <tr className="text-fg-muted"><td className="py-1.5">One-off: onboarding fees</td><td className="py-1.5 text-right tabular-nums">{rwf(inc.onboarding)}</td></tr>
            </tbody></table>
          ) : <p className="text-small text-fg-muted">No data.</p>}
          {inc && inc.recurring > 0 && <p className="mt-2 text-caption text-fg-muted">{Math.round((inc.managedMargin / inc.recurring) * 100)}% of our income comes from the {live!.managed_cars} managed cars; the app commission is {Math.round((inc.commission / inc.recurring) * 100)}%.</p>}
        </Box>
        <div className="xl:col-span-2">
          <ChartCard title="Cash, the next 12 months" subtitle={<>Today's cash, plus each month's {net >= 0 ? 'surplus' : 'burn'}, plus funding expected into our own accounts. <label className="inline-flex items-center gap-1 ml-1"><input type="checkbox" checked={weighted} onChange={(e) => setWeighted(e.target.checked)} /> count deals in talks by their likelihood</label></>}
            legend={[{ key: 'cash', label: 'Cash at the start of the month', color: c.blue }, { key: 'funding', label: 'Funding coming in', color: c.aqua }]}>
            <DailyBars data={projection} c={c} stacked={false} xKey="month" xFormat={monthName} tipTitle={monthName} format={(n) => rwfShort(n)} series={[{ key: 'cash', label: 'Cash at the start of the month', color: c.blue }, { key: 'funding', label: 'Funding coming in', color: c.aqua }]} />
          </ChartCard>
        </div>
      </div>
      {box.list.length > 0 && (
        <Box title="Latest balances" icon={Banknote} padded={false}>
          <table className="w-full text-body"><tbody>{box.list.map((x) => (
            <tr key={x.id} className="border-t border-line-muted first:border-t-0"><td className={td}>{x.label}</td><td className={`${td} text-caption text-fg-muted`}>{dayLabel(x.checked_on)}</td><td className={td}>{x.is_own ? <Label tone="success">own</Label> : <Label>held for others</Label>}</td><td className={`${td} text-right tabular-nums`}>{rwf(Number(x.amount))}</td></tr>
          ))}</tbody></table>
        </Box>
      )}
      {cash && <CashCheckModal money={money} onClose={() => setCash(false)} />}
      {settings && <MoneySettingsModal money={money} onClose={() => setSettings(false)} />}
    </>
  );
}

// ------------------------------------------------------------ funding
function FundingTab({ money, plan }: { money: MoneyData; plan: Plan }) {
  const [editing, setEditing] = useState<Funding | 'new' | null>(null);
  const live = money.funding.filter((f) => f.status !== 'lost');
  const sum = (list: Funding[]) => list.reduce((s, f) => s + Number(f.amount ?? 0), 0);
  const weighted = money.funding.filter((f) => f.status === 'pending' && f.amount).reduce((s, f) => s + Number(f.amount) * ((f.probability ?? 0) / 100), 0);
  return (
    <>
      <div className="flex justify-end mb-3"><button onClick={() => setEditing('new')} className="btn-primary"><Plus size={14} /> New funding source</button></div>
      <StatGrid cols={4}>
        <StatCard label="Received" value={rwf(money.funding.reduce((s, f) => s + Number(f.received_amount), 0))} />
        <StatCard label="Agreed, coming" value={rwf(sum(money.funding.filter((f) => f.status === 'agreed')) - money.funding.filter((f) => f.status === 'agreed').reduce((s, f) => s + Number(f.received_amount), 0))} sub={`${money.funding.filter((f) => f.status === 'agreed').length} sources`} />
        <StatCard label="In talks" value={rwf(sum(money.funding.filter((f) => f.status === 'pending')))} sub={`${rwf(weighted)} counting how likely each is`} />
        <StatCard label="Not sized yet" value={money.funding.filter((f) => f.status !== 'lost' && !f.amount).length} sub="sources without an amount" tone={money.funding.some((f) => f.status !== 'lost' && !f.amount) ? 'attention' : undefined} />
      </StatGrid>
      <div className="space-y-2">
        {live.map((f) => {
          const uses = money.uses.filter((u) => u.funding_id === f.id);
          return (
            <button key={f.id} onClick={() => setEditing(f)} className="w-full text-left card p-4 hover:border-line-strong">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-caption text-fg-muted">F{f.number}</span>
                <span className="text-body font-semibold flex-1 min-w-[200px]">{f.name}</span>
                <Label>{FUNDING_KIND[f.kind]}</Label>
                <Label tone={FUNDING_STATUS[f.status].tone}>{FUNDING_STATUS[f.status].label}</Label>
                <span className="text-body font-semibold tabular-nums">{f.amount ? rwf(Number(f.amount)) : 'amount not set'}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-muted mt-1">
                {f.status === 'pending' && <span>{f.probability === null ? 'likelihood not set' : `${f.probability}% likely`}</span>}
                {f.expected_date && <span>expected {dayLabel(f.expected_date, true)}</span>}
                <span>{f.cash_to_company ? 'comes into our accounts' : 'goes to the cars / project, not our accounts'}</span>
                {f.owner_id && <span>followed by {plan.nameOf(f.owner_id)}</span>}
              </div>
              {f.terms && <p className="text-small mt-2 line-clamp-2">{f.terms}</p>}
              {f.next_step && <p className="text-caption mt-1"><b>Next:</b> {f.next_step}</p>}
              {uses.length > 0 && <p className="text-caption text-fg-muted mt-1">Pays for: {uses.map((u) => `${u.description} (${rwfShort(Number(u.amount))})`).join(', ')}</p>}
            </button>
          );
        })}
      </div>
      {money.funding.some((f) => f.status === 'lost') && <p className="mt-3 text-caption text-fg-muted">Lost: {money.funding.filter((f) => f.status === 'lost').map((f) => f.name).join(', ')}</p>}
      {editing && <FundingModal money={money} plan={plan} funding={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// ------------------------------------------------------------ sources & uses
function Sources({ money, plan }: { money: MoneyData; plan: Plan }) {
  const s = money.settings!;
  const box = latestCash(money.checks);
  const inc = money.live ? incomeNow(money.live, s) : null;
  const net = (inc?.recurring ?? 0) - Number(s.monthly_costs);
  const [horizon, setHorizon] = useState(6);
  const toUs = money.funding.filter((f) => f.cash_to_company && ['agreed', 'pending'].includes(f.status) && f.amount);
  const sources = [
    { label: "Cash today (Kivu Ride's own)", n: box.own, note: box.asOf ? `as of ${dayLabel(box.asOf)}` : 'not recorded' },
    ...(net > 0 ? [{ label: `Surplus from operations, ${horizon} months`, n: net * horizon, note: 'income above running costs' }] : []),
    ...toUs.map((f) => ({ label: `F${f.number} ${f.name}`, n: (Number(f.amount) - Number(f.received_amount)) * (f.status === 'agreed' ? 1 : (f.probability ?? 0) / 100), note: f.status === 'agreed' ? 'agreed' : `in talks, × ${f.probability ?? 0}% likely` })),
  ];
  const budgetRows = plan.budgets.filter((b) => ['approved', 'submitted'].includes(b.status)).map((b) => ({ b, m: budgetMoney(b, plan.lines, plan.spend) }));
  const uses = [
    ...(net < 0 ? [{ label: `Running costs above income, ${horizon} months`, n: -net * horizon, note: `${rwf(-net)} a month` }] : []),
    ...budgetRows.map(({ b, m }) => ({ label: `B${b.number} ${b.name}`, n: Math.max(0, (b.status === 'approved' ? m.approved ?? m.planned : m.planned) - m.spent), note: b.status === 'approved' ? 'approved, still to spend' : 'waiting for approval' })),
  ];
  const tS = sources.reduce((x, y) => x + y.n, 0), tU = uses.reduce((x, y) => x + y.n, 0);
  const elsewhere = money.funding.filter((f) => !f.cash_to_company && f.status !== 'lost');
  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-small">Looking ahead <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="input !w-auto !py-1">{[3, 6, 12].map((n) => <option key={n} value={n}>{n} months</option>)}</select>
        <span className="text-caption text-fg-muted">Budgets count only what is still to spend. Running costs are your monthly figure; approved budgets may overlap with them.</span></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Box title={`Sources · ${rwf(tS)}`} icon={TrendingUp} padded={false}>
          <table className="w-full text-body"><tbody>{sources.map((x, i) => <tr key={i} className="border-t border-line-muted first:border-t-0"><td className={td}>{x.label}<p className="text-caption text-fg-muted">{x.note}</p></td><td className={`${td} text-right tabular-nums`}>{rwf(x.n)}</td></tr>)}</tbody></table>
        </Box>
        <Box title={`Uses · ${rwf(tU)}`} icon={TrendingDown} padded={false}>
          {uses.length ? <table className="w-full text-body"><tbody>{uses.map((x, i) => <tr key={i} className="border-t border-line-muted first:border-t-0"><td className={td}>{x.label}<p className="text-caption text-fg-muted">{x.note}</p></td><td className={`${td} text-right tabular-nums`}>{rwf(x.n)}</td></tr>)}</tbody></table>
            : <p className="p-5 text-small text-fg-muted">No approved or submitted budgets yet.</p>}
        </Box>
      </div>
      <div className={`rounded-lg px-4 py-3 mb-4 ${tS - tU >= 0 ? 'bg-success-muted' : 'bg-danger-muted'}`}>
        <p className="text-body"><b>{tS - tU >= 0 ? 'Covered' : 'Gap'}: {rwf(Math.abs(tS - tU))}</b> over the next {horizon} months. {tS - tU < 0 ? 'Either more funding, a smaller budget, or more income is needed.' : ''}</p>
      </div>
      {elsewhere.length > 0 && (
        <Box title="Money that goes straight to cars or projects" icon={Coins} padded={false}>
          <table className="w-full text-body"><tbody>{elsewhere.map((f) => {
            const u = money.uses.filter((x) => x.funding_id === f.id);
            return <tr key={f.id} className="border-t border-line-muted first:border-t-0"><td className={td}>F{f.number} {f.name}<p className="text-caption text-fg-muted">{u.length ? `pays for ${u.map((x) => x.description).join(', ')}` : 'uses not written yet'}</p></td><td className={td}><Label tone={FUNDING_STATUS[f.status].tone}>{FUNDING_STATUS[f.status].label}</Label></td><td className={`${td} text-right tabular-nums`}>{f.amount ? rwf(Number(f.amount)) : '—'}</td></tr>;
          })}</tbody></table>
        </Box>
      )}
    </>
  );
}

// ------------------------------------------------------------ scenarios
const FIELDS: { key: keyof ScenarioInputs; label: string; hint?: string; step?: number }[] = [
  { key: 'tripsPerDay', label: 'Completed app trips per day' }, { key: 'avgFare', label: 'Average fare (RWF)' }, { key: 'commissionPct', label: 'Commission (%)', step: 0.5 },
  { key: 'managedCars', label: 'Managed cars' }, { key: 'marginPerCar', label: 'Our margin per managed car / month', hint: 'target 120k a week ≈ 520k a month' }, { key: 'feePerCar', label: 'Management fee per car / month' },
  { key: 'otherIncome', label: 'Other income / month' }, { key: 'monthlyCosts', label: 'Running costs / month' }, { key: 'cash', label: 'Cash today' },
];
function Scenarios({ money }: { money: MoneyData }) {
  const s = money.settings!;
  const live = money.live;
  const inc = live ? incomeNow(live, s) : null;
  const cars = Number(live?.managed_cars ?? 0);
  const today: ScenarioInputs = {
    tripsPerDay: inc?.tripsPerDay ?? 0, avgFare: inc?.avgFare || 10000, commissionPct: Number(s.commission_pct), managedCars: cars,
    marginPerCar: cars ? Math.round((inc?.managedMargin ?? 0) / cars) : 520000, feePerCar: cars ? Math.round((inc?.fees ?? 0) / cars) : 30000, otherIncome: 0,
    monthlyCosts: Number(s.monthly_costs), cash: latestCash(money.checks).own,
  };
  const [x, setX] = useState<ScenarioInputs>(today);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const r = runScenario(x);
  const presets: { label: string; v: ScenarioInputs }[] = [
    { label: 'Today', v: today },
    { label: 'Managed cars at target margin', v: { ...today, marginPerCar: 520000 } },
    { label: 'Funded team (8.16M costs)', v: { ...today, monthlyCosts: 8160000 } },
    ...money.scenarios.map((sc) => ({ label: sc.name, v: { ...today, ...sc.inputs } })),
  ];
  const grid = useMemo(() => [10, 25, 50, 93, 150, 250, 400].map((t) => ({ t, ...runScenario({ ...x, tripsPerDay: t }) })), [x]);
  const save = async () => {
    if (!name.trim()) { setMsg('Name the scenario first.'); return; }
    const existing = money.scenarios.find((sc) => sc.name.toLowerCase() === name.trim().toLowerCase());
    const res = existing ? await supabase.from('company_scenarios').update({ inputs: x, updated_at: new Date().toISOString() }).eq('id', existing.id) : await supabase.from('company_scenarios').insert({ name: name.trim(), inputs: x });
    setMsg(res.error ? res.error.message : 'Saved.'); money.reload();
  };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Box title="What if…" icon={Calculator}>
        <div className="flex flex-wrap gap-1.5 mb-3">{presets.map((p) => <button key={p.label} onClick={() => setX(p.v)} className="px-2.5 py-1 rounded-full text-caption border border-line hover:bg-hover">{p.label}</button>)}</div>
        <div className="space-y-2">{FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-small"><span className="flex-1">{f.label}{f.hint && <span className="block text-micro text-fg-subtle">{f.hint}</span>}</span>
            <input type="number" step={f.step ?? 1} value={x[f.key]} onChange={(e) => setX({ ...x, [f.key]: Number(e.target.value) || 0 })} className="input !py-1 !w-32 text-right tabular-nums" /></label>
        ))}</div>
        <div className="flex gap-2 mt-3 pt-3 border-t border-line-muted"><input value={name} onChange={(e) => setName(e.target.value)} className="input !py-1 text-small" placeholder="Name this scenario" /><button onClick={save} className="btn-secondary"><Save size={13} /> Save</button></div>
        {msg && <p className="text-caption mt-1">{msg}</p>}
      </Box>
      <div className="xl:col-span-2 space-y-4">
        <StatGrid cols={4}>
          <StatCard label="Income / month" value={rwf(r.income)} sub={`app ${rwfShort(r.commission)} · managed cars ${rwfShort(r.managed)}`} />
          <StatCard label={r.profit >= 0 ? 'Profit / month' : 'Loss / month'} value={rwf(Math.abs(r.profit))} tone={r.profit >= 0 ? 'success' : 'danger'} />
          <StatCard label="App trips needed to break even" value={r.breakEvenTrips === null ? '—' : r.breakEvenTrips === 0 ? 'None' : `${r.breakEvenTrips} / day`} sub={r.breakEvenTrips === 0 ? 'managed cars and other income already cover the costs' : `on top of the managed cars · ${rwf(r.perTrip)} per trip`} />
          <StatCard label={r.runwayMonths === null ? 'Runway' : 'Cash lasts'} value={r.runwayMonths === null ? 'Not burning' : `${r.runwayMonths} months`} tone={r.runwayMonths !== null && r.runwayMonths < 6 ? 'danger' : undefined} sub={r.carsToBreakEven !== null ? `or ${r.carsToBreakEven} managed cars cover the costs` : ''} />
        </StatGrid>
        <Box title="Profit at different trip levels (everything else as on the left)" icon={TrendingUp} padded={false}>
          <table className="w-full text-body">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset">{['Trips / day', 'App commission', 'Income', 'Profit / month'].map((h, k) => <th key={h} className={`${th} ${k ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>{grid.map((g) => (
              <tr key={g.t} className={`border-t border-line-muted ${g.t === 93 ? 'bg-inset/60' : ''}`}><td className={td}>{g.t}{g.t === 93 ? <span className="text-caption text-fg-muted"> (old break-even)</span> : ''}</td><td className={`${td} text-right tabular-nums`}>{rwfShort(g.commission)}</td><td className={`${td} text-right tabular-nums`}>{rwfShort(g.income)}</td><td className={`${td} text-right tabular-nums font-medium ${g.profit < 0 ? 'text-danger' : 'text-success'}`}>{g.profit < 0 ? '−' : '+'}{rwfShort(Math.abs(g.profit))}</td></tr>
            ))}</tbody>
          </table>
        </Box>
        <p className="text-caption text-fg-muted">Income here is what Kivu Ride keeps: the commission on app trips and its margin and fee on managed cars. Car repayments, owner payouts and driver money are not ours and are left out.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ all budgets together
function AllBudgets({ plan }: { plan: Plan }) {
  const [incl, setIncl] = useState<'approved' | 'all'>('approved');
  const grid = budgetMonths(plan, incl === 'approved' ? ['approved'] : ['approved', 'submitted', 'draft']);
  const months = [...grid.keys()].sort();
  const kinds = BUDGET_KINDS.filter((k) => months.some((m) => grid.get(m)?.get(k.key)));
  if (!months.length) return <EmptyState icon={Wallet} title="No budgets to add up yet" body="Approved budgets appear here month by month, by type — the company budget built from the department budgets." />;
  const total = (m: string) => [...(grid.get(m)?.values() ?? [])].reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-small">Show <select value={incl} onChange={(e) => setIncl(e.target.value as 'approved' | 'all')} className="input !w-auto !py-1"><option value="approved">approved budgets</option><option value="all">approved, waiting and drafts</option></select></div>
      <Box title="The company budget, month by month" icon={Wallet} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead><tr className="text-caption text-fg-muted text-left bg-inset"><th className={th}>Type</th>{months.map((m) => <th key={m} className={`${th} text-right`}>{monthName(m)}</th>)}<th className={`${th} text-right`}>Total</th></tr></thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k.key} className="border-t border-line-muted"><td className={td}>{KIND[k.key].label}</td>{months.map((m) => <td key={m} className={`${td} text-right tabular-nums`}>{grid.get(m)?.get(k.key) ? rwfShort(grid.get(m)!.get(k.key)!) : '—'}</td>)}<td className={`${td} text-right tabular-nums font-medium`}>{rwfShort(months.reduce((s, m) => s + (grid.get(m)?.get(k.key) ?? 0), 0))}</td></tr>
              ))}
              <tr className="border-t border-line bg-inset font-semibold"><td className={td}>Total</td>{months.map((m) => <td key={m} className={`${td} text-right tabular-nums`}>{rwfShort(total(m))}</td>)}<td className={`${td} text-right tabular-nums`}>{rwfShort(months.reduce((s, m) => s + total(m), 0))}</td></tr>
            </tbody>
          </table>
        </div>
      </Box>
    </>
  );
}
