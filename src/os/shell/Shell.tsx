import { lazy, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarPlus, ChevronDown, Keyboard, LogOut, Megaphone, Menu, Moon, PanelLeftClose, PanelLeftOpen, Pin, PinOff,
  PhoneIncoming, Plus, Rocket, Search, Settings, Sun, X, ListTodo, CalendarOff,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useMyOpenShift } from '../../lib/shifts';
import { StartShiftScreen, ShiftChip, EndShiftDrawer } from '../../components/callTickets/ShiftControls';
import NotificationBell from '../../components/NotificationBell';
import Avatar from '../../components/Avatar';
import { Access } from '../access';
import { BadgeKey, ModuleDef, moduleOfPath, PageDef, pageOfPath, visibleModules, visiblePages } from '../registry';
import { useBadges } from '../badges';
import { useWorkspace } from '../workspace';
import { PeekPanel, usePeek } from '../peek';
import { Popover, MenuItem, MenuDivider, MenuLabel, Tooltip } from '../../ui/Popover';
import CommandPalette from './CommandPalette';
import PageBoundary from '../PageBoundary';

const ItRequestHost = lazy(() => import('../../components/it/ItModals').then((m) => ({ default: m.SubmitToItModal })));
const AssignTaskModalHost = lazy(() => import('./NewThingModals').then((m) => ({ default: m.AssignTaskHost })));
const AnnouncementHost = lazy(() => import('./NewThingModals').then((m) => ({ default: m.AnnouncementHost })));
const MeetingHost = lazy(() => import('./NewThingModals').then((m) => ({ default: m.MeetingHost })));

type Badges = Partial<Record<BadgeKey, number>>;
const badgeOf = (p: PageDef, b: Badges) => (p.badge ? b[p.badge] ?? 0 : 0);
const moduleBadge = (m: ModuleDef, a: Access, b: Badges) => visiblePages(m, a).reduce((s, p) => s + badgeOf(p, b), 0);

function useLocalBool(key: string, initial: boolean): [boolean, (v: boolean | ((x: boolean) => boolean)) => void] {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s === null ? initial : s === '1'; } catch { return initial; } });
  const set = useCallback((x: boolean | ((y: boolean) => boolean)) => setV((prev) => { const n = typeof x === 'function' ? x(prev) : x; try { localStorage.setItem(key, n ? '1' : '0'); } catch { /* ignore */ } return n; }), [key]);
  return [v, set];
}

// ---------------------------------------------------------------- shell
export default function Shell({ access, children }: { access: Access; children: ReactNode }) {
  const { profile, signOut: plainSignOut } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const badges = useBadges(access);
  const mods = useMemo(() => visibleModules(access), [access]);
  const current = moduleOfPath(loc.pathname, access) ?? mods[0];
  const [pinned, setPinned] = useLocalBool('kivu-os-sidebar-pinned', true);
  const [railOpen, setRailOpen] = useLocalBool('kivu-os-rail-expanded', false);
  const { theme, toggle: toggleTheme } = useTheme();
  const [flyout, setFlyout] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [newModal, setNewModal] = useState<null | 'task' | 'announcement' | 'meeting' | 'it_request'>(null);
  const flyTimer = useRef<number>();
  const { stack: peekStack } = usePeek();

  // Call Center: a shift must be started to work, and ended to sign out.
  const isCallCenter = access.dept === 'call_center';
  const { shift, loading: shiftLoading, reload: reloadShift } = useMyOpenShift(profile?.id, isCallCenter);
  const [ending, setEnding] = useState<null | 'end' | 'signout'>(null);
  const needsShift = isCallCenter && !shiftLoading && !shift;
  const signOut = isCallCenter && shift ? () => setEnding('signout') : plainSignOut;

  useEffect(() => { setMobileMenu(false); setFlyout(null); }, [loc.pathname]);

  // Keyboard: Ctrl/Cmd K or / = search, ? = shortcuts, [ = sidebar, g + letter = go to module.
  useEffect(() => {
    let g = false; let gt = 0;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setPalette(true); return; }
      if (e.key === '?') { setShortcuts(true); return; }
      if (e.key === '[') { setPinned((p) => !p); return; }
      if (g) {
        g = false; window.clearTimeout(gt);
        const m = mods.find((x) => x.shortcut === `g ${e.key}`);
        if (m) nav(visiblePages(m, access)[0].path);
        return;
      }
      if (e.key === 'g') { g = true; gt = window.setTimeout(() => { g = false; }, 900); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mods, access, nav, setPinned]);

  const openFly = (id: string) => { window.clearTimeout(flyTimer.current); flyTimer.current = window.setTimeout(() => setFlyout(id), 120); };
  const closeFly = () => { window.clearTimeout(flyTimer.current); flyTimer.current = window.setTimeout(() => setFlyout(null), 220); };
  const flyModule = flyout ? mods.find((m) => m.id === flyout) ?? null : null;
  const showSidebar = pinned && current && current.id !== 'home' && visiblePages(current, access).length > 1;
  const railW = railOpen ? '13rem' : '3rem';
  const offset = `calc(${railW} + ${showSidebar ? '14rem' : '0rem'})`;

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <TopBar access={access} current={current} onPalette={() => setPalette(true)} onMenu={() => setMobileMenu(true)}
        onNew={setNewModal} onShortcuts={() => setShortcuts(true)} signOut={signOut}
        shiftChip={shift ? <ShiftChip shift={shift} onEnd={() => setEnding('end')} /> : null} />

      <div className="flex pt-12">
        {/* Rail: icons, or icons with names when expanded */}
        <nav aria-label="Modules" style={{ width: railW }} className="hidden md:flex fixed left-0 top-12 bottom-0 z-30 flex-col gap-1 py-2 px-1.5 bg-surface border-r border-line-muted transition-[width] duration-200" onMouseLeave={closeFly}>
          {mods.map((m) => {
            const active = current?.id === m.id;
            const n = moduleBadge(m, access, badges);
            const btn = (
              <button key={m.id} onClick={() => nav(visiblePages(m, access)[0].path)} onMouseEnter={() => (!railOpen && (!showSidebar || !active) ? openFly(m.id) : undefined)}
                aria-label={m.label} aria-current={active ? 'page' : undefined}
                className={`relative h-9 rounded-lg flex items-center gap-2.5 transition-colors ${railOpen ? 'w-full px-2.5' : 'w-9 justify-center'} ${active ? 'bg-accent/15 text-accent-fg' : 'text-fg-subtle hover:text-fg hover:bg-hover'}`}>
                {active && <span className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
                <m.icon size={18} className="shrink-0" />
                {railOpen && <span className={`flex-1 text-left text-body truncate ${active ? 'font-semibold' : 'text-fg-muted'}`}>{m.label}</span>}
                {n > 0 && (railOpen ? <span className="counter !bg-danger-muted !text-danger">{n}</span> : <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger ring-2 ring-surface" />)}
              </button>
            );
            return railOpen ? btn : <Tooltip key={m.id} label={<span>{m.label}{m.shortcut && <span className="ml-2 opacity-70">{m.shortcut}</span>}</span>} placement="right">{btn}</Tooltip>;
          })}
          <div className={`mt-auto flex flex-col gap-1 ${railOpen ? '' : 'items-center'}`}>
            <RailButton open={railOpen} onClick={toggleTheme} icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Light mode' : 'Dark mode'} />
            <RailButton open={railOpen} onClick={() => setRailOpen((o) => !o)} icon={railOpen ? PanelLeftClose : PanelLeftOpen} label={railOpen ? 'Collapse menu' : 'Expand menu'} />
          </div>
        </nav>

        {/* Left-edge hover zone when the module menu is hidden */}
        {!showSidebar && current && current.id !== 'home' && visiblePages(current, access).length > 1 && <div style={{ left: railW }} className="hidden md:block fixed top-12 bottom-0 w-2 z-30" onMouseEnter={() => openFly(current.id)} />}

        {/* Pinned module menu */}
        {showSidebar && (
          <aside style={{ left: railW }} className="hidden md:flex fixed top-12 bottom-0 z-20 w-56 flex-col bg-surface border-r border-line-muted transition-[left] duration-200">
            <ModuleSidebar module={current} access={access} badges={badges} onHide={() => setPinned(false)} />
          </aside>
        )}

        {/* Flyout module menu (hover) */}
        {flyModule && (!showSidebar || flyModule.id !== current?.id) && (
          <aside style={{ left: railW }} className="hidden md:flex fixed top-12 bottom-0 z-40 w-60 flex-col bg-surface-3 border-r border-line shadow-overlay animate-slide-in-left"
            onMouseEnter={() => window.clearTimeout(flyTimer.current)} onMouseLeave={closeFly}>
            <ModuleSidebar module={flyModule} access={access} badges={badges} onPin={flyModule.id === current?.id ? () => { setPinned(true); setFlyout(null); } : undefined} />
          </aside>
        )}

        <main style={{ ['--os-offset' as string]: offset }} className="flex-1 min-w-0 md:ml-[var(--os-offset)] transition-[margin] duration-200 pb-16 md:pb-0">
          <WorkspaceTabs access={access} />
          <div className="flex">
            <div className="flex-1 min-w-0 px-4 md:px-6 py-4 md:py-5 max-w-[1500px] mx-auto w-full">
              {ending && shift && (
                <EndShiftDrawer shift={shift} onClose={() => setEnding(null)}
                  onEnded={() => { const thenSignOut = ending === 'signout'; setEnding(null); if (thenSignOut) plainSignOut(); else reloadShift(); }} />
              )}
              <PageBoundary resetKey={loc.pathname}>
                <Suspense fallback={<PageSkeleton />}>
                  {needsShift ? <StartShiftScreen onStarted={reloadShift} /> : children}
                </Suspense>
              </PageBoundary>
            </div>
            {peekStack.length > 0 && <PeekPanel />}
          </div>
        </main>
      </div>


      <MobileBar access={access} badges={badges} onMenu={() => setMobileMenu(true)} onSearch={() => setPalette(true)} />
      {mobileMenu && <MobileMenu access={access} badges={badges} onClose={() => setMobileMenu(false)} signOut={signOut} />}
      <CommandPalette open={palette} onClose={() => setPalette(false)} access={access} onSignOut={signOut} onShortcuts={() => setShortcuts(true)} />
      {shortcuts && <ShortcutsDialog mods={mods} onClose={() => setShortcuts(false)} />}
      <Suspense fallback={null}>
        {newModal === 'task' && <AssignTaskModalHost onClose={() => setNewModal(null)} />}
        {newModal === 'announcement' && <AnnouncementHost onClose={() => setNewModal(null)} />}
        {newModal === 'meeting' && <MeetingHost onClose={() => setNewModal(null)} />}
        {newModal === 'it_request' && <ItRequestHost onClose={() => setNewModal(null)} />}
      </Suspense>
    </div>
  );
}

function RailButton({ open, onClick, icon: Icon, label }: { open: boolean; onClick: () => void; icon: typeof Sun; label: string }) {
  const btn = (
    <button onClick={onClick} aria-label={label} className={`h-9 rounded-lg flex items-center gap-2.5 text-fg-subtle hover:text-fg hover:bg-hover ${open ? 'w-full px-2.5' : 'w-9 justify-center'}`}>
      <Icon size={17} className="shrink-0" />{open && <span className="text-body text-fg-muted">{label}</span>}
    </button>
  );
  return open ? btn : <Tooltip label={label} placement="right">{btn}</Tooltip>;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="h-8 w-64 skeleton rounded-md" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 skeleton rounded-card" />)}</div>
      <div className="h-72 skeleton rounded-card" />
    </div>
  );
}

// ---------------------------------------------------------------- top bar
function TopBar({ access, current, onPalette, onMenu, onNew, onShortcuts, signOut, shiftChip }: {
  access: Access; current: ModuleDef | undefined; onPalette: () => void; onMenu: () => void;
  onNew: (k: 'task' | 'announcement' | 'meeting' | 'it_request') => void; onShortcuts: () => void; signOut: () => void; shiftChip: ReactNode;
}) {
  const { profile } = useAuth();
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const nav = useNavigate();
  const { tabs } = useWorkspace();
  const page = pageOfPath(loc.pathname, access);
  const tabTitle = tabs.find((t) => t.path.split('?')[0] === loc.pathname)?.title;
  const crumbs: { label: string; to?: string }[] = [];
  if (current && current.id !== 'home') crumbs.push({ label: current.label, to: visiblePages(current, access)[0]?.path });
  if (page && current?.id !== 'home') crumbs.push({ label: page.label, to: page.path });
  if (!page && tabTitle) crumbs.push({ label: tabTitle });

  return (
    <header className="fixed top-0 inset-x-0 z-50 h-12 flex items-center gap-2 px-2 md:px-3 bg-surface border-b border-line-muted">
      <button onClick={onMenu} className="md:hidden btn-ghost p-2" aria-label="Open menu"><Menu size={18} /></button>
      <Link to="/" className="flex items-center gap-2 shrink-0 rounded-md px-1 py-1 hover:bg-hover" aria-label="Kivu Daily home">
        <span className="w-7 h-7 rounded-md bg-white border border-line flex items-center justify-center overflow-hidden"><img src="/kivu-ride-logo.png" alt="" className="w-5 h-5 object-contain" /></span>
        <span className="hidden lg:block text-ui font-semibold">Kivu Daily</span>
      </Link>
      <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1 min-w-0 text-body">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <span className="text-fg-subtle">/</span>
            {c.to && i < crumbs.length - 1 ? <Link to={c.to} className="text-fg-muted hover:text-fg truncate">{c.label}</Link> : <span className="font-semibold text-fg truncate">{c.label}</span>}
          </span>
        ))}
      </nav>
      <div className="flex-1" />
      <button onClick={onPalette} className="hidden md:flex items-center gap-2 h-8 w-64 lg:w-80 px-2.5 rounded-md border border-line bg-inset text-body text-fg-subtle hover:border-line-strong" aria-label="Search">
        <Search size={14} /> <span className="truncate">Search or jump to…</span> <span className="ml-auto kbd">Ctrl K</span>
      </button>
      <button onClick={onPalette} className="md:hidden btn-ghost p-2" aria-label="Search"><Search size={18} /></button>
      {shiftChip}
      <Popover placement="bottom-end" width={240} trigger={<button className="btn-secondary h-8 px-2" aria-label="Create new"><Plus size={15} /><ChevronDown size={12} /></button>}>
        {(close) => (
          <div className="py-1">
            <MenuLabel>Create</MenuLabel>
            {access.isMd && <MenuItem icon={ListTodo} label="Task for someone" onClick={() => { close(); onNew('task'); }} />}
            {!access.isMd && <MenuItem icon={ListTodo} label="Task for myself" onClick={() => { close(); nav('/me/tasks'); }} />}
            {access.in('call_center') && <MenuItem icon={PhoneIncoming} label="New call or case" onClick={() => { close(); nav('/call-center/cases?new=call'); }} />}
            {access.isMd && <MenuItem icon={Megaphone} label="Announcement" onClick={() => { close(); onNew('announcement'); }} />}
            {access.isMd && <MenuItem icon={CalendarPlus} label="Meeting" onClick={() => { close(); onNew('meeting'); }} />}
            <MenuItem icon={Rocket} label="Request to IT" hint="Idea, problem or need" onClick={() => { close(); onNew('it_request'); }} />
            {(access.isMd || access.duties.has('fleet_manager') || access.duties.has('driver_payment_followup')) && <MenuItem icon={CalendarOff} label="Driver days off" onClick={() => { close(); nav('/fleet/days-off'); }} />}
          </div>
        )}
      </Popover>
      <Tooltip label={theme === 'dark' ? 'Light mode' : 'Dark mode'}><button onClick={toggle} className="btn-ghost p-2" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button></Tooltip>
      <NotificationBell />
      <Popover placement="bottom-end" width={250} trigger={<button className="rounded-full ml-0.5" aria-label="Account menu"><Avatar name={profile?.full_name ?? ''} url={profile?.avatar_url} size="sm" /></button>}>
        {(close) => (
          <div className="py-1">
            <div className="px-3 py-2 border-b border-line-muted mb-1">
              <p className="text-body font-semibold truncate">{profile?.full_name}</p>
              <p className="text-caption text-fg-muted truncate">{access.isMd ? 'Managing Director' : profile?.department?.name ?? 'Employee'}</p>
            </div>
            <MenuItem icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => { toggle(); close(); }} />
            <MenuItem icon={Settings} label="Settings" onClick={() => { close(); nav('/settings'); }} />
            <MenuItem icon={Keyboard} label="Keyboard shortcuts" hint="?" onClick={() => { close(); onShortcuts(); }} />
            <MenuItem icon={Rocket} label="What's new" onClick={() => { close(); nav('/docs/whats-new'); }} />
            <MenuDivider />
            <MenuItem icon={LogOut} label="Sign out" danger onClick={() => { close(); signOut(); }} />
          </div>
        )}
      </Popover>
    </header>
  );
}

// ---------------------------------------------------------------- module sidebar
function ModuleSidebar({ module, access, badges, onPin, onHide }: { module: ModuleDef; access: Access; badges: Badges; onPin?: () => void; onHide?: () => void }) {
  const pages = visiblePages(module, access).filter((p, i, arr) => arr.findIndex((x) => x.path === p.path) === i);
  const groups: { name: string; pages: PageDef[] }[] = [];
  for (const p of pages) {
    const name = p.group ?? '';
    const g = groups.find((x) => x.name === name);
    if (g) g.pages.push(p); else groups.push({ name, pages: [p] });
  }
  const { recent } = useWorkspace();
  const recentHere = recent.filter((r) => r.path.startsWith(module.base) && module.base !== '/').slice(0, 6);
  return (
    <div className="flex flex-col h-full">
      <div className="h-11 px-3 flex items-center gap-2 shrink-0">
        <module.icon size={16} className="text-fg-muted" />
        <p className="text-ui font-semibold flex-1 truncate">{module.label}</p>
        {onPin && <button onClick={onPin} className="btn-ghost p-1" aria-label="Keep this menu open" title="Keep open"><Pin size={13} /></button>}
        {onHide && <Tooltip label="Hide this menu  ["><button onClick={onHide} className="btn-ghost p-1" aria-label="Hide this menu"><PanelLeftClose size={14} /></button></Tooltip>}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
        {groups.map((g) => (
          <div key={g.name || 'main'}>
            {g.name && <p className="px-2 pb-1 text-micro font-semibold uppercase tracking-wide text-fg-subtle">{g.name}</p>}
            <div className="space-y-px">
              {g.pages.map((p) => {
                const n = badgeOf(p, badges);
                return (
                  <NavLink key={p.id} to={p.path} end className={({ isActive }) => `nav-item text-body ${isActive ? 'nav-item-active' : ''}`}>
                    {({ isActive }) => (
                      <>
                        <p.icon size={15} className={isActive ? 'text-accent-fg' : ''} />
                        <span className="flex-1 truncate">{p.label}</span>
                        {n > 0 && <span className={`counter ${p.badge === 'overdueDeposits' || p.badge === 'pendingPauses' || p.badge === 'myCases' ? '!bg-danger-muted !text-danger' : ''}`}>{n}</span>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
        {recentHere.length > 0 && (
          <div>
            <p className="px-2 pb-1 text-micro font-semibold uppercase tracking-wide text-fg-subtle">Recent</p>
            {recentHere.map((r) => (
              <NavLink key={`${r.type}${r.id}`} to={r.path} className={({ isActive }) => `nav-item text-body ${isActive ? 'nav-item-active' : ''}`}>
                <span className="w-[15px] flex justify-center"><span className="w-1.5 h-1.5 rounded-full bg-fg-subtle" /></span>
                <span className="flex-1 truncate">{r.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- workspace tabs
function WorkspaceTabs({ access }: { access: Access }) {
  const { tabs, close, togglePin, closeOthers } = useWorkspace();
  const loc = useLocation();
  const nav = useNavigate();
  if (tabs.length <= 1) return null;
  const labelOf = (path: string, title: string) => title || pageOfPath(path.split('?')[0], access)?.label || 'Page';
  const iconOf = (path: string) => pageOfPath(path.split('?')[0], access)?.icon ?? moduleOfPath(path.split('?')[0], access)?.icon;
  const ordered = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
  return (
    <div className="hidden md:flex items-end gap-px h-9 px-2 bg-surface border-b border-line-muted overflow-x-auto sticky top-12 z-10" role="tablist" aria-label="Open pages">
      {ordered.map((t) => {
        const active = t.path.split('?')[0] === loc.pathname;
        const I = iconOf(t.path);
        return (
          <div key={t.path} role="tab" aria-selected={active} onClick={() => nav(t.path)} onAuxClick={(e) => { if (e.button === 1) close(t.path); }}
            className={`group relative flex items-center gap-1.5 h-8 pl-2.5 pr-1 max-w-[200px] rounded-t-md text-caption cursor-pointer select-none border border-b-0 ${active ? 'bg-canvas border-line-muted text-fg font-medium -mb-px' : 'border-transparent text-fg-muted hover:bg-hover'}`}>
            {active && <span className="absolute top-0 left-2 right-2 h-[2px] rounded-b bg-accent" />}
            {t.pinned ? <Pin size={11} className="shrink-0" /> : I ? <I size={12} className="shrink-0" /> : null}
            <span className="truncate">{labelOf(t.path, t.title)}</span>
            <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <button onClick={(e) => { e.stopPropagation(); togglePin(t.path); }} className="p-0.5 rounded hover:bg-hover" aria-label={t.pinned ? 'Unpin tab' : 'Pin tab'}>{t.pinned ? <PinOff size={11} /> : <Pin size={11} />}</button>
              {!t.pinned && <button onClick={(e) => { e.stopPropagation(); close(t.path); }} className="p-0.5 rounded hover:bg-hover" aria-label="Close tab"><X size={12} /></button>}
            </span>
          </div>
        );
      })}
      <button onClick={() => closeOthers(loc.pathname + loc.search)} className="ml-auto self-center text-caption text-fg-subtle hover:text-fg px-2 whitespace-nowrap">Close others</button>
    </div>
  );
}

export function Ring({ pct, size = 56 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}% done`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-line-muted))" strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-accent))" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-fg text-caption font-semibold">{pct}%</text>
    </svg>
  );
}

// ---------------------------------------------------------------- mobile
function MobileBar({ access, badges, onMenu, onSearch }: { access: Access; badges: Badges; onMenu: () => void; onSearch: () => void }) {
  const mods = visibleModules(access);
  const work = mods.find((m) => !['home', 'me', 'people', 'insights', 'docs', 'admin'].includes(m.id));
  const items = [mods.find((m) => m.id === 'home'), mods.find((m) => m.id === 'me'), work].filter(Boolean) as ModuleDef[];
  const loc = useLocation();
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-surface border-t border-line-muted grid grid-cols-5" aria-label="Main">
      {items.map((m) => {
        const active = moduleOfPath(loc.pathname, access)?.id === m.id;
        const n = moduleBadge(m, access, badges);
        return (
          <Link key={m.id} to={visiblePages(m, access)[0].path} className={`relative flex flex-col items-center justify-center gap-0.5 text-micro ${active ? 'text-accent-fg' : 'text-fg-muted'}`}>
            <m.icon size={19} />{m.label}
            {n > 0 && <span className="absolute top-1.5 right-[30%] w-2 h-2 rounded-full bg-danger" />}
          </Link>
        );
      })}
      {items.length < 3 && <span />}
      <button onClick={onSearch} className="flex flex-col items-center justify-center gap-0.5 text-micro text-fg-muted"><Search size={19} />Search</button>
      <button onClick={onMenu} className="flex flex-col items-center justify-center gap-0.5 text-micro text-fg-muted"><Menu size={19} />More</button>
    </nav>
  );
}

function MobileMenu({ access, badges, onClose, signOut }: { access: Access; badges: Badges; onClose: () => void; signOut: () => void }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="md:hidden fixed inset-0 z-[70] bg-black/40" onClick={onClose}>
      <div className="absolute left-0 top-0 bottom-0 w-[85%] max-w-sm bg-surface overflow-y-auto animate-slide-in-left" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 px-3 flex items-center border-b border-line-muted"><p className="text-ui font-semibold flex-1">Kivu Daily</p><button onClick={onClose} className="btn-ghost p-2" aria-label="Close menu"><X size={18} /></button></div>
        <div className="p-2 space-y-3">
          {visibleModules(access).map((m) => (
            <div key={m.id}>
              <p className="px-2 pb-1 text-micro font-semibold uppercase tracking-wide text-fg-subtle flex items-center gap-1.5"><m.icon size={12} /> {m.label}</p>
              {visiblePages(m, access).filter((p, i, arr) => arr.findIndex((x) => x.path === p.path) === i).map((p) => {
                const n = badgeOf(p, badges);
                return (
                  <NavLink key={p.id} to={p.path} end onClick={onClose} className={({ isActive }) => `nav-item text-body ${isActive ? 'nav-item-active' : ''}`}>
                    <p.icon size={16} /><span className="flex-1">{p.label}</span>{n > 0 && <span className="counter">{n}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
          <div className="border-t border-line-muted pt-2">
            <button onClick={toggle} className="nav-item w-full text-body">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
            <button onClick={signOut} className="nav-item w-full text-body text-danger"><LogOut size={16} />Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shortcuts
function ShortcutsDialog({ mods, onClose }: { mods: ModuleDef[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows: [string, string][] = [
    ['Ctrl K  or  /', 'Search and jump anywhere'], ['?', 'This list'], ['[', 'Show or hide the sidebar'], ['Esc', 'Close a panel or dialog'],
    ...mods.filter((m) => m.shortcut).map((m) => [m.shortcut!, `Go to ${m.label}`] as [string, string]),
  ];
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div role="dialog" aria-label="Keyboard shortcuts" className="w-full max-w-md bg-surface-3 border border-line rounded-xl shadow-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="h-11 px-4 flex items-center border-b border-line-muted"><Keyboard size={15} className="mr-2 text-fg-muted" /><p className="text-ui font-semibold flex-1">Keyboard shortcuts</p><button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X size={15} /></button></div>
        <div className="p-2">
          {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between px-2 py-1.5 text-body"><span className="text-fg-muted">{v}</span><span className="kbd !h-5">{k}</span></div>)}
        </div>
      </div>
    </div>
  );
}

