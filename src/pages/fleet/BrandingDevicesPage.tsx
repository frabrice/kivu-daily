import { useMemo, useState } from 'react';
import HelpButton from '../../components/HelpButton';
import { Paintbrush, Cpu, Phone, User, Save, CheckCircle2 } from 'lucide-react';
import { supabase, PlatformCar, PlatformDriver } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canEditFleet } from '../../lib/fleet';
import { useNonInsiderData } from '../../lib/nonInsider';
import { timeAgo } from '../../lib/utils';

type Kind = 'branding' | 'device';
type View = 'active' | 'done' | 'declined' | 'all';

const FLOW: Record<Kind, { key: string; label: string; chip: string }[]> = {
  branding: [
    { key: 'to_contact', label: 'To contact', chip: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' },
    { key: 'scheduled', label: 'Scheduled', chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' },
    { key: 'branded', label: 'Branded', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
    { key: 'not_going_ahead', label: 'Not going ahead', chip: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400' },
  ],
  device: [
    { key: 'to_contact', label: 'To contact', chip: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' },
    { key: 'agreed', label: 'Agreed', chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' },
    { key: 'installed', label: 'Installed', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
    { key: 'not_going_ahead', label: 'Not going ahead', chip: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400' },
  ],
};
const DONE: Record<Kind, string> = { branding: 'branded', device: 'installed' };

// The Fleet Manager's follow-up list: Non-Insider car owners who told the
// Call Center (or the survey) they allow branding or want to buy our
// device. Each car moves through its own small pipeline until it's done
// or the owner backs out.
export default function BrandingDevicesPage() {
  const { profile } = useAuth();
  const canEdit = canEditFleet(profile);
  const { cars, drivers, loading, reload } = useNonInsiderData();
  const [kind, setKind] = useState<Kind>('branding');
  const [view, setView] = useState<View>('active');

  const statusOf = (c: PlatformCar) => (kind === 'branding' ? c.branding_status : c.device_status);
  const inPipeline = useMemo(() => cars.filter((c) => (kind === 'branding' ? c.branding_status : c.device_status)), [cars, kind]);
  const counts = (k: Kind) => cars.filter((c) => {
    const s = k === 'branding' ? c.branding_status : c.device_status;
    return s && s !== DONE[k] && s !== 'not_going_ahead';
  }).length;
  const shown = inPipeline
    .filter((c) => {
      const s = statusOf(c);
      if (view === 'active') return s !== DONE[kind] && s !== 'not_going_ahead';
      if (view === 'done') return s === DONE[kind];
      if (view === 'declined') return s === 'not_going_ahead';
      return true;
    })
    .sort((a, b) => FLOW[kind].findIndex((f) => f.key === statusOf(a)) - FLOW[kind].findIndex((f) => f.key === statusOf(b))
      || (kind === 'branding' ? (a.branding_recorded_at ?? '') : (a.device_recorded_at ?? '')).localeCompare(kind === 'branding' ? (b.branding_recorded_at ?? '') : (b.device_recorded_at ?? '')));

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Paintbrush size={16} className="text-brand-600 dark:text-brand-300" /> Branding & Devices</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Non-Insider car owners who allow branding or want to buy our device. Contact them and move each car along.</p>
      </div>
        <HelpButton navKey="fleet_branding" title="Branding & Devices" />
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit" role="tablist">
          <KindTab active={kind === 'branding'} onClick={() => setKind('branding')} icon={Paintbrush} label="Allows branding" badge={counts('branding')} />
          <KindTab active={kind === 'device'} onClick={() => setKind('device')} icon={Cpu} label="Wants our device" badge={counts('device')} />
        </div>
        <div className="flex gap-1">
          {(['active', 'done', 'declined', 'all'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${view === v ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500'}`}>
              {v === 'active' ? 'To follow up' : v === 'done' ? (kind === 'branding' ? 'Branded' : 'Installed') : v === 'declined' ? 'Not going ahead' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card p-10 text-center">
          <CheckCircle2 size={22} className="mx-auto text-gray-300 mb-2" />
          <p className="text-[12px] text-gray-400">{view === 'active' ? 'Nothing waiting — every owner has been followed up.' : 'No cars here.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {shown.map((c) => (
            <FollowupCard key={`${kind}-${c.id}`} car={c} kind={kind} owner={drivers.find((d) => d.car_id === c.id) ?? null} canEdit={canEdit} onSaved={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowupCard({ car, kind, owner, canEdit, onSaved }: { car: PlatformCar; kind: Kind; owner: PlatformDriver | null; canEdit: boolean; onSaved: () => void }) {
  const { profile } = useAuth();
  const current = (kind === 'branding' ? car.branding_status : car.device_status) ?? 'to_contact';
  const [status, setStatus] = useState(current);
  const [notes, setNotes] = useState(car.followup_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = status !== current || notes !== (car.followup_notes ?? '');
  const meta = FLOW[kind].find((f) => f.key === current) ?? FLOW[kind][0];
  const recordedAt = kind === 'branding' ? car.branding_recorded_at : car.device_recorded_at;

  const save = async () => {
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('platform_cars').update({
      [kind === 'branding' ? 'branding_status' : 'device_status']: status,
      followup_notes: notes.trim() || null,
      followup_updated_at: new Date().toISOString(),
      followup_updated_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', car.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{car.plate_number}</p>
          {(car.make || car.model || car.color) && <p className="text-[11px] text-gray-400">{[car.make, car.model, car.color].filter(Boolean).join(' · ')}</p>}
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${meta.chip}`}>{meta.label}</span>
      </div>

      {owner ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          <span className="flex items-center gap-1"><User size={12} className="text-gray-400" /> {owner.full_name}{owner.is_owner ? ' (owner)' : ''}</span>
          {owner.phone && <a href={`tel:${owner.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1 text-brand-600 dark:text-brand-300"><Phone size={12} /> {owner.phone}</a>}
        </div>
      ) : (
        <p className="text-[11px] text-gray-400">No driver linked to this car yet.</p>
      )}

      <p className="text-[10px] text-gray-400">Recorded {recordedAt ? timeAgo(recordedAt) : '—'}{car.followup_updated_at ? ` · last updated ${timeAgo(car.followup_updated_at)}` : ''}</p>

      {canEdit ? (
        <>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Follow-up status">
            {FLOW[kind].map((f) => (
              <button key={f.key} role="radio" aria-checked={status === f.key} onClick={() => setStatus(f.key as typeof status)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-all ${status === f.key ? 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-brand/40'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none text-[12px]" placeholder="Follow-up notes — calls made, dates agreed…" aria-label="Follow-up notes" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {dirty && (
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5 text-[12px] disabled:opacity-50"><Save size={13} /> {saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </>
      ) : (
        car.followup_notes && <p className="text-[12px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{car.followup_notes}</p>
      )}
      {car.notes && <p className="text-[11px] text-gray-400 whitespace-pre-wrap border-t border-gray-100 dark:border-white/5 pt-2">{car.notes}</p>}
    </div>
  );
}

function KindTab({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof Cpu; label: string; badge: number }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {badge > 0 && <span className="text-[9px] font-bold text-white bg-orange-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}
