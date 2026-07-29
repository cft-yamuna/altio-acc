import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';

export function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInGoogle() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (authError) {
      setError(authError.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel card">
        <Logo />
        <div className="login-kicker">REIMBURSEMENT WORKSPACE</div>
        <h1>Welcome back</h1>
        <p className="muted">
          Import reimbursement reports, review journal entries, and export them in Zoho Books format.
        </p>
        <button className="btn google-button" onClick={signInGoogle} disabled={busy}>
          <GoogleIcon />
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && <div className="error-text login-error">{error}</div>}
        <p className="login-note">
          Access is limited to approved Altio accounts.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.26h2.909c1.703-1.568 2.684-3.88 2.684-6.617Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.178l-2.91-2.26c-.805.54-1.835.86-3.046.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.708A5.41 5.41 0 0 1 3.681 9c0-.593.102-1.17.282-1.708V4.96H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.04l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.578c1.321 0 2.507.454 3.44 1.345l2.582-2.582C13.464.89 11.426 0 9 0A9 9 0 0 0 .956 4.96l3.007 2.332C4.672 5.163 6.656 3.578 9 3.578Z" />
    </svg>
  );
}
