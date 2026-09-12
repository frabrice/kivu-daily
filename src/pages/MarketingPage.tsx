import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Target, ArrowLeft, Building2, Phone, Mail, CalendarClock, AlertTriangle, Trash2 } from 'lucide-react';
import { supabase, Campaign, Contact, ContactStage, CampaignStatus } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo, todayStr } from '../lib/utils';
import Modal from '../components/Modal';

type Tab = 'campaigns' | 'followups';

const STAGES: { key: ContactStage; label: string; color: string }[] = [
  { key: 'not_contacted', label: 'Not Contacted', color: '#9ca3af' },
  { key: 'contacted', label: 'Contacted', color: '#2F8C86' },
  { key: 'negotiating', label: 'Negotiating', color: '#f97316' },
  { key: 'won', label: 'Won', color: '#4F7B3E' },
  { key: 'lost', label: 'Lost', color: '#ef4444' },
];

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | 'new' | null>(null);

  const load = useCallback(async () => {
    const [c, k] = await Promise.all([
      supabase.from('campaigns').select('*, owner:profiles(*)').order('created_at', { ascending: false }),
      supabase.from('contacts').select('*').order('created_at', { ascending: false }),
    ]);
    setCampaigns((c.data as Campaign[]) ?? []);
    setContacts((k.data as Contact[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('crm-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  useEffect(() => {
    if (selectedCampaign) {
      const fresh = campaigns.find((c) => c.id === selectedCampaign.id);
      if (fresh) setSelectedCampaign(fresh);
    }
  }, [campaigns]); // eslint-disable-line react-hooks/exhaustive-deps

  const followUpsDue = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 3);
    return contacts
      .filter((c) => c.next_follow_up && new Date(c.next_follow_up) <= cutoff && c.stage !== 'won' && c.stage !== 'lost')
      .sort((a, b) => (a.next_follow_up ?? '').localeCompare(b.next_follow_up ?? ''));
  }, [contacts]);

  const overdueCount = followUpsDue.filter((c) => c.next_follow_up! < todayStr()).length;

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  if (selectedCampaign) {
    return (
      <CampaignDetail
        campaign={selectedCampaign}
        contacts={contacts.filter((c) => c.campaign_id === selectedCampaign.id)}
        onBack={() => setSelectedCampaign(null)}
        onAddContact={() => setEditContact('new')}
        onEditContact={(c) => setEditContact(c)}
        onSaved={load}
      >
        {editContact && (
          <ContactDrawer
            contact={editContact === 'new' ? null : editContact}
            campaignId={selectedCampaign.id}
            onClose={() => setEditContact(null)}
            onSaved={load}
          />
        )}
      </CampaignDetail>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
          <TabButton active={tab === 'campaigns'} onClick={() => setTab('campaigns')} label="Campaigns" />
          <TabButton active={tab === 'followups'} onClick={() => setTab('followups')} label="Follow-ups" badge={overdueCount} />
        </div>
        {tab === 'campaigns' && (
          <button onClick={() => setNewCampaignOpen(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> New Campaign
          </button>
        )}
      </div>

      {tab === 'campaigns' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {campaigns.map((camp) => {
            const campContacts = contacts.filter((c) => c.campaign_id === camp.id);
            const won = campContacts.filter((c) => c.stage === 'won').length;
            const contactedOrFurther = campContacts.filter((c) => c.stage !== 'not_contacted').length;
            return (
              <button key={camp.id} onClick={() => setSelectedCampaign(camp)} className="card p-4 text-left hover:shadow-md hover:border-brand/30 transition-all">
                <div className="flex items-start justify-between mb-1.5">
                  <p className="text-[13px] font-semibold truncate pr-2">{camp.name}</p>
                  <StatusBadge status={camp.status} />
                </div>
                {camp.goal && <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{camp.goal}</p>}
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>{campContacts.length} contact{campContacts.length === 1 ? '' : 's'}</span>
                  <span>{contactedOrFurther} reached · <span className="text-positive font-medium">{won} won</span></span>
                </div>
                {campContacts.length > 0 && (
                  <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mt-2 flex">
                    {STAGES.map((s) => {
                      const n = campContacts.filter((c) => c.stage === s.key).length;
                      const pct = (n / campContacts.length) * 100;
                      return pct > 0 ? <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} /> : null;
                    })}
                  </div>
                )}
              </button>
            );
          })}
          {campaigns.length === 0 && (
            <div className="card p-10 text-center col-span-full">
              <Target size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">No campaigns yet. Start one to track outreach.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'followups' && (
        <div className="space-y-1.5">
          {followUpsDue.length === 0 && (
            <div className="card p-10 text-center">
              <CalendarClock size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">Nothing due in the next 3 days.</p>
            </div>
          )}
          {followUpsDue.map((c) => {
            const camp = campaigns.find((camp) => camp.id === c.campaign_id);
            const overdue = c.next_follow_up! < todayStr();
            return (
              <button
                key={c.id}
                onClick={() => { setSelectedCampaign(camp ?? null); setEditContact(c); }}
                className="w-full card p-3 flex items-center gap-3 text-left hover:shadow-md hover:border-brand/30 transition-all"
              >
                {overdue && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{c.org_name}</p>
                  <p className="text-[11px] text-gray-400">{camp?.name} {c.contact_person ? `· ${c.contact_person}` : ''}</p>
                </div>
                <span className={`text-[11px] font-medium shrink-0 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                  {overdue ? 'Overdue' : c.next_follow_up === todayStr() ? 'Today' : c.next_follow_up}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {newCampaignOpen && <NewCampaignDrawer onClose={() => setNewCampaignOpen(false)} onSaved={load} />}
    </div>
  );
}

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${active ? 'bg-white dark:bg-navy-800 text-brand-600 dark:text-brand-300 shadow-sm' : 'text-gray-500'}`}>
      {label}
      {!!badge && <span className="text-[9px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{badge}</span>}
    </button>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<CampaignStatus, string> = {
    active: 'bg-brand/10 text-brand-700 dark:text-brand-300',
    paused: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
    completed: 'bg-gray-100 dark:bg-white/10 text-gray-500',
  };
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${map[status]}`}>{status}</span>;
}

function CampaignDetail({
  campaign,
  contacts,
  onBack,
  onAddContact,
  onEditContact,
  children,
}: {
  campaign: Campaign;
  contacts: Contact[];
  onBack: () => void;
  onAddContact: () => void;
  onEditContact: (c: Contact) => void;
  onSaved: () => void;
  children: React.ReactNode;
}) {
  const byStage = useMemo(() => {
    const map: Record<ContactStage, Contact[]> = { not_contacted: [], contacted: [], negotiating: [], won: [], lost: [] };
    for (const c of contacts) map[c.stage].push(c);
    return map;
  }, [contacts]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 -ml-2">
        <ArrowLeft size={14} /> Campaigns
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{campaign.name}</h2>
            <StatusBadge status={campaign.status} />
          </div>
          {campaign.goal && <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{campaign.goal}</p>}
          <p className="text-[11px] text-gray-400 mt-1">Owned by {campaign.owner?.full_name ?? 'Unknown'}</p>
        </div>
        <button onClick={onAddContact} className="btn-primary flex items-center gap-1.5">
          <Plus size={14} /> Add Contact
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        {STAGES.map((s) => (
          <div key={s.key} className="space-y-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{s.label}</p>
              <span className="text-[10px] text-gray-400">{byStage[s.key].length}</span>
            </div>
            <div className="space-y-1.5 min-h-[40px]">
              {byStage[s.key].map((c) => {
                const overdue = c.next_follow_up && c.next_follow_up < todayStr();
                return (
                  <button key={c.id} onClick={() => onEditContact(c)} className="w-full card p-2.5 text-left hover:shadow-md hover:border-brand/30 transition-all">
                    <p className="text-[12px] font-medium truncate">{c.org_name}</p>
                    {c.type_tag && <p className="text-[10px] text-brand-600 dark:text-brand-300">{c.type_tag}</p>}
                    {c.contact_person && <p className="text-[11px] text-gray-400 truncate">{c.contact_person}</p>}
                    {c.next_follow_up && (
                      <p className={`text-[10px] mt-1 flex items-center gap-1 ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                        <CalendarClock size={10} /> {c.next_follow_up}
                      </p>
                    )}
                  </button>
                );
              })}
              {byStage[s.key].length === 0 && (
                <div className="h-12 rounded-lg border border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center">
                  <p className="text-[10px] text-gray-300 dark:text-white/20">Empty</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {children}
    </div>
  );
}

function NewCampaignDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('campaigns').insert({
      name: name.trim(),
      goal: goal.trim() || null,
      owner_id: profile!.id,
      start_date: startDate || null,
      end_date: endDate || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="New Campaign" subtitle="A push with a goal, timeframe, and a list of targets" maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Hotel Concierge Partnerships Q3" autoFocus />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Goal (optional)</label>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} className="input resize-none" placeholder="What does success look like?" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">End date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
          </div>
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Campaign'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ContactDrawer({
  contact,
  campaignId,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  campaignId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [orgName, setOrgName] = useState(contact?.org_name ?? '');
  const [contactPerson, setContactPerson] = useState(contact?.contact_person ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [typeTag, setTypeTag] = useState(contact?.type_tag ?? '');
  const [stage, setStage] = useState<ContactStage>(contact?.stage ?? 'not_contacted');
  const [nextFollowUp, setNextFollowUp] = useState(contact?.next_follow_up ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!orgName.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      org_name: orgName.trim(),
      contact_person: contactPerson.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      type_tag: typeTag.trim() || null,
      stage,
      next_follow_up: nextFollowUp || null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = contact
      ? await supabase.from('contacts').update(payload).eq('id', contact.id)
      : await supabase.from('contacts').insert({ ...payload, campaign_id: campaignId, created_by: profile!.id, last_touch: todayStr() });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!contact) return;
    setSaving(true);
    await supabase.from('contacts').delete().eq('id', contact.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={contact ? contact.org_name : 'Add Contact'} subtitle={contact ? `Last touched ${timeAgo(contact.updated_at)}` : undefined} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Building2 size={11} /> Organization</label>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="input" placeholder="Kigali Serena Hotel" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Contact person</label>
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="input" placeholder="Name" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Type</label>
            <input value={typeTag} onChange={(e) => setTypeTag(e.target.value)} className="input" placeholder="Hotel, Partner…" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Phone size={11} /> Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+250…" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Mail size={11} /> Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="name@org.com" />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value as ContactStage)} className="input">
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><CalendarClock size={11} /> Next follow-up</label>
          <input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input resize-none" placeholder="What's been discussed…" />
        </div>

        {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          {contact ? (
            <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
              <Trash2 size={13} /> Remove
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving || !orgName.trim()} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : contact ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
