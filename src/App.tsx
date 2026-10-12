import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import EntryPage from './pages/EntryPage';
import SetPasswordPage from './pages/SetPasswordPage';
import OsApp from './os/OsApp';
import LoadingScreen from './components/LoadingScreen';
import PublicSurveyApp from './pages/survey/PublicSurveyApp';

function AppInner() {
  const { user, profile, loading, signOut } = useAuth();

  if (loading) return <LoadingScreen />;

  // Not signed in: the entry room (the door into Kivu Daily).
  if (!user || !profile) return <EntryPage />;

  // Deactivated or terminated: their sign-in is also blocked server-side,
  // but a session opened before that can still be loaded once.
  if (!profile.is_active) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-canvas ">
        <div className="card p-8 max-w-sm text-center">
          <p className="text-ui font-semibold">This account is no longer active</p>
          <p className="text-small text-fg-muted mt-2">If you think this is a mistake, contact the Managing Director.</p>
          <button onClick={signOut} className="btn-primary mt-5">Sign out</button>
        </div>
      </div>
    );
  }

  if (profile.force_password_change) return <SetPasswordPage />;

  return <OsApp />;
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
