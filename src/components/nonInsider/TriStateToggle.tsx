// Survey fields (is_owner, is_branded, allows_branding) start out unknown,
// not false - "No" is a real answer that has to come from the survey too,
// so this needs three states, not a checkbox.
export default function TriStateToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  disabled?: boolean;
}) {
  const options: { key: boolean | null; label: string }[] = [
    { key: null, label: 'Unknown' },
    { key: true, label: 'Yes' },
    { key: false, label: 'No' },
  ];

  return (
    <div>
      <label className="block text-caption font-medium mb-1.5 text-fg-muted">{label}</label>
      <div className="flex gap-1 p-0.5 bg-inset rounded-lg w-fit">
        {options.map((o) => (
          <button
            key={String(o.key)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.key)}
            className={`px-2.5 py-1 rounded-md text-micro font-medium transition-all disabled:opacity-60 ${
              value === o.key ? 'bg-surface-2 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-fg-muted'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
