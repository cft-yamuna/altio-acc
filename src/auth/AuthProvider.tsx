import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export const REIMBURSEMENT_EMAILS = [
  'abilash@craftech360.com',
  'pradeep@craftech360.com',
  'ravi@craftech360.com',
  'pattar@craftech360.com',
  'accounts@craftech360.com',
  'abilashs003@gmail.com',
] as const;

interface AuthState {
  session: Session | null;
  hasAccess: boolean;
  canWrite: boolean;
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
  const hasAccess = (REIMBURSEMENT_EMAILS as readonly string[]).includes(email);
  const value = useMemo(
    () => ({ session, hasAccess, canWrite: hasAccess, loading, signOut }),
    [session, hasAccess, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
