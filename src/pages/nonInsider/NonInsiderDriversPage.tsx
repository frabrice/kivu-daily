import { useState, useMemo } from 'react';
import { Search, Plus, Users2, Phone, CarFront, CircleSlash } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useNonInsiderData, yesNoUnknown } from '../../lib/nonInsider';
import { PlatformDriver } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import PlatformDriverDrawer from '../../components/nonInsider/PlatformDriverDrawer';

interface DriverDrawerState { driver: PlatformDriver | null; startEditing: boolean }

export default function NonInsiderDriversPage({ data }: { data: ReturnType<typeof useNonInsiderData> }) {
  const { profile } = useAuth();
  const { drivers, cars, reload } = data;
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'fleet' || profile?.department?.slug === 'call_center';
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<DriverDrawerState | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) =>
      d.full_name.toLowerCase().includes(q) ||
      d.phone.includes(q) ||
      d.car?.plate_number.toLowerCase().includes(q)
    );
  }, [drivers, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone or plate" className="input pl-8 w-56" />
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

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              onClick={() => setDrawer({ driver: d, startEditing: false })}
              className="card p-4 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-[13px] font-semibold truncate">{d.full_name}</p>
                <EntryActions
                  onView={() => setDrawer({ driver: d, startEditing: false })}
                  onEdit={() => setDrawer({ driver: d, startEditing: true })}
                  canEdit={canEdit}
                />
              </div>
              <p className="text-[11px] text-gray-400 flex items-center gap-1">
                <Phone size={10} /> {d.phone}
              </p>
              {d.car ? (
                <p className="text-[11px] text-brand-600 dark:text-brand-300 flex items-center gap-1 mt-1.5">
                  <CarFront size={10} /> {d.car.plate_number}
                  {(d.car.make || d.car.model) && <span className="text-gray-400"> · {[d.car.make, d.car.model].filter(Boolean).join(' ')}</span>}
                </p>
              ) : (
                <p className="text-[11px] text-orange-600 dark:text-orange-400 flex items-center gap-1 mt-1.5">
                  <CircleSlash size={10} /> No car assigned
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <span className="inline-flex items-center text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                  Owner: {yesNoUnknown(d.is_owner)}
                </span>
                {d.car && (
                  <span className="inline-flex items-center text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                    Branded: {yesNoUnknown(d.car.is_branded)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="card p-10 text-center col-span-full">
              <Users2 size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">No non-insider drivers yet.</p>
            </div>
          )}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filtered}
          keyFn={(d) => d.id}
          emptyLabel="No non-insider drivers yet."
          onRowClick={(d) => setDrawer({ driver: d, startEditing: false })}
          columns={[
            { header: 'Name', render: (d) => <span className="font-medium">{d.full_name}</span> },
            { header: 'Phone', render: (d) => d.phone },
            { header: 'Car', render: (d) => d.car ? d.car.plate_number : <span className="text-orange-600 dark:text-orange-400">No car</span> },
            { header: 'Owner', render: (d) => yesNoUnknown(d.is_owner) },
            { header: 'Branded', render: (d) => yesNoUnknown(d.car?.is_branded ?? null) },
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
