import { Check, Trash2, Clock, CheckCircle2, ChevronRight } from 'lucide-react';
import { Task, ReviewStatus } from '../lib/supabase';
import { formatTime } from '../lib/utils';

interface TaskCardProps {
  task: Task;
  onToggle: (task: Task) => void;
  onDelete?: (task: Task) => void;
  showTime?: boolean;
  onClick?: (task: Task) => void;
  reviewMode?: boolean;
}

const statusConfig: Record<ReviewStatus, { label: string; color: string; bgColor: string }> = {
  completed: { label: 'Completed', color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-500/10' },
  in_progress: { label: 'In Progress', color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-500/10' },
  not_done: { label: 'Not Done', color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-500/10' },
};

export default function TaskCard({ task, onToggle, onDelete, showTime = true, onClick, reviewMode = false }: TaskCardProps) {
  const createdTime = new Date(task.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const completedTime = task.completed_at
    ? new Date(task.completed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null;
  const displayTime = completedTime ?? createdTime;

  const reviewBadge = task.review_status ? (
    <span className={`text-[9px] font-medium px-2 py-0.5 rounded ${statusConfig[task.review_status].bgColor} ${statusConfig[task.review_status].color}`}>
      {statusConfig[task.review_status].label}
    </span>
  ) : null;

  const handleClick = () => {
    if (onClick) {
      onClick(task);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(task);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(task);
  };

  const isClickable = !!onClick;

  return (
    <div
      onClick={handleClick}
      className={`group flex items-center gap-2.5 p-3 rounded-xl border transition-all duration-300 animate-fade-in ${
        task.completed
          ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5'
          : 'border-gray-200 dark:border-white/10 bg-white dark:bg-navy-800 hover:border-brand/40 hover:shadow-sm'
      } ${isClickable ? 'cursor-pointer' : ''}`}
    >
      <button
        onClick={handleToggle}
        aria-label={task.completed ? 'Mark as incomplete' : 'Mark as complete'}
        className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 active:scale-90 ${
          task.completed
            ? 'bg-green-500 border-green-500 animate-check'
            : 'border-gray-300 dark:border-white/20 hover:border-brand hover:scale-110'
        }`}
      >
        {task.completed ? (
          <Check size={13} className="text-white" strokeWidth={3.5} />
        ) : (
          <span className="w-2 h-2 rounded-full bg-transparent group-hover:bg-brand/20 transition-colors" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`text-[12px] transition-all duration-300 ${
            task.completed ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100'
          }`}
        >
          {task.title}
        </p>
        {task.description && !task.completed && (
          <p className="text-xs mt-0.5 text-gray-500 dark:text-gray-400">
            {task.description}
          </p>
        )}
        {task.review_note && (
          <p className="text-xs mt-1 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-white/5 p-1.5 rounded">
            {task.review_note}
          </p>
        )}
        {showTime && (
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {task.is_carried_over && (
              <span className="text-[9px] font-medium text-orange-500 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded">
                Carried Over
              </span>
            )}
            {reviewBadge}
            {task.completed ? (
              <span className="flex items-center gap-1 text-[10px] text-green-500">
                <CheckCircle2 size={11} />
                Done at {formatTime(new Date(task.completed_at!)).slice(0, 5)}
              </span>
            ) : !reviewMode && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <Clock size={11} />
                {displayTime}
              </span>
            )}
          </div>
        )}
      </div>

      {reviewMode && !task.review_status && (
        <div className="flex items-center gap-1 text-brand-500">
          <span className="text-xs font-medium">Review</span>
          <ChevronRight size={16} />
        </div>
      )}

      {onDelete && (
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-gray-400 hover:text-red-500"
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}
