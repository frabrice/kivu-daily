import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis, LabelList,
} from 'recharts';
import { AlertTriangle, Car, Clock, Download, FileText, Gauge, Lightbulb, Plug, Users2, Wallet, Zap } from 'lucide-react';
import { ChargingStation } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { analyseStations, DEFAULT_ASSUMPTIONS, KWH_SCENARIOS, sensitivity, StationAnalysis } from '../../lib/stationAnalysis';

// Charging-station analytics: what the 13 surveyed stations charge, how
// busy they are, what one earns, where the data can't be trusted, and what
// that means for Kivu Ride. Two downloads: the data collected, and the full
// analysis report.

// Reference categorical palette (validated light/dark).
const PAL = {
  light: { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', neutral: '#a3a3a3', grid: '#f1f5f9', axis: '#9ca3af', surface: '#ffffff' },
  dark: { blue: '#3987e5', orange: '#d95926', aqua: '#199e70', neutral: '#6b7f95', grid: 'rgba(255,255,255,0.06)', axis: '#5d7791', surface: '#17263A' },
};
const SCEN_KEYS = KWH_SCENARIOS.map((k) => `k${k}`);
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const mrwf = (n: number) => `${(n / 1_000_000).toFixed(1)}M`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function StationAnalytics({ stations }: { stations: ChargingStation[] }) {
  const { theme } = useTheme();
  const c = PAL[theme === 'dark' ? 'dark' : 'light'];
  const [kwh, setKwh] = useState(DEFAULT_ASSUMPTIONS.kwhPerSession);
  const [ops, setOps] = useState(DEFAULT_ASSUMPTIONS.operatorsPerShift);
  const an = useMemo(() => analyseStations(stations, { ...DEFAULT_ASSUMPTIONS, kwhPerSession: kwh, operatorsPerShift: ops }), [stations, kwh, ops]);
  const [busy, setBusy] = useState<'' | 'data' | 'analysis'>('');
  const [error, setError] = useState('');

  const download = async (kind: 'data' | 'analysis') => {
    setBusy(kind);
    setError('');
    try {
      const mod = await import('../../lib/stationReportPdf');
      const blob = kind === 'data' ? await mod.buildDataReport(stations, an) : await mod.buildAnalysisReport(stations, an);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Kivu-Ride-Charging-Stations-${kind === 'data' ? 'Data-Collected' : 'Analysis-Report'}-${new Date().toISOString().slice(0, 10)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF');
    }
    setBusy('');
  };

  if (an.n === 0) return <div className="card p-12 text-center text-[12px] text-gray-400">No data yet — analytics appear once stations are submitted.</div>;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold">Charging stations — survey analysis</p>
          <p className="text-[11px] text-gray-500">{an.n} stations surveyed {an.firstDate && `${new Date(an.firstDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}–${new Date(an.lastDate!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`} · field follow-up by Henry Rugaba Mark</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => download('data')} disabled={!!busy} className="btn-ghost flex items-center gap-1.5 border border-gray-200 dark:border-white/10 disabled:opacity-50">
            <FileText size={14} /> {busy === 'data' ? 'Preparing…' : 'Download data collected'}
          </button>
          <button onClick={() => download('analysis')} disabled={!!busy} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {busy === 'analysis' ? 'Preparing…' : 'Download analysis report'}
          </button>
        </div>
        {error && <p className="w-full text-[11px] text-red-600">{error}</p>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Zap} label="Stations · guns" value={`${an.n} · ${an.totalGuns}`} sub={`${an.totalChargers} chargers, all open 24 hours`} />
        <Kpi icon={Wallet} label="Average selling price" value={`${Math.round(an.avgSell)} RWF/kWh`} sub={`${an.minSell}–${an.maxSell} · bought at ${Math.round(an.avgBuy)}`} />
        <Kpi icon={Gauge} label="Average margin" value={`${Math.round(an.avgMargin)} RWF/kWh`} sub={`${pct(an.avgMarkupPct)} mark-up on electricity`} />
        <Kpi icon={Car} label="Cars a day per station" value={String(an.fieldCarsAvg)} sub={`${an.fieldCarsMin}–${an.fieldCarsMax} (field) · ${an.networkCarsDay.toLocaleString('en-US')} a day across all`} />
        <Kpi icon={Clock} label="Charging time" value={`${an.fieldMinutesAvg} min`} sub={`${an.fieldMinutesMin} min – ${an.fieldMinutesMax / 60} h`} />
        <Kpi icon={Plug} label="Guns busy" value={pct(an.avgUtilisation)} sub="of the day, at 40 cars × 50 min" />
        <Kpi icon={Users2} label="Operator salary" value={`${Math.round(an.salaryAvg / 1000)}k RWF`} sub={`${Math.round(an.salaryMin / 1000)}k–${Math.round(an.salaryMax / 1000)}k a month · ${an.shifts} × ${an.shiftHours}h shifts`} />
        <Kpi icon={AlertTriangle} label="Reported counts not possible" value={`${an.overCapacityCount} of ${an.n}`} sub="stations — see data quality" tone={an.overCapacityCount ? 'warn' : undefined} />
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-[12px] font-semibold">Assumptions</p>
          <p className="text-[11px] text-gray-500 max-w-md">Not measured in the field — change them and every number, chart and the downloaded report follow.</p>
        </div>
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-1">Energy per charge: <b className="text-gray-800 dark:text-gray-100">{kwh} kWh</b></span>
          <input type="range" min={5} max={40} step={1} value={kwh} onChange={(e) => setKwh(Number(e.target.value))} className="w-56 accent-brand" aria-label="Energy per charge in kWh" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-1">Operators per shift</span>
          <select value={ops} onChange={(e) => setOps(Number(e.target.value))} className="input py-1.5 w-28">
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <Findings an={an} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PriceChart an={an} c={c} />
        <CapacityChart an={an} c={c} />
        <UtilisationChart an={an} c={c} />
        <SensitivityChart an={an} c={c} />
        <MoneyChart an={an} c={c} />
        <MapChart an={an} c={c} />
      </div>

      <DataQuality an={an} />
      <StationTable an={an} />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Zap; label: string; value: string; sub: string; tone?: 'warn' }) {
  return (
    <div className={`card p-4 ${tone === 'warn' ? 'ring-1 ring-amber-300 dark:ring-amber-500/40' : ''}`}>
      <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Icon size={13} /> {label}</p>
      <p className="text-[20px] font-bold leading-tight mt-1 tabular-nums">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}

function Card({ title, sub, children, legend }: { title: string; sub: string; children: React.ReactNode; legend?: { label: string; color: string }[] }) {
  return (
    <div className="card p-4 space-y-2">
      <div>
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="text-[11px] text-gray-500">{sub}</p>
      </div>
      {legend && <div className="flex flex-wrap gap-x-4 gap-y-1">{legend.map((l) => <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />{l.label}</span>)}</div>}
      {children}
    </div>
  );
}

function Tip({ active, payload, rows }: { active?: boolean; payload?: { payload: Record<string, unknown> }[]; rows: (p: Record<string, unknown>) => [string, string][] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-100 dark:border-white/10 bg-white dark:bg-navy-700 shadow-lg px-3 py-2 text-[11px] max-w-[260px]">
      {rows(p).map(([k, v], i) => <p key={i} className={i === 0 ? 'font-semibold mb-0.5' : 'flex justify-between gap-3 text-gray-600 dark:text-gray-300'}>{i === 0 ? k : <><span>{k}</span><b className="text-gray-900 dark:text-white">{v}</b></>}</p>)}
    </div>
  );
}

function Findings({ an }: { an: StationAnalysis }) {
  return (
    <div className="card p-4 space-y-2">
      <p className="text-[13px] font-semibold flex items-center gap-1.5"><Lightbulb size={14} className="text-amber-500" /> What the data says</p>
      <ol className="space-y-1.5">
        {an.findings.map((f, i) => (
          <li key={i} className="text-[12px] leading-relaxed flex gap-2"><span className="w-5 h-5 rounded-full bg-brand/10 text-brand-700 dark:text-brand-300 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span><span>{f}</span></li>
        ))}
      </ol>
      <p className="text-[10px] text-gray-400">Profit figures are before rent, maintenance, equipment and financing — those weren't collected.</p>
    </div>
  );
}

function PriceChart({ an, c }: { an: StationAnalysis; c: typeof PAL.light }) {
  const data = [...an.stations].sort((a, b) => b.sell - a.sell).map((m) => ({ name: `#${m.s.station_number} ${m.s.owner_brand}`, cost: m.buy, margin: m.margin, sell: m.sell, label: m.label }));
  return (
    <Card title="Selling price per kWh, and what the station keeps" sub={`Electricity is bought at ${Math.round(an.avgBuy)} RWF/kWh everywhere; the rest is margin. Network average ${Math.round(an.avgSell)} RWF.`}
      legend={[{ label: 'Electricity cost', color: c.neutral }, { label: 'Station margin', color: c.blue }]}>
      <div style={{ height: data.length * 26 + 30 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36, top: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" domain={[0, (max: number) => Math.ceil((max + 60) / 100) * 100]} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} unit=" RWF" />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: c.grid }} content={<Tip rows={(p) => [[String(p.label), ''], ['Selling price', `${p.sell} RWF/kWh`], ['Electricity cost', `${p.cost} RWF/kWh`], ['Margin', `${p.margin} RWF/kWh`]]} />} />
            <ReferenceLine x={an.avgSell} stroke={c.axis} strokeDasharray="4 3" />
            <Bar dataKey="cost" stackId="p" fill={c.neutral} stroke={c.surface} strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="margin" stackId="p" fill={c.blue} stroke={c.surface} strokeWidth={1} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="sell" position="right" style={{ fontSize: 10, fill: c.axis }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function CapacityChart({ an, c }: { an: StationAnalysis; c: typeof PAL.light }) {
  const data = an.stations.filter((m) => m.capacityAtReported).map((m) => ({ name: `#${m.s.station_number} ${m.s.owner_brand}`, reported: m.reportedCars, capacity: Math.floor(m.capacityAtReported!), over: m.reportedOverCapacity, label: m.label, guns: m.guns, sess: m.reportedSession }));
  return (
    <Card title="Reported cars a day vs. what the guns can physically serve" sub={`Max = guns × 24 h ÷ the reported charging time. ${an.overCapacityCount} stations report more than is possible. Shaded band = Mark's field range (${an.fieldCarsMin}–${an.fieldCarsMax}).`}
      legend={[{ label: 'Reported in the survey', color: c.orange }, { label: 'Most the guns can serve', color: c.blue }]}>
      <div style={{ height: data.length * 30 + 30 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 30, top: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
            <ReferenceArea x1={an.fieldCarsMin} x2={an.fieldCarsMax} fill={c.aqua} fillOpacity={0.12} />
            <Tooltip cursor={{ fill: c.grid }} content={<Tip rows={(p) => [[String(p.label), ''], ['Reported', `${p.reported} cars/day`], ['Possible max', `${p.capacity} cars/day`], ['Guns · charge time', `${p.guns} · ${p.sess} min`], ['', p.over ? 'Reported is NOT possible' : 'Within capacity']]} />} />
            <Bar dataKey="reported" fill={c.orange} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="capacity" fill={c.blue} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function UtilisationChart({ an, c }: { an: StationAnalysis; c: typeof PAL.light }) {
  const data = [...an.stations].sort((a, b) => b.utilisation - a.utilisation).map((m) => ({ name: `#${m.s.station_number} ${m.s.owner_brand}`, util: Math.round(m.utilisation * 100), guns: m.guns, label: m.label }));
  return (
    <Card title="How busy the guns are" sub={`Share of the day the guns are charging at ${an.fieldCarsAvg} cars × ${an.fieldMinutesAvg} min. Above ~70%, drivers start queueing.`}>
      <div style={{ height: data.length * 24 + 30 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36, top: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
            <ReferenceLine x={70} stroke={c.orange} strokeDasharray="4 3" />
            <Tooltip cursor={{ fill: c.grid }} content={<Tip rows={(p) => [[String(p.label), ''], ['Guns busy', `${p.util}% of the day`], ['Guns', String(p.guns)]]} />} />
            <Bar dataKey="util" fill={c.blue} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="util" position="right" formatter={(v: unknown) => `${v}%`} style={{ fontSize: 10, fill: c.axis }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function SensitivityChart({ an, c }: { an: StationAnalysis; c: typeof PAL.light }) {
  const data = sensitivity(an);
  const colors = [c.orange, c.blue, c.aqua];
  return (
    <Card title="Monthly result for a typical station" sub={`Energy margin minus operator salaries, by cars a day and energy per charge. Shaded = Mark's field range. Before rent, maintenance and equipment.`}
      legend={KWH_SCENARIOS.map((k, i) => ({ label: `${k} kWh per charge`, color: colors[i] }))}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 12, top: 6, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <ReferenceArea x1={an.fieldCarsMin} x2={an.fieldCarsMax} fill={c.aqua} fillOpacity={0.1} />
            <XAxis dataKey="cars" tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} label={{ value: 'cars a day', position: 'insideBottomRight', offset: -2, fontSize: 10, fill: c.axis }} />
            <YAxis tickFormatter={mrwf} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
              <div className="rounded-lg border border-gray-100 dark:border-white/10 bg-white dark:bg-navy-700 shadow-lg px-3 py-2 text-[11px]">
                <p className="font-semibold mb-0.5">{label} cars a day</p>
                {KWH_SCENARIOS.map((k, i) => <p key={k} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300"><span className="w-2 h-2 rounded-sm" style={{ background: colors[i] }} />{k} kWh: <b className="text-gray-900 dark:text-white">{rwf(Number(payload.find((p) => p.dataKey === `k${k}`)?.value ?? 0))}</b></p>)}
              </div>
            ) : null} />
            {SCEN_KEYS.map((k, i) => <Line key={k} dataKey={k} stroke={colors[i]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function MoneyChart({ an, c }: { an: StationAnalysis; c: typeof PAL.light }) {
  const n = an.n || 1;
  const rev = an.networkRevenueMonth / n, energy = (an.networkRevenueMonth - an.networkGrossMarginMonth) / n, staff = an.networkStaffMonth / n;
  const data = [
    { name: 'Charging revenue', v: rev, kind: 'in' },
    { name: 'Electricity bought', v: -energy, kind: 'out' },
    { name: 'Operator salaries', v: -staff, kind: 'out' },
    { name: 'Left after salaries', v: rev - energy - staff, kind: 'net' },
  ];
  return (
    <Card title="Where a typical station's month goes" sub={`${an.fieldCarsAvg} cars a day × ${an.a.kwhPerSession} kWh × ${an.a.daysPerMonth} days, at each station's own price, averaged. Before rent, maintenance and equipment.`}
      legend={[{ label: 'Money in / left', color: c.blue }, { label: 'Costs', color: c.neutral }]}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 64, top: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" tickFormatter={mrwf} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: c.axis }} axisLine={false} tickLine={false} />
            <ReferenceLine x={0} stroke={c.axis} />
            <Tooltip cursor={{ fill: c.grid }} content={<Tip rows={(p) => [[String(p.name), ''], ['A month', rwf(Math.abs(Number(p.v)))]]} />} />
            <Bar dataKey="v" isAnimationActive={false} radius={[4, 4, 4, 4]}
              shape={(props: unknown) => {
                const p = props as { x: number; y: number; width: number; height: number; payload: { kind: string } };
                const x = p.width < 0 ? p.x + p.width : p.x;
                return <rect x={x} y={p.y} width={Math.abs(p.width)} height={p.height} rx={4} fill={p.payload.kind === 'out' ? c.neutral : c.blue} />;
              }}>
              <LabelList dataKey="v" position="right" formatter={(v: unknown) => mrwf(Math.abs(Number(v)))} style={{ fontSize: 10, fill: c.axis }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function MapChart({ an, c }: { an: StationAnalysis; c: typeof PAL.light }) {
  const data = an.stations.filter((m) => m.s.latitude && m.s.longitude).map((m) => ({ x: Number(m.s.longitude), y: Number(m.s.latitude), z: m.guns, label: m.label, sell: m.sell, n: `#${m.s.station_number}` }));
  return (
    <Card title="Where the stations are" sub="Positions from the collector's GPS (north is up). Bigger dot = more guns. Gaps show where a Kivu Ride station would face no competition.">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ left: 0, right: 12, top: 6, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} />
            <XAxis type="number" dataKey="x" domain={['dataMin - 0.01', 'dataMax + 0.01']} tickFormatter={(v: number) => v.toFixed(2)} tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} name="Longitude" />
            <YAxis type="number" dataKey="y" domain={['dataMin - 0.01', 'dataMax + 0.01']} tickFormatter={(v: number) => v.toFixed(2)} tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={44} name="Latitude" />
            <ZAxis type="number" dataKey="z" range={[60, 360]} />
            <Tooltip content={<Tip rows={(p) => [[String(p.label), ''], ['Guns', String(p.z)], ['Price', `${p.sell} RWF/kWh`]]} />} />
            <Scatter data={data} fill={c.blue} fillOpacity={0.75} stroke={c.surface} strokeWidth={2} isAnimationActive={false}>
              <LabelList dataKey="n" position="top" style={{ fontSize: 9, fill: c.axis }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function DataQuality({ an }: { an: StationAnalysis }) {
  const tone = { high: 'border-red-400 bg-red-50 dark:bg-red-500/10', medium: 'border-amber-400 bg-amber-50 dark:bg-amber-500/10', low: 'border-gray-300 bg-gray-50 dark:bg-white/5' };
  return (
    <div className="card p-4 space-y-2">
      <p className="text-[13px] font-semibold flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-500" /> Data quality — check before relying on it</p>
      {an.issues.map((i) => (
        <div key={i.title} className={`rounded-lg border-l-4 px-3 py-2 ${tone[i.severity]}`}>
          <p className="text-[12px] font-semibold">{i.title}</p>
          <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{i.detail}</p>
          {i.stations.length > 0 && <ul className="mt-1 space-y-0.5">{i.stations.map((s) => <li key={s} className="text-[11px] text-gray-500">• {s}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}

function StationTable({ an }: { an: StationAnalysis }) {
  return (
    <div className="card p-4 space-y-2">
      <p className="text-[13px] font-semibold">Station by station</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] min-w-[900px]">
          <thead><tr className="text-left text-gray-500">
            {['Station', 'Guns', 'Price', 'Margin', 'Reported cars', 'Possible max', 'Field cars', 'Guns busy', 'Margin a month', 'Salaries', 'Left a month'].map((h, i) => <th key={h} className={`py-1.5 pr-3 font-medium ${i ? 'text-right' : ''}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {an.stations.map((m) => (
              <tr key={m.s.id} className="border-t border-gray-100 dark:border-white/5">
                <td className="py-1.5 pr-3 font-medium">{m.label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{m.guns}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{m.sell}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{m.margin}</td>
                <td className={`py-1.5 pr-3 text-right tabular-nums ${m.reportedOverCapacity ? 'text-red-600 font-semibold' : ''}`}>{m.reportedCars}{m.reportedOverCapacity ? ' ⚠' : ''}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{m.capacityAtReported ? Math.floor(m.capacityAtReported) : '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{m.fieldCars}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{pct(m.utilisation)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{rwf(m.grossMarginDay * an.a.daysPerMonth)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{rwf(m.staffMonth)}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold">{rwf(m.netMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400">Prices and margins in RWF/kWh. Money columns use field cars a day × {an.a.kwhPerSession} kWh per charge (assumption) × {an.a.daysPerMonth} days, before rent, maintenance and equipment.</p>
    </div>
  );
}
