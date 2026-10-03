import { useMemo, useState } from 'react';
import HelpButton from '../../components/HelpButton';
import { BookOpen, Search, Plus, Pencil, Pin } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase, ScriptCard } from '../../lib/supabase';
import { useScriptCards, useDuties } from '../../lib/callTickets';
import ScriptCardView from '../../components/callTickets/ScriptCardView';
import Modal from '../../components/Modal';

// The Call Center Script Book, in the app: every situation from the book
// as a card (what to say / do / collect / who owns it). Quick-reference
// cards are pinned on top. Built for the book's three-second rule - type
// a word, see the answer. Only the MD edits cards.
export default function ScriptBookPage() {
  const { profile } = useAuth();
  const isMD = profile?.role === 'managing_director';
  const { cards, loading, reload } = useScriptCards();
  const duties = useDuties();
  const [q, setQ] = useState('');
  const [section, setSection] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptCard | 'new' | null>(null);

  const sections = useMemo(() => {
    const seen = new Map<string, { key: string; title: string; order: number; count: number }>();
    for (const c of cards.filter((x) => !x.is_quick)) {
      const s = seen.get(c.section_key) ?? { key: c.section_key, title: c.section_title, order: c.section_order, count: 0 };
      s.count++;
      seen.set(c.section_key, s);
    }
    return [...seen.values()].sort((a, b) => a.order - b.order);
  }, [cards]);

  const needle = q.trim().toLowerCase();
  const matches = (c: ScriptCard) => !needle || [c.situation, c.say ?? '', c.section_title, ...c.steps, ...c.collect].some((t) => t.toLowerCase().includes(needle));
  const quick = cards.filter((c) => c.is_quick && matches(c));
  const shown = cards.filter((c) => !c.is_quick && (section === 'all' || c.section_key === section) && matches(c));
  const ownerLabel = (c: ScriptCard) => (c.owner_duty ? duties[c.owner_duty]?.label ?? c.owner_duty : null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><BookOpen size={16} className="text-brand-600 dark:text-brand-300" /> Script Book</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Find the situation, see what to say and do, and who owns it. Kivu Ride Call Center Script Book v1.0.</p>
        </div>
        <div className="flex gap-2">
          <HelpButton navKey="call_center_scripts" title="the Script Book" />
          {isMD && <button onClick={() => setEditing('new')} className="btn-primary flex items-center gap-1.5"><Plus size={14} /> Add card</button>}
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-9 text-[13px]" placeholder='Type a word — "late", "refund", "breakdown", "lost", "login"…' aria-label="Search the Script Book" autoFocus />
      </div>

      {quick.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1"><Pin size={11} /> Quick reference</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            {quick.map((c) => (
              <button key={c.id} onClick={() => setOpenId(c.id)} className={`card p-3 text-left hover:border-brand/30 transition-all ${c.default_priority === 'emergency' ? 'border-red-300 dark:border-red-500/40' : ''}`}>
                <p className={`text-[12px] font-semibold ${c.default_priority === 'emergency' ? 'text-red-600 dark:text-red-400' : ''}`}>{c.situation}</p>
                <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{c.say ?? c.steps[0] ?? ''}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Sections">
        <SectionChip active={section === 'all'} onClick={() => setSection('all')} label="All" />
        {sections.map((s) => <SectionChip key={s.key} active={section === s.key} onClick={() => setSection(s.key)} label={s.title} emergency={s.key === 'emergency'} />)}
      </div>

      {shown.length === 0 ? (
        <div className="card p-10 text-center text-[12px] text-gray-400">Nothing matches "{q}". Try another word, or say: “Let me confirm the correct information for you.”</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {shown.map((c) => (
            <div key={c.id} className={`card p-4 ${c.default_priority === 'emergency' ? 'border-red-300 dark:border-red-500/40' : ''} ${!c.approved ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{c.section_title}</p>
                  <p className="text-[13px] font-semibold">{c.situation}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.default_priority !== 'normal' && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded text-white ${c.default_priority === 'emergency' ? 'bg-red-700' : 'bg-red-500'}`}>{c.default_priority.toUpperCase()}</span>
                  )}
                  {!c.approved && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-white/5">Draft</span>}
                  {isMD && <button onClick={() => setEditing(c)} className="btn-ghost p-1" aria-label={`Edit ${c.situation}`}><Pencil size={12} /></button>}
                </div>
              </div>
              <ScriptCardView card={c} ownerLabel={ownerLabel(c)} />
            </div>
          ))}
        </div>
      )}

      {openId && (() => {
        const c = cards.find((x) => x.id === openId);
        return c ? (
          <Modal open onClose={() => setOpenId(null)} title={c.situation} subtitle={c.section_title} maxWidth="max-w-md">
            <ScriptCardView card={c} />
          </Modal>
        ) : null;
      })()}

      {editing && (
        <ScriptCardEditor
          card={editing === 'new' ? null : editing}
          sections={sections}
          duties={duties}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function SectionChip({ active, onClick, label, emergency }: { active: boolean; onClick: () => void; label: string; emergency?: boolean }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${active ? (emergency ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'border-brand bg-brand/10 text-brand-700 dark:text-brand-300') : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-brand/40'}`}>
      {label}
    </button>
  );
}

function ScriptCardEditor({ card, sections, duties, onClose, onSaved }: {
  card: ScriptCard | null;
  sections: { key: string; title: string; order: number }[];
  duties: Record<string, { label: string; profile_id: string | null }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [sectionKey, setSectionKey] = useState(card?.section_key ?? sections[0]?.key ?? 'general');
  const [situation, setSituation] = useState(card?.situation ?? '');
  const [say, setSay] = useState(card?.say ?? '');
  const [steps, setSteps] = useState((card?.steps ?? []).join('\n'));
  const [collect, setCollect] = useState((card?.collect ?? []).join('\n'));
  const [ownerDuty, setOwnerDuty] = useState(card?.owner_duty ?? '');
  const [priority, setPriority] = useState(card?.default_priority ?? 'normal');
  const [approved, setApproved] = useState(card?.approved ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const routeDuties = Object.entries(duties).filter(([k]) => k.startsWith('route_') || k === 'fleet_manager');

  const save = async () => {
    if (!situation.trim()) { setError('Give the situation a name.'); return; }
    setSaving(true);
    setError('');
    const sec = sections.find((s) => s.key === sectionKey);
    const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
    const payload = {
      section_key: sectionKey,
      section_title: card?.section_key === sectionKey ? card.section_title : sec?.title ?? sectionKey,
      section_order: sec?.order ?? card?.section_order ?? 99,
      situation: situation.trim(), say: say.trim() || null, steps: lines(steps), collect: lines(collect),
      owner_duty: ownerDuty || null, default_priority: priority, approved,
      updated_by: profile?.id ?? null, updated_at: new Date().toISOString(),
    };
    const { error: err } = card
      ? await supabase.from('script_cards').update(payload).eq('id', card.id)
      : await supabase.from('script_cards').insert({ ...payload, card_order: 999 });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const remove = async () => {
    if (!card) return;
    setSaving(true);
    await supabase.from('script_cards').delete().eq('id', card.id);
    setSaving(false);
    onSaved();
  };

  const label = 'block text-[11px] font-medium mb-1.5 text-gray-500';
  return (
    <Modal open onClose={onClose} title={card ? `Edit: ${card.situation}` : 'New Script Book card'} subtitle="Agents see changes straight away" maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="sc-section">Section</label>
            <select id="sc-section" value={sectionKey} onChange={(e) => setSectionKey(e.target.value)} className="input">
              {sections.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="sc-priority">Default priority</label>
            <select id="sc-priority" value={priority} onChange={(e) => setPriority(e.target.value as ScriptCard['default_priority'])} className="input">
              <option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
            </select>
          </div>
        </div>
        <div><label className={label} htmlFor="sc-situation">Situation</label><input id="sc-situation" value={situation} onChange={(e) => setSituation(e.target.value)} className="input" /></div>
        <div><label className={label} htmlFor="sc-say">What to say</label><textarea id="sc-say" value={say} onChange={(e) => setSay(e.target.value)} rows={3} className="input resize-none" /></div>
        <div><label className={label} htmlFor="sc-steps">What to do — one step per line</label><textarea id="sc-steps" value={steps} onChange={(e) => setSteps(e.target.value)} rows={5} className="input resize-none" /></div>
        <div><label className={label} htmlFor="sc-collect">What to collect — one item per line</label><textarea id="sc-collect" value={collect} onChange={(e) => setCollect(e.target.value)} rows={3} className="input resize-none" /></div>
        <div>
          <label className={label} htmlFor="sc-owner">Who owns it</label>
          <select id="sc-owner" value={ownerDuty} onChange={(e) => setOwnerDuty(e.target.value)} className="input">
            <option value="">Usually solved on the call</option>
            {routeDuties.map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Approved — agents can see it</label>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          {card ? <button onClick={remove} disabled={saving} className="btn-ghost text-red-500">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
