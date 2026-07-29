import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { parseCsv } from '../../lib/csv';
import type { Database } from '../../lib/database.types';

const BUCKET = 'altio-reimbursement-docs';
export type ReimbExport = Database['public']['Tables']['altio_reimbursement_exports']['Row'];
export type PendingReimb = Database['public']['Tables']['altio_reimbursement_pending']['Row'];

// Storage caches objects for an hour by default, which would serve a stale CSV right
// after an edit is saved. These exports are re-written in place, so never cache them.
const UPLOAD_OPTS = { upsert: true, cacheControl: '0', contentType: 'text/csv;charset=utf-8' };

// History of Zoho exports (CSV saved in storage, metadata row here).
export function useReimbExports() {
  return useQuery({
    queryKey: ['reimb-exports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('altio_reimbursement_exports')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReimbExport[];
    },
  });
}

export function useSaveReimbExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ filename, rowCount, csv, stamp }: { filename: string; rowCount: number; csv: string; stamp: number }) => {
      const path = `exports/${stamp}-${filename}`;
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, UPLOAD_OPTS);
      if (upErr) throw upErr;
      const { data, error } = await supabase.from('altio_reimbursement_exports').insert({ filename, row_count: rowCount, storage_path: path }).select().single();
      if (error) throw error;
      return data as ReimbExport;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reimb-exports'] }),
  });
}

/** Overwrite an existing export in place — same history row, same stored file (no duplicate). */
export function useUpdateReimbExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, path, filename, rowCount, csv, stamp }: { id: string; path: string; filename: string; rowCount: number; csv: string; stamp: number }) => {
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, UPLOAD_OPTS);
      if (upErr) throw upErr;
      const { error } = await supabase
        .from('altio_reimbursement_exports')
        .update({ filename, row_count: rowCount, created_at: new Date(stamp).toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reimb-exports'] }),
  });
}

/** Temporary link to re-download a past export. Cache-busted so it never serves a stale copy. */
export async function reimbExportSignedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (!data?.signedUrl) return null;
  return `${data.signedUrl}${data.signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
}

/** Read a past export's CSV text so it can be re-loaded into the editor. Fetched fresh —
 *  `download()` goes through the browser cache and would return the pre-edit version. */
export async function reimbExportText(path: string): Promise<string | null> {
  const url = await reimbExportSignedUrl(path);
  if (!url) return null;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return await res.text();
}

// ----------------------------------------------------------------------------
// Monthly collection — reimbursements accumulated into a 'YYYY-MM' bucket over the
// month, deduped, then loaded into the editor and exported together at month-end.
// ----------------------------------------------------------------------------

// Normalise a date to YYYY-MM-DD (best effort) so the same claim, however the source
// formats its date, produces the same duplicate key.
function normDate(d: string): string {
  const s = (d ?? '').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.toLowerCase();
}
/** Duplicate key for a reimbursement: same person + date + amount = the same claim. */
export function pendingDupKey(name: string, date: string, amount: number): string {
  return `${(name ?? '').trim().toLowerCase()}|${normDate(date)}|${amount}`;
}

/** All reimbursements collected into a month bucket, newest first. */
export function usePendingReimb(month: string) {
  return useQuery({
    queryKey: ['reimb-pending', month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('altio_reimbursement_pending')
        .select('*')
        .eq('month', month)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as PendingReimb[];
    },
  });
}

/** Row counts per month bucket, so the month picker can show which months hold claims. */
export function useReimbPendingMonths() {
  return useQuery({
    queryKey: ['reimb-pending-months'],
    queryFn: async () => {
      const { data, error } = await supabase.from('altio_reimbursement_pending').select('month');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data as { month: string }[]) counts[r.month] = (counts[r.month] ?? 0) + 1;
      return counts;
    },
  });
}

type NewPending = Omit<PendingReimb, 'id' | 'created_at' | 'created_by'>;

/** Save one upload (batch) into a month: overwrite any existing rows for the batch, then insert. */
export function useSavePendingBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, rows }: { batchId: string; rows: NewPending[] }) => {
      await supabase.from('altio_reimbursement_pending').delete().eq('batch_id', batchId);
      if (rows.length > 0) {
        const { error } = await supabase.from('altio_reimbursement_pending').insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimb-pending'] });
      qc.invalidateQueries({ queryKey: ['reimb-pending-months'] });
    },
  });
}

/** Delete a whole upload (batch) from a month. */
export function useDeletePendingBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await supabase.from('altio_reimbursement_pending').delete().eq('batch_id', batchId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimb-pending'] });
      qc.invalidateQueries({ queryKey: ['reimb-pending-months'] });
    },
  });
}

/** Remove one or more collected rows (e.g. a highlighted duplicate). */
export function useDeletePendingReimb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('altio_reimbursement_pending').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimb-pending'] });
      qc.invalidateQueries({ queryKey: ['reimb-pending-months'] });
    },
  });
}

/** Empty a whole month bucket (after it has been exported). */
export function useClearPendingMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (month: string) => {
      const { error } = await supabase.from('altio_reimbursement_pending').delete().eq('month', month);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimb-pending'] });
      qc.invalidateQueries({ queryKey: ['reimb-pending-months'] });
    },
  });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Parse an "Approved on" cell into a comparable UTC timestamp. Handles the formats that
// turn up in the payroll report / Zoho export: yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy,
// "12 May 2026" and "May 12, 2026" (any leading time part is ignored). null = unparseable.
function parseApprovedDate(v: string): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mo >= 0) return Date.UTC(+m[3], mo, +m[1]);
  }
  if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mo >= 0) return Date.UTC(+m[3], mo, +m[2]);
  }
  return null;
}

/** Latest "Approved on" date found in a saved export's CSV, formatted `dd MMM yyyy`. */
export function latestApprovedOn(csvText: string): string | null {
  const table = parseCsv(csvText);
  if (table.length < 2) return null;
  const idx = table[0].map((h) => h.trim().toLowerCase()).indexOf('approved on');
  if (idx < 0) return null;
  let best: number | null = null;
  for (let i = 1; i < table.length; i++) {
    const t = parseApprovedDate(table[i][idx] ?? '');
    if (t != null && (best == null || t > best)) best = t;
  }
  return best == null ? null : new Date(best).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The most recent approval date inside a past export, read from its stored CSV and cached. */
export function useReimbApprovedOn(path: string) {
  return useQuery({
    queryKey: ['reimb-approved-on', path],
    queryFn: async () => {
      const text = await reimbExportText(path);
      return text ? latestApprovedOn(text) : null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Delete a saved export — removes both the stored CSV and the history row. */
export function useDeleteReimbExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, path }: { id: string; path: string }) => {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      const { error } = await supabase.from('altio_reimbursement_exports').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reimb-exports'] }),
  });
}

