import { Check, Trash2, Clock, CheckCircle2, ChevronRight, Zap } from 'lucide-react';
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
    <span className={`text-micro font-medium px-2 py-0.5 rounded ${statusConfig[task.review_status].bgColor} ${statusConfig[task.review_status].color}`}>
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
          : 'border-line bg-surface-2 hover:border-brand/40 hover:shadow-sm'
      } ${isClickable ? 'cursor-pointer' : ''}`}
    >
      <button
        onClick={handleToggle}
        aria-label={task.completed ? 'Mark as incomplete' : 'Mark as complete'}
        className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 active:scale-90 ${
          task.completed
            ? 'bg-green-500 border-green-500 animate-check'
            : 'border-line hover:border-brand hover:scale-110'
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
          className={`text-small transition-all duration-300 ${
            task.completed ? 'line-through text-fg-subtle ' : 'text-fg '
          }`}
        >
          {task.title}
        </p>
        {task.smart_key ? <SmartDetails task={task} /> : task.description && !task.completed && (
          <p className="text-xs mt-0.5 text-fg-muted ">
            {task.description}
          </p>
        )}
        {task.review_note && (
          <p className="text-xs mt-1 text-fg-muted bg-inset p-1.5 rounded">
            {task.review_note}
          </p>
        )}
        {showTime && (
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {task.is_carried_over && (
              <span className="text-micro font-medium text-orange-500 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded">
                Carried Over
              </span>
            )}
            {task.priority === 'high' && !task.completed && (
              <span className="text-micro font-semibold text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-500/10 px-1.5 py-0.5 rounded">Urgent</span>
            )}
            {task.smart_key && (
              <span className="text-micro font-medium text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-500/10 px-1.5 py-0.5 rounded flex items-center gap-0.5" title="Created from live data; ticks itself off as the work gets done">
                <Zap size={9} /> Updates itself{task.due_time ? ` · by ${task.due_time}` : ''}
              </span>
            )}
            {task.recurring_task_id && (
              <span className="text-micro font-medium text-teal-700 bg-teal-50 dark:text-teal-300 dark:bg-teal-500/10 px-1.5 py-0.5 rounded">
                Standing duty{task.due_time ? ` · by ${task.due_time}` : ''}
              </span>
            )}
            {reviewBadge}
            {task.completed ? (
              <span className="flex items-center gap-1 text-micro text-green-500">
                <CheckCircle2 size={11} />
                {task.auto_completed ? 'Done automatically' : 'Done'} at {formatTime(new Date(task.completed_at!)).slice(0, 5)}
              </span>
            ) : !reviewMode && (
              <span className="flex items-center gap-1 text-micro text-fg-subtle">
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

      {onDelete && !task.smart_key && (
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-fg-subtle hover:text-red-500"
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

// What a smart task covers: progress, then each item (done ones ticked).
function SmartDetails({ task }: { task: Task }) {
  const items = task.smart_items ?? [];
  const total = task.smart_total ?? items.length;
  const done = task.smart_done ?? items.filter((i) => i.done).length;
  const intro = (task.description ?? '').split('\n')[0];
  return (
    <div className="mt-1 space-y-1.5">
      {intro && !task.completed && <p className="text-caption text-fg-muted ">{intro}</p>}
      {total > 1 && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 max-w-[180px] rounded-full bg-inset overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((done / Math.max(total, 1)) * 100)}%` }} />
          </div>
          <span className="text-micro text-fg-muted tabular-nums">{done}/{total}</span>
        </div>
      )}
      {items.length > 0 && (
        <ul className="space-y-0.5">
          {[...items].sort((a, b) => Number(a.done) - Number(b.done)).slice(0, 12).map((i) => (
            <li key={i.id} className={`text-caption flex gap-1.5 ${i.done ? 'text-fg-subtle line-through' : 'text-fg-muted '}`}>
              <span className={i.done ? 'text-green-500' : 'text-fg-subtle'}>{i.done ? '✓' : '•'}</span>
              <span>{i.label}{i.detail && <span className="text-fg-muted "> — {i.detail}</span>}</span>
            </li>
          ))}
          {items.length > 12 && <li className="text-micro text-fg-subtle">+ {items.length - 12} more</li>}
        </ul>
      )}
    </div>
  );
}
