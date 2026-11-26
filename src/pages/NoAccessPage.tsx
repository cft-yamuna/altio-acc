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
          <strong>{session?.user.email}</strong> is signed in, but hasn’t been given access yet. Sign in with your
          @craftech360.com Google account, or ask an admin to add this address.
        </p>
        <button className="btn" onClick={signOut}>Sign out and use another account</button>
      </div>
    </div>
  );
}
