import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';

const BUCKET = 'altio-reimbursement-docs';

export type ReimbRequest = Database['public']['Tables']['altio_reimbursement_requests']['Row'];
export type RequestStatus = ReimbRequest['status'];

export const CATEGORIES = [
  'Travel', 'Fuel', 'Food & meals', 'Accommodation', 'Client meeting',
  'Office supplies', 'Internet & phone', 'Other',
];

export const MAX_BILLS = 10;
export const MAX_BILL_BYTES = 10 * 1024 * 1024;
export const BILL_ACCEPT = 'image/*,application/pdf';

/** Turn a Supabase error into text a person can act on. */
export function requestError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message ?? '';
  if (e?.code === '42501' || /row-level security|permission denied|unauthorized/i.test(msg)) {
    return 'You don’t have permission to do that.';
  }
  return msg || 'Something went wrong. Please try again.';
}

/** A request the signed-in person has submitted, newest first. */
export function useMyRequests(userId: string | undefined) {
  return useQuery({
    queryKey: ['reimb-requests', 'mine', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('altio_reimbursement_requests')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReimbRequest[];
    },
  });
}

/** Every request (admins only — RLS returns nothing extra to anyone else). */
export function useAllRequests(enabled: boolean) {
  return useQuery({
    queryKey: ['reimb-requests', 'all'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('altio_reimbursement_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReimbRequest[];
    },
  });
}

export type NewRequest = {
  userId: string;
  userName: string;
  expenseDate: string;
  category: string;
  amount: number;
  reason: string;
  project: string;
  files: File[];
};

function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'bill';
}

/** Upload the bills into the requester's own folder, then file the request. */
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: NewRequest) => {
      const uploaded: string[] = [];
      try {
        for (const f of r.files) {
          const path = `requests/${r.userId}/${crypto.randomUUID()}-${safeName(f.name)}`;
          const { error } = await supabase.storage.from(BUCKET).upload(path, f, {
            upsert: false,
            contentType: f.type || undefined,
          });
          if (error) throw error;
          uploaded.push(path);
        }
        const { error } = await supabase.from('altio_reimbursement_requests').insert({
          user_name: r.userName,
          expense_date: r.expenseDate,
          category: r.category,
          amount: r.amount,
          reason: r.reason.trim(),
          project: r.project.trim(),
          bill_paths: uploaded,
        });
        if (error) throw error;
      } catch (err) {
        // Don't leave orphaned bills behind when the request itself didn't save.
        if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded).catch(() => {});
        throw err;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reimb-requests'] }),
  });
}

/** Withdraw a still-pending request and delete its bills. */
export function useWithdrawRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: ReimbRequest) => {
      const { data, error } = await supabase
        .from('altio_reimbursement_requests')
        .delete()
        .eq('id', r.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('This request has already been reviewed, so it can’t be withdrawn.');
      if (r.bill_paths.length) await supabase.storage.from(BUCKET).remove(r.bill_paths).catch(() => {});
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reimb-requests'] }),
  });
}

/** Admin decision. The database records who decided and when. */
export function useReviewRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: RequestStatus; note: string }) => {
      const { data, error } = await supabase
        .from('altio_reimbursement_requests')
        .update({ status, review_note: note.trim() })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('This request couldn’t be updated — only admins can approve or reject.');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reimb-requests'] }),
  });
}

/** Short-lived links to view a request's bills. */
export function useBillUrls(paths: string[]) {
  return useQuery({
    queryKey: ['reimb-bill-urls', paths],
    enabled: paths.length > 0,
    staleTime: 4 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
      return out;
    },
  });
}

/** The original file name, without the folder and the unique prefix added on upload. */
export function billLabel(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(path);
}
