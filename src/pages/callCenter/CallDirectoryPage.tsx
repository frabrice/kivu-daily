import { useMemo, useState } from 'react';
import { Search, Users2, Phone, Clock3, History } from 'lucide-react';
import { useCallCenterData, STAGE_LABEL } from '../../lib/callCenter';
import { effectiveStage } from '../../lib/fleet';
import { timeAgo } from '../../lib/utils';
import { Driver } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import LogCallDrawer from '../../components/callCenter/LogCallDrawer';
import CallHistoryDrawer from '../../components/callCenter/CallHistoryDrawer';

interface CallDirectoryPageProps { data?: ReturnType<typeof useCallCenterData> }

export default function CallDirectoryPage({ data }: CallDirectoryPageProps = {}) {
  return data ? <CallDirectoryPageView data={data} /> : <CallDirectoryPageWithData />;
}

function CallDirectoryPageWithData() {
  return <CallDirectoryPageView data={useCallCenterData()} />;
}

function CallDirectoryPageView({ data }: { data: ReturnType<typeof useCallCenterData> }) {
  const { drivers, logs, reasons, outcomes, scripts, loading, reload } = data;
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const [callDriver, setCallDriver] = useState<Driver | null>(null);
  const [historyDriver, setHistoryDriver] = useState<Driver | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) => d.full_name.toLowerCase().includes(q) || d.phone.includes(q));
  }, [drivers, search]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Users2 size={16} className="text-violet-600 dark:text-violet-300" /> Directory</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Every driver, searchable — click to call.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <div className="relative w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="input pl-8" />
          </div>
        </div>
      </div>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {filtered.map((d) => {
            const callCount = logs.filter((l) => l.driver_id === d.id).length;
            const last = logs.find((l) => l.driver_id === d.id);
            return (
              <div key={d.id} onClick={() => setCallDriver(d)} className="card p-3.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[12px] font-medium truncate">{d.full_name}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setHistoryDriver(d); }}
                      title="View call history"
                      className="btn-ghost p-1.5"
                    >
                      <History size={13} />
                    </button>
                    <Phone size={13} className="text-brand-500" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400">{d.phone} · {STAGE_LABEL[effectiveStage(d)]}</p>
                <p className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1">
                  <Clock3 size={10} /> {callCount === 0 ? 'Never called' : `${callCount} call${callCount === 1 ? '' : 's'} · last ${timeAgo(last!.created_at)}`}
                </p>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="text-[12px] text-gray-400 col-span-full text-center py-8">No drivers found.</p>}
        </div>
      )}

      {view === 'table' && (
        <DataTable
          rows={filtered}
          keyFn={(d) => d.id}
          emptyLabel="No drivers found."
          onRowClick={(d) => setCallDriver(d)}
          columns={[
            { header: 'Name', render: (d) => <span className="font-medium">{d.full_name}</span> },
            { header: 'Phone', render: (d) => d.phone },
            { header: 'Stage', render: (d) => STAGE_LABEL[effectiveStage(d)] },
            {
              header: 'Calls',
              render: (d) => {
                const callCount = logs.filter((l) => l.driver_id === d.id).length;
                const last = logs.find((l) => l.driver_id === d.id);
                return callCount === 0 ? 'Never called' : `${callCount} · last ${timeAgo(last!.created_at)}`;
              },
            },
            {
              header: '',
              className: 'text-right',
              render: (d) => (
                <button onClick={(e) => { e.stopPropagation(); setHistoryDriver(d); }} title="View call history" className="btn-ghost p-1.5">
                  <History size={13} />
                </button>
              ),
            },
          ]}
        />
      )}

      {callDriver && (
        <LogCallDrawer
          driver={callDriver}
          drivers={drivers}
          reasons={reasons}
          outcomes={outcomes}
          scripts={scripts}
          onClose={() => setCallDriver(null)}
          onSaved={reload}
        />
      )}

      {historyDriver && (
        <CallHistoryDrawer
          driver={historyDriver}
          logs={logs.filter((l) => l.driver_id === historyDriver.id)}
          onClose={() => setHistoryDriver(null)}
          onLogCall={() => { setCallDriver(historyDriver); setHistoryDriver(null); }}
        />
      )}
    </div>
  );
}
