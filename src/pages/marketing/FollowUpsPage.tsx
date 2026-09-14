import { useState, useMemo } from 'react';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import { useMarketingData } from '../../lib/marketing';
import { Contact } from '../../lib/supabase';
import { todayStr } from '../../lib/utils';
import ContactDrawer from '../../components/marketing/ContactDrawer';

interface ContactDrawerState { contact: Contact; startEditing: boolean }

interface FollowUpsPageProps { data?: ReturnType<typeof useMarketingData> }

export default function FollowUpsPage({ data }: FollowUpsPageProps = {}) {
  return data ? <FollowUpsPageView data={data} /> : <FollowUpsPageWithData />;
}

function FollowUpsPageWithData() {
  return <FollowUpsPageView data={useMarketingData()} />;
}

function FollowUpsPageView({ data }: { data: ReturnType<typeof useMarketingData> }) {
  const { campaigns, contacts, loading, reload } = data;
  const [contactDrawer, setContactDrawer] = useState<ContactDrawerState | null>(null);

  const followUpsDue = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 3);
    return contacts
      .filter((c) => c.next_follow_up && new Date(c.next_follow_up) <= cutoff && c.stage !== 'won' && c.stage !== 'lost')
      .sort((a, b) => (a.next_follow_up ?? '').localeCompare(b.next_follow_up ?? ''));
  }, [contacts]);

  const overdueCount = followUpsDue.filter((c) => c.next_follow_up! < todayStr()).length;

  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 skeleton rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <CalendarClock size={16} className="text-rose-600 dark:text-rose-300" /> Follow-ups
          {overdueCount > 0 && <span className="text-[8px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">{overdueCount}</span>}
        </h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Contacts due for a touchpoint in the next 3 days, across every campaign.</p>
      </div>

      <div className="space-y-1.5">
        {followUpsDue.length === 0 && (
          <div className="card p-10 text-center">
            <CalendarClock size={26} className="text-gray-300 dark:text-white/20 mx-auto mb-2" />
            <p className="text-[12px] text-gray-400">Nothing due in the next 3 days.</p>
          </div>
        )}
        {followUpsDue.map((c) => {
          const camp = campaigns.find((camp) => camp.id === c.campaign_id);
          const overdue = c.next_follow_up! < todayStr();
          return (
            <button
              key={c.id}
              onClick={() => setContactDrawer({ contact: c, startEditing: false })}
              className="w-full card p-3 flex items-center gap-3 text-left hover:shadow-md hover:border-brand/30 transition-all"
            >
              {overdue && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate">{c.org_name}</p>
                <p className="text-[10px] text-gray-400">{camp?.name} {c.contact_person ? `· ${c.contact_person}` : ''}</p>
              </div>
              <span className={`text-[10px] font-medium shrink-0 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                {overdue ? 'Overdue' : c.next_follow_up === todayStr() ? 'Today' : c.next_follow_up}
              </span>
            </button>
          );
        })}
      </div>

      {contactDrawer && (
        <ContactDrawer
          contact={contactDrawer.contact}
          startEditing={contactDrawer.startEditing}
          campaignId={contactDrawer.contact.campaign_id}
          onClose={() => setContactDrawer(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
