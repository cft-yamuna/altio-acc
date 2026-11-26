import { useEffect, useState, type ReactNode } from 'react';
import { inrSymbol } from '../../lib/inr';
import { fmtDate } from '../../lib/dates';
import { useConfirm } from '../../components/ConfirmDialog';
import {
  billLabel, isImagePath, requestError, useBillUrls, useReviewRequest, useWithdrawRequest,
  type ReimbRequest, type RequestStatus,
} from './hooks';

const STATUS: Record<RequestStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'chip-warn' },
  approved: { label: 'Approved', cls: 'chip-ok' },
  rejected: { label: 'Rejected', cls: 'chip-bad' },
};

export function StatusChip({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

export function fmtStamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * One request in full. `mode` decides the actions in the footer:
 *  - 'owner': the requester — can withdraw while pending
 *  - 'admin': approve / reject (any request, their own included)
 */
export function RequestDrawer({
  request, mode, onClose,
}: {
  request: ReimbRequest;
  mode: 'owner' | 'admin';
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const review = useReviewRequest();
  const withdraw = useWithdrawRequest();
  const [note, setNote] = useState(request.review_note);
  const [err, setErr] = useState<string | null>(null);
  const busy = review.isPending || withdraw.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function decide(status: RequestStatus) {
    setErr(null);
    if (status === 'rejected' && !note.trim()) {
      setErr('Add a reason so the employee knows why it was rejected.');
      return;
    }
    // Only a change of decision needs confirming; saving an edited note doesn't.
    if (status !== request.status) {
      const verb = status === 'approved' ? 'Approve' : status === 'rejected' ? 'Reject' : 'Move back to pending';
      const ok = await confirm({
        title: `${verb} request`,
        message: <>{verb} <strong>{inrSymbol(request.amount)}</strong> for {request.user_name || request.user_email}?</>,
        confirmLabel: verb,
        danger: status === 'rejected',
      });
      if (!ok) return;
    }
    try {
      await review.mutateAsync({ id: request.id, status, note });
      onClose();
    } catch (e) {
      setErr(requestError(e));
    }
  }

  async function doWithdraw() {
    setErr(null);
    const ok = await confirm({
      title: 'Withdraw request',
      message: 'Withdraw this request? It and its bills will be deleted.',
      confirmLabel: 'Withdraw',
      danger: true,
    });
    if (!ok) return;
    try {
      await withdraw.mutateAsync(request);
      onClose();
    } catch (e) {
      setErr(requestError(e));
    }
  }

  return (
    <div className="drawer-overlay" onMouseDown={() => !busy && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="req-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div id="req-title" className="drawer-title">{inrSymbol(request.amount)} · {request.category || 'Reimbursement'}</div>
            <div className="drawer-sub">
              {request.user_name ? `${request.user_name} · ` : ''}{request.user_email} · submitted {fmtStamp(request.created_at)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusChip status={request.status} />
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <div className="field-grid">
              <Field label="Expense date">{fmtDate(request.expense_date)}</Field>
              <Field label="Category">{request.category || '—'}</Field>
              <Field label="Amount" mono>{inrSymbol(request.amount)}</Field>
              <Field label="Project">{request.project || '—'}</Field>
              <Field label="Reason"><span style={{ whiteSpace: 'pre-wrap' }}>{request.reason}</span></Field>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">Bills ({request.bill_paths.length})</div>
            <Bills paths={request.bill_paths} />
          </div>

          {(request.status !== 'pending' || mode === 'admin') && (
            <div className="drawer-section">
              <div className="drawer-section-title">Decision</div>
              {request.status !== 'pending' && (
                <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
                  {STATUS[request.status].label} by {request.reviewed_by ?? '—'} on {fmtStamp(request.reviewed_at)}
                </p>
              )}
              {mode === 'admin' ? (
                <label className="form-field" style={{ marginBottom: 0 }}>
                  <span className="form-label">Note to employee {request.status === 'pending' ? '(required to reject)' : ''}</span>
                  <textarea
                    className="input"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Approved — will be paid with this month’s salary"
                    style={{ resize: 'vertical' }}
                  />
                </label>
              ) : request.review_note ? (
                <div className="card" style={{ padding: '10px 12px', fontSize: 12.5, whiteSpace: 'pre-wrap', boxShadow: 'none' }}>{request.review_note}</div>
              ) : request.status !== 'pending' ? (
                <p className="faint" style={{ margin: 0, fontSize: 12 }}>No note added.</p>
              ) : null}
            </div>
          )}

          {err && <div className="error-text" style={{ marginTop: 12 }}>{err}</div>}
        </div>

        <div className="drawer-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'owner' && request.status === 'pending' && (
              <button className="btn btn-danger" onClick={doWithdraw} disabled={busy}>
                {withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
              </button>
            )}
            {mode === 'admin' && (
              request.status === 'pending' ? (
                <>
                  <button className="btn btn-danger" onClick={() => decide('rejected')} disabled={busy}>Reject</button>
                  <button className="btn btn-primary" onClick={() => decide('approved')} disabled={busy}>
                    {review.isPending ? 'Saving…' : 'Approve'}
                  </button>
                </>
              ) : (
                <>
                  {note.trim() !== request.review_note && (
                    <button className="btn" onClick={() => decide(request.status)} disabled={busy}>Save note</button>
                  )}
                  <button className="btn" onClick={() => decide('pending')} disabled={busy}>Move back to pending</button>
                </>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value"><div className={`field-ro${mono ? ' mono' : ''}`}>{children}</div></div>
    </div>
  );
}

function Bills({ paths }: { paths: string[] }) {
  const urls = useBillUrls(paths);
  if (paths.length === 0) return <p className="faint" style={{ margin: 0, fontSize: 12 }}>No bills attached.</p>;
  if (urls.isError) return <div className="error-text">Couldn’t load the bills. {requestError(urls.error)}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {paths.map((p) => {
        const url = urls.data?.[p];
        return (
          <a
            key={p}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="card"
            title={`Open ${billLabel(p)}`}
            style={{ display: 'grid', gap: 6, padding: 8, textDecoration: 'none', color: 'var(--txt)', boxShadow: 'none', pointerEvents: url ? undefined : 'none' }}
          >
            <div style={{ height: 96, borderRadius: 'var(--radius-sm)', background: 'var(--gray-bg)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
              {url && isImagePath(p)
                ? <img src={url} alt={billLabel(p)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{urls.isLoading ? '…' : /\.pdf$/i.test(p) ? 'PDF' : 'FILE'}</span>}
            </div>
            <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{billLabel(p)}</span>
          </a>
        );
      })}
    </div>
  );
}
