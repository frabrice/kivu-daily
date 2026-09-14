import { useState } from 'react';
import { Building2, Phone, Mail, CalendarClock, Trash2, Pencil } from 'lucide-react';
import { supabase, Contact, ContactStage } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { timeAgo, todayStr } from '../../lib/utils';
import { STAGES } from '../../lib/marketing';
import Modal from '../Modal';

export default function ContactDrawer({
  contact,
  startEditing,
  campaignId,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  startEditing: boolean;
  campaignId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(startEditing);
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
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Building2 size={11} /> Organization</label>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!editing} className="input" placeholder="Kigali Serena Hotel" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Contact person</label>
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} disabled={!editing} className="input" placeholder="Name" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Type</label>
            <input value={typeTag} onChange={(e) => setTypeTag(e.target.value)} disabled={!editing} className="input" placeholder="Hotel, Partner…" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Phone size={11} /> Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} className="input" placeholder="+250…" />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><Mail size={11} /> Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} className="input" placeholder="name@org.com" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value as ContactStage)} disabled={!editing} className="input">
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500 flex items-center gap-1"><CalendarClock size={11} /> Next follow-up</label>
          <input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} disabled={!editing} className="input" />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1.5 text-gray-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editing} rows={3} className="input resize-none" placeholder="What's been discussed…" />
        </div>

        {error && <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {editing ? (
          <div className="flex justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            {contact ? (
              <button onClick={remove} disabled={saving} className="btn-ghost text-red-500 flex items-center gap-1.5">
                <Trash2 size={13} /> Remove
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => (contact ? setEditing(false) : onClose())} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || !orgName.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : contact ? 'Save Changes' : 'Add Contact'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
            <button onClick={onClose} className="btn-ghost">Close</button>
            <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5">
              <Pencil size={13} /> Edit
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
