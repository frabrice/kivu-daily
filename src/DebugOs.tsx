// DEBUG TEMP - renders the Kivu OS shell with a fake signed-in profile (no network login). Remove before release.
import { ThemeProvider } from './lib/theme';
import { AuthContext } from './lib/auth';
import OsApp from './os/OsApp';
import { Profile } from './lib/supabase';

{ const m = location.search.match(/debugos=(\w+)/); if (m) sessionStorage.setItem('debugos', m[1]); }
const ROLE = sessionStorage.getItem('debugos') ?? 'md';
const DEPT: Record<string, { slug: string; name: string } | null> = {
  md: null, fleet: { slug: 'fleet', name: 'Fleet' }, call_center: { slug: 'call_center', name: 'Call Center' }, finance: { slug: 'finance', name: 'Finance' }, it: { slug: 'it', name: 'IT' },
};
const profile = {
  id: '00000000-0000-0000-0000-00000000d0d0', full_name: ROLE === 'md' ? 'Frabrice' : `Test ${ROLE}`, email: 'debug@localhost', role: ROLE === 'md' ? 'managing_director' : 'employee',
  department_id: null, department: DEPT[ROLE] ?? null, avatar_url: null, is_active: true, terminated_at: null, responsibility_label: null, force_password_change: false,
  last_comment_seen_at: null, created_at: '2026-01-01T00:00:00Z',
} as unknown as Profile;

export default function DebugOs() {
  return (
    <ThemeProvider>
      <AuthContext.Provider value={{ session: null, user: null, profile, loading: false, signOut: async () => { sessionStorage.removeItem('debugos'); location.href = '/'; }, refreshProfile: async () => {} }}>
        <OsApp />
      </AuthContext.Provider>
    </ThemeProvider>
  );
}
