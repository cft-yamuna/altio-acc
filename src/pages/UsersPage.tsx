import { useMemo, useState } from 'react';
import { PageHeader } from '../components/AppLayout';
import { Modal } from '../components/Modal';
import { Tile, TileRow } from '../components/Tile';
import { useConfirm } from '../components/ConfirmDialog';
import { REQUEST_DOMAIN, useAuth, type Member, type MemberRole } from '../auth/AuthProvider';
import { fmtDate } from '../lib/dates';
import { EMAIL_RE, memberError, useAddMember, useMembers, useRemoveMember, useUpdateMember } from './users/hooks';

const ROLES: { value: MemberRole; label: string; help: string }[] = [
  { value: 'employee', label: 'Employee', help: 'Submits their own reimbursement requests and sees only those.' },
  { value: 'admin', label: 'Admin', help: 'Also sees every request, approves or rejects them, and manages users.' },
];

/** Admin view: who can sign in, their role, and whether they get the Zoho export workspace. */
export function UsersPage() {
  const { isAdmin, member: me } = useAuth();
  const members = useMembers(isAdmin);
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const rows = members.data ?? [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((m) => m.email.includes(needle) || m.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);
  const admins = rows.filter((m) => m.role === 'admin').length;
  const employees = rows.length - admins;
  const zohoCount = rows.filter((m) => m.zoho_access).length;
  const outside = rows.filter((m) => !m.email.endsWith(REQUEST_DOMAIN)).length;
  const [roleFilter, setRoleFilter] = useState<MemberRole | 'all'>('all');
  const listed = roleFilter === 'all' ? shown : shown.filter((m) => m.role === roleFilter);

  async function change(m: Member, patch: Partial<Pick<Member, 'role' | 'zoho_access'>>) {
    setErr(null);
    if (patch.role && patch.role !== m.role) {
      const ok = await confirm({
        title: 'Change role',
        message: <>Make <strong>{m.email}</strong> {patch.role === 'admin' ? 'an admin? They’ll see every request and can manage users.' : 'an employee? They’ll lose admin access.'}</>,
        confirmLabel: 'Change role',
      });
      if (!ok) return;
    }
    try { await update.mutateAsync({ email: m.email, patch }); } catch (e) { setErr(memberError(e)); }
  }

  async function doRemove(m: Member) {
    setErr(null);
    const company = m.email.endsWith(REQUEST_DOMAIN);
    const ok = await confirm({
      title: 'Remove user',
      message: company
        ? <>Remove <strong>{m.email}</strong> from this list? As a company account they can still sign in as an employee, but they lose any admin or Zoho access.</>
        : <>Remove <strong>{m.email}</strong>? They won’t be able to sign in any more. Requests they already submitted are kept.</>,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try { await remove.mutateAsync(m.email); } catch (e) { setErr(memberError(e)); }
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={`Add people who can sign in and choose their role. Anyone with an ${REQUEST_DOMAIN} Google account can already sign in as an employee.`}
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add user</button>}
      />
      <div style={{ padding: 26, display: 'grid', gap: 16 }}>
        <TileRow>
          <Tile label="Total users" value={String(rows.length)} sub={`${outside} outside ${REQUEST_DOMAIN}`} tone="accent" onClick={() => setRoleFilter('all')} active={roleFilter === 'all'} />
          <Tile label="Admins" value={String(admins)} sub="approve requests, manage users" onClick={() => setRoleFilter('admin')} active={roleFilter === 'admin'} />
          <Tile label="Employees" value={String(employees)} sub="submit their own requests" onClick={() => setRoleFilter('employee')} active={roleFilter === 'employee'} />
          <Tile label="Zoho export access" value={String(zohoCount)} sub="accounts workspace" />
        </TileRow>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {roleFilter === 'all' ? 'Everyone' : roleFilter === 'admin' ? 'Admins only' : 'Employees only'} · {listed.length} shown
            {roleFilter !== 'all' && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setRoleFilter('all')}>Show all</button>}
          </span>
          <input className="input" style={{ width: 260, marginLeft: 'auto' }} value={q} placeholder="🔍 search email or name" onChange={(e) => setQ(e.target.value)} />
        </div>

        {err && <div className="card" style={{ padding: '10px 14px' }}><span className="error-text" style={{ margin: 0 }}>{err}</span></div>}

        <div className="card" style={{ overflow: 'hidden' }}>
          {members.isLoading ? (
            <div className="faint" style={{ padding: 24, textAlign: 'center' }}>Loading users…</div>
          ) : members.isError ? (
            <div className="error-text" style={{ padding: 16 }}>{memberError(members.error)}</div>
          ) : listed.length === 0 ? (
            <div className="faint" style={{ padding: 32, textAlign: 'center' }}>{q ? `No users match “${q}”.` : 'No users here yet.'}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead>
                  <tr><th>User</th><th>Role</th><th>Zoho export</th><th>Added</th><th></th></tr>
                </thead>
                <tbody>
                  {listed.map((m) => {
                    const self = m.email === me?.email;
                    return (
                      <tr key={m.email}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{m.name || m.email.split('@')[0]}{self && <span className="chip chip-gray" style={{ marginLeft: 8 }}>You</span>}</div>
                          <div className="faint" style={{ fontSize: 11 }}>{m.email}</div>
                        </td>
                        <td>
                          <select
                            className="select"
                            style={{ width: 130 }}
                            value={m.role}
                            disabled={self || update.isPending}
                            title={self ? 'You can’t change your own role' : undefined}
                            onChange={(e) => change(m, { role: e.target.value as MemberRole })}
                            aria-label={`Role for ${m.email}`}
                          >
                            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={m.zoho_access}
                              disabled={update.isPending}
                              onChange={(e) => change(m, { zoho_access: e.target.checked })}
                            />
                            {m.zoho_access ? 'Yes' : 'No'}
                          </label>
                        </td>
                        <td className="faint" style={{ fontSize: 11.5 }}>
                          {fmtDate(m.added_at)}
                          {m.added_by && <div style={{ fontSize: 11 }}>by {m.added_by}</div>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {!self && (
                            <button className="btn btn-ghost btn-sm" onClick={() => doRemove(m)} disabled={remove.isPending} title={`Remove ${m.email}`}>
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {adding && <AddUserModal onClose={() => setAdding(false)} existing={rows.map((m) => m.email)} />}
    </>
  );
}

function AddUserModal({ onClose, existing }: { onClose: () => void; existing: string[] }) {
  const add = useAddMember();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('employee');
  const [zoho, setZoho] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = add.isPending;

  async function submit() {
    setErr(null);
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return setErr('Enter a valid email address.');
    if (existing.includes(e)) return setErr('That email has already been added.');
    try {
      await add.mutateAsync({ email: e, name, role, zoho_access: zoho });
      onClose();
    } catch (x) {
      setErr(memberError(x));
    }
  }

  return (
    <Modal
      title="Add user"
      onClose={() => !busy && onClose()}
      width={500}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add user'}</button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="form-field">
          <span className="form-label">Email</span>
          <input className="input" type="email" autoFocus value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-label">Name (optional)</span>
          <input className="input" value={name} placeholder="e.g. Priya Sharma" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="form-field">
          <span className="form-label">Role</span>
          <div style={{ display: 'grid', gap: 8 }}>
            {ROLES.map((r) => (
              <label
                key={r.value}
                className="card"
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', cursor: 'pointer', boxShadow: 'none',
                  ...(role === r.value ? { borderColor: 'var(--accent)', background: 'var(--accent-tint)' } : {}),
                }}
              >
                <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>{r.help}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={zoho} onChange={(e) => setZoho(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <span style={{ fontWeight: 600 }}>Zoho export access</span>
            <span className="muted" style={{ display: 'block', fontSize: 12 }}>The accounts workspace: import the RazorpayX report and export journals to Zoho Books.</span>
          </span>
        </label>

        <p className="faint" style={{ margin: '14px 0 0', fontSize: 11.5, lineHeight: 1.5 }}>
          They sign in with “Continue with Google” using this exact address, so it must be a Google account.
        </p>
        {err && <div className="error-text" style={{ marginTop: 10 }}>{err}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
