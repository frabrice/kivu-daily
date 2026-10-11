import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CarFront, FileText, Megaphone, Paintbrush, Pencil, Phone, PhoneCall, Smartphone } from 'lucide-react';
import { EntityViewProps } from '../../os/peek';
import { EntityLink, useEntityMeta } from '../../os/EntityLink';
import { useAuth } from '../../lib/auth';
import { supabase, PlatformCar, PlatformDriver } from '../../lib/supabase';
import { canEditFleet } from '../../lib/fleet';
import { ANSWER_LABEL, APP_STATUS_SHORT, categoryOf, CATEGORY_LABEL, OutreachCall, OutreachStatus, RESULT_LABEL } from '../../lib/outreach';
import { Box, Details, EmptyState, Label, ObjectLayout, PageHeader, StatCard, StatGrid, Timeline, TimelineItem, Tone } from '../../ui/kit';
import PlatformDriverDrawer from '../../components/nonInsider/PlatformDriverDrawer';
import DriverCasesList from '../../components/callTickets/DriverCasesList';

const CAT_TONE: Record<string, Tone> = { came: 'success', accepted: 'accent', thinking: 'attention', declined: 'neutral', not_reached: 'neutral', wrong_number: 'danger' };

// A Non-Insider driver: every outreach call and answer, their car's
// branding/device follow-up, and any cases.
export default function PartnerEntity({ id, mode }: EntityViewProps) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(false);
  const canEdit = canEditFleet(profile);
  const q = useQuery({
    queryKey: ['partner', id],
    queryFn: async () => {
      const [d, s, c, cars, names] = await Promise.all([
        supabase.from('platform_drivers').select('*, car:platform_cars(*)').eq('id', id).maybeSingle(),
        supabase.from('platform_outreach_status').select('*').eq('platform_driver_id', id).maybeSingle(),
        supabase.from('platform_outreach_calls').select('*').eq('platform_driver_id', id).order('created_at', { ascending: false }),
        supabase.from('platform_cars').select('*').order('plate_number'),
        supabase.from('profiles').select('id, full_name'),
      ]);
      return {
        driver: d.data as PlatformDriver | null, status: s.data as OutreachStatus | null, calls: (c.data as OutreachCall[]) ?? [], cars: (cars.data as PlatformCar[]) ?? [],
        names: Object.fromEntries(((names.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name.trim()])) as Record<string, string>,
      };
    },
  });
  const driver = q.data?.driver ?? null;
  useEntityMeta('partner', id, mode, driver?.full_name, driver?.car?.plate_number);

  if (q.isLoading) return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-card" />)}</div>;
  if (!driver) return <EmptyState icon={CarFront} title="Non-Insider driver not found" />;
  const { status, calls, cars, names } = q.data!;
  const cat = categoryOf(status ?? undefined);
  const reached = calls.filter((c) => c.result === 'reached').length;
  const car = driver.car ?? null;

  const timeline: TimelineItem[] = [
    ...calls.map((c) => ({
      id: c.id, at: c.created_at, icon: PhoneCall, tone: (c.interested ? 'success' : c.result === 'reached' ? 'info' : 'neutral') as Tone,
      title: <>Round {c.round} · <b>{RESULT_LABEL[c.result]}</b>{c.agent_id && <> · <EntityLink type="person" id={c.agent_id} label={names[c.agent_id] ?? 'Agent'} noHover /></>}</>,
      body: c.result === 'reached' ? [c.app_status && `App: ${APP_STATUS_SHORT[c.app_status]}`, c.device_answer && `Device: ${ANSWER_LABEL[c.device_answer]}`, c.branding_answer && `Branding: ${ANSWER_LABEL[c.branding_answer]}`, c.note].filter(Boolean).join(' · ') : c.note ?? undefined,
    })),
    ...(status?.came_to_office_on ? [{ id: 'came', at: status.came_to_office_on, icon: Building2, tone: 'success' as Tone, title: <>Came to the office</> }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const header = (
    <PageHeader icon={CarFront} title={driver.full_name}
      labels={<Label tone={CAT_TONE[cat]}>{CATEGORY_LABEL[cat].split(' — ')[0]}</Label>}
      meta={<>{car && <span className="font-mono">{car.plate_number}</span>}<a href={`tel:${driver.phone}`} className="link flex items-center gap-1"><Phone size={11} />{driver.phone}</a>{driver.is_owner && <span>Owns the car</span>}</>}
      actions={mode === 'page' && canEdit ? <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={14} /> Edit</button> : undefined} />
  );
  const stats = (
    <StatGrid cols={mode === 'peek' ? 2 : 4}>
      <StatCard label="Outreach calls" icon={Megaphone} value={calls.length} sub={`${reached} reached`} />
      <StatCard label="Updated app" icon={Smartphone} value={status?.app_status ? APP_STATUS_SHORT[status.app_status] : 'Not asked'} />
      <StatCard label="Our device" icon={Smartphone} value={status?.device_answer ? ANSWER_LABEL[status.device_answer] : 'Not asked'} tone={status?.device_answer === 'yes' ? 'success' : undefined} sub={car?.device_status ? `Follow-up: ${car.device_status.replace(/_/g, ' ')}` : undefined} />
      <StatCard label="Branding" icon={Paintbrush} value={status?.branding_answer ? ANSWER_LABEL[status.branding_answer] : 'Not asked'} tone={status?.branding_answer === 'yes' ? 'success' : undefined} sub={car?.branding_status ? `Follow-up: ${car.branding_status.replace(/_/g, ' ')}` : undefined} />
    </StatGrid>
  );
  const side = (
    <Box title="Details">
      <Details items={[
        { label: 'Car', value: car ? `${car.plate_number}${car.make ? ` · ${[car.make, car.model].filter(Boolean).join(' ')}` : ''}` : 'No car' },
        { label: 'Uses the app', value: status?.app_usage?.replace(/_/g, ' ') },
        { label: 'Usual area', value: status?.usual_area },
        { label: 'Last called', value: status?.last_called_at ? new Date(status.last_called_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never' },
        { label: 'Call back', value: status?.callback_at ? new Date(status.callback_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null },
        { label: 'Car follow-up notes', value: car?.followup_notes },
        { label: 'Notes', value: driver.notes },
      ]} />
    </Box>
  );
  const drawer = editing && <PlatformDriverDrawer driver={driver} startEditing cars={cars} canEdit={canEdit} onClose={() => setEditing(false)} onSaved={() => q.refetch()} />;
  if (mode === 'peek') return <div className="p-4 space-y-4">{header}{stats}<Box title="Calls" icon={PhoneCall}><Timeline items={timeline} empty="Not called yet." /></Box>{side}{drawer}</div>;
  return (
    <div className="animate-fade-in">
      {header}
      <ObjectLayout side={side} main={<>
        {stats}
        <Box title="Outreach calls" icon={PhoneCall}><Timeline items={timeline} empty="Not called yet." /></Box>
        <Box title="Cases" icon={FileText}><DriverCasesList platformDriverId={id} /></Box>
      </>} />
      {drawer}
    </div>
  );
}
