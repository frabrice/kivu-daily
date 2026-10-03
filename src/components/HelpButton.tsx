import { useState } from 'react';
import { HelpCircle, Lightbulb } from 'lucide-react';
import type { NavKey } from './AppShell';
import { HELP_CONTENT } from '../lib/helpContent';
import Modal from './Modal';

// "How this works" - opens this page's How to Use entry in place, so
// nobody has to leave what they're doing to find the instructions.
export default function HelpButton({ navKey, title }: { navKey: NavKey; title: string }) {
  const [open, setOpen] = useState(false);
  const entry = HELP_CONTENT[navKey];
  if (!entry) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost flex items-center gap-1.5 text-[12px] whitespace-nowrap" aria-label={`How ${title} works`}>
        <HelpCircle size={14} /> How this works
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`How ${title} works`} subtitle={entry.blurb} maxWidth="max-w-lg">
          <div className="space-y-4">
            {entry.sections.map((s) => (
              <section key={s.heading}>
                <h3 className="text-[12px] font-semibold mb-1.5">{s.heading}</h3>
                <div className="space-y-1.5">
                  {s.body.map((b, i) => <p key={i} className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed">{b}</p>)}
                </div>
              </section>
            ))}
            {entry.tips.length > 0 && (
              <div className="rounded-lg bg-amber-50/70 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/20 p-3 space-y-1">
                {entry.tips.map((t, i) => <p key={i} className="text-[11px] text-amber-900 dark:text-amber-200 flex gap-1.5"><Lightbulb size={12} className="shrink-0 mt-0.5" /> {t}</p>)}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
