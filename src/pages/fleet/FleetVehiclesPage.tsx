import { useState, useMemo } from 'react';
import { Search, Plus, Car, ShieldCheck, ShieldAlert, Smartphone, FileCheck2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData } from '../../lib/fleet';
import { Vehicle } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import VehicleDrawer from '../../components/fleet/VehicleDrawer';

interface VehicleDrawerState { vehicle: Vehicle | null; startEditing: boolean }

export default function FleetVehiclesPage() {
  const { profile } = useAuth();
  const { drivers, vehicles, loading, reload } = useFleetData();
  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'fleet';
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const [vehicleDrawer, setVehicleDrawer] = useState<VehicleDrawerState | null>(null);

  const driversForVehicle = (vehicleId: string) => drivers.filter((d) => d.vehicle_id === vehicleId);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      v.plate_number.toLowerCase().includes(q) ||
      driversForVehicle(v.id).some((d) => d.full_name.toLowerCase().includes(q))
    );
  }, [vehicles, drivers, search]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Car size={16} className="text-brand-600 dark:text-brand-300" /> Vehicles</h2>
          <p className="text-[12px] text-gray-400 mt-0.5">Plate, RURA license, device, and documents handed over with each car.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plate or driver" className="input pl-8 w-52" />
          </div>
          {canEdit && (
            <button onClick={() => setVehicleDrawer({ vehicle: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Vehicle
            </button>
          )}
        </div>
      </div>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredVehicles.map((v) => {
            const assigned = driversForVehicle(v.id);
            return (
              <div
                key={v.id}
                onClick={() => setVehicleDrawer({ vehicle: v, startEditing: false })}
                className="card p-4 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[13px] font-semibold">{v.plate_number}</p>
                  <EntryActions
                    onView={() => setVehicleDrawer({ vehicle: v, startEditing: false })}
                    onEdit={() => setVehicleDrawer({ vehicle: v, startEditing: true })}
                    canEdit={canEdit}
                  />
                </div>
                {(v.make || v.model || v.color) && (
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-2">
                    {[v.make, v.model, v.color].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    v.rura_license_status === 'provided'
                      ? 'text-positive bg-positive/10'
                      : 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10'
                  }`}>
                    {v.rura_license_status === 'provided' ? <ShieldCheck size={9} /> : <ShieldAlert size={9} />}
                    RURA {v.rura_license_status === 'provided' ? 'provided' : 'pending'}
                  </span>
                  {v.device_label && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-700 dark:text-brand-300 bg-brand/10 px-1.5 py-0.5 rounded-full">
                      <Smartphone size={9} /> {v.device_label}
                    </span>
                  )}
                  {v.documents.map((doc, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                      <FileCheck2 size={9} /> {doc}
                    </span>
                  ))}
                </div>
                <div className="pt-2 border-t border-gray-100 dark:border-white/5">
                  {assigned.length === 0 ? (
                    <p className="text-[11px] text-gray-400">Unassigned</p>
                  ) : (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {assigned.map((d) => `${d.full_name} (${d.shift === 'day' ? 'Day' : 'Night'})`).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {filteredVehicles.length === 0 && (
            <div className="card p-10 text-center col-span-full">
              <Car size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">No vehicles yet.</p>
            </div>
          )}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filteredVehicles}
          keyFn={(v) => v.id}
          emptyLabel="No vehicles yet."
          onRowClick={(v) => setVehicleDrawer({ vehicle: v, startEditing: false })}
          columns={[
            { header: 'Plate', render: (v) => <span className="font-medium">{v.plate_number}</span> },
            { header: 'Make / Model', render: (v) => [v.make, v.model].filter(Boolean).join(' ') || '—' },
            {
              header: 'RURA',
              render: (v) => (
                <span className={v.rura_license_status === 'provided' ? 'text-positive' : 'text-orange-600 dark:text-orange-400'}>
                  {v.rura_license_status === 'provided' ? 'Provided' : 'Pending'}
                </span>
              ),
            },
            { header: 'Device', render: (v) => v.device_label ?? '—' },
            {
              header: 'Drivers',
              render: (v) => driversForVehicle(v.id).map((d) => d.full_name).join(', ') || 'Unassigned',
            },
            {
              header: '',
              className: 'text-right',
              render: (v) => (
                <EntryActions
                  onView={() => setVehicleDrawer({ vehicle: v, startEditing: false })}
                  onEdit={() => setVehicleDrawer({ vehicle: v, startEditing: true })}
                  canEdit={canEdit}
                />
              ),
            },
          ]}
        />
      )}

      {vehicleDrawer && (
        <VehicleDrawer
          vehicle={vehicleDrawer.vehicle}
          startEditing={vehicleDrawer.startEditing}
          canEdit={canEdit}
          onClose={() => setVehicleDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
