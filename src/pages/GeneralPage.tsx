import { useEffect, useState, useMemo } from 'react';
import { Plus, Flame, ListTodo, Calendar as CalendarIcon, MessageSquare, Megaphone, FileText } from 'lucide-react';
import AddTaskModal from '../components/AddTaskModal';
import TaskReviewModal from '../components/TaskReviewModal';
import TaskCard from '../components/TaskCard';
import ProgressRing from '../components/ProgressRing';
import { useAuth } from '../lib/auth';
import { tasksForDate, completionPct, computeStreak } from '../lib/hooks';
import { supabase, Task } from '../lib/supabase';
import { todayStr, greeting, formatDateFull, formatTime, formatDateLabel } from '../lib/utils';
import MeetingsPage from './MeetingsPage';
import CommentsPage from './CommentsPage';
import AnnouncementsPage from './AnnouncementsPage';
import DocumentsPage from './DocumentsPage';

interface GeneralPageProps {
  tasks: Task[];
  reload: () => void;
}

type Tab = 'today' | 'meetings' | 'comments' | 'announcements' | 'documents';

const TABS: { key: Tab; label: string; icon: typeof ListTodo }[] = [
  { key: 'today', label: 'Today', icon: ListTodo },
  { key: 'meetings', label: 'Meetings', icon: CalendarIcon },
  { key: 'comments', label: 'Comments', icon: MessageSquare },
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
  { key: 'documents', label: 'Documents', icon: FileText },
];

// Everything common to every department, regardless of which specific
// module a person's sidebar shows: today's tasks, meetings, comments,
// announcements, and documents - each its own tab here rather than
// stacked sections, since they're distinct things to switch between,
// not one continuous read. Department-specific work lives in its own
// separate sidebar pages instead of being bundled in here.
//
// tasks/reload come from EmployeeApp's own useTasks() call rather than
// calling useTasks() again in here - two instances for the same userId
// each try to open a realtime channel with the identical name
// (tasks-<userId>), and Supabase's client throws ("cannot add
// postgres_changes callbacks ... after subscribe()") the moment the
// second one subscribes, which crashes the whole page white since
// nothing in the tree catches it.
export default function GeneralPage({ tasks, reload }: GeneralPageProps) {
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${tab === t.key ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'today' && <TodayTab tasks={tasks} reload={reload} />}
      {tab === 'meetings' && <MeetingsPage />}
      {tab === 'comments' && <CommentsPage />}
      {tab === 'announcements' && <AnnouncementsPage />}
      {tab === 'documents' && <DocumentsPage />}
    </div>
  );
}

function TodayTab({ tasks, reload }: GeneralPageProps) {
  const { profile } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const toggleTask = async (task: Task) => {
    const newCompleted = !task.completed;
    const completedAt = newCompleted ? new Date().toISOString() : null;
    await supabase
      .from('tasks')
      .update({ completed: newCompleted, completed_at: completedAt })
      .eq('id', task.id);
    reload();
  };

  const deleteTask = async (task: Task) => {
    await supabase.from('tasks').delete().eq('id', task.id);
  };

  const todayTasks = useMemo(() => tasksForDate(tasks, todayStr()), [tasks]);
  const todayPct = completionPct(todayTasks);
  const completedCount = todayTasks.filter((t) => t.completed).length;
  const streak = computeStreak(tasks);

  const timelineDates = useMemo(() => {
    const dates = new Set<string>();
    dates.add(todayStr());
    for (const t of tasks) dates.add(t.date);
    return Array.from(dates).sort().reverse();
  }, [tasks]);

  return (
    <div className="space-y-5">
      <div className="animate-fade-in flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {greeting()}, {profile?.full_name?.split(' ')[0]}
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">{formatDateFull(now)}</p>
        </div>
        <p className="text-xl font-light text-brand-500 tabular-nums">{formatTime(now)}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-3.5 flex items-center gap-3">
          <ProgressRing pct={todayPct} size={48} stroke={5} showLabel={false} />
          <div>
            <p className="stat-label mb-0.5">Completion</p>
            <p className="text-xl font-bold leading-none">{Math.round(todayPct)}%</p>
          </div>
        </div>
        <div className="card p-3.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
            <ListTodo size={16} className="text-blue-600 dark:text-blue-300" />
          </div>
          <div>
            <p className="stat-label mb-0.5">Tasks Today</p>
            <p className="text-xl font-bold leading-none">{todayTasks.length}<span className="text-[10px] font-normal text-gray-400 ml-1">{completedCount} done</span></p>
          </div>
        </div>
        <div className="card p-3.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
            <Flame size={16} className="text-orange-500" />
          </div>
          <div>
            <p className="stat-label mb-0.5">Streak</p>
            <p className="text-xl font-bold leading-none">{streak} {streak === 1 ? 'Day' : 'Days'}</p>
          </div>
        </div>
      </div>

      <button
        onClick={() => setAddOpen(true)}
        className="btn-primary flex items-center justify-center gap-2 py-2.5"
      >
        <Plus size={16} />
        <span>Add New Task</span>
      </button>

      <div className="space-y-5">
        {timelineDates.slice(0, 14).map((date) => {
          const dayTasks = tasksForDate(tasks, date);
          if (dayTasks.length === 0 && date !== todayStr()) return null;
          const pct = completionPct(dayTasks);
          const isToday = date === todayStr();
          const carried = dayTasks.filter((t) => t.is_carried_over);

          return (
            <div key={date} className="animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <h3 className="section-title">
                  {formatDateLabel(date)}
                  {isToday && <span className="ml-2 text-[8px] font-bold text-brand-700 dark:text-brand-300 bg-brand/10 px-1.5 py-0.5 rounded-full">LIVE</span>}
                </h3>
                {dayTasks.length > 0 && (
                  <span className="text-[10px] text-gray-400">
                    {dayTasks.filter((t) => t.completed).length}/{dayTasks.length} · {Math.round(pct)}%
                  </span>
                )}
              </div>

              {carried.length > 0 && isToday && (
                <p className="text-[10px] font-medium text-orange-500 mb-1.5 px-0.5">Carried Over</p>
              )}

              <div className="space-y-1.5">
                {dayTasks
                  .sort((a, b) => Number(a.completed) - Number(b.review_status ? 1 : 0))
                  .sort((a, b) => Number(a.review_status !== 'completed') - Number(b.review_status !== 'completed'))
                  .map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onToggle={toggleTask}
                      onDelete={isToday ? deleteTask : undefined}
                      onClick={isToday ? (t) => setReviewTask(t) : undefined}
                      reviewMode={isToday}
                    />
                  ))}
                {dayTasks.length === 0 && isToday && (
                  <div className="card p-6 text-center">
                    <p className="text-gray-400 text-[12px]">No tasks yet. Tap + to add your first task.</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} userId={profile!.id} onAdded={reload} />

      {reviewTask && (
        <TaskReviewModal
          open={!!reviewTask}
          onClose={() => setReviewTask(null)}
          task={reviewTask}
          onReviewed={() => {
            reload();
            setReviewTask(null);
          }}
        />
      )}
    </div>
  );
}
