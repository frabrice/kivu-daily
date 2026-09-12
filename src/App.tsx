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

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ThemeProvider>
  );
}
