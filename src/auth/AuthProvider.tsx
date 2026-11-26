import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Accounts team: the Zoho export workspace. Keep identical to
// altio_reimbursement_is_allowed() in the setup SQL.
export const REIMBURSEMENT_EMAILS = [
  'abilash@craftech360.com',
  'pradeep@craftech360.com',
  'ravi@craftech360.com',
  'pattar@craftech360.com',
  'accounts@craftech360.com',
  'abilashs003@gmail.com',
  'yamuna@craftech360.com',
] as const;

// Admins: approve or reject employee requests. Keep identical to
// altio_reimbursement_is_admin() in the requests SQL.
export const ADMIN_EMAILS = [
  'abilash@craftech360.com',
  'abilashs003@gmail.com',
  'yamuna@craftech360.com',
] as const;

// Anyone signed in with a company account can submit requests.
export const REQUEST_DOMAIN = '@craftech360.com';

interface AuthState {
  session: Session | null;
  /** may use the app at all (can submit requests) */
  hasAccess: boolean;
  /** accounts team — the Zoho export workspace */
  canWrite: boolean;
  isAccounts: boolean;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const email = session?.user.email?.trim().toLowerCase() ?? '';
  const isAccounts = (REIMBURSEMENT_EMAILS as readonly string[]).includes(email);
  const isAdmin = (ADMIN_EMAILS as readonly string[]).includes(email);
  const hasAccess = email.endsWith(REQUEST_DOMAIN) || isAccounts || isAdmin;
  const value = useMemo(
    () => ({ session, hasAccess, canWrite: isAccounts, isAccounts, isAdmin, loading, signOut }),
    [session, hasAccess, isAccounts, isAdmin, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
