import { useState, useMemo } from 'react';
import { Search, Plus, Phone, Car, Truck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, STAGES, canEditFleet } from '../../lib/fleet';
import { Driver } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import DriverDrawer from '../../components/fleet/DriverDrawer';

interface DriverDrawerState { driver: Driver | null; startEditing: boolean }

interface FleetPipelinePageProps { data?: ReturnType<typeof useFleetData> }

// Accepts pre-fetched data from the MD's FleetPage tab wrapper (which
// already calls useFleetData() once for its badge counts) so this page
// doesn't open a second realtime subscription under the same channel
// name - Supabase throws if two instances subscribe to it at once.
// Rendered directly by employees with no data prop, so it fetches its
// own in that case.
export default function FleetPipelinePage({ data }: FleetPipelinePageProps = {}) {
  return data ? <FleetPipelinePageView data={data} /> : <FleetPipelinePageWithData />;
}

function FleetPipelinePageWithData() {
  return <FleetPipelinePageView data={useFleetData()} />;
}

function FleetPipelinePageView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const { drivers, vehicles, deposits, fines, finePayments, loading, reload } = data;
  const canEdit = canEditFleet(profile);
  const [view, setView] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [driverDrawer, setDriverDrawer] = useState<DriverDrawerState | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) => d.full_name.toLowerCase().includes(q) || d.phone.includes(q));
  }, [drivers, search]);

  const byStage = useMemo(() => {
    const map: Record<string, Driver[]> = { applying: [], training: [], active: [], waiting: [], flagged: [], inactive: [] };
    for (const d of filtered) map[d.stage].push(d);
    return map;
  }, [filtered]);

  if (loading) return <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-6 gap-3">{STAGES.map((s) => <div key={s.key} className="h-40 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Truck size={16} className="text-blue-600 dark:text-blue-300" /> Driver Pipeline</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Every driver from application through active service.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="input pl-8 w-52" />
          </div>
          {canEdit && (
            <button onClick={() => setDriverDrawer({ driver: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Driver
            </button>
          )}
        </div>
      </div>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          {STAGES.map((stage) => (
            <div key={stage.key} className="space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{stage.label}</p>
                <span className="text-[9px] text-gray-400">{byStage[stage.key].length}</span>
              </div>
              <div className="space-y-1.5 min-h-[40px]">
                {byStage[stage.key].map((d) => (
                  <div
                    key={d.id}
                    onClick={() => setDriverDrawer({ driver: d, startEditing: false })}
                    className="w-full card p-2.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <p className="text-[11px] font-medium truncate">{d.full_name}</p>
                      <EntryActions
                        onView={() => setDriverDrawer({ driver: d, startEditing: false })}
                        onEdit={() => setDriverDrawer({ driver: d, startEditing: true })}
                        canEdit={canEdit}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                      <Phone size={10} /> {d.phone}
                    </p>
                    {d.vehicle ? (
                      <p className="text-[9px] text-brand-600 dark:text-brand-300 flex items-center gap-1 mt-1">
                        <Car size={10} /> {d.vehicle.plate_number}
                        {d.shift && <span className="text-gray-400">· {d.shift === 'day' ? 'Day' : 'Night'}</span>}
                      </p>
                    ) : (
                      <p className="text-[9px] text-gray-300 dark:text-white/20 mt-1">
                        {d.initial_deposit_paid ? 'Deposit paid · no vehicle' : 'No vehicle'}
                      </p>
                    )}
                  </div>
                ))}
                {byStage[stage.key].length === 0 && (
                  <div className="h-12 rounded-lg border border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center">
                    <p className="text-[9px] text-gray-300 dark:text-white/20">Empty</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filtered}
          keyFn={(d) => d.id}
          emptyLabel="No drivers yet."
          onRowClick={(d) => setDriverDrawer({ driver: d, startEditing: false })}
          columns={[
            { header: 'Name', render: (d) => <span className="font-medium">{d.full_name}</span> },
            { header: 'Phone', render: (d) => d.phone },
            {
              header: 'Stage',
              render: (d) => {
                const s = STAGES.find((st) => st.key === d.stage)!;
                return (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
                    {s.label}
                  </span>
                );
              },
            },
            { header: 'Vehicle', render: (d) => d.vehicle?.plate_number ?? '—' },
            { header: 'Shift', render: (d) => (d.shift ? (d.shift === 'day' ? 'Day' : 'Night') : '—') },
            {
              header: '',
              className: 'text-right',
              render: (d) => (
                <EntryActions
                  onView={() => setDriverDrawer({ driver: d, startEditing: false })}
                  onEdit={() => setDriverDrawer({ driver: d, startEditing: true })}
                  canEdit={canEdit}
                />
              ),
            },
          ]}
        />
      )}

      {drivers.length === 0 && (
        <div className="card p-12 text-center">
          <Truck size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No drivers yet.</p>
        </div>
      )}

      {driverDrawer && (
        <DriverDrawer
          driver={driverDrawer.driver}
          startEditing={driverDrawer.startEditing}
          vehicles={vehicles}
          drivers={drivers}
          deposits={deposits}
          fines={fines}
          finePayments={finePayments}
          canEdit={canEdit}
          onClose={() => setDriverDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
