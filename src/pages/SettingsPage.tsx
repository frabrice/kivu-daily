import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { Moon, Sun, User, Lock, Bell, Mail, Clock, MessageSquare, CheckCircle2, TrendingUp } from 'lucide-react';

interface EmailPreferences {
  morning_reminder: boolean;
  end_day_report: boolean;
  comment_notifications: boolean;
  unfinished_task_reminders: boolean;
  performance_nudges: boolean;
}

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
    end_day_report: true,
    comment_notifications: true,
    unfinished_task_reminders: true,
    performance_nudges: true,
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
        end_day_report: data.end_day_report,
        comment_notifications: data.comment_notifications,
        unfinished_task_reminders: data.unfinished_task_reminders,
        performance_nudges: data.performance_nudges,
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
      end_day_report: enabled,
      comment_notifications: enabled,
      unfinished_task_reminders: enabled,
      performance_nudges: enabled,
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
            {/* Morning Reminder */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                  <Clock size={16} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Morning Reminder</p>
                  <p className="text-xs text-gray-500">7:00 AM - Reminder to add your daily tasks</p>
                </div>
              </div>
              <button
                onClick={() => updateEmailPreference('morning_reminder', !emailPrefs.morning_reminder)}
                className={`w-12 h-6 rounded-full transition-all relative ${
                  emailPrefs.morning_reminder ? 'bg-[#007BFF]' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    emailPrefs.morning_reminder ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* Daily Summary */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 size={16} className="text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Daily Summary</p>
                  <p className="text-xs text-gray-500">6:00 PM - End-of-day task completion report</p>
                </div>
              </div>
              <button
                onClick={() => updateEmailPreference('end_day_report', !emailPrefs.end_day_report)}
                className={`w-12 h-6 rounded-full transition-all relative ${
                  emailPrefs.end_day_report ? 'bg-[#007BFF]' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    emailPrefs.end_day_report ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* Comment Notifications */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                  <MessageSquare size={16} className="text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Comment Notifications</p>
                  <p className="text-xs text-gray-500">Instant - When you receive feedback from managers</p>
                </div>
              </div>
              <button
                onClick={() => updateEmailPreference('comment_notifications', !emailPrefs.comment_notifications)}
                className={`w-12 h-6 rounded-full transition-all relative ${
                  emailPrefs.comment_notifications ? 'bg-[#007BFF]' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    emailPrefs.comment_notifications ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* Unfinished Task Reminders */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center">
                  <Bell size={16} className="text-orange-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Unfinished Task Reminders</p>
                  <p className="text-xs text-gray-500">12:00 PM & 3:00 PM - Nudges for incomplete tasks</p>
                </div>
              </div>
              <button
                onClick={() => updateEmailPreference('unfinished_task_reminders', !emailPrefs.unfinished_task_reminders)}
                className={`w-12 h-6 rounded-full transition-all relative ${
                  emailPrefs.unfinished_task_reminders ? 'bg-[#007BFF]' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    emailPrefs.unfinished_task_reminders ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* Performance Nudges */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center">
                  <TrendingUp size={16} className="text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Performance Nudges</p>
                  <p className="text-xs text-gray-500">Weekly - Encouragement when productivity is low</p>
                </div>
              </div>
              <button
                onClick={() => updateEmailPreference('performance_nudges', !emailPrefs.performance_nudges)}
                className={`w-12 h-6 rounded-full transition-all relative ${
                  emailPrefs.performance_nudges ? 'bg-[#007BFF]' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    emailPrefs.performance_nudges ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {savingPrefs && (
          <p className="text-xs text-gray-400 mt-3 text-right">Saving...</p>
        )}
      </div>
    </div>
  );
}
