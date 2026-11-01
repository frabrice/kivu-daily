import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, Profile } from './supabase';
import { getViewAs, setViewAs, ViewAs } from './viewAsStore';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  // The person whose dashboard this is. Normally the signed-in person; when
  // the MD opens someone's dashboard (Admin > Open a dashboard) it is that
  // person, so every page shows what they see. realProfile is always the
  // signed-in person, viewing says whose dashboard is open.
  profile: Profile | null;
  realProfile: Profile | null;
  viewing: ViewAs | null;
  openDashboard: (profileId: string) => Promise<string | null>;
  closeDashboard: () => Promise<void>;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [viewed, setViewed] = useState<Profile | null>(null);
  const [viewing, setViewing] = useState<ViewAs | null>(null);

  const loadProfile = async (uid: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*, department:departments(*)')
      .eq('id', uid)
      .maybeSingle();
    const me = data as Profile | null;
    setProfile(me);
    // Only the MD can be in someone's dashboard.
    const v = getViewAs();
    if (v && me?.role === 'managing_director') {
      const { data: t } = await supabase.from('profiles').select('*, department:departments(*)').eq('id', v.id).maybeSingle();
      if (t) {
        setViewed({ ...(t as Profile), force_password_change: false });
        setViewing(v);
        return;
      }
    }
    if (v) setViewAs(null);
    setViewed(null);
    setViewing(null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      (async () => {
        setSession(sess);
        if (sess?.user) {
          await loadProfile(sess.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    const v = getViewAs();
    if (v) { await supabase.rpc('view_as_end', { p_session: v.session }); setViewAs(null); }
    await supabase.auth.signOut();
    setProfile(null);
    setViewed(null);
    setViewing(null);
    setSession(null);
  };

  // Each switch reloads the app so no page keeps data from the other person.
  const openDashboard = async (profileId: string) => {
    const { data, error } = await supabase.rpc('view_as_start', { p_target: profileId });
    if (error || !data) return error?.message ?? 'Could not open it';
    const { data: t } = await supabase.from('profiles').select('full_name').eq('id', profileId).maybeSingle();
    setViewAs({ id: profileId, name: ((t as { full_name: string } | null)?.full_name ?? 'Them').trim(), session: data as string });
    window.location.assign('/');
    return null;
  };
  const closeDashboard = async () => {
    const v = getViewAs();
    if (v) await supabase.rpc('view_as_end', { p_session: v.session });
    setViewAs(null);
    window.location.assign('/admin/dashboards');
  };

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile: viewed ?? profile, realProfile: profile, viewing, openDashboard, closeDashboard, loading, signOut: viewing ? closeDashboard : signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
