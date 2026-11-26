import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Logo';

export function NoAccessPage() {
  const { session, signOut } = useAuth();
  return (
    <div className="login-page">
      <div className="card no-access-panel">
        <div style={{ display: 'flex', justifyContent: 'center' }}><Logo /></div>
        <h1>Account not approved</h1>
        <p className="muted">
          <strong>{session?.user.email}</strong> is signed in, but reimbursements are only available to
          company (@craftech360.com) accounts. Sign in with your work Google account.
        </p>
        <button className="btn" onClick={signOut}>Sign out and use another account</button>
      </div>
    </div>
  );
}
