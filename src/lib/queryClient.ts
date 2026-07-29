import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Turn a Supabase/Postgres error into a friendly inline message.
// The DB is the source of truth for rules; the UI just renders these.
export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string; details?: string } | null;
  if (!e) return 'Something went wrong.';
  const msg = e.message ?? '';
  if (e.code === '23505' || /duplicate key|already exists/i.test(msg)) {
    return 'That value already exists — it must be unique.';
  }
  if (e.code === '23503' || /foreign key/i.test(msg)) {
    return 'This record is still referenced elsewhere and cannot be removed.';
  }
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'You do not have permission for this action (finance access required).';
  }
  if (e.code === '23514' || /check constraint|violates check/i.test(msg)) {
    if (/deductions_le_gross/.test(msg)) return 'Deductions can’t be more than the gross salary.';
    return 'That value breaks a validation rule.';
  }
  // Trigger-raised business rules come through with their own clear text.
  return msg || 'Something went wrong.';
}


