import { Eye, Pencil } from 'lucide-react';

interface EntryActionsProps {
  onView: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
}

// Explicit View + Edit affordances for a list/table row, so an entry never
// depends on the user guessing that clicking it does one or the other.
export default function EntryActions({ onView, onEdit, canEdit = false }: EntryActionsProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
      <button onClick={onView} title="View" className="btn-ghost p-1.5">
        <Eye size={13} />
      </button>
      {canEdit && onEdit && (
        <button onClick={onEdit} title="Edit" className="btn-ghost p-1.5">
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}
