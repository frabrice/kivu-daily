import { useEffect, useState } from 'react';
import { ArrowLeft, Zap, Users2, Link2, Copy, Check, Trash2, Plus, Table2, TrendingUp, MapPin, ExternalLink, X } from 'lucide-react';
import { supabase, SurveyCase, SurveyCollector, ChargingStation } from '../../lib/supabase';
import { GUN_TYPE_LABEL, DOWNTIME_OPTIONS, KIVU_FLEET_GUN_TYPE, fmtRwf, marginPerKwh } from '../../lib/chargingStations';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StationAnalytics from './StationAnalytics';

type Tab = 'collectors' | 'data' | 'analytics';


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
          {tab === 'analytics' && <StationAnalytics stations={stations} />}
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
          { header: 'Cars/Day (reported)', render: (s) => String(s.cars_per_day) },
          { header: 'Cars/Day (field)', render: (s) => (s.fu_cars_per_day_avg ? `${s.fu_cars_per_day_avg} (${s.fu_cars_per_day_min}–${s.fu_cars_per_day_max})` : '—') },
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

        {station.fu_recorded_at && (
          <div className="rounded-lg bg-brand/5 border border-brand/20 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 mb-1.5">Field follow-up — Henry Rugaba Mark</p>
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Cars per day" value={`${station.fu_cars_per_day_avg} avg (${station.fu_cars_per_day_min}–${station.fu_cars_per_day_max})`} />
              <InfoRow label="Charging time" value={`${station.fu_charge_minutes_avg} min avg (${station.fu_charge_minutes_min} min – ${(station.fu_charge_minutes_max ?? 0) / 60} h)`} />
              <InfoRow label="Operator salary" value={`${fmtRwf(Number(station.fu_operator_salary_avg))} avg`} />
              <InfoRow label="Salary range" value={`${fmtRwf(Number(station.fu_operator_salary_min))} – ${fmtRwf(Number(station.fu_operator_salary_max))}`} />
              <InfoRow label="Shifts" value={`${station.fu_shifts_per_day} × ${station.fu_shift_hours} h · works 24 h`} />
              <InfoRow label="Technical issues" value={station.fu_technical_issues ?? '—'} />
            </div>
            {station.fu_heat_note && <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-2">Heat: {station.fu_heat_note}</p>}
          </div>
        )}

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
