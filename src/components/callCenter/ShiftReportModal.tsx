import Modal from '../Modal';
import { CallCenterShift, durationLabel, INCOMING_TYPES, OUTGOING_TYPES, SLOT_LABEL } from '../../lib/shifts';

export const shiftMinutes = (s: CallCenterShift) => (s.stats.minutes ?? (new Date(s.ended_at ?? Date.now()).getTime() - new Date(s.started_at).getTime()) / 60000);

// One shift: the agent's report next to what Kivu Daily logged.
export default function ShiftReportModal({ shift: open, name, onClose }: { shift: CallCenterShift; name: (id: string | null) => string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`${name(open.agent_id)} — ${SLOT_LABEL[open.slot]}`} subtitle={`${new Date(open.started_at).toLocaleString('en-GB')} · ${durationLabel(shiftMinutes(open))} · ${open.station}`} maxWidth="max-w-lg">
      <div className="space-y-3 text-[12px]">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {[['Calls received', open.report.calls_received], ['Calls made', open.report.calls_made], ['Missed', open.report.calls_missed], ['WhatsApp/SMS', open.report.messages_handled],
            ['Contacts logged', open.stats.contacts_logged], ['Solved on the spot', open.stats.solved_on_call], ['Handed on', open.stats.handed_on], ['Cases closed', open.stats.cases_closed],
            ['Outreach calls', open.stats.outreach_calls], ['Bookings', open.stats.bookings], ['Emergencies', open.stats.emergencies], ['Late (min)', open.late_minutes]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-2 text-center"><p className="text-[14px] font-bold">{(v as number | undefined) ?? '—'}</p><p className="text-[10px] text-gray-500">{l}</p></div>
          ))}
        </div>
        {open.report.in_passengers !== undefined && (
          <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
            {([['Received', INCOMING_TYPES], ['Made', OUTGOING_TYPES]] as const).map(([l, types]) => (
              <div key={l} className="rounded-lg border border-gray-100 dark:border-white/10 p-2">
                <p className="font-semibold mb-0.5">{l}</p>
                {types.map((t) => <p key={t.key} className="flex justify-between text-gray-600 dark:text-gray-300"><span>{t.label}</span><b>{open.report[t.key] ?? 0}</b></p>)}
              </div>
            ))}
          </div>
        )}
        {([['Worked on', open.report.worked_on], ['Resolved', open.report.resolved_summary], ['Still unresolved', open.report.unresolved_summary], ['Problems', open.report.problems], ['Caller feedback', open.report.feedback], ['Suggestions', open.report.suggestions]] as [string, string | undefined][])
          .filter(([, v]) => v && v.trim()).map(([l, v]) => (
            <div key={l}><p className="text-[11px] font-semibold text-gray-500">{l}</p><p className="whitespace-pre-wrap">{v}</p></div>
          ))}
        {open.status === 'auto_closed' && <p className="text-red-600">This shift wasn't ended — it was closed automatically after 10 hours, so there's no report.</p>}
      </div>
    </Modal>
  );
}
