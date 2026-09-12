import { useMemo } from 'react';
import { Trophy, Medal, Award, Flame } from 'lucide-react';
import { EmployeeWithStats } from '../lib/company';
import { completionColor, dateStr, startOfWeek, addDays } from '../lib/utils';
import Avatar from '../components/Avatar';
import { Task } from '../lib/supabase';

interface Props {
  employees: EmployeeWithStats[];
  allTasks: Task[];
  onSelect: (e: EmployeeWithStats) => void;
}

export default function Leaderboard({ employees, allTasks, onSelect }: Props) {
  const ranked = useMemo(() => {
    const weekStart = startOfWeek(new Date());
    const weekEnd = addDays(weekStart, 6);
    const ws = dateStr(weekStart);
    const we = dateStr(weekEnd);

    return employees
      .map((e) => {
        const weekTasks = allTasks.filter((t) => t.user_id === e.id && t.date >= ws && t.date <= we);
        const completed = weekTasks.filter((t) => t.completed).length;
        const total = weekTasks.length;
        const pct = total === 0 ? 0 : (completed / total) * 100;
        return { ...e, weekPct: pct, weekCompleted: completed, weekTotal: total };
      })
      .filter((e) => e.weekTotal > 0)
      .sort((a, b) => b.weekPct - a.weekPct || b.streak - a.streak)
      .slice(0, 10);
  }, [employees, allTasks]);

  const isFriday = new Date().getDay() === 5;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy size={20} className="text-amber-500" />
        <h2 className="text-xl font-semibold">Weekly Leaderboard</h2>
        {!isFriday && <span className="text-xs text-gray-400">(Updates every Friday)</span>}
      </div>

      {ranked.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400">No activity this week yet. Be the first!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ranked.map((e, i) => {
            const isTop3 = i < 3;
            const Icon = i === 0 ? Trophy : i === 1 ? Medal : i === 2 ? Award : null;
            return (
              <button
                key={e.id}
                onClick={() => onSelect(e)}
                className={`card p-4 flex items-center gap-4 w-full text-left hover:shadow-md transition-all ${
                  isTop3 ? 'border-2' : ''
                }`}
                style={isTop3 ? { borderColor: i === 0 ? '#fbbf24' : i === 1 ? '#d1d5db' : '#fb923c' } : undefined}
              >
                <div className="flex items-center justify-center w-8">
                  {Icon ? <Icon size={22} className={i === 0 ? 'text-amber-500' : i === 1 ? 'text-gray-400' : 'text-orange-400'} /> : (
                    <span className="text-lg font-bold text-gray-400">{i + 1}</span>
                  )}
                </div>
                <Avatar name={e.full_name} url={e.avatar_url} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{e.full_name}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
                    <span>{e.department?.name}</span>
                    <span>·</span>
                    <Flame size={11} className="text-orange-400" />
                    <span>{e.streak}-day streak</span>
                    <span>·</span>
                    <span>{e.weekCompleted}/{e.weekTotal} this week</span>
                  </p>
                </div>
                <span className="text-xl font-bold" style={{ color: completionColor(e.weekPct) }}>{Math.round(e.weekPct)}%</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
