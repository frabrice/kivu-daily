import { useState, useMemo } from 'react';
import { Trophy, Search, Car, AlertTriangle, TrendingDown, Users2 } from 'lucide-react';
import {
  useFleetData, buildDepositLeaderboard, depositStatusLabel, DEPOSIT_TIER_STYLE, foldDepositTier,
  formatDateLabelSafe, DEPOSIT_LATE_PENALTY_PER_DAY,
} from '../../lib/fleet';
import KpiTile from '../../components/KpiTile';

interface DepositLeaderboardPageProps { data?: ReturnType<typeof useFleetData> }

// The weekly compliance leaderboard: every active driver with a car,
// ranked by the same score everywhere in the app (see
// computeDriverComplianceScore in lib/fleet.ts) - a day a full 180,000
// lands late costs 30 points, whether that lateness already closed out
// a past week or is still accruing live on the week in progress right
// now. Zero is the ceiling, not a target to beat - a driver who has
// never once been late just sits at 0. Shared as-is by Fleet's own
// sidebar, the bundled Fleet view MD/Call Center/IT see, and Finance's
// own Driver Leaderboard, so the ranking can never drift between them.
export default function DepositLeaderboardPage({ data }: DepositLeaderboardPageProps = {}) {
  return data ? <DepositLeaderboardView data={data} /> : <DepositLeaderboardWithData />;
}

function DepositLeaderboardWithData() {
  return <DepositLeaderboardView data={useFleetData()} />;
}

function DepositLeaderboardView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { drivers, deposits, loading } = data;
  const [search, setSearch] = useState('');

  const rows = useMemo(() => buildDepositLeaderboard(drivers, deposits), [drivers, deposits]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.driver.full_name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const inDefaultCount = rows.filter((r) => r.isCurrentlyInDefault).length;
  const totalDaysLost = rows.reduce((sum, r) => sum + Math.round(-r.score / DEPOSIT_LATE_PENALTY_PER_DAY), 0);
  const perfectCount = rows.filter((r) => r.score === 0 && r.totalCycles > 0).length;

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Trophy size={16} className="text-amber-600 dark:text-amber-300" /> Weekly Deposit Leaderboard</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Every driver's own 7-day clock, counted from their start date - a full 180,000 due every week, no exceptions. Every day it lands late costs {DEPOSIT_LATE_PENALTY_PER_DAY} points, live, whether that week has closed yet or not.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Users2} label="Drivers Tracked" value={String(rows.length)} color="amber" />
        <KpiTile icon={AlertTriangle} label="Currently In Default" value={String(inDefaultCount)} tone={inDefaultCount > 0 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={TrendingDown} label="Total Days Lost" value={String(totalDaysLost)} tone={totalDaysLost > 0 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={Trophy} label="Perfect Record" value={String(perfectCount)} tone="positive" color="amber" />
      </div>

      <div className="relative w-64">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name" className="input pl-8 w-full" />
      </div>

      <div className="space-y-1.5">
        {filteredRows.map((row, i) => {
          const style = DEPOSIT_TIER_STYLE[row.currentTier];
          const dotColor = DEPOSIT_TIER_STYLE[foldDepositTier(row.currentTier)].dot;
          return (
            <div
              key={row.driver.id}
              className={`card p-3 flex items-center gap-3 ${row.isCurrentlyInDefault ? 'border-red-200 dark:border-red-500/30 bg-red-50/40 dark:bg-red-500/5' : ''}`}
            >
              <div className="w-7 text-center shrink-0">
                <span className="text-[13px] font-bold text-gray-400">#{i + 1}</span>
              </div>
              <div className={`w-1.5 h-8 rounded-full shrink-0 ${dotColor}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate">{row.driver.full_name}</p>
                <p className="text-[10px] text-gray-400 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1"><Car size={10} /> {row.driver.vehicle?.plate_number ?? '—'}</span>
                  <span>· Started {row.driver.start_date ? formatDateLabelSafe(row.driver.start_date) : '—'}</span>
                  <span>· {row.onTime} on time · {row.late} late ({row.totalCycles} weeks)</span>
                </p>
              </div>
              <div className="text-right shrink-0 w-20">
                <p className={`text-base font-bold leading-none ${row.score < 0 ? 'text-red-500' : 'text-emerald-500'}`}>{row.score}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">points</p>
              </div>
              <span className={`text-[10px] font-bold shrink-0 px-2 py-0.5 rounded-full ${row.isCurrentlyInDefault ? 'text-white bg-red-500' : style.badge}`}>
                {depositStatusLabel(row.currentDaysSince)}
              </span>
            </div>
          );
        })}
        {filteredRows.length === 0 && (
          <div className="card p-10 text-center">
            <Trophy size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">{rows.length === 0 ? 'No drivers with a vehicle and a start date yet.' : 'No drivers match this search.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
