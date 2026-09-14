import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  subtitle?: string;
  maxWidth?: string;
}

const WIDTH_MAP: Record<string, string> = {
  'max-w-md': 'sm:w-[56vw] sm:min-w-[460px]',
  'max-w-lg': 'sm:w-[60vw] sm:min-w-[520px]',
  'max-w-xl': 'sm:w-[66vw] sm:min-w-[580px]',
  'max-w-2xl': 'sm:w-[72vw] sm:min-w-[640px]',
};

export default function Modal({ open, onClose, children, title, subtitle, maxWidth = 'max-w-md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = WIDTH_MAP[maxWidth] ?? WIDTH_MAP['max-w-lg'];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className={`relative w-full ${width} h-full bg-white dark:bg-navy-900 shadow-2xl flex flex-col animate-slide-in-right`}>
        {title && (
          <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 dark:border-white/5 shrink-0">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold truncate">{title}</h2>
              {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="btn-ghost p-1.5 -mr-1.5 shrink-0">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
