import { useEffect, useState, useMemo } from 'react';
import Modal from './Modal';
import Avatar from './Avatar';
import { Task, Comment, supabase } from '../lib/supabase';
import { EmployeeWithStats, computeStreakForTasks } from '../lib/company';
import { completionPct } from '../lib/hooks';
import { completionColor, todayStr, dateStr, addDays, formatDateLabel } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { ChevronLeft, ChevronRight, Calendar, Send, MessageSquare } from 'lucide-react';
import { useAuth } from '../lib/auth';
import TaskCard from './TaskCard';

interface Props {
  employee: EmployeeWithStats;
  allTasks: Task[];
  onClose: () => void;
  canComment: boolean;
  defaultDate?: string;
}

export default function EmployeeProfileModal({ employee, allTasks, onClose, canComment, defaultDate }: Props) {
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
      const { data } = await supabase
        .from('comments')
        .select('*, author:profiles!comments_author_id_fkey(*)')
        .eq('target_user_id', employee.id)
        .order('created_at', { ascending: false });
      setComments((data as Comment[]) ?? []);
    };
    loadComments();
  }, [employee.id]);

  const saveComment = async () => {
    if (!commentText.trim() || !profile) return;
    setSaving(true);
    const { data } = await supabase
      .from('comments')
      .insert({
        author_id: profile.id,
        target_user_id: employee.id,
        task_date: selectedDate,
        content: commentText.trim(),
      })
      .select('*, author:profiles!comments_author_id_fkey(*)')
      .single();
    if (data) {
      setComments((prev) => [data as Comment, ...prev]);

      // Send email notification to the target user
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            comment_id: data.id,
            target_user_id: employee.id,
            author_id: profile.id,
            content: commentText.trim(),
            task_date: selectedDate,
          }),
        });
      } catch (e) {
        console.error('Failed to send notification:', e);
      }
    }
    setCommentText('');
    setSaving(false);
  };

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
    <Modal open onClose={onClose} title={employee.full_name} subtitle={employee.department?.name ?? 'No department'} maxWidth="max-w-2xl">
      <div>
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Avatar name={employee.full_name} url={employee.avatar_url} size="xl" />
          <div>
            <p className="text-xs text-gray-400">{streak} day streak · {userTasks.filter((t) => t.completed).length} tasks completed</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-3xl font-bold" style={{ color: completionColor(employee.todayPct) }}>{Math.round(employee.todayPct)}%</p>
            <p className="text-xs text-gray-400">Today</p>
          </div>
        </div>

        {/* Weekly chart */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-2">This Week</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-white/5" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <Tooltip contentStyle={{ borderRadius: 12, border: 'none', background: '#071A35', color: '#fff', fontSize: 12 }} />
              <Bar dataKey="pct" radius={[6, 6, 0, 0]}>
                {weeklyData.map((e, i) => (
                  <Cell key={i} fill={completionColor(e.pct)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Date navigation */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-gray-50 dark:bg-white/5">
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
        </div>

        {/* Tasks for selected date */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Tasks</h3>
            <span className="text-xs text-gray-400">
              {dayTasks.filter((t) => t.completed).length}/{dayTasks.length} completed
              {dayTasks.length > 0 && (
                <span className="ml-2 font-medium" style={{ color: completionColor(completionPct(dayTasks)) }}>
                  · {Math.round(completionPct(dayTasks))}%
                </span>
              )}
            </span>
          </div>
          <div className="space-y-2">
            {dayTasks.length === 0 && (
              <p className="text-sm text-gray-400 py-4 text-center">No tasks for this day.</p>
            )}
            {dayTasks.map((t) => (
              <TaskCard key={t.id} task={t} onToggle={() => {}} showTime={false} />
            ))}
          </div>
        </div>

        {/* Comments for selected date */}
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <MessageSquare size={15} className="text-[#007BFF]" />
            Comments for {formatDateLabel(selectedDate)}
          </h3>
          {canComment && (
            <div className="mb-3">
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
          <div className="space-y-2">
            {dayComments.length === 0 && (
              <p className="text-sm text-gray-400">No comments for this day.</p>
            )}
            {dayComments.map((c) => (
              <div key={c.id} className="card p-3 animate-fade-in">
                <div className="flex items-center gap-2 mb-1">
                  <Avatar name={c.author?.full_name ?? 'User'} size="sm" />
                  <p className="text-sm font-medium">{c.author?.full_name}</p>
                  <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">{c.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
