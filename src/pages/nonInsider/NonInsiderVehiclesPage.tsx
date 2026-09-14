import { useState, useMemo } from 'react';
import { Search, Plus, CarFront, User } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useNonInsiderData, yesNoUnknown } from '../../lib/nonInsider';
import { PlatformCar } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import PlatformCarDrawer from '../../components/nonInsider/PlatformCarDrawer';

interface CarDrawerState { car: PlatformCar | null; startEditing: boolean }

export default function NonInsiderVehiclesPage({ data }: { data: ReturnType<typeof useNonInsiderData> }) {
  const { profile } = useAuth();
  const { drivers, cars, reload } = data;
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'fleet' || profile?.department?.slug === 'call_center';
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<CarDrawerState | null>(null);

  const driverFor = (carId: string) => drivers.find((d) => d.car_id === carId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cars;
    return cars.filter((c) =>
      c.plate_number.toLowerCase().includes(q) ||
      driverFor(c.id)?.full_name.toLowerCase().includes(q)
    );
  }, [cars, drivers, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plate or driver" className="input pl-8 w-56" />
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
                  <p className="text-[13px] font-semibold truncate">{c.plate_number}</p>
                  <EntryActions
                    onView={() => setDrawer({ car: c, startEditing: false })}
                    onEdit={() => setDrawer({ car: c, startEditing: true })}
                    canEdit={canEdit}
                  />
                </div>
                {(c.make || c.model || c.color) && (
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-1.5">
                    {[c.make, c.model, c.color].filter(Boolean).join(' · ')}
                  </p>
                )}
                {driver ? (
                  <p className="text-[11px] text-brand-600 dark:text-brand-300 flex items-center gap-1">
                    <User size={10} /> {driver.full_name}
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-400">Unassigned</p>
                )}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  <span className="inline-flex items-center text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                    Branded: {yesNoUnknown(c.is_branded)}
                  </span>
                  <span className="inline-flex items-center text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                    Allows branding: {yesNoUnknown(c.allows_branding)}
                  </span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="card p-10 text-center col-span-full">
              <CarFront size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">No non-insider vehicles yet.</p>
            </div>
          )}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filtered}
          keyFn={(c) => c.id}
          emptyLabel="No non-insider vehicles yet."
          onRowClick={(c) => setDrawer({ car: c, startEditing: false })}
          columns={[
            { header: 'Plate', render: (c) => <span className="font-medium">{c.plate_number}</span> },
            { header: 'Make / Model', render: (c) => [c.make, c.model].filter(Boolean).join(' ') || '—' },
            { header: 'Driver', render: (c) => driverFor(c.id)?.full_name ?? 'Unassigned' },
            { header: 'Branded', render: (c) => yesNoUnknown(c.is_branded) },
            { header: 'Allows branding', render: (c) => yesNoUnknown(c.allows_branding) },
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
