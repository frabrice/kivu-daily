import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Zap, Users2, Link2, Copy, Check, Trash2, Plus, Table2,
  TrendingUp, MapPin, ExternalLink, X, Car, Gauge, DollarSign,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { supabase, SurveyCase, SurveyCollector, ChargingStation } from '../../lib/supabase';
import {
  GUN_TYPES, GUN_TYPE_LABEL, DOWNTIME_OPTIONS, KIVU_FLEET_GUN_TYPE,
  fmtRwf, marginPerKwh, hasFleetCompatibleGun, estimateKwhPerSession,
} from '../../lib/chargingStations';
import DataTable from '../../components/DataTable';
import KpiTile from '../../components/KpiTile';
import Modal from '../../components/Modal';

type Tab = 'collectors' | 'data' | 'analytics';

const PIE_COLORS = ['#2F8C86', '#f59e0b', '#6366f1', '#ef4444', '#94a3b8'];

export default function ChargingStationsHub({ surveyCase, onBack }: { surveyCase: SurveyCase; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('data');
  const [collectors, setCollectors] = useState<SurveyCollector[]>([]);
  const [stations, setStations] = useState<ChargingStation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [colRes, stRes] = await Promise.all([
      supabase.from('survey_collectors').select('*').eq('case_id', surveyCase.id).order('created_at'),
      supabase.from('charging_stations').select('*, guns:charging_station_guns(*), photos:charging_station_photos(*)').eq('case_id', surveyCase.id).order('station_number'),
    ]);
    setCollectors((colRes.data as SurveyCollector[]) ?? []);
    setStations((stRes.data as ChargingStation[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [surveyCase.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5">
        <ArrowLeft size={14} /> Back to Research Cases
      </button>

      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Zap size={16} className="text-amber-600 dark:text-amber-300" /> {surveyCase.name}</h2>
        {surveyCase.description && <p className="text-[11px] text-gray-400 mt-0.5 max-w-2xl">{surveyCase.description}</p>}
      </div>

      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
        <TabButton active={tab === 'collectors'} onClick={() => setTab('collectors')} icon={Users2} label="Collectors & Link" />
        <TabButton active={tab === 'data'} onClick={() => setTab('data')} icon={Table2} label="Data" />
        <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={TrendingUp} label="Analytics" />
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>
      ) : (
        <>
          {tab === 'collectors' && <CollectorsTab surveyCase={surveyCase} collectors={collectors} reload={load} />}
          {tab === 'data' && <DataTab stations={stations} />}
          {tab === 'analytics' && <AnalyticsTab stations={stations} />}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Users2; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function CollectorsTab({ surveyCase, collectors, reload }: { surveyCase: SurveyCase; collectors: SurveyCollector[]; reload: () => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const link = `${window.location.origin}/survey/${surveyCase.link_token}`;

  const copyLink = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addCollector = async () => {
    if (!email.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('survey_collectors').insert({ case_id: surveyCase.id, email: email.trim().toLowerCase(), full_name: fullName.trim() || null });
    setSaving(false);
    if (err) { setError(err.message.includes('duplicate') ? 'This email is already a collector.' : err.message); return; }
    setEmail('');
    setFullName('');
    reload();
  };

  const removeCollector = async (id: string) => {
    await supabase.from('survey_collectors').delete().eq('id', id);
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5"><Link2 size={13} /> Shareable Link</p>
        <div className="flex items-center gap-2">
          <input readOnly value={link} className="input font-mono text-[11px]" />
          <button onClick={copyLink} className="btn-primary shrink-0 flex items-center gap-1.5 whitespace-nowrap">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">Anyone with this link enters their email below to unlock the data-entry form. No password.</p>
      </div>

      <div className="card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Add a Collector</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="collector email" className="input" />
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name (optional)" className="input" />
        </div>
        {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}
        <button onClick={addCollector} disabled={saving || !email.trim()} className="btn-primary mt-2.5 flex items-center gap-1.5 disabled:opacity-50">
          <Plus size={14} /> {saving ? 'Adding…' : 'Add Collector'}
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Authorized Collectors ({collectors.length})</p>
        {collectors.length === 0 ? (
          <div className="card p-8 text-center"><p className="text-[12px] text-gray-400">No collectors added yet.</p></div>
        ) : (
          <div className="space-y-1.5">
            {collectors.map((c) => (
              <div key={c.id} className="card p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate">{c.full_name || c.email}</p>
                  {c.full_name && <p className="text-[10px] text-gray-400 truncate">{c.email}</p>}
                </div>
                <button onClick={() => removeCollector(c.id)} className="btn-ghost p-1.5 text-red-500 shrink-0"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DataTab({ stations }: { stations: ChargingStation[] }) {
  const [detail, setDetail] = useState<ChargingStation | null>(null);

  return (
    <div className="space-y-3">
      <DataTable
        rows={stations}
        keyFn={(s) => s.id}
        emptyLabel="No stations submitted yet."
        onRowClick={setDetail}
        columns={[
          { header: '#', render: (s) => `Station ${s.station_number}` },
          { header: 'Owner / Brand', render: (s) => s.owner_brand },
          { header: 'Location', render: (s) => s.location_name },
          { header: 'Gun Types', render: (s) => (s.guns ?? []).map((g) => GUN_TYPE_LABEL[g.gun_type]).join(', ') || '—' },
          { header: 'Cars/Day', render: (s) => String(s.cars_per_day) },
          { header: 'Margin/kWh', render: (s) => fmtRwf(marginPerKwh(s)) },
          { header: 'Collector', render: (s) => s.submitted_by_email },
        ]}
      />

      {detail && <StationDetailModal station={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StationDetailModal({ station, onClose }: { station: ChargingStation; onClose: () => void }) {
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const urls: Record<string, string> = {};
      for (const p of station.photos ?? []) {
        const { data } = supabase.storage.from('survey-uploads').getPublicUrl(p.file_url);
        urls[p.id] = data.publicUrl;
      }
      setPhotoUrls(urls);
    })();
  }, [station]);

  return (
    <Modal open onClose={onClose} title={`Station ${station.station_number} — ${station.owner_brand}`} subtitle={station.location_name} maxWidth="max-w-lg">
      <div className="space-y-3 text-[12px]">
        {station.reverse_geocoded_address && (
          <div className="flex items-start gap-1.5 text-gray-500"><MapPin size={13} className="shrink-0 mt-0.5" /> {station.reverse_geocoded_address}</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <InfoRow label="Chargers" value={String(station.num_chargers)} />
          <InfoRow label="Charger Brand" value={station.charger_brand || '—'} />
          <InfoRow label="Operator" value={station.operator_name || '—'} />
          <InfoRow label="Cars/Day" value={String(station.cars_per_day)} />
          <InfoRow label="Weekend Cars/Day" value={station.weekday_weekend_variation ? String(station.weekend_cars_per_day ?? '—') : 'Same as weekday'} />
          <InfoRow label="Buying Price/kWh" value={fmtRwf(station.buying_price_per_kwh)} />
          <InfoRow label="Selling Price/kWh" value={fmtRwf(station.selling_price_per_kwh)} />
          <InfoRow label="Margin/kWh" value={fmtRwf(marginPerKwh(station))} />
          <InfoRow label="Hours" value={station.operates_24_7 ? '24/7' : (station.operating_hours_note || '—')} />
          <InfoRow label="Avg Session" value={station.avg_session_minutes ? `${station.avg_session_minutes} min` : '—'} />
          <InfoRow label="Downtime" value={DOWNTIME_OPTIONS.find((d) => d.key === station.downtime_frequency)?.label ?? '—'} />
          <InfoRow label="Collector" value={station.submitted_by_email} />
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Gun Types</p>
          <div className="space-y-1">
            {(station.guns ?? []).map((g) => (
              <div key={g.id} className="flex justify-between text-[11px] py-1 border-b border-gray-50 dark:border-white/5 last:border-0">
                <span>{GUN_TYPE_LABEL[g.gun_type]}{g.gun_type === KIVU_FLEET_GUN_TYPE && <span className="text-positive ml-1">(fleet-compatible)</span>}</span>
                <span className="text-gray-500">{g.gun_count} guns{g.power_kw ? ` · ${g.power_kw}kW` : ''}</span>
              </div>
            ))}
          </div>
        </div>

        {(station.photos ?? []).length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Photos</p>
            <div className="grid grid-cols-3 gap-2">
              {(station.photos ?? []).map((p) => (
                <a key={p.id} href={photoUrls[p.id]} target="_blank" rel="noreferrer" className="aspect-square rounded-lg overflow-hidden border border-gray-100 dark:border-white/10 relative group">
                  {photoUrls[p.id] && <img src={photoUrls[p.id]} alt="" className="w-full h-full object-cover" />}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                    <ExternalLink size={14} className="text-white opacity-0 group-hover:opacity-100" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost flex items-center gap-1.5"><X size={13} /> Close</button>
        </div>
      </div>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-[12px] font-medium">{value}</p>
    </div>
  );
}

function AnalyticsTab({ stations }: { stations: ChargingStation[] }) {
  const n = stations.length;
  const totalCarsPerDay = stations.reduce((s, st) => s + st.cars_per_day, 0);
  const avgMargin = n ? stations.reduce((s, st) => s + marginPerKwh(st), 0) / n : 0;
  const avgCarsPerStation = n ? totalCarsPerDay / n : 0;

  const gunTypeTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const t of GUN_TYPES) totals[t.key] = 0;
    for (const st of stations) for (const g of st.guns ?? []) totals[g.gun_type] = (totals[g.gun_type] ?? 0) + g.gun_count;
    return totals;
  }, [stations]);
  const totalGunCount = Object.values(gunTypeTotals).reduce((s, v) => s + v, 0);
  const fleetCompatibleGuns = gunTypeTotals[KIVU_FLEET_GUN_TYPE] ?? 0;
  const fleetCompatiblePct = totalGunCount ? Math.round((fleetCompatibleGuns / totalGunCount) * 100) : 0;
  const stationsWithFleetGun = stations.filter((s) => hasFleetCompatibleGun(s.guns ?? [])).length;

  const pieData = GUN_TYPES.map((t) => ({ name: t.label, value: gunTypeTotals[t.key] })).filter((d) => d.value > 0);
  const barData = [...stations]
    .sort((a, b) => b.cars_per_day - a.cars_per_day)
    .map((s) => ({ name: `#${s.station_number}`, cars: s.cars_per_day, margin: marginPerKwh(s) }));

  if (n === 0) {
    return (
      <div className="card p-12 text-center">
        <TrendingUp size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
        <p className="text-[12px] text-gray-400">No data yet — analytics will appear once stations are submitted.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Zap} label="Stations Surveyed" value={String(n)} color="amber" />
        <KpiTile icon={Car} label="Total Cars/Day" value={String(totalCarsPerDay)} color="amber" />
        <KpiTile icon={DollarSign} label="Avg Margin/kWh" value={fmtRwf(avgMargin)} tone="positive" color="amber" />
        <KpiTile icon={Gauge} label="Fleet-Compatible Guns" value={`${fleetCompatiblePct}%`} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Cars/Day by Station</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="cars" fill="#2F8C86" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Gun Type Distribution</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(entry) => `${entry.name}: ${entry.value}`}>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-400 mt-1">{stationsWithFleetGun} of {n} stations have at least one GB/T gun — Kivu Ride's own fleet connector.</p>
        </div>

        <div className="card p-4 lg:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Margin per kWh by Station</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => fmtRwf(Number(v))} />
              <Bar dataKey="margin" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <RoiCalculator stations={stations} avgMargin={avgMargin} avgCarsPerStation={avgCarsPerStation} />
    </div>
  );
}

function RoiCalculator({ stations, avgMargin, avgCarsPerStation }: { stations: ChargingStation[]; avgMargin: number; avgCarsPerStation: number }) {
  const avgKwhPerSession = useMemo(() => {
    const estimates = stations
      .map((s) => estimateKwhPerSession(s, s.guns ?? []))
      .filter((v): v is number => v !== null && isFinite(v) && v > 0);
    if (estimates.length === 0) return 20;
    return estimates.reduce((s, v) => s + v, 0) / estimates.length;
  }, [stations]);

  const [carsPerDay, setCarsPerDay] = useState(String(Math.round(avgCarsPerStation) || 10));
  const [kwhPerSession, setKwhPerSession] = useState(String(Math.round(avgKwhPerSession) || 20));
  const [marginInput, setMarginInput] = useState(String(Math.round(avgMargin) || 100));
  const [brandingInvestment, setBrandingInvestment] = useState('');

  const dailyRevenue = (Number(carsPerDay) || 0) * (Number(kwhPerSession) || 0) * (Number(marginInput) || 0);
  const monthlyRevenue = dailyRevenue * 30;
  const annualRevenue = dailyRevenue * 365;
  const paybackMonths = brandingInvestment && monthlyRevenue > 0 ? Number(brandingInvestment) / monthlyRevenue : null;

  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Investor Scenario Calculator</p>
      <p className="text-[10px] text-gray-400 mb-3">Adjust the assumptions to model what a branding partnership could actually earn — defaults are averages from the surveyed stations.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        <div>
          <label className="block text-[10px] font-medium mb-1 text-gray-500">Kivu Cars/Day at Station</label>
          <input type="number" value={carsPerDay} onChange={(e) => setCarsPerDay(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1 text-gray-500">Avg kWh per Charge</label>
          <input type="number" value={kwhPerSession} onChange={(e) => setKwhPerSession(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1 text-gray-500">Margin per kWh (RWF)</label>
          <input type="number" value={marginInput} onChange={(e) => setMarginInput(e.target.value)} className="input" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <ProjectionTile label="Projected Daily Revenue" value={fmtRwf(dailyRevenue)} />
        <ProjectionTile label="Projected Monthly Revenue" value={fmtRwf(monthlyRevenue)} />
        <ProjectionTile label="Projected Annual Revenue" value={fmtRwf(annualRevenue)} />
      </div>

      <div className="border-t border-gray-100 dark:border-white/5 pt-3">
        <label className="block text-[10px] font-medium mb-1 text-gray-500">Branding Investment (RWF, optional)</label>
        <div className="flex items-center gap-2">
          <input type="number" value={brandingInvestment} onChange={(e) => setBrandingInvestment(e.target.value)} placeholder="e.g. 5000000" className="input" />
          {paybackMonths !== null && (
            <span className="text-[12px] font-semibold whitespace-nowrap text-positive">{paybackMonths.toFixed(1)} months payback</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectionTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-white/5 rounded-lg p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-[15px] font-bold mt-0.5">{value}</p>
    </div>
  );
}
