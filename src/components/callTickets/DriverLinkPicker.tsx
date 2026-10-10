import { useEffect, useMemo, useState } from 'react';
import { Car, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { phoneKey } from '../../lib/callTickets';

export interface DriverLink {
  kind: 'internal' | 'platform';
  id: string;
  name: string;
  phone: string | null;
  plate: string | null;
}

interface InternalRow { id: string; full_name: string; phone: string | null; plate_number: string | null }
interface PlatformRow { id: string; full_name: string; phone: string | null; car: { plate_number: string } | null }

const normPlate = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();

// "Which driver or car is this about?" - one search across our own drivers
// (Driver Pipeline) and Non-Insider drivers, by name, phone or plate.
export default function DriverLinkPicker({ value, onChange, autoMatchPhone }: {
  value: DriverLink | null;
  onChange: (v: DriverLink | null) => void;
  // When the caller's own number belongs to a driver, offer them.
  autoMatchPhone?: string;
}) {
  const [all, setAll] = useState<DriverLink[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    Promise.all([
      supabase.rpc('call_center_drivers'),
      supabase.from('platform_drivers').select('id, full_name, phone, car:platform_cars(plate_number)'),
    ]).then(([d, p]) => {
      setAll([
        ...((d.data as unknown as InternalRow[]) ?? []).map((r) => ({ kind: 'internal' as const, id: r.id, name: r.full_name, phone: r.phone, plate: r.plate_number ?? null })),
        ...((p.data as unknown as PlatformRow[]) ?? []).map((r) => ({ kind: 'platform' as const, id: r.id, name: r.full_name, phone: r.phone, plate: r.car?.plate_number ?? null })),
      ]);
    });
  }, []);

  const phoneMatch = useMemo(() => {
    const key = phoneKey(autoMatchPhone);
    return key.length === 9 ? all.find((d) => phoneKey(d.phone) === key) ?? null : null;
  }, [autoMatchPhone, all]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const plateNeedle = normPlate(needle);
    const phoneNeedle = needle.replace(/\D/g, '');
    return all.filter((d) =>
      d.name.toLowerCase().includes(needle)
      || (plateNeedle.length >= 3 && normPlate(d.plate).includes(plateNeedle))
      || (phoneNeedle.length >= 4 && (d.phone ?? '').replace(/\D/g, '').includes(phoneNeedle)),
    ).slice(0, 8);
  }, [q, all]);

  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-brand/30 bg-brand/5">
        <Car size={14} className="text-brand-600 dark:text-brand-300 shrink-0" />
        <div className="flex-1 min-w-0 text-[12px]">
          <span className="font-medium">{value.name}</span>
          {value.plate && <span className="text-gray-500"> · {value.plate}</span>}
          <span className="text-[10px] text-gray-400 ml-1.5">{value.kind === 'internal' ? 'Our driver' : 'Non-Insider'}</span>
        </div>
        <button type="button" onClick={() => onChange(null)} className="btn-ghost p-1" aria-label="Remove driver link"><X size={13} /></button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {phoneMatch && (
        <button type="button" onClick={() => onChange(phoneMatch)} className="w-full text-left text-[11px] px-3 py-2 rounded-lg bg-brand/5 border border-brand/20 text-brand-700 dark:text-brand-300">
          This number belongs to <b>{phoneMatch.name}</b>{phoneMatch.plate ? ` · ${phoneMatch.plate}` : ''} ({phoneMatch.kind === 'internal' ? 'our driver' : 'Non-Insider'}) — tap to link
        </button>
      )}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-8" placeholder="Search driver name, phone or plate (optional)" aria-label="Search driver or car" />
      </div>
      {results.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-50 dark:divide-white/5 max-h-52 overflow-y-auto">
          {results.map((d) => (
            <button key={`${d.kind}-${d.id}`} type="button" onClick={() => { onChange(d); setQ(''); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/[0.03]">
              <Car size={13} className="text-gray-400 shrink-0" />
              <span className="flex-1 min-w-0 text-[12px] truncate"><b className="font-medium">{d.name}</b>{d.plate ? ` · ${d.plate}` : ''}{d.phone ? ` · ${d.phone}` : ''}</span>
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${d.kind === 'internal' ? 'bg-brand/10 text-brand-700 dark:text-brand-300' : 'bg-gray-100 text-gray-500 dark:bg-white/5'}`}>
                {d.kind === 'internal' ? 'Our driver' : 'Non-Insider'}
              </span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && results.length === 0 && <p className="text-[11px] text-gray-400 px-1">No driver or car matches "{q}". You can still type the plate in the details.</p>}
    </div>
  );
}
