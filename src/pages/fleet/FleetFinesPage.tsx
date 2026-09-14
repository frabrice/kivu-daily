import { useState, useMemo } from 'react';
import { Search, Plus, Receipt, Car } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useFleetData, formatDateLabelSafe, canEditFleet } from '../../lib/fleet';
import { DriverFine } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import FineDrawer from '../../components/fleet/FineDrawer';

interface FineDrawerState { fine: DriverFine | null; startEditing: boolean }

interface FleetFinesPageProps { data?: ReturnType<typeof useFleetData> }

export default function FleetFinesPage({ data }: FleetFinesPageProps = {}) {
  return data ? <FleetFinesPageView data={data} /> : <FleetFinesPageWithData />;
}

function FleetFinesPageWithData() {
  return <FleetFinesPageView data={useFleetData()} />;
}

function FleetFinesPageView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { profile } = useAuth();
  const { drivers, vehicles, fines, loading, reload } = data;
  const canEdit = canEditFleet(profile);
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const [fineDrawer, setFineDrawer] = useState<FineDrawerState | null>(null);

  const filteredFines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fines;
    return fines.filter((f) =>
      f.driver?.full_name.toLowerCase().includes(q) || f.vehicle?.plate_number.toLowerCase().includes(q)
    );
  }, [fines, search]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Receipt size={16} className="text-brand-600 dark:text-brand-300" /> Fines</h2>
          <p className="text-[12px] text-gray-400 mt-0.5">Traffic and disciplinary fines logged against a driver and the car involved.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or plate" className="input pl-8 w-52" />
          </div>
          {canEdit && (
            <button onClick={() => setFineDrawer({ fine: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Fine
            </button>
          )}
        </div>
      </div>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredFines.map((f) => (
            <div
              key={f.id}
              onClick={() => setFineDrawer({ fine: f, startEditing: false })}
              className="card p-4 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-[13px] font-semibold">{f.amount.toLocaleString()} RWF</p>
                <EntryActions
                  onView={() => setFineDrawer({ fine: f, startEditing: false })}
                  onEdit={() => setFineDrawer({ fine: f, startEditing: true })}
                  canEdit={canEdit}
                />
              </div>
              <p className="text-[12px] text-gray-600 dark:text-gray-300">{f.driver?.full_name ?? 'Unknown driver'}</p>
              <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                <Car size={10} /> {f.vehicle?.plate_number ?? 'No vehicle on file'}
              </p>
              <p className="text-[11px] text-gray-400 mt-1.5">{formatDateLabelSafe(f.fine_date)}</p>
              {f.reason && <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-2">{f.reason}</p>}
            </div>
          ))}
          {filteredFines.length === 0 && (
            <div className="card p-10 text-center col-span-full">
              <Receipt size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">No fines logged yet.</p>
            </div>
          )}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filteredFines}
          keyFn={(f) => f.id}
          emptyLabel="No fines logged yet."
          onRowClick={(f) => setFineDrawer({ fine: f, startEditing: false })}
          columns={[
            { header: 'Driver', render: (f) => <span className="font-medium">{f.driver?.full_name ?? 'Unknown'}</span> },
            { header: 'Vehicle', render: (f) => f.vehicle?.plate_number ?? '—' },
            { header: 'Amount', render: (f) => `${f.amount.toLocaleString()} RWF` },
            { header: 'Date', render: (f) => f.fine_date },
            { header: 'Reason', className: 'max-w-xs truncate whitespace-normal', render: (f) => f.reason ?? '—' },
            {
              header: '',
              className: 'text-right',
              render: (f) => (
                <EntryActions
                  onView={() => setFineDrawer({ fine: f, startEditing: false })}
                  onEdit={() => setFineDrawer({ fine: f, startEditing: true })}
                  canEdit={canEdit}
                />
              ),
            },
          ]}
        />
      )}

      {fineDrawer && (
        <FineDrawer
          fine={fineDrawer.fine}
          startEditing={fineDrawer.startEditing}
          drivers={drivers}
          vehicles={vehicles}
          canEdit={canEdit}
          onClose={() => setFineDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
