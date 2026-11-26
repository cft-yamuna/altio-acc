import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { Member, MemberRole } from '../../auth/AuthProvider';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Turn a Supabase error into text an admin can act on. */
export function memberError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message ?? '';
  if (e?.code === '23505' || /duplicate key/i.test(msg)) return 'That email has already been added.';
  if (e?.code === '23514' || /email_ok/i.test(msg)) return 'That doesn’t look like a valid email address.';
  if (e?.code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Only admins can manage users.';
  return msg || 'Something went wrong. Please try again.';
}

export function useMembers(enabled: boolean) {
  return useQuery({
    queryKey: ['reimb-members'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('altio_reimbursement_members')
        .select('*')
        .order('role', { ascending: true })
        .order('email', { ascending: true });
      if (error) throw error;
      return data as Member[];
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['reimb-members'] });
  qc.invalidateQueries({ queryKey: ['reimb-me'] });
}

export function useAddMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: { email: string; name: string; role: MemberRole; zoho_access: boolean }) => {
      const { error } = await supabase.from('altio_reimbursement_members').insert({
        email: m.email.trim().toLowerCase(),
        name: m.name.trim(),
        role: m.role,
        zoho_access: m.zoho_access,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, patch }: { email: string; patch: Partial<Pick<Member, 'name' | 'role' | 'zoho_access'>> }) => {
      const { data, error } = await supabase
        .from('altio_reimbursement_members')
        .update(patch)
        .eq('email', email)
        .select('email');
      if (error) throw error;
      if (!data?.length) throw new Error('That user no longer exists.');
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.from('altio_reimbursement_members').delete().eq('email', email);
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}
