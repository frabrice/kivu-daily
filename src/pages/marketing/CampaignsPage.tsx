import { useState, useMemo } from 'react';
import { Plus, Target, ArrowLeft, CalendarClock } from 'lucide-react';
import { useMarketingData, STAGES } from '../../lib/marketing';
import { Campaign, Contact } from '../../lib/supabase';
import ViewToggle, { ViewMode } from '../../components/ViewToggle';
import DataTable from '../../components/DataTable';
import EntryActions from '../../components/EntryActions';
import StatusBadge from '../../components/marketing/StatusBadge';
import CampaignDrawer from '../../components/marketing/CampaignDrawer';
import ContactDrawer from '../../components/marketing/ContactDrawer';
import { todayStr } from '../../lib/utils';

interface CampaignDrawerState { campaign: Campaign | null; startEditing: boolean }
interface ContactDrawerState { contact: Contact | null; startEditing: boolean }

interface CampaignsPageProps { data?: ReturnType<typeof useMarketingData> }

// See FleetPipelinePage.tsx for why this takes an optional pre-fetched
// data prop rather than always calling useMarketingData() itself.
export default function CampaignsPage({ data }: CampaignsPageProps = {}) {
  return data ? <CampaignsPageView data={data} /> : <CampaignsPageWithData />;
}

function CampaignsPageWithData() {
  return <CampaignsPageView data={useMarketingData()} />;
}

function CampaignsPageView({ data }: { data: ReturnType<typeof useMarketingData> }) {
  const { campaigns, contacts, loading, reload } = data;
  const [view, setView] = useState<ViewMode>('cards');
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignDrawer, setCampaignDrawer] = useState<CampaignDrawerState | null>(null);
  const [contactDrawer, setContactDrawer] = useState<ContactDrawerState | null>(null);

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 skeleton rounded-xl" />)}</div>;

  const fresh = selectedCampaign ? campaigns.find((c) => c.id === selectedCampaign.id) ?? selectedCampaign : null;

  if (fresh) {
    return (
      <CampaignDetail
        campaign={fresh}
        contacts={contacts.filter((c) => c.campaign_id === fresh.id)}
        onBack={() => setSelectedCampaign(null)}
        onAddContact={() => setContactDrawer({ contact: null, startEditing: true })}
        onOpenContact={(c, startEditing) => setContactDrawer({ contact: c, startEditing })}
      >
        {contactDrawer && (
          <ContactDrawer
            contact={contactDrawer.contact}
            startEditing={contactDrawer.startEditing}
            campaignId={fresh.id}
            onClose={() => setContactDrawer(null)}
            onSaved={reload}
          />
        )}
      </CampaignDetail>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Target size={16} className="text-brand-600 dark:text-brand-300" /> Campaigns</h2>
          <p className="text-[12px] text-gray-400 mt-0.5">Outreach pushes, each with its own funnel of targets.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button onClick={() => setCampaignDrawer({ campaign: null, startEditing: true })} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> New Campaign
          </button>
        </div>
      </div>

      {view === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {campaigns.map((camp) => {
            const campContacts = contacts.filter((c) => c.campaign_id === camp.id);
            const won = campContacts.filter((c) => c.stage === 'won').length;
            const contactedOrFurther = campContacts.filter((c) => c.stage !== 'not_contacted').length;
            return (
              <div
                key={camp.id}
                onClick={() => setSelectedCampaign(camp)}
                className="card p-4 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
              >
                <div className="flex items-start justify-between mb-1.5 gap-2">
                  <p className="text-[13px] font-semibold truncate">{camp.name}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <StatusBadge status={camp.status} />
                    <EntryActions
                      onView={() => setSelectedCampaign(camp)}
                      onEdit={() => setCampaignDrawer({ campaign: camp, startEditing: true })}
                      canEdit
                    />
                  </div>
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
              </div>
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

      {view === 'table' && (
        <DataTable
          rows={campaigns}
          keyFn={(c) => c.id}
          emptyLabel="No campaigns yet. Start one to track outreach."
          onRowClick={(c) => setSelectedCampaign(c)}
          columns={[
            { header: 'Name', render: (c) => <span className="font-medium">{c.name}</span> },
            { header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            { header: 'Contacts', render: (c) => contacts.filter((k) => k.campaign_id === c.id).length },
            { header: 'Won', render: (c) => contacts.filter((k) => k.campaign_id === c.id && k.stage === 'won').length },
            { header: 'Owner', render: (c) => c.owner?.full_name ?? 'Unassigned' },
            {
              header: '',
              className: 'text-right',
              render: (c) => (
                <EntryActions
                  onView={() => setSelectedCampaign(c)}
                  onEdit={() => setCampaignDrawer({ campaign: c, startEditing: true })}
                  canEdit
                />
              ),
            },
          ]}
        />
      )}

      {campaignDrawer && (
        <CampaignDrawer
          campaign={campaignDrawer.campaign}
          startEditing={campaignDrawer.startEditing}
          onClose={() => setCampaignDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function CampaignDetail({
  campaign,
  contacts,
  onBack,
  onAddContact,
  onOpenContact,
  children,
}: {
  campaign: Campaign;
  contacts: Contact[];
  onBack: () => void;
  onAddContact: () => void;
  onOpenContact: (c: Contact, startEditing: boolean) => void;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<ViewMode>('cards');

  const byStage = useMemo(() => {
    const map: Record<string, Contact[]> = { not_contacted: [], contacted: [], negotiating: [], won: [], lost: [] };
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
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button onClick={onAddContact} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> Add Contact
          </button>
        </div>
      </div>

      {view === 'cards' && (
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
                    <div
                      key={c.id}
                      onClick={() => onOpenContact(c, false)}
                      className="w-full card p-2.5 text-left cursor-pointer hover:shadow-md hover:border-brand/30 transition-all"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-[12px] font-medium truncate">{c.org_name}</p>
                        <EntryActions onView={() => onOpenContact(c, false)} onEdit={() => onOpenContact(c, true)} canEdit />
                      </div>
                      {c.type_tag && <p className="text-[10px] text-brand-600 dark:text-brand-300">{c.type_tag}</p>}
                      {c.contact_person && <p className="text-[11px] text-gray-400 truncate">{c.contact_person}</p>}
                      {c.next_follow_up && (
                        <p className={`text-[10px] mt-1 flex items-center gap-1 ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                          <CalendarClock size={10} /> {c.next_follow_up}
                        </p>
                      )}
                    </div>
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
      )}

      {view === 'table' && (
        <DataTable
          rows={contacts}
          keyFn={(c) => c.id}
          emptyLabel="No contacts yet."
          onRowClick={(c) => onOpenContact(c, false)}
          columns={[
            { header: 'Organization', render: (c) => <span className="font-medium">{c.org_name}</span> },
            { header: 'Contact', render: (c) => c.contact_person ?? '—' },
            {
              header: 'Stage',
              render: (c) => {
                const s = STAGES.find((st) => st.key === c.stage)!;
                return (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
                    {s.label}
                  </span>
                );
              },
            },
            { header: 'Next Follow-up', render: (c) => c.next_follow_up ?? '—' },
            {
              header: '',
              className: 'text-right',
              render: (c) => <EntryActions onView={() => onOpenContact(c, false)} onEdit={() => onOpenContact(c, true)} canEdit />,
            },
          ]}
        />
      )}

      {children}
    </div>
  );
}
