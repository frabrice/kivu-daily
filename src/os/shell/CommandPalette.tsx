import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { Car, CornerDownLeft, FileText, Headphones, LogOut, Moon, Rocket, Search, Settings, Sun, Truck, User, UserRound, CarFront, Keyboard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { Access } from '../access';
import { MODULES, visiblePages } from '../registry';
import { ENTITY_PATH } from '../peek';
import { EntityType, useWorkspace } from '../workspace';

interface Hit { type: EntityType; id: string; label: string; sub?: string }

const ICON: Record<EntityType, typeof Truck> = { driver: Truck, car: Car, owner: UserRound, person: User, agent: Headphones, case: FileText, partner: CarFront };

async function searchAll(q: string, a: Access): Promise<Hit[]> {
  const like = `%${q.replace(/[%_,()]/g, ' ').trim()}%`;
  const out: Hit[] = [];
  const tasks: Promise<void>[] = [];
  const add = (p: PromiseLike<{ data: unknown }>, map: (r: Record<string, unknown>) => Hit) => tasks.push(Promise.resolve(p).then(({ data }) => { for (const r of (data as Record<string, unknown>[]) ?? []) out.push(map(r)); }).catch(() => undefined));
  if (a.in('fleet', 'it', 'finance')) {
    add(supabase.from('drivers').select('id, full_name, phone, vehicle:vehicles(plate_number)').or(`full_name.ilike.${like},phone.ilike.${like}`).limit(6),
      (r) => ({ type: 'driver', id: String(r.id), label: String(r.full_name), sub: [(r.vehicle as { plate_number?: string } | null)?.plate_number, r.phone].filter(Boolean).join(' · ') }));
    add(supabase.from('vehicles').select('id, plate_number, make, model').ilike('plate_number', like).limit(5),
      (r) => ({ type: 'car', id: String(r.id), label: String(r.plate_number), sub: [r.make, r.model].filter(Boolean).join(' ') }));
  }
  if (a.in('finance')) {
    add(supabase.from('vehicle_owners').select('id, full_name, phone').ilike('full_name', like).limit(4), (r) => ({ type: 'owner', id: String(r.id), label: String(r.full_name), sub: String(r.phone ?? '') }));
  }
  if (a.in('fleet', 'it', 'call_center')) {
    add(supabase.from('platform_drivers').select('id, full_name, phone, car:platform_cars(plate_number)').or(`full_name.ilike.${like},phone.ilike.${like}`).limit(5),
      (r) => ({ type: 'partner', id: String(r.id), label: String(r.full_name), sub: [(r.car as { plate_number?: string } | null)?.plate_number, r.phone].filter(Boolean).join(' · ') }));
  }
  add(supabase.from('call_tickets').select('id, reference, caller_name, status').or(`reference.ilike.${like},caller_name.ilike.${like}`).order('created_at', { ascending: false }).limit(5),
    (r) => ({ type: 'case', id: String(r.id), label: `${r.reference} · ${r.caller_name}`, sub: String(r.status).replace(/_/g, ' ') }));
  if (a.isMd || a.dept === 'finance') {
    add(supabase.from('profiles').select('id, full_name, department:departments(name)').eq('is_active', true).ilike('full_name', like).limit(5),
      (r) => ({ type: 'person', id: String(r.id), label: String(r.full_name).trim(), sub: (r.department as { name?: string } | null)?.name ?? '' }));
  }
  await Promise.all(tasks);
  return out;
}

export default function CommandPalette({ open, onClose, access, onSignOut, onShortcuts }: { open: boolean; onClose: () => void; access: Access; onSignOut: () => void; onShortcuts: () => void }) {
  const nav = useNavigate();
  const { theme, toggle } = useTheme();
  const { recent } = useWorkspace();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => { if (!open) { setQ(''); setHits([]); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    let live = true;
    const t = setTimeout(() => searchAll(q, access).then((h) => { if (live) setHits(h); }), 180);
    return () => { live = false; clearTimeout(t); };
  }, [q, access]);

  if (!open) return null;
  const go = (path: string) => { onClose(); nav(path); };
  const groups = MODULES.map((m) => ({ m, pages: visiblePages(m, access) })).filter((g) => g.pages.length);
  const item = 'flex items-center gap-2.5 px-3 py-2 rounded-md text-body cursor-pointer aria-selected:bg-hover aria-selected:text-fg text-fg-muted';
  const heading = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle';

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4 bg-black/40 animate-fade-in" onMouseDown={onClose}>
      <Command label="Search and jump" className={`w-full max-w-xl bg-surface-3 border border-line rounded-xl shadow-overlay overflow-hidden ${heading}`} onMouseDown={(e) => e.stopPropagation()}
        filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
        <div className="flex items-center gap-2 px-3 border-b border-line-muted">
          <Search size={16} className="text-fg-subtle" />
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search drivers, cars, people, cases, pages…" className="flex-1 h-12 bg-transparent outline-none text-ui text-fg placeholder:text-fg-subtle" />
          <span className="kbd">Esc</span>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-8 text-center text-body text-fg-muted">{q.trim().length < 2 ? 'Type to search.' : 'Nothing found.'}</Command.Empty>
          {hits.length > 0 && (
            <Command.Group heading="Results" forceMount>
              {hits.map((h) => {
                const I = ICON[h.type];
                return (
                  <Command.Item key={`${h.type}${h.id}`} value={`${h.type} ${h.label} ${h.sub ?? ''} ${q}`} onSelect={() => go(ENTITY_PATH[h.type](h.id))} className={item}>
                    <I size={15} className="text-fg-subtle shrink-0" /><span className="truncate text-fg">{h.label}</span>{h.sub && <span className="truncate text-caption text-fg-subtle">{h.sub}</span>}
                    <span className="ml-auto text-caption text-fg-subtle capitalize">{h.type === 'partner' ? 'Non-Insider' : h.type}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}
          {!q && recent.length > 0 && (
            <Command.Group heading="Recent">
              {recent.slice(0, 6).map((r) => {
                const I = ICON[r.type];
                return <Command.Item key={`r${r.type}${r.id}`} value={`recent ${r.label}`} onSelect={() => go(r.path)} className={item}><I size={15} className="text-fg-subtle" /><span className="text-fg">{r.label}</span>{r.sub && <span className="text-caption text-fg-subtle truncate">{r.sub}</span>}</Command.Item>;
              })}
            </Command.Group>
          )}
          {groups.map(({ m, pages }) => (
            <Command.Group key={m.id} heading={m.label}>
              {pages.filter((p, i, arr) => arr.findIndex((x) => x.path === p.path) === i).map((p) => (
                <Command.Item key={p.id} value={`${m.label} ${p.label} ${p.keywords ?? ''}`} onSelect={() => go(p.path)} className={item}>
                  <p.icon size={15} className="text-fg-subtle" /><span className="text-fg">{p.label}</span>
                  {p.description && <span className="truncate text-caption text-fg-subtle hidden sm:inline">{p.description}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
          <Command.Group heading="Actions">
            <Command.Item value="theme dark light mode switch" onSelect={() => { toggle(); onClose(); }} className={item}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}<span className="text-fg">Switch to {theme === 'dark' ? 'light' : 'dark'} mode</span></Command.Item>
            <Command.Item value="keyboard shortcuts help" onSelect={() => { onClose(); onShortcuts(); }} className={item}><Keyboard size={15} /><span className="text-fg">Keyboard shortcuts</span><span className="ml-auto kbd">?</span></Command.Item>
            <Command.Item value="whats new changes release" onSelect={() => go('/docs/whats-new')} className={item}><Rocket size={15} /><span className="text-fg">What's new</span></Command.Item>
            <Command.Item value="settings preferences" onSelect={() => go('/settings')} className={item}><Settings size={15} /><span className="text-fg">Settings</span></Command.Item>
            <Command.Item value="sign out log out" onSelect={() => { onClose(); onSignOut(); }} className={item}><LogOut size={15} /><span className="text-fg">Sign out</span></Command.Item>
          </Command.Group>
        </Command.List>
        <div className="flex items-center gap-3 px-3 h-9 border-t border-line-muted text-caption text-fg-subtle">
          <span className="flex items-center gap-1"><CornerDownLeft size={12} /> open</span><span>↑↓ move</span><span className="ml-auto">Ctrl K anywhere</span>
        </div>
      </Command>
    </div>
  );
}
