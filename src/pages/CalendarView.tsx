import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarCheck, TrendingUp, Sparkles, ListChecks } from 'lucide-react';
import { Task } from '../lib/supabase';
import { dailyCompletionMap } from '../lib/hooks';
import { completionColor, formatDateLabel, dateStr, todayStr } from '../lib/utils';
import Modal from '../components/Modal';
import TaskCard from '../components/TaskCard';

interface CalendarViewProps {
  tasks: Task[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEGEND = [
  { label: '100%', color: '#4F7B3E' },
  { label: '80%+', color: '#65a30d' },
  { label: '50%+', color: '#f97316' },
  { label: '<50%', color: '#ef4444' },
];

export default function CalendarView({ tasks }: CalendarViewProps) {
  const [cursor, setCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const map = useMemo(() => dailyCompletionMap(tasks), [tasks]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Monday=0
  const daysInMonth = lastDay.getDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push(dateStr(date));
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells.push(null);

  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const monthStats = useMemo(() => {
    const monthDates = cells.filter((c): c is string => !!c);
    const logged = monthDates.filter((d) => map[d]);
    const avgPct = logged.length === 0 ? 0 : logged.reduce((s, d) => s + map[d].pct, 0) / logged.length;
    const perfectDays = logged.filter((d) => map[d].pct === 100).length;
    const tasksCompleted = logged.reduce((s, d) => s + map[d].completed, 0);
    return { daysLogged: logged.length, avgPct, perfectDays, tasksCompleted };
  }, [cells, map]);

  const selectedTasks = selectedDate ? tasks.filter((t) => t.date === selectedDate) : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-tight">{monthLabel}</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Task completion by day</p>
        </div>
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1.5 rounded-md text-gray-500 hover:bg-white dark:hover:bg-navy-800 hover:shadow-sm transition-all">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => setCursor(new Date())} className="px-3 py-1.5 rounded-md text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-navy-800 hover:shadow-sm transition-all">
            Today
          </button>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1.5 rounded-md text-gray-500 hover:bg-white dark:hover:bg-navy-800 hover:shadow-sm transition-all">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Month stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="card p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <CalendarCheck size={12} className="text-brand-500" />
            <p className="stat-label">Days Logged</p>
          </div>
          <p className="text-lg font-bold leading-none">{monthStats.daysLogged}</p>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={12} className="text-brand-500" />
            <p className="stat-label">Avg Completion</p>
          </div>
          <p className="text-lg font-bold leading-none" style={{ color: monthStats.daysLogged ? completionColor(monthStats.avgPct) : undefined }}>
            {monthStats.daysLogged ? `${Math.round(monthStats.avgPct)}%` : '—'}
          </p>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles size={12} className="text-brand-500" />
            <p className="stat-label">Perfect Days</p>
          </div>
          <p className="text-lg font-bold leading-none">{monthStats.perfectDays}</p>
        </div>
        <div className="card p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <ListChecks size={12} className="text-brand-500" />
            <p className="stat-label">Tasks Done</p>
          </div>
          <p className="text-lg font-bold leading-none">{monthStats.tasksCompleted}</p>
        </div>
      </div>

      {/* Grid */}
      <div className="card p-4 sm:p-5">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[9px] font-semibold uppercase tracking-wide text-gray-400 py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {cells.map((date, i) => {
            if (!date) return <div key={i} />;
            const info = map[date];
            const dayNum = new Date(date + 'T00:00:00').getDate();
            const isToday = todayStr() === date;
            const color = info ? completionColor(info.pct) : undefined;

            return (
              <button
                key={i}
                onClick={() => setSelectedDate(date)}
                className={`group relative aspect-square rounded-xl flex flex-col justify-between p-1.5 sm:p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                  isToday ? 'ring-2 ring-brand ring-offset-1 ring-offset-white dark:ring-offset-navy-800' : ''
                } ${info ? '' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}
                style={info ? { backgroundColor: `${color}14` } : undefined}
              >
                <span className={`text-[10px] sm:text-[11px] font-semibold ${info ? '' : 'text-gray-400'}`}>
                  {dayNum}
                </span>
                {info && (
                  <>
                    <span className="hidden sm:block text-[8px] font-medium text-gray-400">
                      {info.completed}/{info.total}
                    </span>
                    <span className="block h-1 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                      <span className="block h-full rounded-full transition-all" style={{ width: `${info.pct}%`, backgroundColor: color }} />
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-5 pt-4 border-t border-gray-100 dark:border-white/5">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={!!selectedDate} onClose={() => setSelectedDate(null)} title={selectedDate ? formatDateLabel(selectedDate) : ''} maxWidth="max-w-lg">
        {selectedTasks.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No tasks for this day.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {selectedTasks.map((t) => (
              <TaskCard key={t.id} task={t} onToggle={() => {}} showTime={false} />
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
