import { useState, useMemo } from 'react';
import { Trophy, Search, Car, AlertTriangle, TrendingDown, Users2, CalendarClock } from 'lucide-react';
import {
  useFleetData, buildDepositLeaderboard, depositStandingLabel, DEPOSIT_TIER_STYLE, foldDepositTier,
  formatDateLabelSafe, formatRwf, DEPOSIT_LATE_PENALTY_PER_DAY, SUNDAY_RULE_START,
} from '../../lib/fleet';
import { todayStr } from '../../lib/utils';
import KpiTile from '../../components/KpiTile';

interface DepositLeaderboardPageProps { data?: ReturnType<typeof useFleetData> }

// Every active driver with a car, ranked by one score used everywhere:
// each working day spent uncleared costs 30 points, counted from the
// switch-over week. Zero is the ceiling - a driver who has never been
// late sits at 0. Shared as-is by Fleet's sidebar, the Fleet view MD/
// Call Center/IT see, and Finance's Driver Leaderboard.
export default function DepositLeaderboardPage({ data }: DepositLeaderboardPageProps = {}) {
  return data ? <DepositLeaderboardView data={data} /> : <DepositLeaderboardWithData />;
}

function DepositLeaderboardWithData() {
  return <DepositLeaderboardView data={useFleetData()} />;
}

function DepositLeaderboardView({ data }: { data: ReturnType<typeof useFleetData> }) {
  const { drivers, deposits, loading } = data;
  const [search, setSearch] = useState('');
  const beforeSwitchover = todayStr() < SUNDAY_RULE_START;

  const rows = useMemo(() => buildDepositLeaderboard(drivers, deposits), [drivers, deposits]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.driver.full_name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const notClearedCount = rows.filter((r) => !r.standing.isCleared).length;
  const totalDaysLost = rows.reduce((sum, r) => sum + r.standing.daysLost, 0);
  const perfectCount = rows.filter((r) => r.standing.daysLost === 0 && r.standing.onTimeWeeks > 0).length;
  const switchoverRows = [...rows].sort((a, b) => b.standing.nextDueAmount - a.standing.nextDueAmount);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Trophy size={16} className="text-amber-600 dark:text-amber-300" /> Weekly Deposit Leaderboard</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Every driver pays by Sunday for the Monday–Sunday week ahead. Unpaid on Monday means not cleared to drive, and every working day lost costs {DEPOSIT_LATE_PENALTY_PER_DAY} points.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Users2} label="Drivers Tracked" value={String(rows.length)} color="amber" />
        <KpiTile icon={AlertTriangle} label={beforeSwitchover ? 'Behind Today' : 'Not Cleared'} value={String(notClearedCount)} tone={notClearedCount > 0 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={TrendingDown} label="Days Lost" value={String(totalDaysLost)} tone={totalDaysLost > 0 ? 'negative' : undefined} color="amber" />
        <KpiTile icon={Trophy} label="Perfect Record" value={String(perfectCount)} tone="positive" color="amber" />
      </div>

      {beforeSwitchover && rows.length > 0 && (
        <div className="card p-3.5 border border-amber-200 dark:border-amber-500/20 bg-amber-50/40 dark:bg-amber-500/5 space-y-2">
          <div>
            <p className="text-[12px] font-semibold flex items-center gap-1.5"><CalendarClock size={13} className="text-amber-600 dark:text-amber-300" /> Switch-over: due by Sunday {formatDateLabelSafe(rows[0].standing.nextDueDate ?? SUNDAY_RULE_START)}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
              From Monday {formatDateLabelSafe(SUNDAY_RULE_START)}, a driver must have paid for every working day up to the coming Sunday to be cleared to drive. Scores start counting that week. Tell each driver what they owe:
            </p>
          </div>
          <div className="divide-y divide-amber-100 dark:divide-white/5">
            {switchoverRows.map((r) => (
              <div key={r.driver.id} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                <span className="truncate">{r.driver.full_name}</span>
                <span className={`font-semibold shrink-0 ${r.standing.nextDueAmount > 0 ? '' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {r.standing.nextDueAmount > 0 ? formatRwf(r.standing.nextDueAmount) : 'Already covered'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative w-64">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name" className="input pl-8 w-full" />
      </div>

      <div className="space-y-1.5">
        {filteredRows.map((row, i) => {
          const s = row.standing;
          const style = DEPOSIT_TIER_STYLE[row.tier];
          const dotColor = DEPOSIT_TIER_STYLE[foldDepositTier(row.tier)].dot;
          const notCleared = !s.isCleared;
          return (
            <div
              key={row.driver.id}
              className={`card p-3 flex items-center gap-3 ${notCleared ? 'border-red-200 dark:border-red-500/30 bg-red-50/40 dark:bg-red-500/5' : ''}`}
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
                  {s.onTimeWeeks + s.lateWeeks > 0 && <span>· {s.onTimeWeeks} on time · {s.lateWeeks} late</span>}
                  {s.owes > 0 && <span className="text-red-500 font-medium">· owes {formatRwf(s.owes)}</span>}
                </p>
              </div>
              <div className="text-right shrink-0 w-20">
                <p className={`text-base font-bold leading-none ${s.score < 0 ? 'text-red-500' : 'text-emerald-500'}`}>{s.score}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">points</p>
              </div>
              <span className={`text-[10px] font-bold shrink-0 px-2 py-0.5 rounded-full ${notCleared ? 'text-white bg-red-500' : style.badge}`}>
                {depositStandingLabel(s)}
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
