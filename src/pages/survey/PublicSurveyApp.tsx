import { useEffect, useState } from 'react';
import { MapPin, Loader2, CheckCircle2, Zap, Camera, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { GUN_TYPES, DOWNTIME_OPTIONS } from '../../lib/chargingStations';

type Stage = 'loading' | 'invalid' | 'email-gate' | 'form' | 'thanks';

interface GunEntry { checked: boolean; count: string; power: string }

function initialGuns(): Record<string, GunEntry> {
  const g: Record<string, GunEntry> = {};
  for (const t of GUN_TYPES) g[t.key] = { checked: false, count: '', power: '' };
  return g;
}

// A fully standalone public page - no login, no app shell. Reached at
// /survey/<case link_token>, shared by the MD with field collectors who
// have no Kivu Daily account at all. Every write still goes through
// server-side RPCs that re-validate the token/email themselves, so
// nothing here needs to be trusted - this component is just the UI.
export default function PublicSurveyApp({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [caseName, setCaseName] = useState('');
  const [nextStationNumber, setNextStationNumber] = useState(1);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [checkingEmail, setCheckingEmail] = useState(false);

  const loadProgress = async () => {
    const { data, error } = await supabase.rpc('get_survey_progress', { p_token: token });
    if (error || !data) { setStage('invalid'); return; }
    setCaseName(data.name);
    setNextStationNumber(data.next_station_number);
    const savedEmail = sessionStorage.getItem(`survey-email-${token}`);
    if (savedEmail) { setEmail(savedEmail); setStage('form'); }
    else setStage('email-gate');
  };

  useEffect(() => { loadProgress(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    if (!email.trim()) return;
    setCheckingEmail(true);
    const { data, error } = await supabase.rpc('validate_collector_email', { p_token: token, p_email: email.trim() });
    setCheckingEmail(false);
    if (error || !data) { setEmailError('This email is not authorized to collect data for this survey. Contact your administrator.'); return; }
    sessionStorage.setItem(`survey-email-${token}`, email.trim());
    setStage('form');
  };

  if (stage === 'loading') {
    return <CenteredMessage><Loader2 className="animate-spin mx-auto mb-3 text-brand-600" size={28} /><p className="text-[13px] text-gray-500">Loading survey…</p></CenteredMessage>;
  }

  if (stage === 'invalid') {
    return <CenteredMessage><p className="text-[14px] font-medium text-gray-700">This link is invalid or no longer active.</p><p className="text-[12px] text-gray-400 mt-1.5">Contact your administrator for a current link.</p></CenteredMessage>;
  }

  if (stage === 'email-gate') {
    return (
      <CenteredMessage>
        <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-4"><Zap size={26} className="text-brand-600" /></div>
        <h1 className="text-[18px] font-semibold text-center">{caseName}</h1>
        <p className="text-[12px] text-gray-400 text-center mt-1 mb-5">Enter your email to start collecting data.</p>
        <form onSubmit={submitEmail} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input text-center"
            autoFocus
          />
          {emailError && <p className="text-[11px] text-red-500 text-center">{emailError}</p>}
          <button type="submit" disabled={checkingEmail} className="btn-primary w-full disabled:opacity-50">
            {checkingEmail ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </CenteredMessage>
    );
  }

  if (stage === 'thanks') {
    return (
      <CenteredMessage>
        <CheckCircle2 size={40} className="text-positive mx-auto mb-3" />
        <p className="text-[14px] font-medium text-center">Station recorded. Thank you!</p>
        <button onClick={() => { setStage('form'); loadProgress(); }} className="btn-primary w-full mt-4">Add Another Station</button>
      </CenteredMessage>
    );
  }

  return <StationForm token={token} caseName={caseName} email={email} stationNumber={nextStationNumber} onSubmitted={() => setStage('thanks')} />;
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-5">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function StationForm({
  token, caseName, email, stationNumber, onSubmitted,
}: {
  token: string;
  caseName: string;
  email: string;
  stationNumber: number;
  onSubmitted: () => void;
}) {
  const [ownerBrand, setOwnerBrand] = useState('');
  const [locationName, setLocationName] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [numChargers, setNumChargers] = useState('');
  const [chargerBrand, setChargerBrand] = useState('');
  const [guns, setGuns] = useState<Record<string, GunEntry>>(initialGuns());
  const [operatorName, setOperatorName] = useState('');
  const [buyingPrice, setBuyingPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [carsPerDay, setCarsPerDay] = useState('');
  const [hasWeekendVariation, setHasWeekendVariation] = useState(false);
  const [weekendCarsPerDay, setWeekendCarsPerDay] = useState('');
  const [operates247, setOperates247] = useState(false);
  const [operatingHours, setOperatingHours] = useState('');
  const [avgSessionMinutes, setAvgSessionMinutes] = useState('');
  const [downtime, setDowntime] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const getLocation = () => {
    setLocationError('');
    setLocating(true);
    if (!navigator.geolocation) { setLocating(false); setLocationError('Location is not supported on this device/browser.'); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude);
        setLng(longitude);
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
          const data = await res.json();
          setAddress(data?.display_name ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        } catch {
          setAddress(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        }
        setLocating(false);
      },
      (err) => { setLocating(false); setLocationError(err.message || 'Could not get your location.'); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const toggleGun = (key: string) => setGuns((prev) => ({ ...prev, [key]: { ...prev[key], checked: !prev[key].checked } }));
  const updateGun = (key: string, patch: Partial<GunEntry>) => setGuns((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const canSubmit = ownerBrand.trim() && locationName.trim() && numChargers && buyingPrice && sellingPrice && carsPerDay
    && Object.values(guns).some((g) => g.checked && Number(g.count) > 0);

  const submit = async () => {
    if (!canSubmit) { setError('Please fill in all required fields and select at least one gun type.'); return; }
    setSaving(true);
    setError('');

    let photoUrls: string[] = [];
    if (photos.length > 0) {
      setUploading(true);
      for (const file of photos) {
        const path = `${token}/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from('survey-uploads').upload(path, file);
        if (upErr) { setUploading(false); setSaving(false); setError(`Photo upload failed: ${upErr.message}`); return; }
        photoUrls.push(path);
      }
      setUploading(false);
    }

    const gunPayload = Object.entries(guns)
      .filter(([, g]) => g.checked && Number(g.count) > 0)
      .map(([key, g]) => ({ gun_type: key, gun_count: Number(g.count), power_kw: g.power ? Number(g.power) : null }));

    const { error: err } = await supabase.rpc('submit_charging_station', {
      p_token: token,
      p_email: email,
      p_owner_brand: ownerBrand.trim(),
      p_location_name: locationName.trim(),
      p_latitude: lat,
      p_longitude: lng,
      p_reverse_geocoded_address: address || null,
      p_num_chargers: Number(numChargers),
      p_charger_brand: chargerBrand.trim() || null,
      p_operator_name: operatorName.trim() || null,
      p_buying_price_per_kwh: Number(buyingPrice),
      p_selling_price_per_kwh: Number(sellingPrice),
      p_cars_per_day: Number(carsPerDay),
      p_weekday_weekend_variation: hasWeekendVariation,
      p_weekend_cars_per_day: hasWeekendVariation && weekendCarsPerDay ? Number(weekendCarsPerDay) : null,
      p_operates_24_7: operates247,
      p_operating_hours_note: !operates247 ? (operatingHours.trim() || null) : null,
      p_avg_session_minutes: avgSessionMinutes ? Number(avgSessionMinutes) : null,
      p_downtime_frequency: downtime || null,
      p_guns: gunPayload,
      p_photo_urls: photoUrls,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSubmitted();
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <p className="text-[11px] text-gray-400">{caseName}</p>
        <h1 className="text-[16px] font-semibold">Station {stationNumber}</h1>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <Section title="Owner & Location">
          <Field label="Owner / Brand" required>
            <input value={ownerBrand} onChange={(e) => setOwnerBrand(e.target.value)} className="input" placeholder="e.g. TotalEnergies" />
          </Field>
          <Field label="Local Name" required>
            <input value={locationName} onChange={(e) => setLocationName(e.target.value)} className="input" placeholder="e.g. Kimironko" />
          </Field>
          <Field label="Exact Location">
            <button type="button" onClick={getLocation} disabled={locating} className="btn-ghost w-full flex items-center justify-center gap-1.5 disabled:opacity-50">
              {locating ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
              {locating ? 'Getting location…' : lat ? 'Update Location' : 'Get Current Location'}
            </button>
            {address && <p className="text-[11px] text-gray-500 mt-1.5">{address}</p>}
            {locationError && <p className="text-[11px] text-red-500 mt-1.5">{locationError}</p>}
          </Field>
        </Section>

        <Section title="Chargers">
          <Field label="Number of Chargers" required>
            <input type="number" value={numChargers} onChange={(e) => setNumChargers(e.target.value)} className="input" />
          </Field>
          <Field label="Charger Brand">
            <input value={chargerBrand} onChange={(e) => setChargerBrand(e.target.value)} className="input" placeholder="e.g. ABB, Kempower" />
          </Field>
          <Field label="Gun Types" required>
            <div className="space-y-2">
              {GUN_TYPES.map((t) => (
                <div key={t.key} className="border border-gray-100 rounded-lg p-2.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={guns[t.key].checked} onChange={() => toggleGun(t.key)} className="w-4 h-4" />
                    <span className="text-[12px] font-medium flex-1">{t.label}</span>
                  </label>
                  {guns[t.key].checked && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <input type="number" value={guns[t.key].count} onChange={(e) => updateGun(t.key, { count: e.target.value })} placeholder="Count" className="input" />
                      <input type="number" value={guns[t.key].power} onChange={(e) => updateGun(t.key, { power: e.target.value })} placeholder="Power (kW)" className="input" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Field>
          <Field label="Operator Name">
            <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} className="input" placeholder="Optional" />
          </Field>
        </Section>

        <Section title="Pricing & Traffic">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Buying Price / kWh" required>
              <input type="number" value={buyingPrice} onChange={(e) => setBuyingPrice(e.target.value)} className="input" placeholder="RWF" />
            </Field>
            <Field label="Selling Price / kWh" required>
              <input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} className="input" placeholder="RWF" />
            </Field>
          </div>
          <Field label="Cars per Day" required>
            <input type="number" value={carsPerDay} onChange={(e) => setCarsPerDay(e.target.value)} className="input" />
          </Field>
          <Field label="Different on Weekends?">
            <div className="flex gap-2">
              <ToggleButton active={hasWeekendVariation} onClick={() => setHasWeekendVariation(true)}>Yes</ToggleButton>
              <ToggleButton active={!hasWeekendVariation} onClick={() => setHasWeekendVariation(false)}>No</ToggleButton>
            </div>
            {hasWeekendVariation && (
              <input type="number" value={weekendCarsPerDay} onChange={(e) => setWeekendCarsPerDay(e.target.value)} className="input mt-2" placeholder="Cars per day on weekends" />
            )}
          </Field>
        </Section>

        <Section title="Operations">
          <Field label="Operates 24/7?">
            <div className="flex gap-2">
              <ToggleButton active={operates247} onClick={() => setOperates247(true)}>Yes</ToggleButton>
              <ToggleButton active={!operates247} onClick={() => setOperates247(false)}>No</ToggleButton>
            </div>
            {!operates247 && (
              <input value={operatingHours} onChange={(e) => setOperatingHours(e.target.value)} className="input mt-2" placeholder="e.g. 6am - 10pm" />
            )}
          </Field>
          <Field label="Average Charging Session (minutes)">
            <input type="number" value={avgSessionMinutes} onChange={(e) => setAvgSessionMinutes(e.target.value)} className="input" placeholder="Optional" />
          </Field>
          <Field label="How Often Out of Service?">
            <select value={downtime} onChange={(e) => setDowntime(e.target.value)} className="input">
              <option value="">Not sure / skip</option>
              {DOWNTIME_OPTIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Photos">
          <label className="btn-ghost w-full flex items-center justify-center gap-1.5 cursor-pointer">
            <Camera size={14} /> Add Photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhotos((prev) => [...prev, f]); e.target.value = ''; }} />
          </label>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {photos.map((f, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-gray-100">
                  <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

        <button onClick={submit} disabled={saving || !canSubmit} className="btn-primary w-full disabled:opacity-50">
          {uploading ? 'Uploading photos…' : saving ? 'Submitting…' : 'Submit Station'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium mb-1.5 text-gray-600">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-[12px] font-medium border transition-colors ${active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-500 border-gray-200'}`}
    >
      {children}
    </button>
  );
}
