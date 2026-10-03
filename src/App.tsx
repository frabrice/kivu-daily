import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import LandingPage from './pages/LandingPage';
import RoleSelectPage from './pages/RoleSelectPage';
import AuthPage from './pages/AuthPage';
import SetPasswordPage from './pages/SetPasswordPage';
import EmployeeApp from './pages/EmployeeApp';
import ManagingDirectorApp from './pages/ManagingDirectorApp';
import LoadingScreen from './components/LoadingScreen';
import PublicSurveyApp from './pages/survey/PublicSurveyApp';

type PreAuthView = 'landing' | 'role-select' | 'login';

function AppInner() {
  const { user, profile, loading, signOut } = useAuth();
  const [preAuthView, setPreAuthView] = useState<PreAuthView>('landing');
  const [prefillEmail, setPrefillEmail] = useState('');

  if (loading) return <LoadingScreen />;

  if (!user || !profile) {
    if (preAuthView === 'landing') {
      return <LandingPage onLogin={() => setPreAuthView('role-select')} />;
    }
    if (preAuthView === 'role-select') {
      return (
        <RoleSelectPage
          onBack={() => setPreAuthView('landing')}
          onManual={(email) => {
            setPrefillEmail(email);
            setPreAuthView('login');
          }}
        />
      );
    }
    return <AuthPage prefillEmail={prefillEmail} onBack={() => setPreAuthView('role-select')} />;
  }

  // Deactivated or terminated: their sign-in is also blocked server-side,
  // but a session opened before that can still be loaded once.
  if (!profile.is_active) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-navy-950">
        <div className="card p-8 max-w-sm text-center">
          <p className="text-[14px] font-semibold">This account is no longer active</p>
          <p className="text-[12px] text-gray-500 mt-2">If you think this is a mistake, contact the Managing Director.</p>
          <button onClick={signOut} className="btn-primary mt-5">Sign out</button>
        </div>
      </div>
    );
  }

  if (profile.force_password_change) return <SetPasswordPage />;

  if (profile.role === 'managing_director') return <ManagingDirectorApp />;
  return <EmployeeApp />;
}

// /survey/<token> is a fully public, unauthenticated route for field
// data collectors with no Kivu Daily account at all - checked before
// AuthProvider even mounts, since it must never require a login.
const surveyMatch = window.location.pathname.match(/^\/survey\/([^/]+)/);

export default function App() {
  if (surveyMatch) return <PublicSurveyApp token={surveyMatch[1]} />;

  return (
    <ThemeProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ThemeProvider>
  );
}
