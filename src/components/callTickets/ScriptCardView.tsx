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
          <p className="text-[12px] font-bold flex items-center gap-1.5"><AlertTriangle size={14} /> Safety comes first — public emergency help before anything else.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {EMERGENCY_NUMBERS.map((e) => (
              <a key={e.n} href={`tel:${e.n}`} className="rounded-md bg-white/15 hover:bg-white/25 px-2 py-1.5 text-center">
                <span className="block text-[15px] font-bold">{e.n}</span>
                <span className="block text-[10px] opacity-90">{e.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {card.say && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><MessageSquareQuote size={11} /> Say</p>
          <p className="text-[13px] leading-relaxed border-l-[3px] border-brand bg-brand/5 rounded-r-md px-3 py-2">“{card.say}”</p>
        </div>
      )}

      {card.steps.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Phone size={11} /> Do</p>
          <ol className="space-y-1">
            {card.steps.map((s, i) => (
              <li key={i} className="text-[12px] flex gap-2">
                <span className="w-4 h-4 rounded-full bg-gray-100 dark:bg-white/10 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {card.collect.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><ClipboardList size={11} /> Collect</p>
          <ul className="space-y-0.5">
            {card.collect.map((c, i) => <li key={i} className="text-[12px] flex gap-1.5"><span className="text-brand-600 dark:text-brand-300">•</span>{c}</li>)}
          </ul>
        </div>
      )}

      {ownerLabel !== undefined && (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5 pt-1 border-t border-gray-100 dark:border-white/5">
          <Send size={11} /> {card.owner_duty ? <>Owner: <b className="text-gray-700 dark:text-gray-200">{ownerLabel ?? 'not set'}</b></> : 'Usually solved on the call'}
        </p>
      )}
    </div>
  );
}
