import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell } from 'recharts';
import { Task } from '../lib/supabase';
import { completionPct, computeStreak, longestStreak, dailyCompletionMap } from '../lib/hooks';
import { dateStr, addDays, startOfWeek, completionColor } from '../lib/utils';
import { Flame, Trophy, CheckCircle2, ListTodo, TrendingUp, Calendar } from 'lucide-react';

interface Props {
  tasks: Task[];
  profileName: string;
}

export default function PersonalAnalytics({ tasks, profileName }: Props) {
  const today = new Date();
  const todayStr = dateStr(today);

  const todayTasks = tasks.filter((t) => t.date === todayStr);
  const weekStart = startOfWeek(today);
  const weekTasks = tasks.filter((t) => t.date >= dateStr(weekStart) && t.date <= todayStr);
  const monthTasks = tasks.filter((t) => {
    const d = new Date(t.date + 'T00:00:00');
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  });

  const completed = tasks.filter((t) => t.completed).length;
  const streak = computeStreak(tasks);
  const longest = longestStreak(tasks);
  const avgPct = useMemo(() => {
    const map = dailyCompletionMap(tasks);
    const vals = Object.values(map).map((v) => v.pct);
    return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [tasks]);

  // Weekly chart: last 7 days
  const weeklyData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const ds = dateStr(d);
      const dayTasks = tasks.filter((t) => t.date === ds);
      days.push({
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        pct: Math.round(completionPct(dayTasks)),
        date: ds,
      });
    }
    return days;
  }, [tasks, today]);

  // Monthly trend: last 30 days
  const monthlyData = useMemo(() => {
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i);
      const ds = dateStr(d);
      const dayTasks = tasks.filter((t) => t.date === ds);
      days.push({
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pct: Math.round(completionPct(dayTasks)),
      });
    }
    return days;
  }, [tasks, today]);

  const stats = [
    { label: "Today's Completion", value: `${Math.round(completionPct(todayTasks))}%`, icon: TrendingUp, color: 'text-brand-600 dark:text-brand-300' },
    { label: 'Weekly Completion', value: `${Math.round(completionPct(weekTasks))}%`, icon: Calendar, color: 'text-emerald-500' },
    { label: 'Monthly Completion', value: `${Math.round(completionPct(monthTasks))}%`, icon: CheckCircle2, color: 'text-violet-500' },
    { label: 'Current Streak', value: `${streak} ${streak === 1 ? 'day' : 'days'}`, icon: Flame, color: 'text-orange-500' },
    { label: 'Longest Streak', value: `${longest} days`, icon: Trophy, color: 'text-amber-500' },
    { label: 'Tasks Completed', value: `${completed}`, icon: CheckCircle2, color: 'text-green-500' },
    { label: 'Tasks Created', value: `${tasks.length}`, icon: ListTodo, color: 'text-blue-500' },
    { label: 'Avg Completion', value: `${Math.round(avgPct)}%`, icon: TrendingUp, color: 'text-cyan-500' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{profileName}'s Analytics</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card p-4">
              <Icon size={18} className={s.color} />
              <p className="text-2xl font-bold mt-2">{s.value}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
            </div>
          );
        })}
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-4">This Week</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weeklyData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-white/5" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#9ca3af" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#9ca3af" />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: 'none', background: '#071A35', color: '#fff', fontSize: 12 }}
              formatter={(v) => [`${v}%`, 'Completion']}
            />
            <Bar dataKey="pct" radius={[8, 8, 0, 0]}>
              {weeklyData.map((entry, i) => (
                <Cell key={i} fill={completionColor(entry.pct)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-4">Last 30 Days</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-white/5" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" interval={4} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#9ca3af" />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: 'none', background: '#071A35', color: '#fff', fontSize: 12 }}
              formatter={(v) => [`${v}%`, 'Completion']}
            />
            <Line type="monotone" dataKey="pct" stroke="#007BFF" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
