import { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, FileText, History, MessageSquare, Phone, PhoneCall, RotateCcw, ShieldCheck, Siren, UserCheck, Wand2, XCircle,
} from 'lucide-react';
import { EntityViewProps } from '../../os/peek';
import { EntityLink, useEntityMeta } from '../../os/EntityLink';
import { useCallTickets, STATUS_META, CATEGORY_LABEL, isOverdue, isUnresolved } from '../../lib/callTickets';
import { CallTicketUpdate } from '../../lib/supabase';
import { durationLabel } from '../../lib/shifts';
import { Box, Details, EmptyState, Label, ObjectLayout, PageHeader, StatCard, StatGrid, Timeline, TimelineItem, Tone } from '../../ui/kit';
import TicketDrawer from '../../components/callTickets/TicketDrawer';

const KIND: Record<CallTicketUpdate['kind'], { icon: typeof History; tone: Tone }> = {
  created: { icon: PhoneCall, tone: 'info' }, note: { icon: MessageSquare, tone: 'neutral' }, status: { icon: RotateCcw, tone: 'attention' },
  reassigned: { icon: UserCheck, tone: 'accent' }, resolved: { icon: CheckCircle2, tone: 'success' }, closed: { icon: XCircle, tone: 'neutral' },
  reopened: { icon: RotateCcw, tone: 'attention' }, acknowledged: { icon: ShieldCheck, tone: 'done' }, callback: { icon: Phone, tone: 'info' },
};

// A Call Center case as a conversation: who called, what happened, who
// has it now, how fast it was answered - GitHub-issue style.
export default function CaseEntity({ id, mode }: EntityViewProps) {
  const { tickets, people, loading, reload, personName, updatesFor } = useCallTickets();
  const [acting, setActing] = useState(false);
  const t = tickets.find((x) => x.id === id) ?? null;
  useEntityMeta('case', id, mode, t ? `${t.reference} · ${t.caller_name}` : null, t?.status);

  if (loading) return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 skeleton rounded-card" />)}</div>;
  if (!t) return <EmptyState icon={FileText} title="Case not found" body="It may belong to another department, or it was removed." />;

  const updates = updatesFor(id);
  const open = isUnresolved(t);
  const st = STATUS_META[t.status];
  const statusTone: Tone = t.status === 'resolved' ? 'success' : t.status === 'closed' ? 'neutral' : t.status === 'waiting_on_caller' ? 'done' : 'attention';
  const firstReply = t.first_response_at ? (new Date(t.first_response_at).getTime() - new Date(t.assigned_at ?? t.created_at).getTime()) / 60000 : null;
  const age = ((t.resolved_at ? new Date(t.resolved_at).getTime() : Date.now()) - new Date(t.created_at).getTime()) / 60000;

  const timeline: TimelineItem[] = [
    { id: 'origin', at: t.created_at, icon: PhoneCall, tone: 'info', title: <><b>{t.caller_name}</b> {t.channel === 'call' ? 'called' : `wrote on ${t.channel}`} · logged by {personName(t.created_by)}</>, body: <p className="whitespace-pre-wrap text-fg">{t.details}</p> },
    ...updates.filter((u) => u.kind !== 'created').map((u) => {
      const k = KIND[u.kind] ?? KIND.note;
      const who = personName(u.author_id);
      const title = u.kind === 'reassigned' ? <>{who} handed it to <b>{personName(u.to_assignee)}</b></>
        : u.kind === 'status' ? <>{who} changed it from {STATUS_META[u.from_status ?? 'open']?.label ?? u.from_status} to <b>{STATUS_META[u.to_status ?? 'open']?.label ?? u.to_status}</b></>
        : u.kind === 'note' ? <>{who} added a note</> : <>{who} · {u.kind.replace(/_/g, ' ')}</>;
      return { id: u.id, at: u.created_at, icon: k.icon, tone: k.tone, title, body: u.body ? <p className="whitespace-pre-wrap">{u.body}</p> : undefined };
    }),
  ];

  const header = (
    <PageHeader icon={t.priority === 'emergency' ? Siren : FileText}
      title={<><span className="text-fg-muted font-normal">{t.reference}</span> {t.caller_name}</>}
      labels={<>
        <Label tone={statusTone}>{st?.label ?? t.status}</Label>
        {t.priority !== 'normal' && <Label tone="danger" icon={AlertTriangle}>{t.priority}</Label>}
        {open && isOverdue(t) && <Label tone="danger" icon={Clock}>Overdue</Label>}
      </>}
      meta={<>
        <span>{CATEGORY_LABEL[t.category] ?? t.category}{t.situation ? ` · ${t.situation}` : ''}</span>
        <span>opened {new Date(t.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        {t.assignee_id && <span>with <EntityLink type="person" id={t.assignee_id} label={personName(t.assignee_id)} /></span>}
      </>}
      actions={<button onClick={() => setActing(true)} className="btn-primary"><Wand2 size={14} /> {open ? 'Work on this case' : 'Open case actions'}</button>}
    />
  );

  const side = (
    <Box title="Details">
      <Details items={[
        { label: 'Caller', value: <span className="flex flex-col"><span>{t.caller_name}</span><a href={`tel:${t.caller_phone}`} className="link text-caption">{t.caller_phone}</a></span> },
        { label: 'Caller type', value: t.caller_type.replace(/_/g, ' ') },
        { label: 'Driver', value: t.driver_id ? <EntityLink type="driver" id={t.driver_id} label={t.driver_label ?? t.driver?.full_name ?? 'Driver'} /> : t.platform_driver_id ? <EntityLink type="partner" id={t.platform_driver_id} label={t.platform_driver?.full_name ?? 'Non-Insider driver'} /> : t.driver_label },
        { label: 'Trip', value: t.trip_reference },
        { label: 'Car', value: t.vehicle_plate },
        { label: 'Assigned to', value: t.assignee_id ? <EntityLink type="person" id={t.assignee_id} label={personName(t.assignee_id)} /> : 'Nobody yet' },
        { label: 'Promised update', value: t.promised_update_at ? new Date(t.promised_update_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null },
        { label: 'Call back', value: t.callback_at ? new Date(t.callback_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null },
        { label: 'Caller felt', value: t.satisfaction },
        { label: 'Resolution', value: t.resolution_note },
      ]} />
    </Box>
  );

  const stats = (
    <StatGrid cols={mode === 'peek' ? 2 : 3}>
      <StatCard label="First reply" icon={Clock} value={firstReply === null ? (open ? 'Waiting' : '—') : durationLabel(firstReply)} tone={firstReply !== null && firstReply > 120 ? 'danger' : firstReply !== null ? 'success' : open ? 'attention' : undefined} sub="Target: 2 hours" />
      <StatCard label={open ? 'Open for' : 'Took'} icon={History} value={durationLabel(age)} />
      <StatCard label="Updates" icon={MessageSquare} value={updates.length} />
    </StatGrid>
  );

  const drawer = acting && <TicketDrawer ticket={t} updates={updates} people={people} personName={personName} onClose={() => setActing(false)} onChanged={reload} />;
  if (mode === 'peek') return <div className="p-4 space-y-4">{header}{stats}<Box title="Conversation" icon={MessageSquare}><Timeline items={timeline} /></Box>{side}{drawer}</div>;
  return (
    <div className="animate-fade-in">
      {header}
      <ObjectLayout side={side} main={<>{stats}<Box title="Conversation" icon={MessageSquare}><Timeline items={timeline} /></Box></>} />
      {drawer}
    </div>
  );
}
