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
  const { user, profile, loading } = useAuth();
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
