import { useMemo, useState } from 'react';
import { PageHeader } from '../components/AppLayout';
import { Tile, TileRow } from '../components/Tile';
import { useAuth } from '../auth/AuthProvider';
import { inr, inrWhole } from '../lib/inr';
import { fmtDate } from '../lib/dates';
import { downloadCsv } from '../lib/csv';
import { requestError, useAllRequests, type RequestStatus } from './requests/hooks';
import { RequestDrawer, StatusChip, fmtStamp } from './requests/RequestDrawer';

type Filter = RequestStatus | 'all';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

/** Admin view: every employee request, approve or reject with a note. */
export function ApprovalsPage() {
  const { session, isAdmin } = useAuth();
  const all = useAllRequests(isAdmin);
  const [filter, setFilter] = useState<Filter>('pending');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = all.data ?? [];
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { pending: 0, approved: 0, rejected: 0, all: rows.length };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const pendingAmount = rows.filter((r) => r.status === 'pending').reduce((a, r) => a + Number(r.amount), 0);
  const approvedAmount = rows.filter((r) => r.status === 'approved').reduce((a, r) => a + Number(r.amount), 0);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (filter === 'all' || r.status === filter) &&
      (!needle || [r.user_name, r.user_email, r.reason, r.category, r.project].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [rows, filter, q]);
  const open = rows.find((r) => r.id === openId) ?? null;

  function exportCsv() {
    const header = ['Submitted', 'Employee', 'Email', 'Expense date', 'Category', 'Project', 'Reason', 'Amount', 'Status', 'Note', 'Reviewed by', 'Reviewed at', 'Bills'];
    const body = shown.map((r) => [
      fmtStamp(r.created_at), r.user_name, r.user_email, r.expense_date, r.category, r.project, r.reason,
      Number(r.amount), r.status, r.review_note, r.reviewed_by ?? '', fmtStamp(r.reviewed_at), r.bill_paths.length,
    ]);
    downloadCsv(`reimbursement-requests-${filter}.csv`, header, body);
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Review employee reimbursement requests and their bills, then approve or reject them."
        actions={<button className="btn" onClick={exportCsv} disabled={shown.length === 0}>⬇ Export CSV</button>}
      />
      <div style={{ padding: 26, display: 'grid', gap: 16 }}>
        <TileRow>
          <Tile label="Waiting for review" value={String(counts.pending)} sub={inrWhole(pendingAmount)} tone={counts.pending ? 'warn' : 'ok'} onClick={() => setFilter('pending')} active={filter === 'pending'} />
          <Tile label="Approved" value={inrWhole(approvedAmount)} sub={`${counts.approved} request${counts.approved === 1 ? '' : 's'}`} tone="ok" onClick={() => setFilter('approved')} active={filter === 'approved'} />
          <Tile label="Rejected" value={String(counts.rejected)} tone={counts.rejected ? 'bad' : 'default'} onClick={() => setFilter('rejected')} active={filter === 'rejected'} />
        </TileRow>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="seg" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={`seg-btn${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label} <span className="faint mono" style={{ fontSize: 11 }}>{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <input className="input" style={{ width: 260, marginLeft: 'auto' }} value={q} placeholder="🔍 search name, email, reason" onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          {all.isLoading ? (
            <div className="faint" style={{ padding: 24, textAlign: 'center' }}>Loading requests…</div>
          ) : all.isError ? (
            <div className="error-text" style={{ padding: 16 }}>{requestError(all.error)}</div>
          ) : shown.length === 0 ? (
            <div className="faint" style={{ padding: 32, textAlign: 'center' }}>
              {q ? `No requests match “${q}”.` : filter === 'pending' ? 'Nothing waiting for review.' : 'No requests here yet.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Submitted</th><th>Employee</th><th>Expense date</th><th>Category</th><th>Reason</th>
                    <th className="th-num">Amount</th><th>Bills</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                      <td className="faint">{fmtDate(r.created_at)}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.user_name || r.user_email.split('@')[0]}</div>
                        <div className="faint" style={{ fontSize: 11 }}>{r.user_email}</div>
                      </td>
                      <td>{fmtDate(r.expense_date)}</td>
                      <td>{r.category || '—'}</td>
                      <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reason}>{r.reason}</td>
                      <td className="td-num mono">{inr(r.amount)}</td>
                      <td className="faint">{r.bill_paths.length}</td>
                      <td><StatusChip status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {open && session && <RequestDrawer request={open} mode="admin" currentUserId={session.user.id} onClose={() => setOpenId(null)} />}
    </>
  );
}
