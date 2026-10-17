import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { useAccess, Access } from './access';
import { routeTable } from './registry';
import { WorkspaceProvider, usePageTitle } from './workspace';
import { PeekProvider, ENTITY_VIEW } from './peek';
import Shell from './shell/Shell';
import { EntityType } from './workspace';

// Kivu OS: one app for the MD and every department, with real addresses.

function PageRoute({ Component, title }: { Component: React.ComponentType; title: string }) {
  usePageTitle(title);
  return <Component />;
}

function EntityRoute({ type }: { type: EntityType }) {
  const { id } = useParams();
  const View = ENTITY_VIEW[type];
  return id ? <View key={id} id={id} mode="page" /> : <Navigate to="/" replace />;
}

// Links from emails used ?ticket=<id> and ?page=<key>; send them to the new addresses.
function LegacyLinks({ access }: { access: Access }) {
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    const p = new URLSearchParams(loc.search);
    const ticket = p.get('ticket');
    const page = p.get('page');
    if (loc.pathname !== '/' || (!ticket && !page)) return;
    if (page === 'fleet_branding') { nav('/fleet/branding', { replace: true }); return; }
    if (page === 'whats_new') { nav('/docs/whats-new', { replace: true }); return; }
    if (page === 'it_checkin') { nav('/product/team?checkin=1', { replace: true }); return; }
    if (page === 'it_inbox') { nav('/product/inbox', { replace: true }); return; }
    if (page === 'company_budget') { nav(`/company/budgets${p.get('b') ? `?b=${encodeURIComponent(p.get('b')!)}` : ''}`, { replace: true }); return; }
    if (page === 'it_health') { nav(`/product/health${p.get('tab') ? `?tab=${encodeURIComponent(p.get('tab')!)}` : ''}`, { replace: true }); return; }
    if (page === 'it_review') { nav(`/product/review${p.get('week') ? `?week=${encodeURIComponent(p.get('week')!)}` : ''}`, { replace: true }); return; }
    if (page === 'it_release') { nav(`/product/releases${p.get('r') ? `?r=${encodeURIComponent(p.get('r')!)}` : ''}`, { replace: true }); return; }
    if (page === 'it_roadmap') { nav(`/product/roadmap${p.get('i') ? `?i=${encodeURIComponent(p.get('i')!)}` : ''}`, { replace: true }); return; }
    if (page === 'it_issue') { nav(`/product/issues${p.get('issue') ? `?issue=${encodeURIComponent(p.get('issue')!)}` : ''}`, { replace: true }); return; }
    if (ticket) {
      const own = page === 'from_call_center' || access.dept !== 'call_center';
      nav(`${own ? '/me/cases' : '/call-center/cases'}?ticket=${encodeURIComponent(ticket)}`, { replace: true });
      return;
    }
    if (page === 'from_call_center') nav('/me/cases', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function NotFound() {
  usePageTitle('Not found');
  return (
    <div className="max-w-md mx-auto mt-16 card p-8 text-center">
      <Compass size={28} className="mx-auto text-fg-subtle mb-3" />
      <p className="text-title font-semibold">This page isn't here</p>
      <p className="text-body text-fg-muted mt-1">It may have moved in the new Kivu Daily, or you may not have access to it.</p>
      <Link to="/" className="btn-primary mt-5">Go home</Link>
    </div>
  );
}

function OsRoutes() {
  const access = useAccess();
  const routes = useMemo(() => routeTable(access), [access]);
  const canFleet = access.in('fleet', 'it', 'finance');
  return (
    <WorkspaceProvider>
      <PeekProvider>
        <LegacyLinks access={access} />
        <Shell access={access}>
          <Routes>
            {routes.map((p) => <Route key={p.path} path={p.path} element={<PageRoute Component={p.component} title={p.label} />} />)}
            {canFleet && <Route path="/fleet/drivers/:id" element={<EntityRoute type="driver" />} />}
            {canFleet && <Route path="/fleet/cars/:id" element={<EntityRoute type="car" />} />}
            {access.in('finance') && <Route path="/finance/owners/:id" element={<EntityRoute type="owner" />} />}
            {(access.isMd || access.dept === 'finance') && <Route path="/people/:id" element={<EntityRoute type="person" />} />}
            {access.isMd && <Route path="/call-center/agents/:id" element={<EntityRoute type="agent" />} />}
            <Route path="/cases/:id" element={<EntityRoute type="case" />} />
            {access.in('fleet', 'it', 'call_center') && <Route path="/non-insider/:id" element={<EntityRoute type="partner" />} />}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Shell>
      </PeekProvider>
    </WorkspaceProvider>
  );
}

export default function OsApp() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <OsRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
