import { MouseEvent, ReactNode, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Car, FileText, Headphones, Truck, User, UserRound, CarFront, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { computeDepositStanding } from '../lib/fleet';
import { HoverCard } from '../ui/Popover';
import { Label, rwf } from '../ui/kit';
import { ENTITY_PATH, usePeek } from './peek';
import { EntityType, usePageTitle, useWorkspace } from './workspace';
import type { Driver, DriverDeposit } from '../lib/supabase';

const ICON: Record<EntityType, typeof Truck> = { driver: Truck, car: Car, owner: UserRound, person: User, agent: Headphones, case: FileText, partner: CarFront };

// A name that opens the object: click = side panel, Ctrl/middle click = new
// tab (it's a real link), hover = summary card.
export function EntityLink({ type, id, label, children, className = '', noHover }: { type: EntityType; id: string; label: string; children?: ReactNode; className?: string; noHover?: boolean }) {
  const { open } = usePeek();
  const href = ENTITY_PATH[type](id);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    open({ type, id, label });
  };
  const a = <a href={href} onClick={onClick} className={`link font-medium ${className}`}>{children ?? label}</a>;
  if (noHover) return a;
  return <HoverCard trigger={a}><EntitySummary type={type} id={id} /></HoverCard>;
}

// Object pages call this: names the tab and adds the object to "Recent".
export function useEntityMeta(type: EntityType, id: string, mode: 'page' | 'peek', label: string | null | undefined, sub?: string) {
  const { pushRecent } = useWorkspace();
  usePageTitle(mode === 'page' ? label : null, 'entity', type);
  useEffect(() => {
    if (label) pushRecent({ type, id, label, sub, path: ENTITY_PATH[type](id) });
  }, [type, id, label, sub, pushRecent]);
}

interface Summary { title: string; sub?: string; facts: [string, ReactNode][]; label?: ReactNode }

async function summarize(type: EntityType, id: string): Promise<Summary | null> {
  if (type === 'driver') {
    const [{ data: d }, { data: deps }] = await Promise.all([
      supabase.from('drivers').select('*, vehicle:vehicles(plate_number), pauses:driver_pauses(*)').eq('id', id).maybeSingle(),
      supabase.from('driver_deposits').select('*').eq('driver_id', id),
    ]);
    if (!d) return null;
    const drv = d as Driver;
    const s = drv.start_date ? computeDepositStanding(drv, (deps as DriverDeposit[]) ?? []) : null;
    return {
      title: drv.full_name, sub: [drv.vehicle?.plate_number, drv.shift ? `${drv.shift} shift` : null].filter(Boolean).join(' · '),
      label: drv.contract_status === 'ended' ? <Label>Contract ended</Label> : s?.pausedToday ? <Label tone="attention">Paused</Label> : s && !s.isCleared ? <Label tone="danger">Not paid up</Label> : <Label tone="success">Paid up</Label>,
      facts: [['Phone', drv.phone], ['Owes now', s ? rwf(s.owes) : '—'], ['Paid in total', s ? rwf(s.totalPaid) : '—']],
    };
  }
  if (type === 'car') {
    const [{ data: v }, { data: ds }] = await Promise.all([
      supabase.from('vehicles').select('plate_number, make, model, rura_license_expiry_date, operation_start_date').eq('id', id).maybeSingle(),
      supabase.from('drivers').select('full_name, shift').eq('vehicle_id', id).eq('contract_status', 'active'),
    ]);
    if (!v) return null;
    const drivers = (ds as { full_name: string; shift: string | null }[]) ?? [];
    return { title: v.plate_number, sub: [v.make, v.model].filter(Boolean).join(' '), label: drivers.length ? <Label tone="success">{drivers.length} driver{drivers.length === 1 ? '' : 's'}</Label> : <Label tone="danger">No driver</Label>,
      facts: [['Drivers', drivers.map((x) => `${x.full_name.split(' ')[0]}${x.shift ? ` (${x.shift})` : ''}`).join(', ') || '—'], ['Licence expires', v.rura_license_expiry_date ?? '—'], ['On the road since', v.operation_start_date ?? '—']] };
  }
  if (type === 'person' || type === 'agent') {
    const { data: p } = await supabase.from('profiles').select('full_name, email, role, department:departments(name)').eq('id', id).maybeSingle();
    if (!p) return null;
    return { title: p.full_name, sub: (p.department as { name?: string } | null)?.name ?? (p.role === 'managing_director' ? 'Managing Director' : ''), facts: [['Email', p.email ?? '—']] };
  }
  if (type === 'case') {
    const { data: t } = await supabase.from('call_tickets').select('reference, caller_name, caller_phone, status, category, priority, created_at').eq('id', id).maybeSingle();
    if (!t) return null;
    const tone = t.status === 'resolved' || t.status === 'closed' ? 'success' : t.priority === 'emergency' ? 'danger' : 'attention';
    return { title: `${t.reference} · ${t.caller_name}`, sub: String(t.category).replace(/_/g, ' '), label: <Label tone={tone}>{String(t.status).replace(/_/g, ' ')}</Label>, facts: [['Caller', t.caller_phone], ['Opened', new Date(t.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })]] };
  }
  if (type === 'partner') {
    const [{ data: d }, { data: st }] = await Promise.all([
      supabase.from('platform_drivers').select('full_name, phone, car:platform_cars(plate_number, branding_status, device_status)').eq('id', id).maybeSingle(),
      supabase.from('platform_outreach_status').select('last_result, last_called_at, device_answer, branding_answer, came_to_office_on').eq('platform_driver_id', id).maybeSingle(),
    ]);
    if (!d) return null;
    const car = d.car as { plate_number?: string } | null;
    return { title: d.full_name, sub: car?.plate_number ?? '', facts: [['Phone', d.phone ?? '—'], ['Last call', st?.last_called_at ? `${new Date(st.last_called_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${String(st.last_result ?? '').replace(/_/g, ' ')}` : 'Never'], ['Device / branding', `${st?.device_answer ?? '—'} / ${st?.branding_answer ?? '—'}`]] };
  }
  if (type === 'owner') {
    const [{ data: o }, { count }] = await Promise.all([
      supabase.from('vehicle_owners').select('full_name, phone, bank_name').eq('id', id).maybeSingle(),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('owner_id', id),
    ]);
    if (!o) return null;
    return { title: o.full_name, sub: `${count ?? 0} car${count === 1 ? '' : 's'}`, facts: [['Phone', o.phone ?? '—'], ['Bank', o.bank_name ?? '—']] };
  }
  return null;
}

function EntitySummary({ type, id }: { type: EntityType; id: string }) {
  const q = useQuery({ queryKey: ['entity-summary', type, id], queryFn: () => summarize(type, id), staleTime: 60_000 });
  const I = ICON[type];
  if (q.isLoading) return <div className="p-3 space-y-2"><div className="h-4 w-40 skeleton rounded" /><div className="h-3 w-56 skeleton rounded" /></div>;
  if (!q.data) return <p className="p-3 text-body text-fg-muted">Not available.</p>;
  const s = q.data;
  return (
    <div className="p-3">
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-md bg-inset border border-line-muted flex items-center justify-center shrink-0"><I size={15} className="text-fg-muted" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold truncate">{s.title}</p>
          {s.sub && <p className="text-caption text-fg-muted truncate capitalize">{s.sub}</p>}
        </div>
        {s.label}
      </div>
      <dl className="mt-2.5 space-y-1">
        {s.facts.map(([k, v]) => <div key={k} className="flex justify-between gap-3 text-caption"><dt className="text-fg-muted">{k}</dt><dd className="text-fg text-right truncate flex items-center gap-1">{k === 'Phone' && <Phone size={10} />}{v}</dd></div>)}
      </dl>
      <p className="mt-2 text-micro text-fg-subtle">Click to open · Ctrl+click for a new tab</p>
    </div>
  );
}
