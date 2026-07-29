import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { Logo } from './components/Logo';
import { NoAccessPage } from './pages/NoAccessPage';
import { ReimbursementPage } from './pages/ReimbursementPage';

export function App() {
  const { session, hasAccess, loading, signOut } = useAuth();

  if (loading) return <FullScreen>Checking your account…</FullScreen>;
  if (!session) return <LoginPage />;
  if (!hasAccess) return <NoAccessPage />;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
      <div className="app-topbar">
        <Logo />
        <div className="app-topbar-user">
          <span className="muted">{session.user.email}</span>
          <button className="btn btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </div>
      <main>
        <ReimbursementPage />
      </main>
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: 'var(--muted)' }}>
      {children}
    </div>
  );
}
