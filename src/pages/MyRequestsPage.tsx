import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/AppLayout';
import { Modal } from '../components/Modal';
import { Tile, TileRow } from '../components/Tile';
import { useAuth } from '../auth/AuthProvider';
import { inr, inrWhole, parseMoney } from '../lib/inr';
import { fmtDate, toISODate } from '../lib/dates';
import {
  BILL_ACCEPT, CATEGORIES, MAX_BILLS, MAX_BILL_BYTES, requestError, useCreateRequest, useMyRequests,
  type ReimbRequest,
} from './requests/hooks';
import { RequestDrawer, StatusChip } from './requests/RequestDrawer';

/** Employee view: submit a reimbursement with bills and follow its status. */
export function MyRequestsPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const mine = useMyRequests(userId);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = mine.data ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;
  const sum = (s: ReimbRequest['status']) => {
    const list = rows.filter((r) => r.status === s);
    return { count: list.length, amount: list.reduce((a, r) => a + Number(r.amount), 0) };
  };
  const pending = sum('pending');
  const approved = sum('approved');
  const rejected = sum('rejected');

  return (
    <>
      <PageHeader
        title="My reimbursements"
        subtitle="Upload your bills, say what you spent and why, and track the approval."
        actions={<button className="btn btn-primary" onClick={() => setCreating(true)}>+ New request</button>}
      />
      <div style={{ padding: 26, display: 'grid', gap: 16 }}>
        <TileRow>
          <Tile label="Pending" value={inrWhole(pending.amount)} sub={`${pending.count} request${pending.count === 1 ? '' : 's'}`} tone="warn" />
          <Tile label="Approved" value={inrWhole(approved.amount)} sub={`${approved.count} request${approved.count === 1 ? '' : 's'}`} tone="ok" />
          <Tile label="Rejected" value={String(rejected.count)} sub={rejected.count ? 'open one to see why' : undefined} tone={rejected.count ? 'bad' : 'default'} />
        </TileRow>

        <div className="card" style={{ overflow: 'hidden' }}>
          {mine.isLoading ? (
            <div className="faint" style={{ padding: 24, textAlign: 'center' }}>Loading your requests…</div>
          ) : mine.isError ? (
            <div className="error-text" style={{ padding: 16 }}>{requestError(mine.error)}</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>No requests yet</div>
              <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>Spent money on work? Submit it with the bill and an admin will review it.</p>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setCreating(true)}>+ New request</button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Submitted</th><th>Expense date</th><th>Category</th><th>Reason</th>
                    <th className="th-num">Amount</th><th>Bills</th><th>Status</th><th>Note from admin</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                      <td className="faint">{fmtDate(r.created_at)}</td>
                      <td>{fmtDate(r.expense_date)}</td>
                      <td>{r.category || '—'}</td>
                      <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reason}>{r.reason}</td>
                      <td className="td-num mono">{inr(r.amount)}</td>
                      <td className="faint">{r.bill_paths.length}</td>
                      <td><StatusChip status={r.status} /></td>
                      <td className="muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.review_note}>{r.review_note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {creating && <NewRequestModal onClose={() => setCreating(false)} />}
      {open && <RequestDrawer request={open} mode="owner" onClose={() => setOpenId(null)} />}
    </>
  );
}

function NewRequestModal({ onClose }: { onClose: () => void }) {
  const { session } = useAuth();
  const create = useCreateRequest();
  const today = toISODate();
  const [expenseDate, setExpenseDate] = useState(today);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [project, setProject] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = create.isPending;

  const totalMb = useMemo(() => files.reduce((a, f) => a + f.size, 0) / 1024 / 1024, [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setErr(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!(f.type.startsWith('image/') || f.type === 'application/pdf')) { setErr(`“${f.name}” isn’t an image or PDF.`); continue; }
      if (f.size > MAX_BILL_BYTES) { setErr(`“${f.name}” is over 10 MB.`); continue; }
      if (next.length >= MAX_BILLS) { setErr(`You can attach up to ${MAX_BILLS} bills.`); break; }
      next.push(f);
    }
    setFiles(next);
  }

  async function submit() {
    setErr(null);
    const amt = parseMoney(amount);
    if (!expenseDate) return setErr('Pick the date you spent the money.');
    if (expenseDate > today) return setErr('The expense date can’t be in the future.');
    if (!category) return setErr('Pick a category.');
    if (!(amt > 0)) return setErr('Enter the amount you spent.');
    if (!reason.trim()) return setErr('Say why you spent it.');
    if (files.length === 0) return setErr('Attach at least one bill.');
    try {
      await create.mutateAsync({
        userId: session!.user.id,
        userName: String(session?.user.user_metadata?.full_name ?? session?.user.user_metadata?.name ?? ''),
        expenseDate, category, amount: Math.round(amt * 100) / 100, reason, project, files,
      });
      onClose();
    } catch (e) {
      setErr(requestError(e));
    }
  }

  return (
    <Modal
      title="New reimbursement request"
      onClose={() => !busy && onClose()}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <label className="form-field">
          <span className="form-label">Expense date</span>
          <input className="input" type="date" value={expenseDate} max={today} onChange={(e) => setExpenseDate(e.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-label">Amount (₹)</span>
          <input className="input mono" inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-label">Category</span>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>Pick one</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Project (optional)</span>
          <input className="input" value={project} placeholder="e.g. client or event name" onChange={(e) => setProject(e.target.value)} />
        </label>
      </div>
      <label className="form-field">
        <span className="form-label">Why did you spend it?</span>
        <textarea
          className="input"
          rows={3}
          value={reason}
          placeholder="e.g. Cab from office to client site for the Altio demo"
          onChange={(e) => setReason(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </label>

      <div>
        <span className="form-label">Bills</span>
        <div
          className="card"
          style={{ padding: 14, boxShadow: 'none', borderStyle: 'dashed', textAlign: 'center', cursor: 'pointer' }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <span className="muted" style={{ fontSize: 12.5 }}>Drop photos or PDFs of your bills here, or <span style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>browse</span></span>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Up to {MAX_BILLS} files, 10 MB each</div>
        </div>
        <input ref={fileRef} type="file" accept={BILL_ACCEPT} multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {files.length > 0 && (
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span className="faint mono" style={{ fontSize: 11 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setFiles(files.filter((_, j) => j !== i))} disabled={busy} aria-label={`Remove ${f.name}`}>✕</button>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 11 }}>{files.length} file{files.length === 1 ? '' : 's'} · {totalMb.toFixed(1)} MB</div>
          </div>
        )}
      </div>

      {err && <div className="error-text" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}
