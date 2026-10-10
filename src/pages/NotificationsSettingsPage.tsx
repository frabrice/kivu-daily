import { useEffect, useState } from 'react';
import { ArrowLeft, Mail, Send, CheckCircle2, XCircle, Clock, UserCog } from 'lucide-react';
import { supabase, Department, NotificationOutboxRow, NotificationRule, Profile, Responsibility } from '../lib/supabase';
import { timeAgo } from '../lib/utils';
import { edgeFunctionError } from '../lib/edgeFunctions';

// The MD's control room for the email engine (notifications-run): who
// owns each follow-up duty, which emails are switched on, a "send it to
// me" test for each one, and a log of everything that's gone out. The
// engine itself runs every 5 minutes on a schedule in the database - this
// page only changes who receives what and whether it's on.
export default function NotificationsSettingsPage({ onBack }: { onBack: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [duties, setDuties] = useState<Responsibility[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [outbox, setOutbox] = useState<NotificationOutboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const load = async () => {
    const [pRes, dRes, rRes, nRes, oRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      supabase.from('departments').select('*'),
      supabase.from('responsibilities').select('*').order('key', { ascending: false }),
      supabase.from('notification_rules').select('*').order('sort_order'),
      supabase.from('notification_outbox')
        .select('id, rule_key, recipient_id, recipient_email, subject, status, attempts, error, is_test, created_at, sent_at')
        .order('created_at', { ascending: false }).limit(50),
    ]);
    setProfiles((pRes.data as Profile[]) ?? []);
    setDepartments((dRes.data as Department[]) ?? []);
    setDuties((rRes.data as Responsibility[]) ?? []);
    setRules((nRes.data as NotificationRule[]) ?? []);
    setOutbox((oRes.data as NotificationOutboxRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const assignDuty = async (key: string, profileId: string) => {
    setDuties((prev) => prev.map((d) => (d.key === key ? { ...d, profile_id: profileId || null } : d)));
    await supabase.from('responsibilities').update({ profile_id: profileId || null, updated_at: new Date().toISOString() }).eq('key', key);
  };

  const toggleRule = async (rule: NotificationRule) => {
    setRules((prev) => prev.map((r) => (r.key === rule.key ? { ...r, enabled: !r.enabled } : r)));
    await supabase.from('notification_rules').update({ enabled: !rule.enabled, updated_at: new Date().toISOString() }).eq('key', rule.key);
  };

  const setDelivery = async (rule: NotificationRule, delivery: NotificationRule['delivery']) => {
    setRules((prev) => prev.map((r) => (r.key === rule.key ? { ...r, delivery } : r)));
    await supabase.from('notification_rules').update({ delivery, updated_at: new Date().toISOString() }).eq('key', rule.key);
  };

  const sendTest = async (rule: NotificationRule) => {
    setTesting(rule.key);
    const { data, error } = await supabase.functions.invoke('notifications-run', { body: { mode: 'test', rule_key: rule.key } });
    const result = error
      ? { ok: false, message: await edgeFunctionError(error) }
      : data?.sent
        ? { ok: true, message: `Sent to ${data.to}` }
        : { ok: false, message: data?.error ?? data?.message ?? 'Not sent' };
    setTestResult((prev) => ({ ...prev, [rule.key]: result }));
    setTesting(null);
    load();
  };

  const personName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? 'Nobody assigned';
  const audienceLabel = (token: string) => {
    if (token === 'md') return 'MD';
    if (token === 'actor') return 'The person it concerns';
    if (token === 'employees') return 'Each employee';
    if (token === 'person') return "The person it's addressed to";
    if (token.startsWith('dept:')) return `${departments.find((d) => d.slug === token.slice(5))?.name ?? token.slice(5)} team`;
    if (token.startsWith('resp:')) {
      const duty = duties.find((d) => d.key === token.slice(5));
      return duty ? personName(duty.profile_id) : token.slice(5);
    }
    return token;
  };
  const ruleLabel = (key: string) => rules.find((r) => r.key === key)?.label ?? key;
  const areas = [...new Set(rules.map((r) => r.area))];

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5">
        <ArrowLeft size={14} /> Back to MD Panel
      </button>

      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Mail size={16} className="text-brand-600 dark:text-brand-300" /> Email notifications</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Checked every 5 minutes, Kigali time. Emails are held between 20:00 and 06:30 and go out in the morning.</p>
        <p className="text-[11px] text-gray-500 mt-1">Most reports now arrive as sections of each person's <b>Your day</b> email (07:00), and non-urgent updates as one line in it. Only urgent things are sent on their own. Change any rule with "Delivered as".</p>
      </div>

      <section className="card p-4 space-y-3">
        <h3 className="text-[12px] font-semibold flex items-center gap-1.5"><UserCog size={14} /> Who's in charge</h3>
        <p className="text-[11px] text-gray-400 -mt-2">Changing the person here moves all of that duty's emails to them.</p>
        {duties.map((d) => (
          <div key={d.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium">{d.label}</p>
              {d.description && <p className="text-[11px] text-gray-400">{d.description}</p>}
            </div>
            <select className="input sm:w-56" value={d.profile_id ?? ''} onChange={(e) => assignDuty(d.key, e.target.value)}>
              <option value="">Nobody assigned</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
        ))}
      </section>

      {areas.map((area) => (
      <section key={area} className="space-y-2">
        <h3 className="text-[12px] font-semibold">{area}</h3>
        {rules.filter((r) => r.area === area).map((r) => {
          const res = testResult[r.key];
          return (
            <div key={r.key} className={`card p-4 ${r.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[12px] font-semibold">{r.label}</p>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-white/5 flex items-center gap-1"><Clock size={9} /> {r.schedule_label}</span>
                  </div>
                  {r.description && <p className="text-[11px] text-gray-400 mt-0.5">{r.description}</p>}
                  <p className="text-[11px] mt-1.5"><span className="text-gray-400">To:</span> {r.audience.map(audienceLabel).join(', ')}</p>
                  {r.preference_key && <p className="text-[11px] text-gray-400 mt-0.5">Each person can also switch this off for themselves in Settings.</p>}
                  {!['your_day', 'urgent_nudge'].includes(r.key) && (
                    <label className="flex items-center gap-2 mt-2 text-[11px]">
                      <span className="text-gray-400">Delivered as</span>
                      <select value={r.delivery} onChange={(e) => setDelivery(r, e.target.value as NotificationRule['delivery'])} className="input py-1 text-[11px] w-auto">
                        <option value="instant">{r.schedule_label.startsWith('Instant') ? 'Its own email, straight away' : 'Its own email'}</option>
                        {r.schedule_label.startsWith('Instant')
                          ? <option value="digest">A line in the next Your day email</option>
                          : <option value="bundled">A section of Your day (07:00)</option>}
                        <option value="off">Not sent</option>
                      </select>
                    </label>
                  )}
                </div>
                <button
                  onClick={() => toggleRule(r)}
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label={`${r.enabled ? 'Turn off' : 'Turn on'} ${r.label}`}
                  className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${r.enabled ? 'bg-brand' : 'bg-gray-300 dark:bg-white/15'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${r.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button onClick={() => sendTest(r)} disabled={testing !== null} className="btn-ghost flex items-center gap-1.5 text-[11px] disabled:opacity-50">
                  <Send size={12} /> {testing === r.key ? 'Sending…' : 'Send test to me'}
                </button>
                {res && (
                  <span className={`text-[11px] ${res.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{res.message}</span>
                )}
              </div>
            </div>
          );
        })}
      </section>
      ))}

      <section className="card p-4">
        <h3 className="text-[12px] font-semibold mb-2">Recently sent</h3>
        {outbox.length === 0 ? (
          <p className="text-[11px] text-gray-400 py-4 text-center">Nothing sent yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {outbox.map((o) => (
              <div key={o.id} className="py-2 flex items-start gap-2">
                {o.status === 'sent' ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                  : o.status === 'failed' ? <XCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                  : <Clock size={14} className="text-gray-400 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] truncate">{o.subject}</p>
                  <p className="text-[11px] text-gray-400">
                    {ruleLabel(o.rule_key)} · {personName(o.recipient_id) === 'Nobody assigned' ? o.recipient_email : personName(o.recipient_id)} · {timeAgo(o.sent_at ?? o.created_at)}
                    {o.status === 'pending' && ' · waiting to send'}
                  </p>
                  {o.status === 'failed' && o.error && <p className="text-[11px] text-red-500">{o.error}{o.attempts < 3 ? ' — will retry' : ''}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
