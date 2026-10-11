import { createContext, lazy, LazyExoticComponent, ComponentType, ReactNode, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Maximize2, X } from 'lucide-react';
import { EntityType } from './workspace';

// Objects open in a side panel next to the page you're on ("peek"), and
// peeks stack: driver -> their car -> its owner. "Open full page" turns
// the top one into its own page and tab.

export interface EntityRef { type: EntityType; id: string; label?: string }
export interface EntityViewProps { id: string; mode: 'page' | 'peek' }

export const ENTITY_PATH: Record<EntityType, (id: string) => string> = {
  driver: (id) => `/fleet/drivers/${id}`,
  car: (id) => `/fleet/cars/${id}`,
  owner: (id) => `/finance/owners/${id}`,
  person: (id) => `/people/${id}`,
  agent: (id) => `/call-center/agents/${id}`,
  case: (id) => `/cases/${id}`,
  partner: (id) => `/non-insider/${id}`,
};

export const ENTITY_VIEW: Record<EntityType, LazyExoticComponent<ComponentType<EntityViewProps>>> = {
  driver: lazy(() => import('../pages/entities/DriverEntity')),
  car: lazy(() => import('../pages/entities/CarEntity')),
  owner: lazy(() => import('../pages/entities/OwnerEntity')),
  person: lazy(() => import('../pages/entities/PersonEntity')),
  agent: lazy(() => import('../pages/entities/AgentEntity')),
  case: lazy(() => import('../pages/entities/CaseEntity')),
  partner: lazy(() => import('../pages/entities/PartnerEntity')),
};

interface Ctx { stack: EntityRef[]; open: (r: EntityRef) => void; back: () => void; close: () => void }
const PeekCtx = createContext<Ctx | null>(null);

export function PeekProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<EntityRef[]>([]);
  const open = useCallback((r: EntityRef) => setStack((s) => (s.length && s[s.length - 1].type === r.type && s[s.length - 1].id === r.id ? s : [...s.slice(-5), r])), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const close = useCallback(() => setStack([]), []);
  const value = useMemo(() => ({ stack, open, back, close }), [stack, open, back, close]);
  return <PeekCtx.Provider value={value}>{children}</PeekCtx.Provider>;
}

export function usePeek() {
  const c = useContext(PeekCtx);
  if (!c) throw new Error('usePeek outside PeekProvider');
  return c;
}

const TYPE_LABEL: Record<EntityType, string> = { driver: 'Driver', car: 'Car', owner: 'Vehicle owner', person: 'Person', agent: 'Agent', case: 'Case', partner: 'Non-Insider driver' };

export function PeekPanel() {
  const { stack, back, close } = usePeek();
  const nav = useNavigate();
  const top = stack[stack.length - 1];
  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest('input,textarea,select,[role=dialog]')) back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top, back]);
  if (!top) return null;
  const View = ENTITY_VIEW[top.type];
  return (
    <aside className="fixed md:sticky right-0 top-0 md:top-12 z-40 md:z-10 h-[100dvh] md:h-[calc(100vh-3rem)] w-full md:w-[460px] shrink-0 bg-surface-3 border-l border-line shadow-overlay md:shadow-none flex flex-col animate-slide-in-right" aria-label={`${TYPE_LABEL[top.type]} details`}>
      <div className="h-10 px-2 flex items-center gap-1 border-b border-line-muted shrink-0">
        {stack.length > 1 && <button onClick={back} className="btn-ghost p-1.5" aria-label="Back"><ChevronLeft size={15} /></button>}
        <div className="flex items-center gap-1 min-w-0 text-caption text-fg-muted">
          {stack.map((s, i) => (
            <span key={`${s.type}${s.id}`} className={`truncate ${i === stack.length - 1 ? 'text-fg font-medium' : ''}`}>{i > 0 && <span className="mx-1 text-fg-subtle">/</span>}{s.label ?? TYPE_LABEL[s.type]}</span>
          ))}
        </div>
        <div className="ml-auto flex items-center">
          <button onClick={() => { close(); nav(ENTITY_PATH[top.type](top.id)); }} className="btn-ghost p-1.5" title="Open full page" aria-label="Open full page"><Maximize2 size={14} /></button>
          <button onClick={close} className="btn-ghost p-1.5" title="Close (Esc)" aria-label="Close"><X size={15} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="p-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 skeleton rounded-lg" />)}</div>}>
          <View key={`${top.type}${top.id}`} id={top.id} mode="peek" />
        </Suspense>
      </div>
    </aside>
  );
}
