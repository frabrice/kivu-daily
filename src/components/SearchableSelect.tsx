import { useState } from 'react';
import { X, ChevronDown } from 'lucide-react';

export interface SearchableOption {
  id: string;
  label: string;
  sublabel?: string;
}

// A plain <select> can't be typed-into to filter a long list by name -
// this is a lightweight combobox for exactly that: type to filter,
// click an option to pick it, an x to clear. Options render via
// onMouseDown (not onClick) so the click registers before the input's
// onBlur closes the list.
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  emptyLabel = 'No matches',
  disabled,
}: {
  options: SearchableOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div className="relative">
      <div className="relative">
        <input
          value={open ? query : (selected?.label ?? '')}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setQuery(''); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder={placeholder}
          className="input pr-7"
        />
        {selected && !open ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500"
            tabIndex={-1}
          >
            <X size={13} />
          </button>
        ) : (
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto card border border-gray-200 dark:border-white/10 shadow-lg py-1">
          {filtered.length === 0 ? (
            <p className="text-[11px] text-gray-400 px-3 py-2">{emptyLabel}</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(o.id); setQuery(''); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                {o.label}
                {o.sublabel && <span className="text-gray-400 text-[10px]"> · {o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
