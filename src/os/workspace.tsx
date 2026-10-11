import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// The workspace: tabs for every page and object you have open (like an
// operating system's windows), plus a "recent" list. Kept per person.

export type EntityType = 'driver' | 'car' | 'owner' | 'person' | 'agent' | 'case' | 'partner';
export interface WsTab { path: string; title: string; kind: 'page' | 'entity'; icon?: string; pinned?: boolean }
export interface RecentItem { type: EntityType; id: string; label: string; sub?: string; path: string; at: number }

interface Ctx {
  tabs: WsTab[];
  current: string;
  setTitle: (path: string, title: string, kind?: WsTab['kind'], icon?: string) => void;
  close: (path: string) => void;
  closeOthers: (path: string) => void;
  togglePin: (path: string) => void;
  recent: RecentItem[];
  pushRecent: (r: Omit<RecentItem, 'at'>) => void;
}

const WsCtx = createContext<Ctx | null>(null);
const MAX_TABS = 12;
const fullPath = (l: { pathname: string; search: string }) => l.pathname + l.search;

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const key = `kivu-os-ws-${profile?.id ?? 'anon'}`;
  const [tabs, setTabs] = useState<WsTab[]>(() => load<WsTab[]>(`${key}-tabs`, []));
  const [recent, setRecent] = useState<RecentItem[]>(() => load<RecentItem[]>(`${key}-recent`, []));
  const current = loc.pathname;

  useEffect(() => { try { localStorage.setItem(`${key}-tabs`, JSON.stringify(tabs)); } catch { /* ignore */ } }, [tabs, key]);
  useEffect(() => { try { localStorage.setItem(`${key}-recent`, JSON.stringify(recent.slice(0, 20))); } catch { /* ignore */ } }, [recent, key]);

  // Every page you visit becomes (or re-activates) a tab.
  useEffect(() => {
    setTabs((t) => {
      const i = t.findIndex((x) => x.path.split('?')[0] === loc.pathname);
      if (i >= 0) {
        if (t[i].path === fullPath(loc)) return t;
        const next = [...t];
        next[i] = { ...next[i], path: fullPath(loc) };
        return next;
      }
      let next = [...t, { path: fullPath(loc), title: '', kind: 'page' as const }];
      while (next.length > MAX_TABS) {
        const drop = next.findIndex((x) => !x.pinned && x.path.split('?')[0] !== loc.pathname);
        if (drop < 0) break;
        next = next.filter((_, j) => j !== drop);
      }
      return next;
    });
  }, [loc.pathname, loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTitle = useCallback((path: string, title: string, kind: WsTab['kind'] = 'page', icon?: string) => {
    setTabs((t) => {
      const i = t.findIndex((x) => x.path.split('?')[0] === path);
      if (i < 0 || (t[i].title === title && t[i].kind === kind && t[i].icon === icon)) return t;
      const next = [...t];
      next[i] = { ...next[i], title, kind, icon };
      return next;
    });
  }, []);

  const close = useCallback((path: string) => {
    setTabs((t) => {
      const i = t.findIndex((x) => x.path === path);
      if (i < 0) return t;
      const next = t.filter((_, j) => j !== i);
      if (path.split('?')[0] === loc.pathname) {
        const neighbour = next[i] ?? next[i - 1];
        setTimeout(() => nav(neighbour?.path ?? '/'), 0);
      }
      return next;
    });
  }, [loc.pathname, nav]);

  const closeOthers = useCallback((path: string) => setTabs((t) => t.filter((x) => x.path === path || x.pinned)), []);
  const togglePin = useCallback((path: string) => setTabs((t) => t.map((x) => (x.path === path ? { ...x, pinned: !x.pinned } : x))), []);
  const pushRecent = useCallback((r: Omit<RecentItem, 'at'>) => {
    setRecent((list) => [{ ...r, at: Date.now() }, ...list.filter((x) => !(x.type === r.type && x.id === r.id))].slice(0, 20));
  }, []);

  const value = useMemo(() => ({ tabs, current, setTitle, close, closeOthers, togglePin, recent, pushRecent }), [tabs, current, setTitle, close, closeOthers, togglePin, recent, pushRecent]);
  return <WsCtx.Provider value={value}>{children}</WsCtx.Provider>;
}

export function useWorkspace() {
  const c = useContext(WsCtx);
  if (!c) throw new Error('useWorkspace outside WorkspaceProvider');
  return c;
}

// Pages call this to name their tab (and the browser tab).
export function usePageTitle(title: string | null | undefined, kind: WsTab['kind'] = 'page', icon?: string) {
  const { setTitle } = useWorkspace();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!title) return;
    setTitle(pathname, title, kind, icon);
    document.title = `${title} · Kivu Daily`;
  }, [title, pathname, kind, icon, setTitle]);
}
