import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { Logo } from './components/Logo';
import { NoAccessPage } from './pages/NoAccessPage';
import { ReimbursementPage } from './pages/ReimbursementPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { useAllRequests } from './pages/requests/hooks';

type Tab = 'requests' | 'approvals' | 'accounts';

export function App() {
  const { session, hasAccess, isAdmin, isAccounts, loading, signOut } = useAuth();

  if (loading) return <FullScreen>Checking your account…</FullScreen>;
  if (!session) return <LoginPage />;
  if (!hasAccess) return <NoAccessPage />;

  // Everyone can request; admins approve; the accounts team keeps the Zoho workspace.
  const tabs: { key: Tab; label: string }[] = [
    ...(isAdmin ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
    { key: 'requests', label: 'My reimbursements' },
    ...(isAccounts ? [{ key: 'accounts' as Tab, label: 'Zoho export' }] : []),
  ];

  return <Shell tabs={tabs} email={session.user.email ?? ''} isAdmin={isAdmin} onSignOut={signOut} />;
}

function Shell({ tabs, email, isAdmin, onSignOut }: {
  tabs: { key: Tab; label: string }[];
  email: string;
  isAdmin: boolean;
  onSignOut: () => void;
}) {
  const allowed = tabs.map((t) => t.key);
  const fromHash = () => {
    const h = window.location.hash.replace('#', '') as Tab;
    return allowed.includes(h) ? h : allowed[0];
  };
  const [tab, setTab] = useState<Tab>(fromHash);
  const pending = useAllRequests(isAdmin).data?.filter((r) => r.status === 'pending').length ?? 0;

  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed.join(',')]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
      <div className="app-topbar">
        <Logo />
        {tabs.length > 1 && (
          <nav className="app-nav" aria-label="Sections">
            {tabs.map((t) => (
              <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} aria-current={tab === t.key ? 'page' : undefined} onClick={() => go(t.key)}>
                {t.label}
                {t.key === 'approvals' && pending > 0 && <span className="pill-count" style={{ marginLeft: 6, padding: '1px 7px', fontSize: 11 }}>{pending}</span>}
              </button>
            ))}
          </nav>
        )}
        <div className="app-topbar-user">
          <span className="muted">{email}</span>
          <button className="btn btn-sm" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
      <main>
        {tab === 'approvals' ? <ApprovalsPage /> : tab === 'accounts' ? <ReimbursementPage /> : <MyRequestsPage />}
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
