import { useEffect, useState } from 'react';
import { Ban, ExternalLink, Hand, MessageSquare, Pencil, Send, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  ItData, ItEvent, ItIssue, PRIORITY_OF, SIZES, SOURCE_LABEL, STATUSES, STATUS_OF, TYPE_LABEL, IssueStatus, keyOf, loadIssueEvents, when, ago,
} from '../../lib/it';
import Modal from '../Modal';
import { Label } from '../../ui/kit';
import { IssueFormModal } from './ItModals';

// One issue: what it is, where it stands, who did what, and the conversation.
export default function IssuePanel({ data, issue, me, isLead, onClose }: { data: ItData; issue: ItIssue; me: string; isLead: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<ItEvent[]>([]);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { loadIssueEvents(issue.id).then(setEvents); }, [issue.id, issue.updated_at]);
  const milestone = data.milestones.find((m) => m.id === issue.milestone_id);
  const inbox = issue.inbox_id ? data.inbox.find((x) => x.id === issue.inbox_id) : null;
  const canWork = isLead || !issue.assignee_id || issue.assignee_id === me;

  const update = async (patch: Partial<ItIssue>) => {
    setBusy(true); setError('');
    const { error: err } = await supabase.from('it_issues').update(patch).eq('id', issue.id);
    setBusy(false);
    if (err) setError(err.message); else data.reload();
  };
  const send = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.from('it_issue_events').insert({ issue_id: issue.id, kind: 'comment', body: comment.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setComment('');
    setEvents(await loadIssueEvents(issue.id));
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${keyOf(issue.id)}? Prefer "Won't do" to keep the history.`)) return;
    const { error: err } = await supabase.from('it_issues').delete().eq('id', issue.id);
    if (err) setError(err.message); else { data.reload(); onClose(); }
  };
  const toggleCriterion = (i: number) => update({ acceptance_criteria: issue.acceptance_criteria.map((c, j) => (j === i ? { ...c, done: !c.done } : c)) });

  const eventText = (e: ItEvent) => {
    const st = (v: string | null) => (v ? STATUS_OF[v as IssueStatus]?.label ?? v : '—');
    switch (e.kind) {
      case 'created': return <>created it</>;
      case 'status': return <>moved it from <b>{st(e.from_value)}</b> to <b>{st(e.to_value)}</b></>;
      case 'assigned': return e.to_value ? <>assigned it to <b>{data.nameOf(e.to_value)}</b></> : <>unassigned it</>;
      case 'milestone': return e.to_value ? <>put it in <b>M{data.milestones.find((m) => m.id === e.to_value)?.number} · {data.milestones.find((m) => m.id === e.to_value)?.name ?? 'a milestone'}</b></> : <>took it out of its milestone</>;
      case 'priority': return <>changed priority {e.from_value?.toUpperCase()} → <b>{e.to_value?.toUpperCase()}</b></>;
      case 'planned': return e.to_value === 'true' ? <>marked it <b>planned</b></> : <>marked it unplanned</>;
      case 'blocked': return <>marked it <b className="text-danger">blocked</b>{e.body ? `: ${e.body}` : ''}</>;
      case 'unblocked': return <>unblocked it</>;
      default: return null;
    }
  };

  return (
    <Modal open onClose={onClose} title={`${keyOf(issue.id)} · ${issue.title}`} subtitle={`${TYPE_LABEL[issue.type]} · ${issue.areas.map(data.areaLabel).join(', ') || 'no area'}`} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <select value={issue.status} disabled={!canWork || busy} onChange={(e) => update({ status: e.target.value as IssueStatus })} className="input !w-auto !py-1" aria-label="Status">
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Label tone={PRIORITY_OF[issue.priority].tone}>{PRIORITY_OF[issue.priority].label}</Label>
          {!issue.planned && <Label tone="attention">Unplanned</Label>}
          {issue.blocked && <Label tone="danger" icon={Ban}>Blocked</Label>}
          <div className="ml-auto flex flex-wrap gap-1.5">
            {issue.assignee_id !== me && (!issue.assignee_id || isLead) && <button onClick={() => update({ assignee_id: me })} className="btn-secondary text-caption"><Hand size={13} /> Take it</button>}
            {canWork && (issue.blocked
              ? <button onClick={() => update({ blocked: false })} className="btn-secondary text-caption">Unblock</button>
              : <button onClick={() => setBlocking(true)} className="btn-ghost text-caption"><Ban size={13} /> Blocked…</button>)}
            {canWork && <button onClick={() => setEditing(true)} className="btn-secondary text-caption"><Pencil size={13} /> Edit</button>}
            {isLead && !issue.planned && <button onClick={() => update({ planned: true })} className="btn-ghost text-caption">Mark planned</button>}
          </div>
        </div>
        {blocking && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-danger/40 p-2.5">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="input flex-1 min-w-[200px]" placeholder="What is blocking it? (waiting for…)" autoFocus />
            <button onClick={() => setBlocking(false)} className="btn-ghost">Cancel</button>
            <button onClick={() => { update({ blocked: true, blocked_reason: reason.trim() || null }); setBlocking(false); setReason(''); }} className="btn-danger">Mark blocked</button>
          </div>
        )}
        {issue.blocked && issue.blocked_reason && <p className="text-small text-danger">Blocked: {issue.blocked_reason}</p>}

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-small">
          {([
            ['Assignee', data.nameOf(issue.assignee_id)],
            ['Milestone', milestone ? `M${milestone.number} · ${milestone.name}` : 'Backlog'],
            ['Size', SIZES.find((s) => s.key === issue.size)?.label ?? 'Not sized'],
            ['Due', issue.due_date ?? '—'],
            ['Source', `${SOURCE_LABEL[issue.source]}${inbox ? ` · ${data.nameOf(inbox.submitted_by)}` : ''}`],
            ['Created', `${data.nameOf(issue.created_by)} · ${when(issue.created_at)}`],
            ['Started', when(issue.started_at)],
            ['Finished', when(issue.completed_at)],
            ['Last update', ago(issue.last_activity_at)],
          ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-caption text-fg-muted">{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {issue.labels.length > 0 && <div className="flex flex-wrap gap-1">{issue.labels.map((l) => <Label key={l}>{l}</Label>)}</div>}
        {issue.github_url && <a href={issue.github_url} target="_blank" rel="noreferrer" className="link text-small inline-flex items-center gap-1"><ExternalLink size={13} /> GitHub</a>}
        {issue.description && <p className="text-body whitespace-pre-line">{issue.description}</p>}

        {issue.acceptance_criteria.length > 0 && (
          <section>
            <h3 className="text-body font-semibold mb-1.5">Done when</h3>
            <ul className="space-y-1">
              {issue.acceptance_criteria.map((c, i) => (
                <li key={i}><label className="flex items-start gap-2 text-body cursor-pointer"><input type="checkbox" className="mt-1" checked={c.done} disabled={!canWork} onChange={() => toggleCriterion(i)} /><span className={c.done ? 'line-through text-fg-muted' : ''}>{c.text}</span></label></li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="text-body font-semibold mb-2 flex items-center gap-1.5"><MessageSquare size={14} /> Activity</h3>
          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className={e.kind === 'comment' ? 'rounded-lg border border-line p-2.5' : 'text-small text-fg-muted'}>
                {e.kind === 'comment'
                  ? <><p className="text-caption text-fg-muted"><b className="text-fg">{data.nameOf(e.actor)}</b> · {when(e.at)}</p><p className="text-body whitespace-pre-line mt-0.5">{e.body}</p></>
                  : <><b className="text-fg">{data.nameOf(e.actor)}</b> {eventText(e)} · {when(e.at)}</>}
              </li>
            ))}
          </ol>
          <div className="flex gap-2 mt-3">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="input resize-none flex-1" placeholder="Write an update or a question…" />
            <button onClick={send} disabled={busy || !comment.trim()} className="btn-primary self-end disabled:opacity-50" aria-label="Send"><Send size={14} /></button>
          </div>
        </section>
        {error && <p className="text-caption text-danger">{error}</p>}
        {isLead && <button onClick={remove} className="btn-ghost text-caption text-fg-subtle hover:text-danger"><Trash2 size={13} /> Delete issue</button>}
      </div>
      {editing && <IssueFormModal data={data} issue={issue} isLead={isLead} me={me} onClose={() => setEditing(false)} onSaved={() => data.reload()} />}
    </Modal>
  );
}
