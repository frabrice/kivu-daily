import { useEffect, useMemo, useState } from 'react';
import { Mail, Search, UserRound, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { usePageTitle } from '../../os/workspace';
import { EmptyState, Label, PageHeader } from '../../ui/kit';

// Call Center > Team: everyone at Kivu Ride and what they are in charge of,
// so an agent knows who to hand a case to. Built from live data: people and
// departments, their named duties (responsibilities, set by the MD in
// Notifications settings) and the agents' Kivu Ride dashboard accounts.
// What each duty covers is written here once, so reassigning a duty moves
// it to the new person by itself.

interface Person { id: string; full_name: string; role: string; responsibility_label: string | null; email: string | null; department: { slug: string; name: string } | null }

const DUTY: Record<string, { title: string; topics: string[] }> = {
  route_md: { title: 'Managing Director', topics: ['Approves payments, payroll and driver pauses', 'Emergencies: every emergency case goes to him', 'Anything nobody else can decide'] },
  route_bizdev: { title: 'Business development', topics: ['New partners, investors and car owners', 'Marketing and brand partners'] },
  route_corporate: { title: 'Company clients', topics: ['Companies that ride with us: agreements and prices'] },
  route_finance: { title: 'Finance', topics: ['Payments to car owners', 'Staff and driver salaries', 'Bank, Mobile Money and cash', 'Company invoices', 'App commissions entered each week'] },
  deposit_confirmation: { title: 'Confirms driver payments', topics: ['A driver says they paid but it is not confirmed yet', 'A wrong or rejected payment'] },
  branding_signups: { title: 'Branding & device sign-ups', topics: ['A Non-Insider driver wants branding or our device (meter)', 'Payment and installation date for branding or the device'] },
  route_operations: { title: 'Operations', topics: ['Cars that must stay off the road (driver not paid)', 'Cars with no driver', 'Drivers on shift and the daily fleet meeting'] },
  fleet_manager: { title: 'Fleet manager', topics: ['Our drivers: contracts, documents, days off', 'New drivers joining, replacements', 'Car owners we manage', 'Branding and devices on Non-Insider cars'] },
  route_it: { title: 'Head of IT', topics: ['The Kivu Ride app or dashboard is not working', 'A driver or passenger account problem in the app', 'Payments in the app failing', 'Kivu Daily problems (or Flag to IT on any page)'] },
  driver_payment_followup: { title: 'Driver payments follow-up', topics: ['Our drivers who owe their daily payment', 'Promises to pay'] },
  company_trips: { title: 'Company trips', topics: ['A trip to add to a company account'] },
};
// What a whole department does, shown for everyone in it.
const DEPT: Record<string, string[]> = {
  call_center: ['Hotline: passengers and drivers', 'Booking trips (Dispatch)', 'Calls after trips', 'Commission follow-up', 'Putting drivers online, calling those offline', 'Calling back callers'],
  it: ['App testing and problems'],
  fleet: ['Our cars and drivers'],
  finance: ['Money in and out'],
};
const ORDER = ['management', 'finance', 'fleet', 'it', 'call_center'];
const DEPT_NAME: Record<string, string> = { management: 'Management', finance: 'Finance', fleet: 'Fleet & Operations', it: 'IT', call_center: 'Call Center' };

export default function TeamPage() {
  usePageTitle('Team');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [duties, setDuties] = useState<{ key: string; label: string; profile_id: string | null }[]>([]);
  const [accounts, setAccounts] = useState<{ admin_id: number; profile_id: string | null; kind: string }[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, full_name, role, responsibility_label, email, department:departments(slug, name)').eq('is_active', true),
      supabase.from('responsibilities').select('key, label, profile_id'),
      supabase.from('kivuride_admin_accounts').select('admin_id, profile_id, kind'),
    ]).then(([p, r, a]) => {
      setPeople(((p.data ?? []) as unknown as Person[]).map((x) => ({ ...x, full_name: x.full_name.trim() })));
      setDuties((r.data ?? []) as { key: string; label: string; profile_id: string | null }[]);
      setAccounts((a.data ?? []) as { admin_id: number; profile_id: string | null; kind: string }[]);
    });
  }, []);

  const cards = useMemo(() => (people ?? []).map((p) => {
    const dept = p.role === 'managing_director' ? 'management' : p.department?.slug ?? 'other';
    const mine = duties.filter((d) => d.profile_id === p.id).map((d) => ({ key: d.key, title: DUTY[d.key]?.title ?? d.label, topics: DUTY[d.key]?.topics ?? [] }));
    const account = accounts.find((x) => x.profile_id === p.id && x.kind === 'agent')?.admin_id ?? null;
    const role = p.role === 'managing_director' ? 'Managing Director' : p.responsibility_label || (dept === 'call_center' ? 'Call Center agent' : DEPT_NAME[dept] ?? '');
    const text = [p.full_name, role, DEPT_NAME[dept], ...mine.flatMap((m) => [m.title, ...m.topics]), ...(DEPT[dept] ?? [])].join(' ').toLowerCase();
    return { p, dept, mine, account, role, text };
  }).sort((a, b) => ORDER.indexOf(a.dept) - ORDER.indexOf(b.dept) || a.p.full_name.localeCompare(b.p.full_name)), [people, duties, accounts]);

  const term = q.trim().toLowerCase();
  const shown = cards.filter((c) => !term || term.split(/\s+/).every((w) => c.text.includes(w)));
  // "Who do I go to for…": every duty with a holder.
  const topics = duties.filter((d) => d.profile_id && DUTY[d.key]).flatMap((d) => DUTY[d.key].topics.map((t) => ({ t, who: cards.find((c) => c.p.id === d.profile_id) })))
    .filter((x) => x.who && (!term || x.t.toLowerCase().includes(term) || x.who.p.full_name.toLowerCase().includes(term)));

  return (
    <div className="space-y-4">
      <PageHeader icon={Users} title="Team" subtitle="Everyone at Kivu Ride and what they are in charge of: who to hand a case to." />
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name or a problem: payment, app, branding, contract…" className="input pl-9" aria-label="Search the team" />
      </div>

      {!people ? <div className="h-40 skeleton rounded-card" /> : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-4">
            {ORDER.concat('other').map((dept) => {
              const list = shown.filter((c) => c.dept === dept);
              if (!list.length) return null;
              return (
                <section key={dept}>
                  <h2 className="section-title mb-2">{DEPT_NAME[dept] ?? 'Others'} <span className="text-fg-subtle font-normal">· {list.length}</span></h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {list.map((c) => (
                      <div key={c.p.id} className="card p-3">
                        <div className="flex items-start gap-2.5">
                          <span className="w-9 h-9 rounded-full bg-inset flex items-center justify-center shrink-0 text-small font-semibold">{c.p.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold truncate">{c.p.full_name}</p>
                            <p className="text-caption text-fg-muted">{c.role}{c.account ? ` · dashboard #${c.account}` : ''}</p>
                          </div>
                          {c.p.email && <a href={`mailto:${c.p.email}`} className="btn-ghost h-7 px-2" title={c.p.email} aria-label={`Email ${c.p.full_name}`}><Mail size={13} /></a>}
                        </div>
                        {c.mine.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {c.mine.map((m) => (
                              <div key={m.key}>
                                <Label tone="accent">{m.title}</Label>
                                {m.topics.length > 0 && <ul className="mt-1 text-caption text-fg-muted list-disc pl-4">{m.topics.map((t) => <li key={t}>{t}</li>)}</ul>}
                              </div>
                            ))}
                          </div>
                        )}
                        {!c.mine.length && DEPT[c.dept] && <p className="mt-2 text-caption text-fg-muted">{DEPT[c.dept].join(' · ')}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            {shown.length === 0 && <EmptyState icon={UserRound} title="Nobody matches" body="Try another word, like payment, app, car or branding." />}
          </div>

          <aside className="card p-3 h-fit">
            <p className="text-body font-semibold mb-2">Who do I go to for…</p>
            {topics.length ? (
              <ul className="divide-y divide-line-muted">
                {topics.map((x, i) => (
                  <li key={i} className="py-1.5 text-small flex items-start justify-between gap-3">
                    <span>{x.t}</span>
                    <button className="font-medium text-link whitespace-nowrap" onClick={() => setQ(x.who!.p.full_name)}>{x.who!.p.full_name.split(/\s+/).slice(0, 2).join(' ')}</button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-small text-fg-muted">Nothing matches.</p>}
            <p className="text-micro text-fg-subtle mt-3">Duties are set by the MD in Notifications settings; this page follows them.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
