import { useEffect, useMemo, useState } from 'react';
import HelpButton from '../../components/HelpButton';
import { Phone, PhoneCall } from 'lucide-react';
import { useCallCenterData, STAGE_LABEL } from '../../lib/callCenter';
import { effectiveStage, computeDepositStanding, formatRwf } from '../../lib/fleet';
import LogCallDrawer from '../../components/callCenter/LogCallDrawer';
import { Driver, supabase } from '../../lib/supabase';

interface CallQueuePageProps { data?: ReturnType<typeof useCallCenterData> }

// See FleetPipelinePage.tsx for why this takes an optional pre-fetched
// data prop rather than always calling useCallCenterData() itself.
export default function CallQueuePage({ data }: CallQueuePageProps = {}) {
  return data ? <CallQueuePageView data={data} /> : <CallQueuePageWithData />;
}

function CallQueuePageWithData() {
  return <CallQueuePageView data={useCallCenterData()} />;
}

type Group = 'payment' | 'followup' | 'onboarding' | 'checkin' | 'recent';

const GROUPS: { key: Group; title: string; hint: string; dot: string }[] = [
  { key: 'payment', title: 'Payment backup', hint: "Behind on their weekly payment — Janviere leads; call if she asks or they're still behind.", dot: 'bg-red-500' },
  { key: 'followup', title: 'Follow-ups', hint: 'Last call needed a follow-up, or Fleet flagged the driver.', dot: 'bg-orange-500' },
  { key: 'onboarding', title: 'Onboarding', hint: 'Applicants not driving yet — help them finish onboarding.', dot: 'bg-blue-500' },
  { key: 'checkin', title: 'Check-ins', hint: 'Active drivers not called in 7+ days (or never).', dot: 'bg-amber-400' },
  { key: 'recent', title: 'Called recently', hint: 'Nothing due.', dot: 'bg-gray-300 dark:bg-white/20' },
];

function CallQueuePageView({ data }: { data: ReturnType<typeof useCallCenterData> }) {
  const { drivers, logs, reasons, outcomes, scripts, loading, reload } = data;
  const [callDriver, setCallDriver] = useState<Driver | null>(null);
  const [deposits, setDeposits] = useState<{ driver_id: string; paid_date: string; amount: number; created_at: string }[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    supabase.from('driver_deposits').select('driver_id, paid_date, amount, created_at').then(({ data: d }) => setDeposits((d as typeof deposits) ?? []));
  }, []);

  // Each driver lands in exactly one group, most urgent purpose first.
  const grouped = useMemo(() => {
    const out: Record<Group, { driver: Driver; reasonLabel: string }[]> = { payment: [], followup: [], onboarding: [], checkin: [], recent: [] };
    for (const d of drivers.filter((x) => x.stage !== 'inactive' && x.contract_status !== 'ended')) {
      const lastCall = logs.find((l) => l.driver_id === d.id) ?? null;
      const days = lastCall ? Math.floor((Date.now() - new Date(lastCall.created_at).getTime()) / 86400000) : null;
      const stage = effectiveStage(d);
      const standing = stage === 'active' ? computeDepositStanding(d, deposits.filter((x) => x.driver_id === d.id)) : null;
      if (standing && (standing.owes > 0 || standing.weekBehind > 0)) {
        out.payment.push({ driver: d, reasonLabel: standing.owes > 0 ? `Owes ${formatRwf(standing.owes)} · behind ${formatRwf(standing.weekBehind)}` : `Behind ${formatRwf(standing.weekBehind)}` });
      } else if (lastCall?.outcome?.needs_followup || stage === 'flagged') {
        out.followup.push({ driver: d, reasonLabel: lastCall?.outcome?.needs_followup ? `Follow-up: ${lastCall.outcome.label}` : 'Flagged by Fleet' });
      } else if (stage !== 'active') {
        out.onboarding.push({ driver: d, reasonLabel: `${STAGE_LABEL[stage]}${lastCall ? ` · called ${days === 0 ? 'today' : `${days}d ago`}` : ' · never called'}` });
      } else if (!lastCall || (days ?? 0) >= 7) {
        out.checkin.push({ driver: d, reasonLabel: lastCall ? `${days}d since last call` : 'Never called' });
      } else {
        out.recent.push({ driver: d, reasonLabel: `Called ${days === 0 ? 'today' : `${days}d ago`}` });
      }
    }
    for (const g of Object.values(out)) g.sort((a, b) => a.driver.full_name.localeCompare(b.driver.full_name));
    return out;
  }, [drivers, logs, deposits]);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 skeleton rounded-xl" />)}</div>;

  const total = drivers.filter((x) => x.stage !== 'inactive' && x.contract_status !== 'ended').length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><PhoneCall size={16} className="text-violet-600 dark:text-violet-300" /> Call Queue</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Drivers to call, grouped by why. Click a driver to log the call.</p>
      </div>
        <HelpButton navKey="call_center_queue" title="the Call Queue" />
      </div>

      {total === 0 && (
        <div className="card p-10 text-center">
          <Phone size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-gray-400">No drivers yet — Fleet adds them in the Driver Pipeline.</p>
        </div>
      )}

      {GROUPS.map((g) => {
        const list = grouped[g.key];
        if (list.length === 0 || (g.key === 'recent' && !showRecent)) return null;
        return (
          <section key={g.key} className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${g.dot}`} />
              <h3 className="text-[12px] font-semibold">{g.title} <span className="text-gray-400 font-normal">({list.length})</span></h3>
              <p className="text-[11px] text-gray-400 truncate">{g.hint}</p>
            </div>
            {list.map((q) => (
              <button key={q.driver.id} onClick={() => setCallDriver(q.driver)}
                className="w-full card p-3 flex items-center gap-3 text-left hover:shadow-md hover:border-brand/30 transition-all">
                <div className={`w-1.5 h-8 rounded-full shrink-0 ${g.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate">{q.driver.full_name}</p>
                  <p className="text-[10px] text-gray-400">{q.driver.phone} · {STAGE_LABEL[effectiveStage(q.driver)]}</p>
                </div>
                <span className={`text-[10px] font-medium shrink-0 ${g.key === 'recent' ? 'text-gray-400' : 'text-orange-600 dark:text-orange-400'}`}>{q.reasonLabel}</span>
                <Phone size={14} className="text-brand-500 shrink-0" />
              </button>
            ))}
          </section>
        );
      })}

      {grouped.recent.length > 0 && (
        <button onClick={() => setShowRecent((v) => !v)} className="btn-ghost text-[11px]">
          {showRecent ? 'Hide' : 'Show'} {grouped.recent.length} called recently
        </button>
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
    </div>
  );
}
