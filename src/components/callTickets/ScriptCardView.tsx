import { AlertTriangle, ClipboardList, MessageSquareQuote, Send, Phone } from 'lucide-react';
import { ScriptCard } from '../../lib/supabase';

const EMERGENCY_NUMBERS = [
  { n: '112', label: 'Police / general' },
  { n: '113', label: 'Traffic accident' },
  { n: '912', label: 'Ambulance' },
  { n: '111', label: 'Fire & rescue' },
];

// One Script Book situation: what to say, what to do, what to collect,
// and who owns it - laid out so an agent finds the answer in seconds.
export default function ScriptCardView({ card, ownerLabel, compact = false }: { card: ScriptCard; ownerLabel?: string | null; compact?: boolean }) {
  const emergency = card.default_priority === 'emergency';
  return (
    <div className={`space-y-3 ${compact ? '' : ''}`}>
      {emergency && (
        <div className="rounded-lg bg-red-600 text-white p-3 space-y-2">
          <p className="text-small font-bold flex items-center gap-1.5"><AlertTriangle size={14} /> Safety comes first — public emergency help before anything else.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {EMERGENCY_NUMBERS.map((e) => (
              <a key={e.n} href={`tel:${e.n}`} className="rounded-md bg-white/15 hover:bg-white/25 px-2 py-1.5 text-center">
                <span className="block text-title font-bold">{e.n}</span>
                <span className="block text-micro opacity-90">{e.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {card.say && (
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle mb-1 flex items-center gap-1"><MessageSquareQuote size={11} /> Say</p>
          <p className="text-body leading-relaxed border-l-[3px] border-brand bg-brand/5 rounded-r-md px-3 py-2">“{card.say}”</p>
        </div>
      )}

      {card.steps.length > 0 && (
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle mb-1 flex items-center gap-1"><Phone size={11} /> Do</p>
          <ol className="space-y-1">
            {card.steps.map((s, i) => (
              <li key={i} className="text-small flex gap-2">
                <span className="w-4 h-4 rounded-full bg-inset text-micro font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {card.collect.length > 0 && (
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle mb-1 flex items-center gap-1"><ClipboardList size={11} /> Collect</p>
          <ul className="space-y-0.5">
            {card.collect.map((c, i) => <li key={i} className="text-small flex gap-1.5"><span className="text-brand-600 dark:text-brand-300">•</span>{c}</li>)}
          </ul>
        </div>
      )}

      {ownerLabel !== undefined && (
        <p className="text-caption text-fg-muted flex items-center gap-1.5 pt-1 border-t border-line-muted ">
          <Send size={11} /> {card.owner_duty ? <>Owner: <b className="text-fg-muted ">{ownerLabel ?? 'not set'}</b></> : 'Usually solved on the call'}
        </p>
      )}
    </div>
  );
}
