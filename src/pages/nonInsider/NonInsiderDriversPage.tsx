import { useState, useMemo } from 'react';
import { Search, Plus, Users2, Phone, CarFront, CircleSlash, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { canEditFleet } from '../../lib/fleet';
import { useNonInsiderData, yesNoUnknown, matchesTri, TriFilter } from '../../lib/nonInsider';
import { PlatformDriver } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import PlatformDriverDrawer from '../../components/nonInsider/PlatformDriverDrawer';

interface DriverDrawerState { driver: PlatformDriver | null; startEditing: boolean }

type OwnerFilter = 'all' | 'yes' | 'no' | 'unknown';
type CarFilter = 'all' | 'has_car' | 'no_car';

export default function NonInsiderDriversPage({ data }: { data: ReturnType<typeof useNonInsiderData> }) {
  const { profile } = useAuth();
  const { drivers, cars, reload } = data;
  const canEdit = canEditFleet(profile);
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [carFilter, setCarFilter] = useState<CarFilter>('all');
  const [makeFilter, setMakeFilter] = useState('all');
  const [brandedFilter, setBrandedFilter] = useState<TriFilter>('all');
  const [allowsBrandingFilter, setAllowsBrandingFilter] = useState<TriFilter>('all');
  const [deviceFilter, setDeviceFilter] = useState<TriFilter>('all');
  const [drawer, setDrawer] = useState<DriverDrawerState | null>(null);

  const availableMakes = useMemo(() => {
    const set = new Set(cars.map((c) => c.make).filter((m): m is string => !!m));
    return Array.from(set).sort();
  }, [cars]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drivers.filter((d) => {
      if (q && !(
        d.full_name.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        d.car?.plate_number.toLowerCase().includes(q)
      )) return false;
      if (ownerFilter === 'yes' && d.is_owner !== true) return false;
      if (ownerFilter === 'no' && d.is_owner !== false) return false;
      if (ownerFilter === 'unknown' && d.is_owner !== null) return false;
      if (carFilter === 'has_car' && !d.car) return false;
      if (carFilter === 'no_car' && d.car) return false;
      if (makeFilter !== 'all' && d.car?.make !== makeFilter) return false;
      if (!matchesTri(d.car?.is_branded ?? null, brandedFilter)) return false;
      if (!matchesTri(d.car?.allows_branding ?? null, allowsBrandingFilter)) return false;
      if (!matchesTri(d.car?.willing_to_buy_device ?? null, deviceFilter)) return false;
      return true;
    });
  }, [drivers, search, ownerFilter, carFilter, makeFilter, brandedFilter, allowsBrandingFilter, deviceFilter]);

  const hasActiveFilters = !!search || ownerFilter !== 'all' || carFilter !== 'all' || makeFilter !== 'all' || brandedFilter !== 'all' || allowsBrandingFilter !== 'all' || deviceFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setOwnerFilter('all');
    setCarFilter('all');
    setMakeFilter('all');
    setBrandedFilter('all');
    setAllowsBrandingFilter('all');
    setDeviceFilter('all');
  };

  const selectClass = 'input py-1.5 text-[11px] w-auto';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone or plate" className="input pl-8 w-52" />
          </div>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value as OwnerFilter)} className={selectClass}>
            <option value="all">Owner: any</option>
            <option value="yes">Owner: Yes</option>
            <option value="no">Owner: No</option>
            <option value="unknown">Owner: Unknown</option>
          </select>
          <select value={carFilter} onChange={(e) => setCarFilter(e.target.value as CarFilter)} className={selectClass}>
            <option value="all">Car: any</option>
            <option value="has_car">Has car</option>
            <option value="no_car">No car</option>
          </select>
          <select value={makeFilter} onChange={(e) => setMakeFilter(e.target.value)} className={selectClass}>
            <option value="all">All makes</option>
            {availableMakes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={brandedFilter} onChange={(e) => setBrandedFilter(e.target.value as TriFilter)} className={selectClass}>
            <option value="all">Branded: any</option>
            <option value="yes">Branded: Yes</option>
            <option value="no">Branded: No</option>
            <option value="unknown">Branded: Unknown</option>
          </select>
          <select value={allowsBrandingFilter} onChange={(e) => setAllowsBrandingFilter(e.target.value as TriFilter)} className={selectClass}>
            <option value="all">Allows branding: any</option>
            <option value="yes">Allows branding: Yes</option>
            <option value="no">Allows branding: No</option>
            <option value="unknown">Allows branding: Unknown</option>
          </select>
          <select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value as TriFilter)} className={selectClass}>
            <option value="all">Device: any</option>
            <option value="yes">Device: Yes</option>
            <option value="no">Device: No</option>
            <option value="unknown">Device: Unknown</option>
          </select>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn-ghost text-[11px] flex items-center gap-1 px-2 py-1.5">
              <X size={11} /> Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          {canEdit && (
            <button onClick={() => setDrawer({ driver: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Driver
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-gray-400">{filtered.length} of {drivers.length} driver{drivers.length === 1 ? '' : 's'}</p>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              onClick={() => setDrawer({ driver: d, startEditing: false })}
              className="card p-4 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-[12px] font-semibold truncate">{d.full_name}</p>
                <EntryActions
                  onView={() => setDrawer({ driver: d, startEditing: false })}
                  onEdit={() => setDrawer({ driver: d, startEditing: true })}
                  canEdit={canEdit}
                />
              </div>
              <p className="text-[10px] text-gray-400 flex items-center gap-1">
                <Phone size={10} /> {d.phone}
              </p>
              {d.car ? (
                <p className="text-[10px] text-brand-600 dark:text-brand-300 flex items-center gap-1 mt-1.5">
                  <CarFront size={10} /> {d.car.plate_number}
                  {(d.car.make || d.car.model) && <span className="text-gray-400"> · {[d.car.make, d.car.model].filter(Boolean).join(' ')}</span>}
                </p>
              ) : (
                <p className="text-[10px] text-orange-600 dark:text-orange-400 flex items-center gap-1 mt-1.5">
                  <CircleSlash size={10} /> No car assigned
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <span className="inline-flex items-center text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                  Owner: {yesNoUnknown(d.is_owner)}
                </span>
                {d.car && (
                  <>
                    <span className="inline-flex items-center text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                      Branded: {yesNoUnknown(d.car.is_branded)}
                    </span>
                    <span className="inline-flex items-center text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                      Allows branding: {yesNoUnknown(d.car.allows_branding)}
                    </span>
                    <span className="inline-flex items-center text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                      Device: {yesNoUnknown(d.car.willing_to_buy_device)}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="card p-10 text-center col-span-full">
              <Users2 size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[12px] text-gray-400">{drivers.length === 0 ? 'No non-insider drivers yet.' : 'No drivers match these filters.'}</p>
            </div>
          )}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filtered}
          keyFn={(d) => d.id}
          emptyLabel={drivers.length === 0 ? 'No non-insider drivers yet.' : 'No drivers match these filters.'}
          onRowClick={(d) => setDrawer({ driver: d, startEditing: false })}
          columns={[
            { header: 'Name', render: (d) => <span className="font-medium">{d.full_name}</span> },
            { header: 'Phone', render: (d) => d.phone },
            { header: 'Car', render: (d) => d.car ? `${d.car.plate_number}${d.car.make ? ` · ${d.car.make}` : ''}` : <span className="text-orange-600 dark:text-orange-400">No car</span> },
            { header: 'Owner', render: (d) => yesNoUnknown(d.is_owner) },
            { header: 'Branded', render: (d) => yesNoUnknown(d.car?.is_branded ?? null) },
            { header: 'Allows branding', render: (d) => yesNoUnknown(d.car?.allows_branding ?? null) },
            { header: 'Device', render: (d) => yesNoUnknown(d.car?.willing_to_buy_device ?? null) },
            {
              header: '',
              className: 'text-right',
              render: (d) => (
                <EntryActions
                  onView={() => setDrawer({ driver: d, startEditing: false })}
                  onEdit={() => setDrawer({ driver: d, startEditing: true })}
                  canEdit={canEdit}
                />
              ),
            },
          ]}
        />
      )}

      {drawer && (
        <PlatformDriverDrawer
          driver={drawer.driver}
          startEditing={drawer.startEditing}
          cars={cars}
          canEdit={canEdit}
          onClose={() => setDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
