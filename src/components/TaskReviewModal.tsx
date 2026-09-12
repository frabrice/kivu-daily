import { useState, useEffect } from 'react';
import Modal from './Modal';
import { Task, ReviewStatus, supabase } from '../lib/supabase';
import { CheckCircle2, Clock, XCircle, AlertCircle, Loader2, History, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDateLabel, dateStr, addDays } from '../lib/utils';

interface TaskReviewModalProps {
  open: boolean;
  onClose: () => void;
  task: Task;
  onReviewed: () => void;
}

export default function TaskReviewModal({ open, onClose, task, onReviewed }: TaskReviewModalProps) {
  const [status, setStatus] = useState<ReviewStatus | null>(task.review_status);
  const [note, setNote] = useState(task.review_note || '');
  const [showNoteInput, setShowNoteInput] = useState(!!task.review_note);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ date: string; review_status: ReviewStatus; review_note: string | null }[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (open && task.is_carried_over && task.parent_task_id) {
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
  }, [open, task.is_carried_over, task.parent_task_id]);

  useEffect(() => {
    if (!open) {
      setStatus(task.review_status);
      setNote(task.review_note || '');
      setShowNoteInput(!!task.review_note);
      setHistory([]);
    }
  }, [open, task.review_status, task.review_note]);

  const handleSubmit = async () => {
    if (!status) return;
    if ((status === 'in_progress' || status === 'not_done') && !note.trim()) return;

    setLoading(true);

    const completed = status === 'completed';
    const reviewedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        review_status: status,
        review_note: note.trim() || null,
        reviewed_at: reviewedAt,
        completed,
        completed_at: completed ? reviewedAt : null,
      })
      .eq('id', task.id);

    if (updateError) {
      setLoading(false);
      return;
    }

    if (status === 'in_progress' || status === 'not_done') {
      const tomorrowDate = dateStr(addDays(new Date(), 1));

      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', task.user_id)
        .eq('title', task.title)
        .eq('date', tomorrowDate);

      if (!existingTasks || existingTasks.length === 0) {
        await supabase.from('tasks').insert({
          user_id: task.user_id,
          title: task.title,
          description: task.description,
          date: tomorrowDate,
          is_carried_over: true,
          original_date: task.date,
          parent_task_id: task.id,
        });
      }
    }

    setLoading(false);
    onReviewed();
    onClose();
  };

  const statusOptions: { value: ReviewStatus; label: string; icon: typeof CheckCircle2; color: string; bgColor: string; borderColor: string }[] = [
    { value: 'completed', label: 'Completed', icon: CheckCircle2, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-500/10', borderColor: 'border-green-300 dark:border-green-500/30' },
    { value: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-500/10', borderColor: 'border-blue-300 dark:border-blue-500/30' },
    { value: 'not_done', label: 'Not Done', icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-500/10', borderColor: 'border-red-300 dark:border-red-500/30' },
  ];

  const cannotSubmit = !status ||
    ((status === 'in_progress' || status === 'not_done') && !note.trim());

  return (
    <Modal open={open} onClose={onClose} title="Review Task" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/5">
          <p className="font-medium text-gray-800 dark:text-gray-100">{task.title}</p>
          {task.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{task.description}</p>
          )}
          {task.is_carried_over && (
            <span className="inline-block text-xs font-medium text-orange-500 bg-orange-50 dark:bg-orange-500/10 px-2 py-0.5 rounded mt-2">
              Carried over from {formatDateLabel(task.original_date || task.date)}
            </span>
          )}
        </div>

        {history.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <History size={16} />
              <span>Task History ({history.length})</span>
              {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showHistory && (
              <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                {history.map((h, idx) => (
                  <div key={`${h.date}-${idx}`} className="p-2.5 rounded-lg bg-gray-100 dark:bg-white/5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-300">{formatDateLabel(h.date)}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        h.review_status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400' :
                        h.review_status === 'in_progress' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                        'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400'
                      }`}>
                        {h.review_status === 'completed' ? 'Completed' : h.review_status === 'in_progress' ? 'In Progress' : 'Not Done'}
                      </span>
                    </div>
                    {h.review_note && <p className="text-gray-500 dark:text-gray-400 mt-1 text-xs">{h.review_note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Select Status</p>
          <div className="space-y-2">
            {statusOptions.map((opt) => {
              const Icon = opt.icon;
              const isSelected = status === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    setStatus(opt.value);
                    if (opt.value === 'completed') {
                      setShowNoteInput(false);
                    } else {
                      setShowNoteInput(true);
                    }
                  }}
                  className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all ${
                    isSelected
                      ? `${opt.bgColor} ${opt.borderColor}`
                      : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isSelected ? opt.bgColor : 'bg-gray-100 dark:bg-white/5'}`}>
                    <Icon size={18} className={isSelected ? opt.color : 'text-gray-400'} />
                  </div>
                  <span className={`font-medium ${isSelected ? opt.color : 'text-gray-700 dark:text-gray-200'}`}>
                    {opt.label}
                  </span>
                  {isSelected && (
                    <div className={`ml-auto w-5 h-5 rounded-full flex items-center justify-center ${opt.bgColor}`}>
                      <Icon size={14} className={opt.color} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {status === 'completed' && !showNoteInput && (
          <button
            onClick={() => setShowNoteInput(true)}
            className="text-sm text-[#007BFF] hover:underline"
          >
            + Add an optional note
          </button>
        )}

        {(showNoteInput || status === 'in_progress' || status === 'not_done') && status && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {status === 'completed' ? 'Note (optional)' : status === 'in_progress' ? 'Progress Description' : 'Explanation'}
              </p>
              {(status === 'in_progress' || status === 'not_done') && (
                <span className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={12} /> Required
                </span>
              )}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                status === 'completed' ? 'Add a note about this task (optional)' :
                status === 'in_progress' ? 'Describe the current progress and what remains to be done...' :
                'Explain why this task was not completed...'
              }
              rows={3}
              className="input resize-none"
            />
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || cannotSubmit}
            className="btn-primary disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? 'Saving…' : 'Submit Review'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
