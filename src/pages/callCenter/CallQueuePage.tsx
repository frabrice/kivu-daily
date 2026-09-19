import { useMemo, useState } from 'react';
import { Phone, PhoneCall } from 'lucide-react';
import { useCallCenterData, STAGE_LABEL } from '../../lib/callCenter';
import { effectiveStage } from '../../lib/fleet';
import LogCallDrawer from '../../components/callCenter/LogCallDrawer';
import { Driver } from '../../lib/supabase';

interface CallQueuePageProps { data?: ReturnType<typeof useCallCenterData> }

// See FleetPipelinePage.tsx for why this takes an optional pre-fetched
// data prop rather than always calling useCallCenterData() itself.
export default function CallQueuePage({ data }: CallQueuePageProps = {}) {
  return data ? <CallQueuePageView data={data} /> : <CallQueuePageWithData />;
}

function CallQueuePageWithData() {
  return <CallQueuePageView data={useCallCenterData()} />;
}

function CallQueuePageView({ data }: { data: ReturnType<typeof useCallCenterData> }) {
  const { drivers, logs, reasons, outcomes, scripts, loading, reload } = data;
  const [callDriver, setCallDriver] = useState<Driver | null>(null);

  const queue = useMemo(() => {
    return drivers
      .filter((d) => d.stage !== 'inactive')
      .map((d) => {
        const driverLogs = logs.filter((l) => l.driver_id === d.id);
        const lastCall = driverLogs[0] ?? null;
        let priority = 4;
        let reasonLabel = '';
        if (!lastCall) {
          priority = 0;
          reasonLabel = 'Never called';
        } else if (lastCall.outcome?.needs_followup) {
          priority = 1;
          reasonLabel = `Follow-up: ${lastCall.outcome.label}`;
        } else {
          const days = Math.floor((Date.now() - new Date(lastCall.created_at).getTime()) / 86400000);
          if (days >= 7) {
            priority = 2;
            reasonLabel = `${days}d since last call`;
          } else {
            priority = 4;
            reasonLabel = `Called ${days === 0 ? 'today' : days + 'd ago'}`;
          }
        }
        return { driver: d, lastCall, priority, reasonLabel };
      })
      .sort((a, b) => a.priority - b.priority || a.driver.full_name.localeCompare(b.driver.full_name));
  }, [drivers, logs]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><PhoneCall size={16} className="text-violet-600 dark:text-violet-300" /> Call Queue</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Who to call next, ranked by urgency.</p>
      </div>

      <div className="space-y-1.5">
        {queue.length === 0 && (
          <div className="card p-10 text-center">
            <Phone size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">No drivers yet — add some from the Fleet module.</p>
          </div>
        )}
        {queue.map((q) => (
          <button
            key={q.driver.id}
            onClick={() => setCallDriver(q.driver)}
            className="w-full card p-3 flex items-center gap-3 text-left hover:shadow-md hover:border-brand/30 transition-all"
          >
            <div className={`w-1.5 h-8 rounded-full shrink-0 ${q.priority === 0 ? 'bg-red-500' : q.priority === 1 ? 'bg-orange-500' : q.priority === 2 ? 'bg-amber-400' : 'bg-gray-200 dark:bg-white/10'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium truncate">{q.driver.full_name}</p>
              <p className="text-[10px] text-gray-400">{q.driver.phone} · {STAGE_LABEL[effectiveStage(q.driver)]}</p>
            </div>
            <span className={`text-[10px] font-medium shrink-0 ${q.priority <= 2 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400'}`}>
              {q.reasonLabel}
            </span>
            <Phone size={14} className="text-brand-500 shrink-0" />
          </button>
        ))}
      </div>

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
    </div>
  );
}
