import { useEffect, useState, useMemo } from 'react';
import Avatar from '../components/Avatar';
import { Task, Comment, ReviewStatus, supabase } from '../lib/supabase';
import { EmployeeWithStats, computeStreakForTasks } from '../lib/company';
import { completionPct } from '../lib/hooks';
import { completionColor, todayStr, dateStr, addDays, formatDateLabel } from '../lib/utils';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';
import { ChevronLeft, ChevronRight, Calendar, Send, MessageSquare, ArrowLeft, Flame, FileText, History, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../lib/auth';

interface Props {
  employee: EmployeeWithStats;
  allTasks: Task[];
  onBack: () => void;
  canComment: boolean;
  defaultDate?: string;
}

export default function EmployeeProfilePage({ employee, allTasks, onBack, canComment, defaultDate }: Props) {
  const { profile } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(defaultDate ?? todayStr());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const userTasks = useMemo(() => allTasks.filter((t) => t.user_id === employee.id), [allTasks, employee.id]);
  const streak = computeStreakForTasks(userTasks);

  useEffect(() => {
    const loadComments = async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:profiles!comments_author_id_fkey(*)')
        .eq('target_user_id', employee.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading employee comments:', error);
      } else {
        setComments((data as Comment[]) ?? []);
      }
    };
    loadComments();
  }, [employee.id]);

  const saveComment = async () => {
    if (!commentText.trim() || !profile) {
      console.log('Cannot save: commentText=', commentText.trim(), 'profile=', profile);
      return;
    }
    setSaving(true);

    const insertData = {
      author_id: profile.id,
      target_user_id: employee.id,
      task_date: selectedDate,
      content: commentText.trim(),
    };

    console.log('Attempting to insert comment:', insertData);

    const { data, error } = await supabase
      .from('comments')
      .insert(insertData)
      .select('*, author:profiles!comments_author_id_fkey(*)')
      .single();

    if (error) {
      console.error('Error saving comment:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      alert('Failed to save comment: ' + error.message);
      setSaving(false);
      return;
    }

    console.log('Comment saved successfully:', data);
    if (data) {
      setComments((prev) => [data as Comment, ...prev]);
      setCommentText('');
    }
    setSaving(false);
  };

  useEffect(() => {
    if (!employee.id) return;
    const channel = supabase
      .channel(`employee-comments-${employee.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `target_user_id=eq.${employee.id}` }, () => {
        supabase
          .from('comments')
          .select('*, author:profiles!comments_author_id_fkey(*)')
          .eq('target_user_id', employee.id)
          .order('created_at', { ascending: false })
          .then(({ data }) => {
            if (data) setComments(data as Comment[]);
          });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [employee.id]);

  const goPrevDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    setSelectedDate(dateStr(addDays(d, -1)));
  };
  const goNextDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    const next = dateStr(addDays(d, 1));
    if (next <= todayStr()) setSelectedDate(next);
  };
  const isToday = selectedDate === todayStr();

  const dayTasks = useMemo(
    () => userTasks
      .filter((t) => t.date === selectedDate)
      .sort((a, b) => Number(a.completed) - Number(b.completed)),
    [userTasks, selectedDate]
  );

  const dayComments = useMemo(
    () => comments.filter((c) => c.task_date === selectedDate),
    [comments, selectedDate]
  );

  const weeklyData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const ds = dateStr(d);
      const dayTasks = userTasks.filter((t) => t.date === ds);
      days.push({ day: d.toLocaleDateString('en-US', { weekday: 'short' }), pct: Math.round(completionPct(dayTasks)) });
    }
    return days;
  }, [userTasks]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back button */}
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
        <ArrowLeft size={18} />
        Back to Dashboard
      </button>

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-center gap-5">
          <Avatar name={employee.full_name} url={employee.avatar_url} size="xl" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{employee.full_name}</h1>
            <p className="text-sm text-gray-500">{employee.department?.name ?? 'No department'}</p>
            <div className="flex items-center gap-4 mt-2">
              <span className="flex items-center gap-1 text-xs text-orange-500 font-medium">
                <Flame size={14} />
                {streak} day streak
              </span>
              <span className="text-xs text-gray-400">
                {userTasks.filter((t) => t.completed).length} total tasks completed
              </span>
              {!employee.is_active && (
                <span className="text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
                  Inactive
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold" style={{ color: completionColor(employee.todayPct) }}>{Math.round(employee.todayPct)}%</p>
            <p className="text-xs text-gray-400">Today's Completion</p>
          </div>
        </div>
      </div>

      {/* Stats + Weekly chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-3">This Week</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-white/5" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#9ca3af" width={28} />
              <Tooltip contentStyle={{ borderRadius: 12, border: 'none', background: '#071A35', color: '#fff', fontSize: 12 }} />
              <Line type="monotone" dataKey="pct" stroke="#007BFF" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-3">Quick Stats</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Tasks Today</span>
              <span className="text-lg font-bold">{employee.todayTotal}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Completed Today</span>
              <span className="text-lg font-bold text-green-500">{employee.todayCompleted}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Current Streak</span>
              <span className="text-lg font-bold text-orange-500">{streak} days</span>
            </div>
          </div>
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-gray-50 dark:bg-white/5 max-w-md">
        <button onClick={goPrevDay} className="btn-ghost p-2" aria-label="Previous day">
          <ChevronLeft size={20} />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowDatePicker((v) => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            <Calendar size={16} className="text-[#007BFF]" />
            <span className="text-sm font-semibold">{formatDateLabel(selectedDate)}</span>
          </button>
          {showDatePicker && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-10 card p-2 animate-fade-in">
              <input
                type="date"
                value={selectedDate}
                max={todayStr()}
                onChange={(e) => { if (e.target.value) { setSelectedDate(e.target.value); setShowDatePicker(false); } }}
                className="input text-sm py-1.5"
                autoFocus
              />
            </div>
          )}
        </div>
        <button onClick={goNextDay} disabled={isToday} className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Next day">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Tasks for selected date */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Tasks for {formatDateLabel(selectedDate)}</h3>
          <span className="text-sm text-gray-400">
            {dayTasks.filter((t) => t.completed).length}/{dayTasks.length} completed
            {dayTasks.length > 0 && (
              <span className="ml-2 font-medium" style={{ color: completionColor(completionPct(dayTasks)) }}>
                {' '}&middot; {Math.round(completionPct(dayTasks))}%
              </span>
            )}
          </span>
        </div>
        <div className="space-y-2">
          {dayTasks.length === 0 && (
            <div className="card p-8 text-center">
              <p className="text-sm text-gray-400">No tasks for this day.</p>
            </div>
          )}
          {dayTasks.map((t) => (
            <TaskDetailCard key={t.id} task={t} />
          ))}
        </div>
      </div>

      {/* Comments for selected date */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <MessageSquare size={18} className="text-[#007BFF]" />
          Comments for {formatDateLabel(selectedDate)}
        </h3>
        {canComment && (
          <div className="mb-4">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={`Leave a comment for ${employee.full_name.split(' ')[0]} about ${formatDateLabel(selectedDate)}…`}
              rows={3}
              className="input resize-none mb-2"
            />
            <button onClick={saveComment} disabled={saving || !commentText.trim()} className="btn-primary disabled:opacity-50 flex items-center gap-2">
              <Send size={15} />
              {saving ? 'Saving…' : 'Post Comment'}
            </button>
          </div>
        )}
        <div className="space-y-3">
          {dayComments.length === 0 && (
            <p className="text-sm text-gray-400">No comments for this day.</p>
          )}
          {dayComments.map((c) => (
            <div key={c.id} className="card p-4 animate-fade-in">
              <div className="flex items-center gap-3 mb-2">
                <Avatar name={c.author?.full_name ?? 'User'} url={c.author?.avatar_url} size="md" />
                <div>
                  <p className="text-sm font-semibold">{c.author?.full_name}</p>
                  <p className="text-xs text-gray-400 capitalize">{c.author?.role === 'managing_director' ? 'Managing Director' : c.author?.role}</p>
                </div>
                <span className="ml-auto text-xs text-gray-400">
                  {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{c.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const statusConfig: Record<ReviewStatus, { label: string; color: string; bgColor: string }> = {
  completed: { label: 'Completed', color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-500/10' },
  in_progress: { label: 'In Progress', color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-500/10' },
  not_done: { label: 'Not Done', color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-500/10' },
};

function TaskDetailCard({ task }: { task: Task }) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<{ date: string; review_status: ReviewStatus; review_note: string | null }[]>([]);

  useEffect(() => {
    if (task.is_carried_over && task.parent_task_id) {
      const loadHistory = async () => {
        const chainHistory: { date: string; review_status: ReviewStatus; review_note: string | null }[] = [];
        let currentId: string | null = task.parent_task_id;

        while (currentId) {
          const { data } = await supabase
            .from('tasks')
            .select('id, date, review_status, review_note, parent_task_id')
            .eq('id', currentId)
            .single();

          if (data && data.review_status) {
            chainHistory.push({
              date: data.date,
              review_status: data.review_status as ReviewStatus,
              review_note: data.review_note,
            });
          }
          currentId = data?.parent_task_id || null;
        }

        setHistory(chainHistory);
      };
      loadHistory();
    }
  }, [task.is_carried_over, task.parent_task_id]);

  return (
    <div className={`group flex flex-col gap-2 p-3.5 rounded-2xl border transition-all duration-300 ${
      task.review_status === 'completed'
        ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5'
        : task.review_status === 'in_progress'
        ? 'border-blue-300 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5'
        : task.review_status === 'not_done'
        ? 'border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
        : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1f3a]'
    }`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${
            task.completed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100'
          }`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{task.description}</p>
          )}
        </div>
        {task.review_status && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusConfig[task.review_status].bgColor} ${statusConfig[task.review_status].color}`}>
            {statusConfig[task.review_status].label}
          </span>
        )}
      </div>

      {task.review_note && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-white/5">
          <FileText size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Employee Note:</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{task.review_note}</p>
          </div>
        </div>
      )}

      {task.is_carried_over && history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <History size={14} />
            <span>View history ({history.length})</span>
            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showHistory && (
            <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto">
              {history.map((h, idx) => (
                <div key={`${h.date}-${idx}`} className="p-2 rounded-lg bg-gray-100 dark:bg-white/5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{formatDateLabel(h.date)}</span>
                    <span className={`font-medium px-1.5 py-0.5 rounded ${statusConfig[h.review_status].bgColor} ${statusConfig[h.review_status].color}`}>
                      {statusConfig[h.review_status].label}
                    </span>
                  </div>
                  {h.review_note && <p className="text-gray-500 dark:text-gray-400 mt-1">{h.review_note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
