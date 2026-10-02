import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { Moon, Sun, User, Lock, Bell, Mail, Clock, MessageSquare } from 'lucide-react';

interface EmailPreferences {
  morning_reminder: boolean;
  unfinished_task_reminders: boolean;
  comment_notifications: boolean;
}

// The personal emails the notification engine sends (see the
// notification_rules rows with a preference_key). A missing
// email_preferences row means everything is on.
const EMAIL_SWITCHES: { key: keyof EmailPreferences; label: string; when: string; icon: typeof Clock; tint: string }[] = [
  { key: 'morning_reminder', label: "Add today's tasks", when: "8:00 AM, Monday–Saturday — only if you haven't added any yet", icon: Clock, tint: 'bg-amber-50 dark:bg-amber-500/10 text-amber-500' },
  { key: 'unfinished_task_reminders', label: 'Unfinished tasks', when: '5:30 PM, Monday–Saturday — only if some are still open', icon: Bell, tint: 'bg-orange-50 dark:bg-orange-500/10 text-orange-500' },
  { key: 'comment_notifications', label: 'Comments and replies', when: 'Instant — when someone comments on your work or replies to you', icon: MessageSquare, tint: 'bg-blue-50 dark:bg-blue-500/10 text-blue-500' },
];

export default function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [emailPrefs, setEmailPrefs] = useState<EmailPreferences>({
    morning_reminder: true,
    unfinished_task_reminders: true,
    comment_notifications: true,
  });
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    if (profile?.id) {
      loadEmailPreferences();
    }
  }, [profile?.id]);

  const loadEmailPreferences = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('email_preferences')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (data) {
      setEmailPrefs({
        morning_reminder: data.morning_reminder,
        unfinished_task_reminders: data.unfinished_task_reminders,
        comment_notifications: data.comment_notifications,
      });
    }
    setLoadingPrefs(false);
  };

  const updateEmailPreference = async (key: keyof EmailPreferences, value: boolean) => {
    if (!profile?.id) return;
    setSavingPrefs(true);
    const newPrefs = { ...emailPrefs, [key]: value };
    setEmailPrefs(newPrefs);

    await supabase
      .from('email_preferences')
      .upsert({
        user_id: profile.id,
        ...newPrefs,
        updated_at: new Date().toISOString(),
      });

    setSavingPrefs(false);
  };

  const toggleAllEmails = async (enabled: boolean) => {
    if (!profile?.id) return;
    setSavingPrefs(true);
    const newPrefs: EmailPreferences = {
      morning_reminder: enabled,
      unfinished_task_reminders: enabled,
      comment_notifications: enabled,
    };
    setEmailPrefs(newPrefs);

    await supabase
      .from('email_preferences')
      .upsert({
        user_id: profile.id,
        ...newPrefs,
        updated_at: new Date().toISOString(),
      });

    setSavingPrefs(false);
  };

  const saveProfile = async () => {
    setSaving(true);
    await supabase.from('profiles').update({ full_name: fullName, updated_at: new Date().toISOString() }).eq('id', profile!.id);
    await refreshProfile();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const changePw = async () => {
    setPwMsg('');
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) setPwMsg(error.message);
    else {
      setPwMsg('Password updated');
      setNewPw('');
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Profile */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className="text-[#007BFF]" />
          <h3 className="font-semibold">Profile</h3>
        </div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Full Name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input mb-3" />
        <div className="flex items-center gap-3">
          <button onClick={saveProfile} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-sm text-green-600">Saved!</span>}
        </div>
      </div>

      {/* Password */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={18} className="text-[#007BFF]" />
          <h3 className="font-semibold">Change Password</h3>
        </div>
        <input type="password" placeholder="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="input mb-3" />
        <button onClick={changePw} disabled={!newPw || newPw.length < 6} className="btn-primary disabled:opacity-50">
          Update Password
        </button>
        {pwMsg && <p className="text-sm mt-2 text-gray-500">{pwMsg}</p>}
      </div>

      {/* Theme */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          {theme === 'light' ? <Moon size={18} className="text-[#007BFF]" /> : <Sun size={18} className="text-[#007BFF]" />}
          <h3 className="font-semibold">Theme</h3>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTheme('light')}
            className={`flex-1 py-3 rounded-xl border transition-all ${theme === 'light' ? 'border-[#007BFF] bg-[#007BFF]/5 text-[#007BFF]' : 'border-gray-200 dark:border-white/10'}`}
          >
            Light
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex-1 py-3 rounded-xl border transition-all ${theme === 'dark' ? 'border-[#007BFF] bg-[#007BFF]/5 text-[#007BFF]' : 'border-gray-200 dark:border-white/10'}`}
          >
            Dark
          </button>
        </div>
      </div>

      {/* Email Notifications */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-[#007BFF]" />
            <h3 className="font-semibold">Email Notifications</h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => toggleAllEmails(true)}
              className="text-xs text-[#007BFF] hover:underline"
            >
              Enable all
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={() => toggleAllEmails(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Disable all
            </button>
          </div>
        </div>

        {loadingPrefs ? (
          <p className="text-sm text-gray-400">Loading preferences...</p>
        ) : (
          <div className="space-y-4">
            {EMAIL_SWITCHES.map(({ key, label, when, icon: Icon, tint }, i) => (
              <div key={key} className={`flex items-center justify-between py-3 ${i < EMAIL_SWITCHES.length - 1 ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-gray-500">{when}</p>
                  </div>
                </div>
                <button
                  onClick={() => updateEmailPreference(key, !emailPrefs[key])}
                  role="switch"
                  aria-checked={emailPrefs[key]}
                  aria-label={label}
                  className={`w-12 h-6 rounded-full transition-all relative ${
                    emailPrefs[key] ? 'bg-[#007BFF]' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                      emailPrefs[key] ? 'right-1' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            ))}
            <p className="text-xs text-gray-400 pt-1">
              {profile?.role === 'managing_director'
                ? 'These are sent to employees. Your own briefings and reports are managed in MD Panel → Email notifications.'
                : "Emails about duties you're in charge of (driver payments, Finance approvals, call queues) can't be turned off here — they're part of the job."}
            </p>
          </div>
        )}

        {savingPrefs && (
          <p className="text-xs text-gray-400 mt-3 text-right">Saving...</p>
        )}
      </div>
    </div>
  );
}
