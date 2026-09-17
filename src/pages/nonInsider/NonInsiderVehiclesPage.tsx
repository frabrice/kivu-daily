import { useState, useMemo } from 'react';
import { Search, Plus, CarFront, User, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { canEditFleet } from '../../lib/fleet';
import { useNonInsiderData, yesNoUnknown } from '../../lib/nonInsider';
import { PlatformCar } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import PlatformCarDrawer from '../../components/nonInsider/PlatformCarDrawer';

interface CarDrawerState { car: PlatformCar | null; startEditing: boolean }

type TriFilter = 'all' | 'yes' | 'no' | 'unknown';
type AssignmentFilter = 'all' | 'assigned' | 'unassigned';

function matchesTri(value: boolean | null, filter: TriFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'yes') return value === true;
  if (filter === 'no') return value === false;
  return value === null;
}

export default function NonInsiderVehiclesPage({ data }: { data: ReturnType<typeof useNonInsiderData> }) {
  const { profile } = useAuth();
  const { drivers, cars, reload } = data;
  const canEdit = canEditFleet(profile);
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const [makeFilter, setMakeFilter] = useState('all');
  const [brandedFilter, setBrandedFilter] = useState<TriFilter>('all');
  const [allowsBrandingFilter, setAllowsBrandingFilter] = useState<TriFilter>('all');
  const [deviceFilter, setDeviceFilter] = useState<TriFilter>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all');
  const [drawer, setDrawer] = useState<CarDrawerState | null>(null);

  const driverFor = (carId: string) => drivers.find((d) => d.car_id === carId) ?? null;

  const availableMakes = useMemo(() => {
    const set = new Set(cars.map((c) => c.make).filter((m): m is string => !!m));
    return Array.from(set).sort();
  }, [cars]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cars.filter((c) => {
      if (q && !(c.plate_number.toLowerCase().includes(q) || driverFor(c.id)?.full_name.toLowerCase().includes(q))) return false;
      if (makeFilter !== 'all' && c.make !== makeFilter) return false;
      if (!matchesTri(c.is_branded, brandedFilter)) return false;
      if (!matchesTri(c.allows_branding, allowsBrandingFilter)) return false;
      if (!matchesTri(c.willing_to_buy_device, deviceFilter)) return false;
      if (assignmentFilter === 'assigned' && !driverFor(c.id)) return false;
      if (assignmentFilter === 'unassigned' && driverFor(c.id)) return false;
      return true;
    });
  }, [cars, drivers, search, makeFilter, brandedFilter, allowsBrandingFilter, deviceFilter, assignmentFilter]);

  const hasActiveFilters = !!search || makeFilter !== 'all' || brandedFilter !== 'all' || allowsBrandingFilter !== 'all' || deviceFilter !== 'all' || assignmentFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setMakeFilter('all');
    setBrandedFilter('all');
    setAllowsBrandingFilter('all');
    setDeviceFilter('all');
    setAssignmentFilter('all');
  };

  const selectClass = 'input py-1.5 text-[11px] w-auto';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plate or driver" className="input pl-8 w-52" />
          </div>
          <select value={makeFilter} onChange={(e) => setMakeFilter(e.target.value)} className={selectClass}>
            <option value="all">All makes</option>
            {availableMakes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={assignmentFilter} onChange={(e) => setAssignmentFilter(e.target.value as AssignmentFilter)} className={selectClass}>
            <option value="all">Assigned or not</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
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
            <button onClick={() => setDrawer({ car: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Vehicle
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-gray-400">{filtered.length} of {cars.length} vehicle{cars.length === 1 ? '' : 's'}</p>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => {
            const driver = driverFor(c.id);
            return (
              <div
                key={c.id}
                onClick={() => setDrawer({ car: c, startEditing: false })}
                className="card p-4 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[12px] font-semibold truncate">{c.plate_number}</p>
                  <EntryActions
                    onView={() => setDrawer({ car: c, startEditing: false })}
                    onEdit={() => setDrawer({ car: c, startEditing: true })}
                    canEdit={canEdit}
                  />
                </div>
                {(c.make || c.model || c.color) && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
                    {[c.make, c.model, c.color].filter(Boolean).join(' · ')}
                  </p>
                )}
                {driver ? (
                  <p className="text-[10px] text-brand-600 dark:text-brand-300 flex items-center gap-1">
                    <User size={10} /> {driver.full_name}
                  </p>
                ) : (
                  <p className="text-[10px] text-gray-400">Unassigned</p>
                )}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  <span className="inline-flex items-center text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                    Branded: {yesNoUnknown(c.is_branded)}
                  </span>
                  <span className="inline-flex items-center text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                    Allows branding: {yesNoUnknown(c.allows_branding)}
                  </span>
                  <span className="inline-flex items-center text-[9px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                    Device: {yesNoUnknown(c.willing_to_buy_device)}
                  </span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="card p-10 text-center col-span-full">
              <CarFront size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[12px] text-gray-400">{cars.length === 0 ? 'No non-insider vehicles yet.' : 'No vehicles match these filters.'}</p>
            </div>
          )}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filtered}
          keyFn={(c) => c.id}
          emptyLabel={cars.length === 0 ? 'No non-insider vehicles yet.' : 'No vehicles match these filters.'}
          onRowClick={(c) => setDrawer({ car: c, startEditing: false })}
          columns={[
            { header: 'Plate', render: (c) => <span className="font-medium">{c.plate_number}</span> },
            { header: 'Make / Model', render: (c) => [c.make, c.model].filter(Boolean).join(' ') || '—' },
            { header: 'Driver', render: (c) => driverFor(c.id)?.full_name ?? 'Unassigned' },
            { header: 'Branded', render: (c) => yesNoUnknown(c.is_branded) },
            { header: 'Allows branding', render: (c) => yesNoUnknown(c.allows_branding) },
            { header: 'Device', render: (c) => yesNoUnknown(c.willing_to_buy_device) },
            {
              header: '',
              className: 'text-right',
              render: (c) => (
                <EntryActions
                  onView={() => setDrawer({ car: c, startEditing: false })}
                  onEdit={() => setDrawer({ car: c, startEditing: true })}
                  canEdit={canEdit}
                />
              ),
            },
          ]}
        />
      )}

      {drawer && (
        <PlatformCarDrawer
          car={drawer.car}
          startEditing={drawer.startEditing}
          canEdit={canEdit}
          onClose={() => setDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
