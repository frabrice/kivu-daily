import { useEffect, useState, useMemo } from 'react';
import { Plus, Flame, Calendar as CalendarIcon, MessageSquare, Megaphone, FileText } from 'lucide-react';
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

// Everything common to every department, regardless of which specific
// module a person's sidebar shows: today's tasks, meetings, comments,
// announcements, and documents. Department-specific work lives in its
// own separate sidebar pages instead of being bundled in here.
//
// tasks/reload come from EmployeeApp's own useTasks() call rather than
// calling useTasks() again in here - two instances for the same userId
// each try to open a realtime channel with the identical name
// (tasks-<userId>), and Supabase's client throws ("cannot add
// postgres_changes callbacks ... after subscribe()") the moment the
// second one subscribes, which crashes the whole page white since
// nothing in the tree catches it.
export default function GeneralPage({ tasks, reload }: GeneralPageProps) {
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
    <div className="space-y-10">
      <div className="space-y-5">
        <div className="animate-fade-in flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {greeting()}, {profile?.full_name?.split(' ')[0]}
            </h2>
            <p className="text-[12px] text-gray-400 mt-0.5">{formatDateFull(now)}</p>
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
          <div className="card p-3.5">
            <p className="stat-label mb-0.5">Tasks Today</p>
            <p className="text-xl font-bold leading-none">{todayTasks.length}<span className="text-[11px] font-normal text-gray-400 ml-1">{completedCount} done</span></p>
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
                    {isToday && <span className="ml-2 text-[9px] font-bold text-brand-700 dark:text-brand-300 bg-brand/10 px-1.5 py-0.5 rounded-full">LIVE</span>}
                  </h3>
                  {dayTasks.length > 0 && (
                    <span className="text-[11px] text-gray-400">
                      {dayTasks.filter((t) => t.completed).length}/{dayTasks.length} · {Math.round(pct)}%
                    </span>
                  )}
                </div>

                {carried.length > 0 && isToday && (
                  <p className="text-[11px] font-medium text-orange-500 mb-1.5 px-0.5">Carried Over</p>
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
                      <p className="text-gray-400 text-[13px]">No tasks yet. Tap + to add your first task.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-6 border-t border-gray-100 dark:border-white/5 space-y-3">
        <h3 className="section-title flex items-center gap-2"><CalendarIcon size={13} /> Meetings</h3>
        <MeetingsPage />
      </div>

      <div className="pt-6 border-t border-gray-100 dark:border-white/5 space-y-3">
        <h3 className="section-title flex items-center gap-2"><MessageSquare size={13} /> Comments</h3>
        <CommentsPage />
      </div>

      <div className="pt-6 border-t border-gray-100 dark:border-white/5 space-y-3">
        <h3 className="section-title flex items-center gap-2"><Megaphone size={13} /> Announcements</h3>
        <AnnouncementsPage />
      </div>

      <div className="pt-6 border-t border-gray-100 dark:border-white/5 space-y-3">
        <h3 className="section-title flex items-center gap-2"><FileText size={13} /> Documents</h3>
        <DocumentsPage />
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
