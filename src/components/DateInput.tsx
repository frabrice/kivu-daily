import { useRef } from 'react';
import { CalendarDays } from 'lucide-react';

function formatDMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

// Native <input type="date"> always displays in the browser's own locale
// (mm/dd/yyyy under en-US) - not something HTML/CSS can override, even via
// the lang attribute (verified empirically). Rwanda reads dates day-first,
// so this shows a dd/mm/yyyy label instead and opens the real native
// calendar (via showPicker()) on click - rather than overlaying an
// invisible native input for direct typing, since its segments are still
// laid out mm/dd/yyyy internally and would land on the wrong digit group
// the moment our label reorders day before month.
export default function DateInput({
  value,
  onChange,
  disabled,
  wrapperClassName = '',
  placeholder = 'dd/mm/yyyy',
  max,
  min,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Layout-only classes (margin, etc) for the outer wrapper - the visible box always uses the standard .input look. */
  wrapperClassName?: string;
  placeholder?: string;
  max?: string;
  min?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const open = () => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    if (typeof (el as unknown as { showPicker?: () => void }).showPicker === 'function') {
      try {
        (el as unknown as { showPicker: () => void }).showPicker();
        return;
      } catch {
        // falls through to focus()
      }
    }
    el.focus();
  };

  return (
    <div className={`relative ${wrapperClassName}`}>
      <button
        type="button"
        onClick={open}
        disabled={disabled}
        className="input flex items-center justify-between gap-1.5 text-left disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className={value ? '' : 'text-gray-400'}>{value ? formatDMY(value) : placeholder}</span>
        <CalendarDays size={13} className="text-gray-400 shrink-0" />
      </button>
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        max={max}
        min={min}
        autoFocus={autoFocus}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
      />
    </div>
  );
}
