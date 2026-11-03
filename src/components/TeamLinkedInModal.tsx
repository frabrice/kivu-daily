import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Linkedin, Loader2 } from 'lucide-react';
import Modal from './Modal';
import { supabase } from '../lib/supabase';
import { linkedinUrl } from '../lib/linkedin';

// MD Panel > Departments > LinkedIn links: every active person's public
// LinkedIn profile in one list, in the order kivuride.com shows the team
// (MD, Finance, Marketing, then the rest). Saved links appear on the site's
// team as a LinkedIn icon next to the name; an empty one shows no icon.

interface Person { id: string; full_name: string; role: string; responsibility_label: string | null; linkedin_url: string | null; department: { name: string } | null }
const ORDER = ['Leadership', 'Finance', 'Marketing/Sales/BD', 'Fleet', 'IT', 'Call Center'];
const deptOf = (p: Person) => (p.role === 'managing_director' ? 'Leadership' : p.department?.name ?? 'Other');
const rank = (d: string) => (ORDER.includes(d) ? ORDER.indexOf(d) : ORDER.length);

export default function TeamLinkedInModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, role, responsibility_label, linkedin_url, department:departments(name)').eq('is_active', true).order('full_name')
      .then(({ data, error }) => {
        if (error) { setErr(error.message); setPeople([]); return; }
        const list = (data ?? []) as unknown as Person[];
        setPeople(list);
        setLinks(Object.fromEntries(list.map((p) => [p.id, p.linkedin_url ?? ''])));
      });
  }, []);

  const groups = useMemo(() => {
    const by = new Map<string, Person[]>();
    for (const p of people ?? []) by.set(deptOf(p), [...(by.get(deptOf(p)) ?? []), p]);
    return [...by.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [people]);

  const clean = (id: string) => linkedinUrl(links[id] ?? '');
  const changed = (people ?? []).filter((p) => clean(p.id) !== undefined && (clean(p.id) ?? null) !== (p.linkedin_url ?? null));
  const invalid = (people ?? []).filter((p) => clean(p.id) === undefined);
  const withLink = (people ?? []).filter((p) => clean(p.id)).length;

  const save = async () => {
    if (invalid.length) { setErr(`Fix the ${invalid.length} link${invalid.length === 1 ? '' : 's'} marked in red: a profile link looks like linkedin.com/in/their-name.`); return; }
    setBusy(true); setErr('');
    try {
      for (const p of changed) {
        const { error } = await supabase.from('profiles').update({ linkedin_url: clean(p.id) ?? null, updated_at: new Date().toISOString() }).eq('id', p.id);
        if (error) throw new Error(`${p.full_name.trim()}: ${error.message}`);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="LinkedIn links" subtitle="Each link shows as a LinkedIn icon next to the person on kivuride.com's team. Leave it empty to show no icon." maxWidth="max-w-xl">
      {!people ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-fg-subtle" /></div>
      ) : (
        <div className="space-y-4">
          <p className="text-caption text-fg-muted"><b className="text-fg">{withLink}</b> of {people.length} people have a link.</p>
          {groups.map(([dept, list]) => (
            <section key={dept}>
              <p className="text-micro font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">{dept === 'Marketing/Sales/BD' ? 'Marketing' : dept}</p>
              <div className="rounded-lg border border-line-muted divide-y divide-line-muted">
                {list.map((p) => {
                  const v = links[p.id] ?? '', ok = clean(p.id);
                  return (
                    <div key={p.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-3 py-2">
                      <div className="w-full sm:w-44 shrink-0 min-w-0">
                        <p className="text-caption font-medium truncate">{p.full_name.trim()}</p>
                        <p className="text-micro text-fg-subtle truncate">{p.responsibility_label || (p.role === 'managing_director' ? 'Managing Director' : p.department?.name)}</p>
                      </div>
                      <div className="relative flex-1 min-w-[200px]">
                        <Linkedin size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${ok ? 'text-[#0A66C2]' : 'text-fg-subtle'}`} />
                        <input value={v} onChange={(e) => setLinks((m) => ({ ...m, [p.id]: e.target.value }))} placeholder="linkedin.com/in/…" inputMode="url"
                          aria-label={`LinkedIn profile of ${p.full_name.trim()}`}
                          className={`input !py-1 !pl-8 text-caption ${ok === undefined ? '!border-danger' : ''}`} />
                      </div>
                      {ok ? <a href={ok} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1.5 shrink-0" title="Open the profile to check it"><ExternalLink size={13} /></a> : <span className="w-[29px] shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {err && <p className="text-caption text-danger">{err}</p>}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-muted">
            <span className="text-micro text-fg-subtle mr-auto">{changed.length ? `${changed.length} change${changed.length === 1 ? '' : 's'} to save` : 'No changes'}</span>
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={busy || !changed.length} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : 'Save links'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
