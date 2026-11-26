import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

// Who can do what lives in the altio_reimbursement_members table, managed by admins on
// the Users tab. The database enforces the same rules (see the members SQL).
export type Member = Database['public']['Tables']['altio_reimbursement_members']['Row'];
export type MemberRole = Member['role'];

// Company accounts can sign in as employees without being added.
export const REQUEST_DOMAIN = '@craftech360.com';

interface AuthState {
  session: Session | null;
  /** the signed-in person's row in the members table, if they've been added */
  member: Member | null;
  /** may use the app at all (can submit requests) */
  hasAccess: boolean;
  /** Zoho export workspace */
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

  // RLS returns only the caller's own row (or every row for an admin), so filter by email.
  const me = useQuery({
    queryKey: ['reimb-me', email],
    enabled: !!email,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('altio_reimbursement_members')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      if (error) throw error;
      return (data as Member | null) ?? null;
    },
  });

  const member = me.data ?? null;
  const isAdmin = member?.role === 'admin';
  const isAccounts = !!member?.zoho_access;
  const hasAccess = email.endsWith(REQUEST_DOMAIN) || !!member;
  const busy = loading || (!!email && me.isLoading);

  const value = useMemo(
    () => ({ session, member, hasAccess, canWrite: isAccounts, isAccounts, isAdmin, loading: busy, signOut }),
    [session, member, hasAccess, isAccounts, isAdmin, busy, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
