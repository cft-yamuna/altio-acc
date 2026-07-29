import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PageHeader } from '../components/AppLayout';
import { useDateRange } from '../components/DateRangeFilter';
import { inRange } from '../lib/dateRange';
import { Tile, TileRow } from '../components/Tile';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../auth/AuthProvider';
import { inr } from '../lib/inr';
import { downloadCsv, parseCsv, toCsv, type CsvCell } from '../lib/csv';
import { exportPdf } from '../lib/pdf';
import {
  useReimbExports, useSaveReimbExport, useUpdateReimbExport, useDeleteReimbExport,
  useReimbApprovedOn, reimbExportSignedUrl, reimbExportText, type ReimbExport,
  usePendingReimb, useReimbPendingMonths, useSavePendingBatch, useDeletePendingReimb,
  useDeletePendingBatch, useClearPendingMonth, pendingDupKey, type PendingReimb,
} from './reimburse/hooks';
import { SuggestInput } from '../components/Sheet';
import { fmtDate, fmtMonth, recentMonths } from '../lib/dates';

const ZOHO_HEADERS = [
  'Journal Date', 'Reference Number', 'Journal Number Prefix', 'Journal Number Suffix', 'Account', 'Notes',
  'Description', 'Journal Type', 'Debit', 'Credit', 'Project Name', 'Currency', 'Approved on',
];

type Raw = { date: string; name: string; type: string; details: string; amount: number; status: string; approvedOn: string };
type ZRow = {
  key: string; pair: number; rawDate: string; date: string; refNo: string; journalNo: string;
  account: string; notes: string; description: string; debit: number | ''; credit: number | '';
  project: string; approvedOn: string; search: string;
  // Original reimbursement fields kept so a saved monthly batch can be rebuilt exactly.
  srcType: string; srcName: string;
};

function colIndex(header: string[], name: string): number {
  return header.map((h) => h.trim().toLowerCase()).indexOf(name.toLowerCase());
}
function toDdMmYyyy(d: string): string {
  const m = d.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}
function toIso(d: string): string {
  const m = d.trim().match(/^(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

function accountFor(type: string): string {
  const t = type.trim().replace(/\s+/g, '_').replace(/&/g, 'and');
  return t ? `${t}_event` : 'Reimbursement_event';
}
const pad3 = (n: number) => String(n).padStart(3, '0');

function parseRaw(text: string): { rows: Raw[]; error: string | null } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: 'The file has no rows.' };
  const h = table[0];
  const idx = {
    date: colIndex(h, 'Date'), name: colIndex(h, 'Name'), type: colIndex(h, 'Type'),
    details: colIndex(h, 'Details'), amount: colIndex(h, 'Amount'), status: colIndex(h, 'Status'), approved: colIndex(h, 'Approved On'),
  };
  if (idx.amount < 0 || idx.name < 0) return { rows: [], error: 'This doesn’t look like a reimbursement export (missing Name / Amount columns).' };
  const rows = table.slice(1).map((r) => ({
    date: idx.date >= 0 ? r[idx.date] ?? '' : '',
    name: idx.name >= 0 ? r[idx.name] ?? '' : '',
    type: idx.type >= 0 ? r[idx.type] ?? '' : '',
    details: idx.details >= 0 ? r[idx.details] ?? '' : '',
    amount: Number((r[idx.amount] ?? '').replace(/[^0-9.]/g, '')) || 0,
    status: idx.status >= 0 ? r[idx.status] ?? '' : '',
    approvedOn: idx.approved >= 0 ? r[idx.approved] ?? '' : '',
  })).filter((x) => x.amount > 0);
  return { rows, error: null };
}

// Rebuild the editable rows from a saved Zoho export (so a past export can be re-edited).
function parseZoho(text: string): { rows: ZRow[]; error: string | null } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: 'That saved export has no rows.' };
  const h = table[0];
  const idx = {
    date: colIndex(h, 'Journal Date'), ref: colIndex(h, 'Reference Number'), suffix: colIndex(h, 'Journal Number Suffix'),
    account: colIndex(h, 'Account'), notes: colIndex(h, 'Notes'), desc: colIndex(h, 'Description'),
    debit: colIndex(h, 'Debit'), credit: colIndex(h, 'Credit'), project: colIndex(h, 'Project Name'), approved: colIndex(h, 'Approved on'),
  };
  if (idx.ref < 0 || idx.account < 0) return { rows: [], error: 'This doesn’t look like a saved Zoho export.' };
  const num = (v: string) => { const s = (v ?? '').replace(/[^0-9.]/g, ''); return s ? Number(s) : ''; };
  const rows = table.slice(1).map((r, i) => {
    const date = r[idx.date] ?? '';
    return {
      key: `h${i}`, pair: Math.floor(i / 2), rawDate: toIso(date), date,
      refNo: idx.ref >= 0 ? r[idx.ref] ?? '' : '', journalNo: idx.suffix >= 0 ? r[idx.suffix] ?? '' : '',
      account: idx.account >= 0 ? r[idx.account] ?? '' : '', notes: idx.notes >= 0 ? r[idx.notes] ?? '' : '',
      description: idx.desc >= 0 ? r[idx.desc] ?? '' : '', debit: num(r[idx.debit]), credit: num(r[idx.credit]),
      project: idx.project >= 0 ? r[idx.project] ?? '' : '', approvedOn: idx.approved >= 0 ? r[idx.approved] ?? '' : '', search: '',
      srcType: '', srcName: '',
    } as ZRow;
  });
  return { rows, error: null };
}

function ym(d: string): string {
  const m = d.trim().match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}${m[2]}` : '000000';
}



function buildRows(raws: Raw[], refStart: number, journalStart: number): ZRow[] {
  let ref = refStart;
  const out: ZRow[] = [];
  raws.forEach((r, i) => {
    const journal = String(journalStart + i);
    const date = toDdMmYyyy(r.date);
    const search = `${r.name} ${r.type} ${r.details}`.toLowerCase();
    // Default initial import uses Year-Month date prefix (e.g. 202607001).
    // If a custom starting ref is passed, it uses pad3(ref) directly.
    const refNo = refStart === 1 ? `${ym(r.date)}${pad3(ref++)}` : pad3(ref++);
    out.push({ key: `${i}d`, pair: i, rawDate: r.date, date, refNo, journalNo: journal, account: accountFor(r.type), notes: r.details, description: 'Amount Receiver', debit: r.amount, credit: '', project: '', approvedOn: r.approvedOn, search, srcType: r.type, srcName: r.name });
    out.push({ key: `${i}c`, pair: i, rawDate: r.date, date, refNo, journalNo: journal, account: r.name, notes: r.details, description: 'Amount Payable', debit: '', credit: r.amount, project: '', approvedOn: r.approvedOn, search, srcType: r.type, srcName: r.name });
  });
  return out;
}

// ---- Monthly batch helpers (pending rows <-> editable Zoho rows) ----
function rawsFromPending(rows: PendingReimb[]): Raw[] {
  return rows.map((p) => ({ date: p.entry_date, name: p.name, type: p.type, details: p.details, amount: Number(p.amount), status: p.status, approvedOn: p.approved_on }));
}
// Editable rows for a set of pending rows, restoring the project and the Purpose account
// override saved against each reimbursement (the override is on the debit / expense row).
function buildFromPending(rows: PendingReimb[], refStart: number, journalStart: number): ZRow[] {
  return buildRows(rawsFromPending(rows), refStart, journalStart).map((r) => {
    const saved = rows[r.pair];
    const account = r.description === 'Amount Receiver' && saved?.account ? saved.account : r.account;
    return { ...r, project: saved?.project ?? '', account };
  });
}
// The Zoho CSV cells for one batch (used to download a single upload).
function zohoRowsFromPending(rows: PendingReimb[], refStart = 1, journalStart = 40001): CsvCell[][] {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  return buildFromPending(ordered, refStart, journalStart).map((r) => [r.date, r.refNo, 'JNR-', r.journalNo, r.account, r.notes, r.description, 'both', r.debit, r.credit, r.project, 'INR', r.approvedOn]);
}
// Latest approval date across a set of rows, formatted "06 Jul 26".
function batchApproved(rows: PendingReimb[]): string {
  const vals = rows.map((r) => r.approved_on).filter(Boolean);
  if (vals.length === 0) return '—';
  return fmtDate(vals.reduce((a, b) => (a > b ? a : b)).slice(0, 10));
}

// Re-assign Reference (per row pair) + Journal (per pair) from the start values typed by user.
function renumber(rows: ZRow[], refStart: number, journalStart: number): ZRow[] {
  let ref = refStart;
  let j = journalStart;
  const journalByPair: Record<number, string> = {};
  const refByPair: Record<number, string> = {};
  const seen = new Set<number>();
  return rows.map((row) => {
    if (!seen.has(row.pair)) {
      journalByPair[row.pair] = String(j++);
      refByPair[row.pair] = pad3(ref++);
      seen.add(row.pair);
    }
    return { ...row, refNo: refByPair[row.pair], journalNo: journalByPair[row.pair] };
  });
}

export function ReimbursementPage() {
  const { canWrite } = useAuth();
  // Landing view: choose between the one-off "quick" export and the "monthly" collector.
  const [view, setView] = useState<'home' | 'quick' | 'monthly'>('home');
  // In the monthly view: null = show the month list, else the 'YYYY-MM' being collected.
  const [monthlyMonth, setMonthlyMonth] = useState<string | null>(null);
  // Where the editor was opened from, so "← Back" returns to the right landing view.
  const [editorFrom, setEditorFrom] = useState<'quick' | 'monthly'>('quick');
  // Set when the editor is editing a monthly upload (batch). null = ordinary export editing.
  // batchId null = a brand-new upload not yet saved into the month.
  const [monthTarget, setMonthTarget] = useState<{ month: string; batchId: string | null } | null>(null);
  const [rows, setRows] = useState<ZRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [refStart, setRefStart] = useState('1');
  const [journalStart, setJournalStart] = useState('40001');
  const [bulk, setBulk] = useState('');
  const [saveName, setSaveName] = useState('');
  const [q, setQ] = useState('');
  const { range } = useDateRange({ title: 'Show only rows in this date range (export still includes every row)' });
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveExport = useSaveReimbExport();
  const updateExport = useUpdateReimbExport();
  const delExport = useDeleteReimbExport();
  const savePendingBatch = useSavePendingBatch();
  // Set when the editor was opened from a history entry — saving then overwrites that
  // entry instead of creating a new one.
  const [editing, setEditing] = useState<ReimbExport | null>(null);
  const history = useReimbExports();
  const confirm = useConfirm();
  // Standalone module: project and purpose values are typed by the user.
  // No project, expense-account, CRM, or finance-master tables are queried.
  const projectNames: string[] = [];
  const subExpenseOpts: string[] = [];

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const { rows: raws, error } = parseRaw(String(reader.result));
      if (error) { setErr(error); return; }
      setRefStart('1');
      setJournalStart('40001');
      setBulk('');
      setSaveName('');
      setRows(buildRows(raws, 1, 40001));
      setFileName(file.name);
      setEditing(null); // a fresh import is a new export, not an edit of an old one
      setEditorFrom('quick');
      setMonthTarget(null);
      setErr(null);
    };
    reader.readAsText(file);
  }

  const openEditor = (built: ZRow[]) => { setRows(built); setEditing(null); setQ(''); setErr(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  // Upload a CSV into a month → open the editor as a NEW (unsaved) batch.
  function uploadToMonth(file: File, month: string) {
    const reader = new FileReader();
    reader.onload = () => {
      const { rows: raws, error } = parseRaw(String(reader.result));
      if (error) { setErr(error); return; }
      if (raws.length === 0) { setErr('No reimbursements with an amount were found in that file.'); return; }
      setRefStart('1');
      setJournalStart('40001');
      setBulk('');
      setFileName(file.name);
      setSaveName(file.name.replace(/\.csv$/i, ''));
      setMonthTarget({ month, batchId: null });
      setEditorFrom('monthly');
      openEditor(buildRows(raws, 1, 40001));
    };
    reader.readAsText(file);
  }

  // Reopen a saved upload (batch) in the editor to change and re-save it.
  function editBatch(month: string, batchId: string, batchRows: PendingReimb[]) {
    setRefStart('1');
    setJournalStart('40001');
    setBulk('');
    setFileName(batchRows[0]?.source_file ?? 'upload');
    setSaveName((batchRows[0]?.source_file ?? '').replace(/\.csv$/i, ''));
    setMonthTarget({ month, batchId });
    setEditorFrom('monthly');
    // Sort by the stored position so the numbering sticks to each reimbursement across reopens.
    const ordered = [...batchRows].sort((a, b) => a.seq - b.seq);
    openEditor(buildFromPending(ordered, 1, 40001));
  }

  // Load the whole month (all uploads combined) into the editor for the final Zoho export.
  function exportMonth(month: string, monthRows: PendingReimb[]) {
    setRefStart('1');
    setJournalStart('40001');
    setBulk('');
    const sorted = [...monthRows].sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.seq - b.seq));
    setFileName(`${fmtMonth(month)} collection`);
    setSaveName(`reimbursement-${month}`);
    setMonthTarget(null); // combined month exports to the normal export history
    setEditorFrom('monthly');
    openEditor(buildFromPending(sorted, 1, 40001));
  }

  // Save the current editor rows as this month's batch, then return to the month page.
  function saveBatch() {
    if (!monthTarget) return;
    const batchId = monthTarget.batchId ?? crypto.randomUUID();
    const newRows = rows.filter((r) => r.debit !== '').map((r, i) => {
      const amount = Number(r.debit);
      return {
        month: monthTarget.month, batch_id: batchId, entry_date: r.rawDate, name: r.srcName, type: r.srcType,
        details: r.notes, amount, status: '', approved_on: r.approvedOn, source_file: fileName,
        dup_key: pendingDupKey(r.srcName, r.rawDate, amount), project: r.project, account: r.account, seq: i,
      };
    });
    savePendingBatch.mutate({ batchId, rows: newRows }, {
      onSuccess: () => { setRows([]); setFileName(''); setMonthTarget(null); setView('monthly'); setRefStart('1'); setJournalStart('40001'); },
      onError: (e) => setErr(
        /altio_reimbursement_pending|batch_id|project|does not exist|schema cache|column/i.test(e.message)
          ? 'The standalone reimbursement database isn’t fully set up yet. Run “supabase/26.07.29-12.53-altio-reimbursement-setup.sql” in the Altio Supabase project, then try again.'
          : `Couldn’t save the upload: ${e.message}`,
      ),
    });
  }

  const setCell = (key: string, field: 'refNo' | 'journalNo' | 'project' | 'account', value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const applyNumbering = () => setRows((rs) => renumber(rs, Number(refStart) || 1, Number(journalStart) || 40001));
  const applyProject = () => setRows((rs) => rs.map((r) => ({ ...r, project: bulk })));

  const shown = useMemo(() => {
    // Date range narrows the preview first; both rows of a pair share a date so pairs stay whole.
    const base = rows.filter((r) => inRange(r.rawDate, range));
    const s = q.trim().toLowerCase();
    if (!s) return base;
    // Match anywhere — account, notes, reference, journal, project, date, amount, etc.
    const hit = (r: ZRow) =>
      [r.date, r.refNo, r.journalNo, r.account, r.notes, r.description, r.project, r.approvedOn, r.debit, r.credit]
        .join(' ').toLowerCase().includes(s);
    // If either row of a reimbursement matches, keep the whole pair (debit + credit).
    const pairs = new Set(base.filter(hit).map((r) => r.pair));
    return base.filter((r) => pairs.has(r.pair));
  }, [rows, q, range.from, range.to]);

  const total = useMemo(() => rows.filter((r) => r.debit !== '').reduce((a, r) => a + Number(r.debit), 0), [rows]);
  const unassigned = rows.filter((r) => !r.project.trim()).length;

  function csvRows(): CsvCell[][] {
    return rows.map((r) => [r.date, r.refNo, 'JNR-', r.journalNo, r.account, r.notes, r.description, 'both', r.debit, r.credit, r.project, 'INR', r.approvedOn]);
  }
  // Use the typed name, or fall back to the default filename (same as before).
  function filenameFor(): string {
    const n = saveName.trim();
    if (!n) return 'reimbursement-zoho.csv';
    return n.toLowerCase().endsWith('.csv') ? n : `${n}.csv`;
  }
  // Persist to history: overwrite the entry we're editing, else add a new one.
  async function persist() {
    if (rows.length === 0) return;
    const data = csvRows();
    const filename = filenameFor();
    const csv = toCsv(ZOHO_HEADERS, data);
    const stamp = Date.now();
    if (editing) {
      await updateExport.mutateAsync({ id: editing.id, path: editing.storage_path, filename, rowCount: data.length, csv, stamp });
    } else {
      try {
        const saved = await saveExport.mutateAsync({ filename, rowCount: data.length, csv, stamp });
        if (saved) setEditing(saved);
      } catch (e) {
        console.error('Failed to save draft history:', e);
      }
    }
  }

  async function exportZoho() {
    downloadCsv(filenameFor().replace(/\.csv$/i, ''), ZOHO_HEADERS, csvRows());
    await persist();
  }
  // Combined month export downloads only — it must NOT land in the Quick export history.
  function exportZohoDownloadOnly() {
    downloadCsv(filenameFor().replace(/\.csv$/i, ''), ZOHO_HEADERS, csvRows());
  }
  // Human-readable PDF of the same journal (drops the Zoho-only Prefix/Type/Currency columns).
  function exportPdfFile() {
    const headers = ['Date', 'Reference', 'Journal', 'Account', 'Notes', 'Description', 'Debit', 'Credit', 'Project', 'Approved on'];
    const data = rows.map((r) => [r.date, r.refNo, r.journalNo, r.account, r.notes, r.description, r.debit, r.credit, r.project, r.approvedOn]);
    exportPdf('Reimbursement journal', headers, data, { subtitle: `${rows.length} journal lines` });
  }
  // Save the current (even half-finished) work to history without downloading.
  const saveDraft = persist;
  const busy = saveExport.isPending || updateExport.isPending || savePendingBatch.isPending;

  // Leave the editor, auto-saving current work first.
  const backFromEditor = async () => {
    if (rows.length > 0) {
      if (monthTarget) {
        // Auto-save monthly batch
        saveBatch();
        return;
      } else {
        // Auto-save quick export draft
        await persist();
      }
    }
    setRows([]); setFileName(''); setEditing(null); setQ(''); setErr(null);
    setRefStart('1'); setJournalStart('40001'); setBulk(''); setSaveName('');
    if (monthTarget) { setMonthTarget(null); setView('monthly'); }
    else setView(editorFrom);
  };

  async function openExport(path: string) {
    const win = window.open('', '_blank');
    const url = await reimbExportSignedUrl(path);
    if (url && win) win.location.href = url;
    else if (win) win.close();
  }

  // Load a past export back into the editor so it can be changed and re-exported.
  async function loadExport(e: ReimbExport) {
    const text = await reimbExportText(e.storage_path);
    if (!text) { setErr('Could not open that saved export.'); return; }
    const { rows: parsed, error } = parseZoho(text);
    if (error) { setErr(error); return; }
    setRows(parsed);
    setFileName(e.filename);
    setSaveName(e.filename.replace(/\.csv$/i, ''));
    setEditing(e); // saving now overwrites this entry
    setQ(''); setErr(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteExport(e: ReimbExport) {
    if (await confirm({ title: 'Delete export', message: `Delete the export from ${new Date(e.created_at).toLocaleString('en-GB')}? This removes the saved file too.`, confirmLabel: 'Delete', danger: true })) {
      delExport.mutate({ id: e.id, path: e.storage_path });
      if (editing?.id === e.id) setEditing(null); // no longer editing something that's gone
    }
  }

  return (
    <>
      <PageHeader
        title="Reimbursement"
        subtitle="Import the payroll reimbursement report, edit the reference / journal numbers and project, and export it in Zoho Books format."
        actions={rows.length === 0 && view !== 'home' ? (
          <button
            className="btn"
            title={view === 'monthly' && monthlyMonth ? 'Back to the month list' : 'Back to the reimbursement menu'}
            onClick={() => {
              if (view === 'monthly' && monthlyMonth) { setMonthlyMonth(null); setErr(null); return; }
              setView('home'); setMonthlyMonth(null); setErr(null);
            }}
          >← Back</button>
        ) : rows.length > 0 && canWrite ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" title="Back" onClick={backFromEditor}>← Back</button>
            {monthTarget ? (
              <button className="btn btn-primary" title="Save this upload into the month" onClick={saveBatch} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <SaveIcon /> {busy ? 'Saving…' : 'Save'}
              </button>
            ) : editorFrom === 'monthly' ? (
              <ExportDropdown onPdf={exportPdfFile} onZoho={exportZohoDownloadOnly} busy={false} />
            ) : (
              <>
                <button
                  className="btn"
                  title={editing ? `Overwrite “${editing.filename}” in history` : 'Save the current work to history (no download)'}
                  onClick={saveDraft}
                  disabled={busy}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <SaveIcon /> {busy ? 'Saving…' : 'Save'}
                </button>
                <ExportDropdown onPdf={exportPdfFile} onZoho={exportZoho} busy={busy} />
              </>
            )}
          </div>
        ) : null}
      />
      <div style={{ padding: 26, display: 'grid', gap: 16 }}>
        {rows.length === 0 && view === 'home' ? (
          <ModeChooser onQuick={() => { setView('quick'); setErr(null); }} onMonthly={() => { setView('monthly'); setErr(null); }} />
        ) : rows.length === 0 && view === 'monthly' ? (
          monthlyMonth
            ? (
              <>
                {err && <div className="card" style={{ padding: '10px 14px' }}><span className="error-text" style={{ margin: 0 }}>{err}</span></div>}
                <MonthlyCollect
                  month={monthlyMonth} canWrite={canWrite}
                  onUpload={(f) => uploadToMonth(f, monthlyMonth)}
                  onEditBatch={(batchId, batchRows) => editBatch(monthlyMonth, batchId, batchRows)}
                  onExportMonth={(monthRows) => exportMonth(monthlyMonth, monthRows)}
                />
              </>
            )
            : <MonthList onPick={(m) => { setMonthlyMonth(m); setErr(null); }} />
        ) : rows.length === 0 ? (
          <>
            <div
              className="card"
              style={{ padding: 44, textAlign: 'center', border: dragOver ? '2px dashed var(--accent)' : undefined, background: dragOver ? 'var(--accent-tint)' : undefined }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
            >
              <div style={{ fontSize: 15, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>Import a reimbursement report</div>
              <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                Drag &amp; drop the CSV exported from payroll (RazorpayX) here, or click to browse. Then edit the numbers /
                project and export it for Zoho Books.
              </p>
              {canWrite && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => inputRef.current?.click()}>⬇ Import CSV</button>}
              {err && <div className="error-text" style={{ marginTop: 10 }}>{err}</div>}
              <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
            </div>
            <ExportHistory history={history} onOpen={openExport} onEdit={loadExport} onDelete={deleteExport} canWrite={canWrite} />
          </>
        ) : (
          <>
            {err && <div className="card" style={{ padding: '10px 14px' }}><span className="error-text" style={{ margin: 0 }}>{err}</span></div>}
            <TileRow>
              <Tile label="Reimbursements" value={String(rows.length / 2)} sub={fileName} />
              <Tile label="Total" value={inr(total)} tone="accent" />
              <Tile label="Journal rows" value={String(rows.length)} />
              <Tile label="Unassigned project" value={String(unassigned)} tone={unassigned > 0 ? 'bad' : 'ok'} />
            </TileRow>

            <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 12 }}>Reference starts at</span>
              <input className="input mono" style={{ width: 90 }} value={refStart} onChange={(e) => setRefStart(e.target.value)} />
              <span className="muted" style={{ fontSize: 12 }}>Journal starts at</span>
              <input className="input mono" style={{ width: 90 }} value={journalStart} onChange={(e) => setJournalStart(e.target.value)} />
              <button className="btn btn-sm" onClick={applyNumbering}>Apply numbering</button>
              <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
              <SuggestInput value={bulk} options={projectNames} onChange={setBulk} placeholder="pick project for all rows" style={{ width: 200 }} />
              <button className="btn btn-sm" onClick={applyProject} disabled={!bulk.trim()}>Apply to all</button>
              <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
              <span className="muted" style={{ fontSize: 12 }}>Save as</span>
              <SuggestInput value={saveName} options={projectNames} onChange={setSaveName} placeholder="file name (optional)" style={{ width: 170 }} />
              <input className="input" style={{ width: 200, marginLeft: 'auto' }} value={q} placeholder="🔍 filter by name / keyword" onChange={(e) => setQ(e.target.value)} />
            </div>

            {monthTarget && (
              <div className="card" style={{ padding: '9px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="chip chip-gray">Monthly upload · {fmtMonth(monthTarget.month)}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  Edit projects / numbering, then <strong>{monthTarget.batchId ? 'Save changes' : 'Save to month'}</strong> — it’s filed under this month on its own.
                </span>
              </div>
            )}

            {/* Date range filter removed — not needed here */}

            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Date</th><th>Reference</th><th>Journal</th><th>Account</th><th>Purpose</th><th>Notes</th>
                      <th>Description</th><th className="th-num">Debit</th><th className="th-num">Credit</th>
                      <th>Project</th><th>Approved on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.key}>
                        <td className="faint">{r.date}</td>
                        <td><input className="input mono" style={{ width: 110 }} value={r.refNo} onChange={(e) => setCell(r.key, 'refNo', e.target.value)} /></td>
                        <td><input className="input mono" style={{ width: 80 }} value={r.journalNo} onChange={(e) => setCell(r.key, 'journalNo', e.target.value)} /></td>
                        <td style={{ fontWeight: r.description === 'Amount Payable' ? 500 : 400 }}>{r.account}</td>
                        {/* Purpose: retag the expense (debit) row's account to a real sub-expense.
                            UI only — it writes into `account`, so nothing extra is exported. */}
                        <td style={{ minWidth: 190 }}>{r.description === 'Amount Receiver'
                          ? <SuggestInput value={r.account} options={subExpenseOpts} onChange={(v) => setCell(r.key, 'account', v)} placeholder="type or pick sub-expense" style={{ minWidth: 180 }} />
                          : <span className="faint" style={{ fontSize: 11 }}>—</span>}</td>
                        <td style={{ maxWidth: 220, whiteSpace: 'pre-wrap' }}>{r.notes}</td>
                        <td className="faint" style={{ fontSize: 11.5 }}>{r.description}</td>
                        <td className="td-num mono">{r.debit === '' ? '' : inr(r.debit)}</td>
                        <td className="td-num mono">{r.credit === '' ? '' : inr(r.credit)}</td>
                        <td><SuggestInput value={r.project} options={projectNames} onChange={(v) => setCell(r.key, 'project', v)} placeholder="pick project" style={{ width: 170 }} /></td>
                        <td className="faint" style={{ fontSize: 11 }}>{r.approvedOn || '—'}</td>
                      </tr>
                    ))}
                    {shown.length === 0 && <tr><td colSpan={11} className="pad faint" style={{ textAlign: 'center' }}>No rows match “{q}”.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
              Each reimbursement = two rows (Amount Receiver debit + Amount Payable credit) sharing a journal number.
              Use <strong>Purpose</strong> on the debit row to retag its account to any sub-expense — it overwrites the
              Account, so the export stays the normal single Account column.
              Edit any Reference / Journal / Project cell, or set the start values and click <strong>Apply numbering</strong>.
              <strong> Project</strong> and <strong>Purpose</strong> are standalone text fields; values are not loaded
              from any accounting, CRM, project, or master-data system.
              Prefix (JNR-), Journal Type (both) and Currency (INR) are added automatically on export.
            </p>

            {/* Global export history is rendered on Quick export landing page only */}
          </>
        )}
      </div>
    </>
  );
}

function ExportHistory({ history, onOpen, onEdit, onDelete, canWrite }: {
  history: ReturnType<typeof useReimbExports>;
  onOpen: (path: string) => void;
  onEdit: (e: ReimbExport) => void;
  onDelete: (e: ReimbExport) => void;
  canWrite: boolean;
}) {
  const list = history.data ?? [];
  if (list.length === 0) return null;
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--line)' }}>Export history</div>
      <table className="grid">
        <thead>
          <tr><th>Exported on</th><th>File</th><th className="th-num">Rows</th><th>Approved</th><th></th></tr>
        </thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td className="mono faint">{e.filename}</td>
              <td className="td-num">{e.row_count}</td>
              <ApprovedCell path={e.storage_path} />
              <td className="td-num" style={{ whiteSpace: 'nowrap' }}>
                {canWrite && <button className="btn btn-ghost btn-sm" title="Load into the editor to change and re-export" onClick={() => onEdit(e)}>✎ Edit</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => onOpen(e.storage_path)}>Download</button>
                {canWrite && <button className="btn btn-ghost btn-sm" title="Delete this export" onClick={() => onDelete(e)}>✕</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The latest approval date inside a past export, read from its stored CSV (cached).
function ApprovedCell({ path }: { path: string }) {
  const { data, isLoading } = useReimbApprovedOn(path);
  return <td className="faint" style={{ whiteSpace: 'nowrap' }}>{isLoading ? '…' : (data || '—')}</td>;
}

// A soft accent-tinted badge holding a monochrome icon — blends with the paper UI.
function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span style={{
      width: 40, height: 40, borderRadius: 11, flexShrink: 0,
      background: 'var(--accent-tint)', color: 'var(--accent-deep)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</span>
  );
}
const svgProps = { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const UploadIcon = () => (
  <svg {...svgProps}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);
const CalendarIcon = () => (
  <svg {...svgProps}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
);
const SaveIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);
const ExportIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const ChevronDown = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const PdfIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const CsvIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 13h8" />
    <path d="M8 17h8" />
    <path d="M12 9v12" />
  </svg>
);

// Dropdown for export options (PDF + Zoho)
function ExportDropdown({ onPdf, onZoho, busy }: { onPdf: () => void; onZoho: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Close on outside click
  const close = () => setOpen(false);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <ExportIcon /> {busy ? 'Exporting…' : 'Export'} <ChevronDown />
      </button>
      {open && (
        <>
          {/* Invisible overlay to catch outside clicks */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={close} />
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 100,
            background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 180, overflow: 'hidden',
          }}>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', textAlign: 'left', borderRadius: 0, padding: '10px 14px', fontSize: 13, justifyContent: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              onClick={() => { onPdf(); close(); }}
            >
              <PdfIcon /> Export as PDF
            </button>
            <div style={{ height: 1, background: 'var(--line)' }} />
            <button
              className="btn btn-ghost"
              style={{ width: '100%', textAlign: 'left', borderRadius: 0, padding: '10px 14px', fontSize: 13, justifyContent: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              onClick={() => { onZoho(); close(); }}
            >
              <CsvIcon /> Export to Zoho
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Landing screen: pick between the one-off export and the month-long collector.
function ModeChooser({ onQuick, onMonthly }: { onQuick: () => void; onMonthly: () => void }) {
  const card: CSSProperties = { padding: 26, textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 12, alignContent: 'start' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <button className="card" style={card} onClick={onQuick}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconBadge><UploadIcon /></IconBadge>
          <span style={{ fontSize: 15, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>Quick export</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          Import one reimbursement report, edit the reference / journal numbers and project, and export it to Zoho Books
          straight away. Same as before.
        </p>
        <span className="btn btn-primary btn-sm" style={{ justifySelf: 'start', marginTop: 2 }}>Open →</span>
      </button>
      <button className="card" style={card} onClick={onMonthly}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconBadge><CalendarIcon /></IconBadge>
          <span style={{ fontSize: 15, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>Monthly collection</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          Pick a month and upload reimbursements as they come in through the month. Duplicates are highlighted so you
          can drop them, and at month-end you export the whole month together.
        </p>
        <span className="btn btn-primary btn-sm" style={{ justifySelf: 'start', marginTop: 2 }}>Open →</span>
      </button>
    </div>
  );
}

// Month picker as a table of big, clickable rows — click a month to open its collection page.
function MonthList({ onPick }: { onPick: (month: string) => void }) {
  const months = useMemo(() => recentMonths(12), []);
  const monthCounts = useReimbPendingMonths();
  const counts = monthCounts.data ?? {};
  return (
    <>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--line)' }}>Pick a month to collect into</div>
        <table className="grid">
          <thead>
            <tr><th>Month</th><th className="th-num">Collected</th><th></th></tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m} style={{ cursor: 'pointer' }} onClick={() => onPick(m)}>
                <td style={{ fontSize: 16, fontFamily: 'var(--font-head)', color: 'var(--ink)', padding: '16px 14px' }}>{fmtMonth(m)}</td>
                <td className="td-num">{counts[m] ? <span style={{ fontWeight: 600, color: 'var(--accent-deep)' }}>{counts[m]}</span> : <span className="faint">empty</span>}</td>
                <td className="td-num faint" style={{ whiteSpace: 'nowrap', paddingRight: 16 }}>Open →</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
        Open a month to upload reimbursements into it through the month. The <strong>Collected</strong> count shows how
        many rows are already waiting in each month; export a month from inside its page when it’s complete.
      </p>
    </>
  );
}

// Month page: uploads collected as editable batches, duplicates flagged across the whole
// month, a combined view of everything, and a single export of the full month.
function MonthlyCollect({ month, canWrite, onUpload, onEditBatch, onExportMonth }: {
  month: string; canWrite: boolean;
  onUpload: (file: File) => void;
  onEditBatch: (batchId: string, rows: PendingReimb[]) => void;
  onExportMonth: (rows: PendingReimb[]) => void;
}) {
  const pending = usePendingReimb(month);
  const delRow = useDeletePendingReimb();
  const delBatch = useDeletePendingBatch();
  const clearMonth = useClearPendingMonth();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // The combined month summary (total + duplicates + export) is shown behind one button.
  const [showCombined, setShowCombined] = useState(false);

  const list = pending.data ?? [];
  // A duplicate is only flagged ACROSS uploads: the same key (person + date + amount) must
  // appear in two or more different files. Repeats inside a single upload are left alone.
  const dupKeys = useMemo(() => {
    const byKey = new Map<string, Set<string>>();
    for (const r of list) {
      const s = byKey.get(r.dup_key) ?? new Set<string>();
      s.add(r.batch_id ?? '∅');
      byKey.set(r.dup_key, s);
    }
    return new Set([...byKey.entries()].filter(([, batches]) => batches.size > 1).map(([k]) => k));
  }, [list]);
  const total = list.reduce((a, r) => a + Number(r.amount), 0);

  // Group the collected rows back into the uploads (batches) they came from, newest first.
  const batches = useMemo(() => {
    const map = new Map<string, PendingReimb[]>();
    for (const r of list) { if (!r.batch_id) continue; const a = map.get(r.batch_id) ?? []; a.push(r); map.set(r.batch_id, a); }
    return [...map.entries()].map(([batchId, rows]) => ({
      batchId, rows,
      file: rows[0].source_file || 'upload.csv',
      savedAt: rows.reduce((min, r) => (r.created_at < min ? r.created_at : min), rows[0].created_at),
    })).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }, [list]);

  function downloadBatch(b: { file: string; rows: PendingReimb[] }) {
    downloadCsv(b.file.replace(/\.csv$/i, ''), ZOHO_HEADERS, zohoRowsFromPending(b.rows));
  }
  async function deleteBatch(b: { batchId: string; file: string; rows: PendingReimb[] }) {
    if (await confirm({ title: 'Delete upload', message: `Delete “${b.file}” (${b.rows.length} reimbursement${b.rows.length > 1 ? 's' : ''}) from ${fmtMonth(month)}?`, confirmLabel: 'Delete', danger: true })) {
      delBatch.mutate(b.batchId);
    }
  }
  async function clearAll() {
    if (await confirm({ title: 'Clear month', message: `Remove everything collected in ${fmtMonth(month)}? This can’t be undone.`, confirmLabel: 'Clear', danger: true })) clearMonth.mutate(month);
  }
  // Keep one of each cross-file duplicate and delete the rest.
  async function removeDuplicates() {
    const seen = new Set<string>(); const toDelete: string[] = [];
    for (const r of list) if (dupKeys.has(r.dup_key)) { if (seen.has(r.dup_key)) toDelete.push(r.id); else seen.add(r.dup_key); }
    if (toDelete.length === 0) return;
    if (await confirm({ title: 'Remove duplicates', message: `Delete ${toDelete.length} duplicate row(s), keeping one of each in ${fmtMonth(month)}?`, confirmLabel: 'Remove', danger: true })) delRow.mutate(toDelete);
  }

  const dupRows = list.filter((r) => dupKeys.has(r.dup_key));

  if (showCombined) {
    /* Duplicates view: the month's total and the duplicate reimbursements. */
    return (
      <>
        <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>Duplicates · {fmtMonth(month)}</span>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowCombined(false)}>← Back</button>
        </div>

        <TileRow>
          <Tile label="Reimbursements" value={String(list.length)} sub={`${batches.length} upload${batches.length === 1 ? '' : 's'}`} />
          <Tile label="Month total" value={inr(total)} tone="accent" />
          <Tile label="Duplicates" value={String(dupRows.length)} tone={dupRows.length > 0 ? 'bad' : 'ok'} />
        </TileRow>

        {dupRows.length > 0 ? (
          <div className="card" style={{ overflow: 'hidden', border: '1px solid var(--bad-bg)' }}>
            <div style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12.5, color: 'var(--bad)', borderBottom: '1px solid var(--line)' }}>
              {dupRows.length} duplicate{dupRows.length > 1 ? 's' : ''} — same person, date &amp; amount
            </div>
            <table className="grid">
              <thead><tr><th>Date</th><th>Name</th><th className="th-num">Amount</th><th>Source</th><th></th></tr></thead>
              <tbody>
                {dupRows.map((r) => (
                  <tr key={r.id} style={{ background: 'rgba(190, 70, 60, 0.07)' }}>
                    <td className="faint">{r.entry_date}</td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td className="td-num mono">{inr(Number(r.amount))}</td>
                    <td className="mono faint" style={{ fontSize: 11 }}>{r.source_file}</td>
                    <td className="td-num" style={{ whiteSpace: 'nowrap' }}>
                      {canWrite && <button className="btn btn-ghost btn-sm" title="Remove this reimbursement" onClick={() => delRow.mutate([r.id])}>✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <span className="chip chip-ok">No duplicates in {fmtMonth(month)}</span>
          </div>
        )}

        {canWrite && dupRows.length > 0 && (
          <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" title="Keep one of each duplicate and delete the rest" onClick={removeDuplicates} disabled={delRow.isPending}>🧹 Remove duplicates</button>
            <button className="btn btn-sm" onClick={clearAll} disabled={clearMonth.isPending}>Clear month</button>
          </div>
        )}
      </>
    );
  }

  /* Month landing — same shape as Quick export: an upload dropzone, then the history. */
  return (
    <>
      <div
        className="card"
        style={{ padding: 44, textAlign: 'center', border: dragOver ? '2px dashed var(--accent)' : undefined, background: dragOver ? 'var(--accent-tint)' : undefined }}
        onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f && canWrite) onUpload(f); }}
      >
        <div style={{ fontSize: 15, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>Import a reimbursement report into {fmtMonth(month)}</div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
          Drag &amp; drop the RazorpayX CSV here, or click to browse. It opens the editor — set the numbers / projects, then
          <strong> Save to month</strong> to file it under this month.
        </p>
        {canWrite && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => inputRef.current?.click()}>⬇ Import CSV</button>}
        <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
      </div>

      {batches.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--line)' }}>Uploads in {fmtMonth(month)}</div>
          <table className="grid">
            <thead>
              <tr><th>Saved on</th><th>File</th><th className="th-num">Rows</th><th>Approved</th><th></th></tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batchId}>
                  <td>{new Date(b.savedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="mono faint">{b.file}</td>
                  <td className="td-num">{b.rows.length}</td>
                  <td className="faint" style={{ whiteSpace: 'nowrap' }}>{batchApproved(b.rows)}</td>
                  <td className="td-num" style={{ whiteSpace: 'nowrap' }}>
                    {canWrite && <button className="btn btn-ghost btn-sm" title="Reopen in the editor to change and re-save" onClick={() => onEditBatch(b.batchId, b.rows)}>✎ Edit</button>}
                    <button className="btn btn-ghost btn-sm" title="Download this upload as a Zoho CSV" onClick={() => downloadBatch(b)}>Download</button>
                    {canWrite && <button className="btn btn-ghost btn-sm" title="Delete this upload" onClick={() => deleteBatch(b)}>✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom: view duplicates/total, or open the combined editor to export. */}
      {list.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>{list.length} reimbursement{list.length > 1 ? 's' : ''} · {inr(total)}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className={`btn btn-sm${dupRows.length > 0 ? ' btn-danger' : ''}`} title="See the month total and any duplicate reimbursements" onClick={() => setShowCombined(true)}>
              {dupRows.length > 0 ? `⚠ ${dupRows.length} duplicate${dupRows.length > 1 ? 's' : ''}` : '👁 Duplicates'}
            </button>
            <button className="btn btn-primary btn-sm" title="Open the whole month in the editor to review and export" onClick={() => onExportMonth(list)}>📊 Combined →</button>
          </span>
        </div>
      )}
    </>
  );
}
