import { useEffect, useState, useCallback, useMemo } from 'react';
import { Search, Plus, Phone, Trash2, Truck, Flag, Car, Smartphone, FileCheck2, X, Pencil, Wallet, ShieldCheck, ShieldAlert, CalendarDays, Sun, Moon, Receipt } from 'lucide-react';
import { supabase, Driver, DriverStage, Vehicle, DriverDeposit, DriverFine, DriverShift, RuraLicenseStatus } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo, todayStr, dateStr, addDays } from '../lib/utils';
import Modal from '../components/Modal';
import FlagToITDrawer from '../components/FlagToITDrawer';
import ViewToggle, { ViewMode } from '../components/ViewToggle';
import DataTable from '../components/DataTable';
import EntryActions from '../components/EntryActions';

const STAGES: { key: DriverStage; label: string; color: string }[] = [
  { key: 'applying', label: 'Applying', color: '#9ca3af' },
  { key: 'training', label: 'Training', color: '#f97316' },
  { key: 'active', label: 'Active', color: '#4F7B3E' },
  { key: 'waiting', label: 'Waiting', color: '#2F8C86' },
  { key: 'flagged', label: 'Flagged', color: '#ef4444' },
  { key: 'inactive', label: 'Inactive', color: '#6b7280' },
];

type Tab = 'pipeline' | 'vehicles' | 'deposits' | 'fines';
const WEEKLY_DEPOSIT_AMOUNT = 180000;

interface DriverDrawerState { driver: Driver | null; startEditing: boolean }
interface VehicleDrawerState { vehicle: Vehicle | null; startEditing: boolean }
interface FineDrawerState { fine: DriverFine | null; startEditing: boolean }

export default function FleetPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('pipeline');
  const [view, setView] = useState<ViewMode>('cards');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [deposits, setDeposits] = useState<DriverDeposit[]>([]);
  const [fines, setFines] = useState<DriverFine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [driverDrawer, setDriverDrawer] = useState<DriverDrawerState | null>(null);
  const [vehicleDrawer, setVehicleDrawer] = useState<VehicleDrawerState | null>(null);
  const [fineDrawer, setFineDrawer] = useState<FineDrawerState | null>(null);
  const [loggingDepositFor, setLoggingDepositFor] = useState<Driver | null>(null);

  const canEdit = profile?.role === 'managing_director' || profile?.department?.slug === 'fleet';

  const load = useCallback(async () => {
    const [d, v, dep, fin] = await Promise.all([
      supabase.from('drivers').select('*, vehicle:vehicles(*)').order('created_at', { ascending: false }),
      supabase.from('vehicles').select('*').order('created_at', { ascending: false }),
      supabase.from('driver_deposits').select('*').order('paid_date', { ascending: false }),
      supabase.from('driver_fines').select('*, driver:drivers(*), vehicle:vehicles(*)').order('fine_date', { ascending: false }),
    ]);
    setDrivers((d.data as Driver[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
    setDeposits((dep.data as DriverDeposit[]) ?? []);
    setFines((fin.data as DriverFine[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('fleet-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_deposits' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_fines' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) => d.full_name.toLowerCase().includes(q) || d.phone.includes(q));
  }, [drivers, search]);

  const byStage = useMemo(() => {
    const map: Record<DriverStage, Driver[]> = { applying: [], training: [], active: [], waiting: [], flagged: [], inactive: [] };
    for (const d of filtered) map[d.stage].push(d);
    return map;
  }, [filtered]);

  const driversForVehicle = (vehicleId: string) => drivers.filter((d) => d.vehicle_id === vehicleId);
  const depositsForDriver = (driverId: string) => deposits.filter((dep) => dep.driver_id === driverId);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      v.plate_number.toLowerCase().includes(q) ||
      driversForVehicle(v.id).some((d) => d.full_name.toLowerCase().includes(q))
    );
  }, [vehicles, drivers, search]);

  const filteredFines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fines;
    return fines.filter((f) =>
      f.driver?.full_name.toLowerCase().includes(q) || f.vehicle?.plate_number.toLowerCase().includes(q)
    );
  }, [fines, search]);

  const depositQueue = useMemo(() => {
    const assigned = drivers.filter((d) => d.vehicle_id);
    const rows = assigned.map((d) => {
      const history = depositsForDriver(d.id).sort((a, b) => b.paid_date.localeCompare(a.paid_date));
      const last = history[0] ?? null;
      const daysSince = last ? Math.floor((new Date(todayStr()).getTime() - new Date(last.paid_date).getTime()) / 86400000) : null;
      let priority: number;
      let label: string;
      if (!last) {
        priority = 0;
        label = 'Never paid';
      } else if (daysSince! >= 7) {
        priority = 1;
        label = `Overdue by ${daysSince! - 6}d`;
      } else if (daysSince! === 6) {
        priority = 2;
        label = 'Due tomorrow';
      } else {
        priority = 3;
        label = `Paid ${daysSince} d ago`;
      }
      return { driver: d, last, daysSince, priority, label };
    });
    return rows
      .filter((r) => {
        const q = search.trim().toLowerCase();
        return !q || r.driver.full_name.toLowerCase().includes(q);
      })
      .sort((a, b) => a.priority - b.priority || (b.daysSince ?? 999) - (a.daysSince ?? 999));
  }, [drivers, deposits, search]);

  const overdueCount = depositQueue.filter((r) => r.priority <= 1).length;

  const showViewToggle = tab !== 'deposits';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
          <TabButton active={tab === 'pipeline'} onClick={() => setTab('pipeline')} icon={Truck} label="Driver Pipeline" />
          <TabButton active={tab === 'vehicles'} onClick={() => setTab('vehicles')} icon={Car} label="Vehicles" />
          <TabButton active={tab === 'deposits'} onClick={() => setTab('deposits')} icon={Wallet} label="Deposits" badge={overdueCount} />
          <TabButton active={tab === 'fines'} onClick={() => setTab('fines')} icon={Receipt} label="Fines" />
        </div>
        <div className="flex items-center gap-2">
          {showViewToggle && <ViewToggle value={view} onChange={setView} />}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'vehicles' ? 'Search plate or driver' : 'Search name or phone'}
              className="input pl-8 w-52"
            />
          </div>
          {canEdit && tab === 'pipeline' && (
            <button onClick={() => setDriverDrawer({ driver: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Driver
            </button>
          )}
          {canEdit && tab === 'vehicles' && (
            <button onClick={() => setVehicleDrawer({ vehicle: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Vehicle
            </button>
          )}
          {canEdit && tab === 'fines' && (
            <button onClick={() => setFineDrawer({ fine: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Fine
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map((s) => <div key={s.key} className="h-40 skeleton rounded-xl" />)}
        </div>
      )}

      {!loading && tab === 'pipeline' && view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          {STAGES.map((stage) => (
            <div key={stage.key} className="space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{stage.label}</p>
                <span className="text-[10px] text-gray-400">{byStage[stage.key].length}</span>
              </div>
              <div className="space-y-1.5 min-h-[40px]">
                {byStage[stage.key].map((d) => (
                  <div
                    key={d.id}
                    onClick={() => setDriverDrawer({ driver: d, startEditing: false })}
                    className="w-full card p-2.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <p className="text-[12px] font-medium truncate">{d.full_name}</p>
                      <EntryActions
                        onView={() => setDriverDrawer({ driver: d, startEditing: false })}
                        onEdit={() => setDriverDrawer({ driver: d, startEditing: true })}
                        canEdit={canEdit}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                      <Phone size={10} /> {d.phone}
                    </p>
                    {d.vehicle ? (
                      <p className="text-[10px] text-brand-600 dark:text-brand-300 flex items-center gap-1 mt-1">
                        <Car size={10} /> {d.vehicle.plate_number}
                        {d.shift && <span className="text-gray-400">· {d.shift === 'day' ? 'Day' : 'Night'}</span>}
                      </p>
                    ) : (
                      <p className="text-[10px] text-gray-300 dark:text-white/20 mt-1">
                        {d.initial_deposit_paid ? 'Deposit paid · no vehicle' : 'No vehicle'}
                      </p>
                    )}
                  </div>
                ))}
                {byStage[stage.key].length === 0 && (
                  <div className="h-12 rounded-lg border border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center">
                    <p className="text-[10px] text-gray-300 dark:text-white/20">Empty</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'pipeline' && view === 'table' && (
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
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
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

      {!loading && tab === 'vehicles' && view === 'cards' && (
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

      {!loading && tab === 'vehicles' && view === 'table' && (
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

      {!loading && tab === 'deposits' && (
        <div className="space-y-1.5">
          {depositQueue.map((row) => {
            const urgent = row.priority <= 1;
            return (
              <div key={row.driver.id} className="card p-3 flex items-center gap-3">
                <div className={`w-1.5 h-8 rounded-full shrink-0 ${
                  row.priority === 0 ? 'bg-red-500' : row.priority === 1 ? 'bg-red-500' : row.priority === 2 ? 'bg-orange-500' : 'bg-gray-200 dark:bg-white/10'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{row.driver.full_name}</p>
                  <p className="text-[11px] text-gray-400 flex items-center gap-1">
                    <Car size={10} /> {row.driver.vehicle?.plate_number}
                    {row.driver.shift && <span>· {row.driver.shift === 'day' ? 'Day shift' : 'Night shift'}</span>}
                  </p>
                </div>
                <span className={`text-[11px] font-medium shrink-0 ${urgent ? 'text-red-500' : row.priority === 2 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`}>
                  {row.label}
                </span>
                {canEdit && (
                  <button onClick={() => setLoggingDepositFor(row.driver)} className="btn-primary shrink-0 whitespace-nowrap">
                    Log Deposit
                  </button>
                )}
              </div>
            );
          })}
          {depositQueue.length === 0 && (
            <div className="card p-10 text-center">
              <Wallet size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">No drivers with a vehicle assigned yet.</p>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'fines' && view === 'cards' && (
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

      {!loading && tab === 'fines' && view === 'table' && (
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

      {driverDrawer && (
        <DriverDrawer
          driver={driverDrawer.driver}
          startEditing={driverDrawer.startEditing}
          vehicles={vehicles}
          drivers={drivers}
          canEdit={canEdit}
          onClose={() => setDriverDrawer(null)}
          onSaved={load}
        />
      )}

      {vehicleDrawer && (
        <VehicleDrawer
          vehicle={vehicleDrawer.vehicle}
          startEditing={vehicleDrawer.startEditing}
          canEdit={canEdit}
          onClose={() => setVehicleDrawer(null)}
          onSaved={load}
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
          onSaved={load}
        />
      )}

      {loggingDepositFor && (
        <LogDepositDrawer
          driver={loggingDepositFor}
          onClose={() => setLoggingDepositFor(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function formatDateLabelSafe(d: string): string {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof Truck; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      <Icon size={14} /> {label}
      {!!badge && <span className="text-[9px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}

function LogDepositDrawer({ driver, onClose, onSaved }: { driver: Driver; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [amount, setAmount] = useState(String(WEEKLY_DEPOSIT_AMOUNT));
  const [paidDate, setPaidDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || !paidDate) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('driver_deposits').insert({
      driver_id: driver.id,
      amount: numAmount,
      paid_date: paidDate,
      created_by: profile!.id,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Log Deposit" subtitle={driver.full_name} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Date Paid</label>
          <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="input" />
          <p className="text-[11px] text-gray-400 mt-1">Their next deposit will be due 7 days after this date.</p>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !Number(amount) || !paidDate} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Log Deposit'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FineDrawer({
  fine,
  startEditing,
  drivers,
  vehicles,
  canEdit,
  onClose,
  onSaved,
}: {
  fine: DriverFine | null;
  startEditing: boolean;
  drivers: Driver[];
  vehicles: Vehicle[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [driverId, setDriverId] = useState(fine?.driver_id ?? '');
  const [vehicleId, setVehicleId] = useState(fine?.vehicle_id ?? '');
  const [amount, setAmount] = useState(fine ? String(fine.amount) : '');
  const [fineDate, setFineDate] = useState(fine?.fine_date ?? todayStr());
  const [reason, setReason] = useState(fine?.reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const numAmount = Number(amount);
    if (!driverId || !vehicleId || !numAmount || numAmount <= 0 || !fineDate) return;
    setSaving(true);
    setError('');
    const payload = {
      driver_id: driverId,
      vehicle_id: vehicleId,
      amount: numAmount,
      fine_date: fineDate,
      reason: reason.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = fine
      ? await supabase.from('driver_fines').update(payload).eq('id', fine.id)
      : await supabase.from('driver_fines').insert({ ...payload, created_by: profile!.id });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!fine) return;
    setSaving(true);
    await supabase.from('driver_fines').delete().eq('id', fine.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={fine ? `${fine.amount.toLocaleString()} RWF fine` : 'Add Fine'} subtitle={fine ? timeAgo(fine.updated_at) + ' updated' : 'Amount, date, driver, and the car that was fined'} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Amount (RWF)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editing} className="input" placeholder="20000" autoFocus />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Date</label>
            <input type="date" value={fineDate} onChange={(e) => setFineDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Driver</label>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!editing} className="input">
            <option value="">Select a driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Car Fined</label>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!editing} className="input">
            <option value="">Select a car</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate_number}{v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Reason (optional)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={!editing} rows={2} className="input resize-none" placeholder="e.g. speeding, illegal parking…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {fine ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (fine ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !driverId || !vehicleId || !Number(amount) || !fineDate} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : fine ? 'Save Changes' : 'Add Fine'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DriverDrawer({
  driver,
  startEditing,
  vehicles,
  drivers,
  canEdit,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  startEditing: boolean;
  vehicles: Vehicle[];
  drivers: Driver[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [fullName, setFullName] = useState(driver?.full_name ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [email, setEmail] = useState(driver?.email ?? '');
  const [joinDate, setJoinDate] = useState(driver?.join_date ?? todayStr());
  const [initialDepositPaid, setInitialDepositPaid] = useState(driver?.initial_deposit_paid ?? false);
  const [stage, setStage] = useState<DriverStage>(driver?.stage ?? 'applying');
  const [notes, setNotes] = useState(driver?.notes ?? '');
  const [vehicleId, setVehicleId] = useState(driver?.vehicle_id ?? '');
  const [shift, setShift] = useState<DriverShift | ''>(driver?.shift ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const shiftTakenBy = (s: DriverShift) => drivers.find((d) => d.vehicle_id === vehicleId && d.id !== driver?.id && d.shift === s);
  const vehicleFull = !!selectedVehicle && drivers.filter((d) => d.vehicle_id === vehicleId && d.id !== driver?.id).length >= 2;

  const save = async () => {
    if (!fullName.trim() || !phone.trim()) return;
    if (vehicleId && !shift) {
      setError('Pick a shift for this driver on the assigned vehicle.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      join_date: joinDate || null,
      initial_deposit_paid: initialDepositPaid,
      stage,
      notes: notes.trim() || null,
      vehicle_id: vehicleId || null,
      shift: vehicleId ? shift || null : null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = driver
      ? await supabase.from('drivers').update(payload).eq('id', driver.id)
      : await supabase.from('drivers').insert({ ...payload, created_by: profile!.id });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!driver) return;
    setSaving(true);
    await supabase.from('drivers').delete().eq('id', driver.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={driver ? driver.full_name : 'Add Driver'} subtitle={driver ? timeAgo(driver.updated_at) + ' updated' : undefined} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Full Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} className="input" placeholder="Jean Baptiste" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} className="input" placeholder="+250 7XX XXX XXX" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} className="input" placeholder="jean@example.com" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><CalendarDays size={11} /> Join Date</label>
            <input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value as DriverStage)} disabled={!editing} className="input">
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <label className={`flex items-center gap-2.5 p-2.5 rounded-lg border ${initialDepositPaid ? 'border-brand/30 bg-brand/5' : 'border-gray-200 dark:border-white/10'}`}>
          <input type="checkbox" checked={initialDepositPaid} onChange={(e) => setInitialDepositPaid(e.target.checked)} disabled={!editing} className="w-4 h-4 accent-brand" />
          <span className="text-[12px] font-medium">Initial deposit paid</span>
        </label>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Assigned Vehicle</label>
          <select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setShift(''); }} disabled={!editing} className="input">
            <option value="">No vehicle assigned</option>
            {vehicles.map((v) => {
              const others = drivers.filter((d) => d.vehicle_id === v.id && d.id !== driver?.id);
              const full = others.length >= 2 && v.id !== driver?.vehicle_id;
              return (
                <option key={v.id} value={v.id} disabled={full}>
                  {v.plate_number}{v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
                  {others.length > 0 ? ` (${others.map((d) => `${d.full_name}: ${d.shift === 'day' ? 'Day' : 'Night'}`).join(', ')})` : ''}
                  {full ? ' — full' : ''}
                </option>
              );
            })}
          </select>
          {editing && (
            <button type="button" onClick={() => setAddVehicleOpen(true)} className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline mt-1.5">
              + Add a new vehicle
            </button>
          )}

          {selectedVehicle && (
            <div className="mt-2 p-2.5 rounded-lg bg-gray-50 dark:bg-white/5 space-y-2">
              {(selectedVehicle.make || selectedVehicle.model || selectedVehicle.color) && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {[selectedVehicle.make, selectedVehicle.model, selectedVehicle.color].filter(Boolean).join(' · ')}
                </p>
              )}
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-1">Shift</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['day', 'night'] as DriverShift[]).map((s) => {
                    const taken = shiftTakenBy(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={!editing || !!taken}
                        onClick={() => setShift(s)}
                        className={`p-2 rounded-lg border text-left text-[12px] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                          shift === s ? 'border-brand bg-brand/10' : 'border-gray-200 dark:border-white/10'
                        }`}
                      >
                        {s === 'day' ? <Sun size={12} /> : <Moon size={12} />}
                        {s === 'day' ? 'Day' : 'Night'}
                        {taken && <span className="text-[10px] text-gray-400">· {taken.full_name}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Onboarding progress, issues, follow-ups…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {driver ? (
              <div className="flex gap-2">
                <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                  <Trash2 size={13} /> Remove
                </button>
                <button onClick={() => setFlagOpen(true)} disabled={saving} className="btn-ghost text-gray-500 flex items-center gap-1.5">
                  <Flag size={13} /> Flag to IT
                </button>
              </div>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (driver ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !fullName.trim() || !phone.trim() || vehicleFull} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : driver ? 'Save Changes' : 'Add Driver'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>

      {flagOpen && driver && (
        <FlagToITDrawer
          entityType="driver"
          entityId={driver.id}
          entityLabel={`Driver: ${driver.full_name}`}
          onClose={() => setFlagOpen(false)}
        />
      )}

      {addVehicleOpen && (
        <VehicleDrawer
          vehicle={null}
          startEditing
          canEdit={canEdit}
          onClose={() => setAddVehicleOpen(false)}
          onSaved={() => {}}
          onCreated={(v) => setVehicleId(v.id)}
        />
      )}
    </Modal>
  );
}

function VehicleDrawer({
  vehicle,
  startEditing,
  canEdit,
  onClose,
  onSaved,
  onCreated,
}: {
  vehicle: Vehicle | null;
  startEditing: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (vehicle: Vehicle) => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [plateNumber, setPlateNumber] = useState(vehicle?.plate_number ?? '');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [deviceLabel, setDeviceLabel] = useState(vehicle?.device_label ?? '');
  const [documents, setDocuments] = useState<string[]>(vehicle?.documents ?? []);
  const [notes, setNotes] = useState(vehicle?.notes ?? '');
  const [givenDate, setGivenDate] = useState(vehicle?.given_date ?? '');
  const [operationStartDate, setOperationStartDate] = useState(vehicle?.operation_start_date ?? '');
  const [ruraStatus, setRuraStatus] = useState<RuraLicenseStatus>(vehicle?.rura_license_status ?? 'pending');
  const [ruraIssuedDate, setRuraIssuedDate] = useState(vehicle?.rura_license_issued_date ?? '');
  const [ruraExpiryDate, setRuraExpiryDate] = useState(vehicle?.rura_license_expiry_date ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addDoc = () => setDocuments((d) => [...d, '']);
  const updateDoc = (i: number, text: string) => setDocuments((d) => d.map((v, idx) => (idx === i ? text : v)));
  const removeDoc = (i: number) => setDocuments((d) => d.filter((_, idx) => idx !== i));

  const handleIssuedDateChange = (value: string) => {
    setRuraIssuedDate(value);
    if (value && !ruraExpiryDate) {
      const issued = new Date(value + 'T00:00:00');
      setRuraExpiryDate(dateStr(addDays(issued, 730)));
    }
  };

  const save = async () => {
    if (!plateNumber.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      plate_number: plateNumber.trim().toUpperCase(),
      make: make.trim() || null,
      model: model.trim() || null,
      color: color.trim() || null,
      device_label: deviceLabel.trim() || null,
      documents: documents.map((d) => d.trim()).filter(Boolean),
      notes: notes.trim() || null,
      given_date: givenDate || null,
      operation_start_date: operationStartDate || null,
      rura_license_status: ruraStatus,
      rura_license_issued_date: ruraIssuedDate || null,
      rura_license_expiry_date: ruraExpiryDate || null,
      updated_at: new Date().toISOString(),
    };
    if (vehicle) {
      const { error: err } = await supabase.from('vehicles').update(payload).eq('id', vehicle.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { data, error: err } = await supabase.from('vehicles').insert({ ...payload, created_by: profile!.id }).select().single();
      setSaving(false);
      if (err) { setError(err.message); return; }
      if (data) onCreated?.(data as Vehicle);
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!vehicle) return;
    setSaving(true);
    await supabase.from('vehicles').delete().eq('id', vehicle.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={vehicle ? vehicle.plate_number : 'Add Vehicle'} subtitle={vehicle ? timeAgo(vehicle.updated_at) + ' updated' : 'Plate, device and documents handed over with it'} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Plate Number</label>
          <input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} disabled={!editing} className="input" placeholder="RAD 123 A" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Make</label>
            <input value={make} onChange={(e) => setMake(e.target.value)} disabled={!editing} className="input" placeholder="Toyota" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} disabled={!editing} className="input" placeholder="Corolla" />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Color</label>
          <input value={color} onChange={(e) => setColor(e.target.value)} disabled={!editing} className="input" placeholder="White" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Given To Us</label>
            <input type="date" value={givenDate} onChange={(e) => setGivenDate(e.target.value)} disabled={!editing} className="input" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Operation Start</label>
            <input type="date" value={operationStartDate} onChange={(e) => setOperationStartDate(e.target.value)} disabled={!editing} className="input" />
          </div>
        </div>

        <div className="p-3 rounded-lg border border-gray-100 dark:border-white/5 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-gray-500">RURA License</p>
            <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg">
              {(['pending', 'provided'] as RuraLicenseStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!editing}
                  onClick={() => setRuraStatus(s)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${ruraStatus === s ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
                >
                  {s === 'pending' ? 'Pending' : 'Provided'}
                </button>
              ))}
            </div>
          </div>
          {ruraStatus === 'provided' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium mb-1 text-gray-500">Issued</label>
                <input type="date" value={ruraIssuedDate} onChange={(e) => handleIssuedDateChange(e.target.value)} disabled={!editing} className="input" />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1 text-gray-500">Expires</label>
                <input type="date" value={ruraExpiryDate} onChange={(e) => setRuraExpiryDate(e.target.value)} disabled={!editing} className="input" />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Device Given</label>
          <input value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} disabled={!editing} className="input" placeholder="e.g. Tracker unit #114 / Android tablet" />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Documents Given</label>
          <div className="space-y-1.5">
            {documents.map((doc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={doc}
                  onChange={(e) => updateDoc(i, e.target.value)}
                  disabled={!editing}
                  className="input flex-1 py-1.5"
                  placeholder="e.g. Logbook, Insurance Certificate"
                />
                {editing && (
                  <button type="button" onClick={() => removeDoc(i)} className="shrink-0 text-gray-300 hover:text-red-500">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {editing && (
              <button type="button" onClick={addDoc} className="text-[12px] text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1 pt-0.5">
                <Plus size={12} /> Add document
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="Condition, mileage, anything worth remembering…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {vehicle ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (vehicle ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !plateNumber.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : vehicle ? 'Save Changes' : 'Add Vehicle'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            {canEdit && (
              <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
